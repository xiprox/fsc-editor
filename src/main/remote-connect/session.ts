/**
 * The relay client, and the only place in the app that opens a socket.
 *
 * It lives in the main process for two reasons that both make it not a choice:
 * the packaged app's CSP is `connect-src 'self'`, so the renderer cannot reach
 * the relay at all, and building a manifest means hashing files, which needs a
 * filesystem the renderer does not have.
 *
 * Everything arriving here is treated as hostile. A host is whoever holds a
 * six-character code, so a manifest is a list of paths a stranger chose: every
 * one is checked against the workspace boundary before it is allowed to name a
 * row in the UI, let alone a file on disk.
 */

import fs from "node:fs/promises"

import {
  CLOSE_INTENTIONAL,
  MAX_FILE_BYTES,
  MAX_MANIFEST_ENTRIES,
  type GuestId,
  type HostMessage,
  type ManifestEntry,
  type Presence,
  type RelayFrame,
  type RemoteEvent,
  type RemoteState,
} from "@shared/remote-connect"
import type { ProfileFile } from "@shared/types"

import { listFiles } from "../files"
import { isInside, resolveInside, toRelPath } from "../paths"
import { currentWorkspace } from "../workspace"
import { buildManifest, diffManifests, forgetHashes } from "./manifest"
import {
  clearShared,
  isShared,
  pruneShared,
  selectShared,
  sharedPaths,
} from "./share"

/**
 * The deployed Worker in `relay/`. Override with `FSCE_RELAY_URL` to point at
 * `npm run relay:dev` — `ws://127.0.0.1:8787` — or at your own deployment.
 */
const RELAY_URL =
  process.env.FSCE_RELAY_URL ?? "wss://fsce-relay.ihsan.dev"

/** Attempts to get back after an unexpected drop, inside the relay's grace. */
const RECONNECT_DELAYS_MS = [500, 1500, 4000, 8000]

type Role = "host" | "guest"

interface Live {
  socket: WebSocket
  role: Role
  code: string
  /** Proves a reconnecting host is the same host. Never leaves this process. */
  resume: string
  guests: Set<GuestId>
  /** The host's last published view, to diff the next one against. */
  manifest: ManifestEntry[]
  /** Set while tearing down on purpose, so the close handler stays quiet. */
  stopping: boolean
  attempt: number
}

let live: Live | null = null
let emit: (event: RemoteEvent) => void = () => {}
let retry: ReturnType<typeof setTimeout> | undefined

export function onRemoteEvent(sink: (event: RemoteEvent) => void): void {
  emit = sink
}

function publish(state: RemoteState): void {
  emit({ kind: "state", state })
}

function send(frame: RelayFrame): void {
  if (live?.socket.readyState === WebSocket.OPEN)
    live.socket.send(JSON.stringify(frame))
}

export function remoteState(): RemoteState {
  if (!live) return { phase: "idle" }

  return live.role === "host"
    ? {
        phase: "hosting",
        code: live.code,
        guests: live.guests.size,
        shared: sharedPaths(),
      }
    : { phase: "connected", code: live.code, files: live.manifest }
}

/**
 * Opens a session sharing exactly these profiles.
 *
 * The selection is an argument rather than something set afterwards because a
 * code that exists before the choice does is a code someone can join while the
 * answer to "what does this share?" is still being decided. There is no
 * overload that shares everything: hosting the whole workspace is something a
 * host can choose, not something that can happen by omission.
 */
export async function host(paths: string[]): Promise<void> {
  disconnect()
  selectShared(paths)
  await connect("host", "")
}

export async function join(code: string): Promise<void> {
  disconnect()
  publish({ phase: "connecting", code })
  await connect("guest", code)
}

/**
 * Ends the session on purpose, which is different from dropping: the close code
 * is what tells the relay to kick the guests now rather than hold the session
 * open hoping we come back.
 */
export function disconnect(): void {
  clearTimeout(retry)
  retry = undefined

  if (live) {
    live.stopping = true
    try {
      live.socket.close(CLOSE_INTENTIONAL)
    } catch {
      // Already gone; nothing to tell it.
    }
    live = null
  }

  clearShared()
  forgetHashes()
  publish({ phase: "idle" })
}

async function connect(role: Role, code: string, resume = ""): Promise<void> {
  const url =
    role === "host"
      ? `${RELAY_URL}/host${code ? `?code=${code}&resume=${resume}` : ""}`
      : `${RELAY_URL}/join?code=${code}`

  const socket = new WebSocket(url)

  const session: Live = {
    socket,
    role,
    code,
    resume,
    guests: new Set(),
    manifest: [],
    stopping: false,
    attempt: 0,
  }

  live = session

  socket.addEventListener("message", (event) => {
    if (live === session && typeof event.data === "string")
      void receive(session, event.data)
  })

  socket.addEventListener("close", (event) => {
    if (live === session) onClosed(session, event.reason)
  })

  // An `error` is always followed by `close`, so the reporting lives there and
  // this only stops Node from treating it as unhandled.
  socket.addEventListener("error", () => {})
}

async function receive(session: Live, raw: string): Promise<void> {
  let frame: RelayFrame
  try {
    frame = JSON.parse(raw) as RelayFrame
  } catch {
    return
  }

  switch (frame.type) {
    case "hosting": {
      session.code = frame.code
      session.resume = frame.resume
      session.attempt = 0
      await republish(session)
      return
    }

    case "joined": {
      session.attempt = 0
      publish({ phase: "connected", code: session.code, files: session.manifest })
      return
    }

    case "guest-joined": {
      session.guests.add(frame.guestId)
      // A guest that arrives mid-session has never seen a manifest, and the
      // host is the only one who can say what it is.
      send({
        type: "from-host",
        to: frame.guestId,
        message: { kind: "manifest", files: session.manifest },
      })
      publish(remoteState())
      return
    }

    case "guest-left": {
      session.guests.delete(frame.guestId)
      publish(remoteState())
      return
    }

    case "from-guest": {
      await serveFile(frame.from, frame.message.relPath)
      return
    }

    case "from-host": {
      receiveFromHost(session, frame.message)
      return
    }

    case "closed": {
      session.stopping = true
      live = null
      publish({ phase: "idle", error: describe(frame.reason) })
      return
    }
  }
}

/** Everything the guest learns about the host's workspace arrives here. */
function receiveFromHost(session: Live, message: HostMessage): void {
  const { root } = currentWorkspace()

  switch (message.kind) {
    case "manifest": {
      session.manifest = acceptEntries(root, message.files)
      publish({ phase: "connected", code: session.code, files: session.manifest })
      return
    }

    case "manifest-delta": {
      const changed = acceptEntries(root, message.changed)
      const dropped = new Set(
        message.removed.filter((relPath) => isInside(root, relPath))
      )
      const replaced = new Set(changed.map((entry) => entry.relPath))

      session.manifest = [
        ...session.manifest.filter(
          (entry) => !dropped.has(entry.relPath) && !replaced.has(entry.relPath)
        ),
        ...changed,
      ]

      publish({ phase: "connected", code: session.code, files: session.manifest })
      return
    }

    case "file": {
      if (!isInside(root, message.relPath)) return
      if (message.content.length > MAX_FILE_BYTES) {
        emit({
          kind: "file-error",
          relPath: message.relPath,
          message: "The remote copy is too large to accept.",
        })
        return
      }

      emit({ kind: "file", relPath: message.relPath, content: message.content })
      return
    }

    case "file-error": {
      if (isInside(root, message.relPath))
        emit({
          kind: "file-error",
          relPath: message.relPath,
          message: message.message,
        })
      return
    }

    case "presence": {
      const { activeFile, activeLine, dirty } = message.presence

      // Presence names paths like everything else from a host, and those paths
      // reach the UI, so they go through the same gate.
      emit({
        kind: "presence",
        presence: {
          activeFile:
            activeFile && isInside(root, activeFile) ? activeFile : null,
          activeLine: Number.isFinite(activeLine) ? activeLine : 1,
          dirty: dirty.filter((relPath) => isInside(root, relPath)),
        },
      })
      return
    }
  }
}

/**
 * Drops entries that name somewhere outside the workspace, and caps how many
 * are kept. A host is a stranger with a code, so this is the boundary between
 * their list of paths and anything this app is willing to show or write.
 */
function acceptEntries(root: string, entries: ManifestEntry[]): ManifestEntry[] {
  return entries
    .filter((entry) => isInside(root, entry.relPath))
    .slice(0, MAX_MANIFEST_ENTRIES)
}

/** The host answering one guest's request for one file. */
async function serveFile(to: GuestId, relPath: string): Promise<void> {
  const { root } = currentWorkspace()

  const reply = (message: HostMessage) =>
    send({ type: "from-host", to, message })

  let full: string
  try {
    full = resolveInside(root, relPath)
  } catch {
    // The guest asked for something outside the workspace. Answering with the
    // reason would confirm the shape of the machine to whoever is probing.
    reply({ kind: "file-error", relPath, message: "Not available." })
    return
  }

  // The share set is enforced here and not only when the manifest is built.
  // Leaving it out of the manifest is what stops an *honest* guest asking; this
  // is what stops the other kind, who can name any path they like — one kept
  // from before it was unshared, or simply guessed. Without this, "not shared"
  // would be a statement about the UI rather than about the session.
  //
  // Re-derived from the resolved path rather than trusting the string that
  // arrived, so `./modules/a.yaml` and `modules\a.yaml` are answered the same
  // way as the spelling the host actually chose.
  if (!isShared(toRelPath(root, full))) {
    // Word for word what an out-of-workspace path gets. A different message
    // here would answer a question nobody is entitled to ask — whether a file
    // the host is not sharing exists at all.
    reply({ kind: "file-error", relPath, message: "Not available." })
    return
  }

  try {
    const stat = await fs.stat(full)
    if (stat.size > MAX_FILE_BYTES) {
      reply({ kind: "file-error", relPath, message: "Too large to send." })
      return
    }

    const content = await fs.readFile(full, "utf8")
    reply({ kind: "file", relPath, content })
  } catch {
    reply({ kind: "file-error", relPath, message: "Could not be read." })
  }
}

/**
 * Host → guests: where I am and what I have not saved.
 *
 * Broadcast, unlike a file response — every guest following the session wants
 * it, and it names no content.
 */
export function publishPresence(presence: Presence): void {
  if (live?.role !== "host") return

  // Presence names paths, so it is filtered like everything else that leaves
  // here. A host reading an unshared profile would otherwise announce its
  // filename to every guest — the one fact about it they were not given.
  //
  // The unshared case reports `null` rather than the last shared file, which
  // would be a lie, or a placeholder, which would leak that something is being
  // withheld. To a guest it is indistinguishable from the host looking away.
  send({
    type: "from-host",
    message: {
      kind: "presence",
      presence: {
        activeFile:
          presence.activeFile && isShared(presence.activeFile)
            ? presence.activeFile
            : null,
        activeLine: presence.activeLine,
        dirty: presence.dirty.filter(isShared),
      },
    },
  })
}

/** Guest → host: please send me this file. */
export function requestFile(relPath: string): void {
  if (live?.role !== "guest") return

  send({
    type: "from-guest",
    // Stamped by the relay from the socket it arrived on; whatever is put here
    // is discarded, and it is only present because the frame shape is shared.
    from: "",
    message: { kind: "get-file", relPath },
  })
}

/**
 * The workspace changed while hosting. Publishes what moved rather than the
 * whole list, which is most of the point of hashing in the first place.
 */
export async function filesChanged(files: ProfileFile[]): Promise<void> {
  if (live?.role !== "host") return

  // A profile that has been deleted leaves the selection as well as the
  // manifest, which is `pruneShared`'s whole job.
  pruneShared(files.map((file) => file.relPath))

  await publishDelta(live, files)
}

/**
 * The host changed what they are sharing, mid-session.
 *
 * Ticking a box is not a different kind of event from saving a file: both end
 * as a manifest delta describing what appeared and what went away, which is why
 * unsharing needs no protocol of its own and the guest needs no new code to
 * handle it — a file that leaves the manifest is already something they know
 * how to stop showing.
 */
export async function setShared(paths: string[]): Promise<void> {
  selectShared(paths)
  if (live?.role !== "host") return

  const { root } = currentWorkspace()
  await publishDelta(live, await listFiles(root))
}

/**
 * The single place a manifest is built while a session is running, so the share
 * filter is applied once and cannot be forgotten by one of the callers.
 */
async function publishDelta(session: Live, files: ProfileFile[]): Promise<void> {
  const { root } = currentWorkspace()

  const next = await buildManifest(root, files.filter(sharedFile))
  const delta = diffManifests(session.manifest, next)

  session.manifest = next
  publish(remoteState())

  if (!delta.changed.length && !delta.removed.length) return

  send({
    type: "from-host",
    message: { kind: "manifest-delta", changed: delta.changed, removed: delta.removed },
  })
}

/** A fresh full manifest, for a session that has just opened or reopened. */
async function republish(session: Live): Promise<void> {
  const { root } = currentWorkspace()
  const files = await listFiles(root)

  // Filtered before hashing rather than after: an unshared profile is not
  // opened, not read and not hashed, so the cost of hosting one file out of a
  // hundred is the cost of one file.
  session.manifest = await buildManifest(root, files.filter(sharedFile))
  send({ type: "from-host", message: { kind: "manifest", files: session.manifest } })
  publish(remoteState())
}

function sharedFile(file: ProfileFile): boolean {
  return isShared(file.relPath)
}

function onClosed(session: Live, reason: string): void {
  if (session.stopping) return

  // The relay names the reason in the close frame when it ended the session on
  // purpose. That is final — retrying would only be refused again.
  if (reason) {
    live = null
    publish({ phase: "idle", error: describe(reason) })
    return
  }

  const delay = RECONNECT_DELAYS_MS[session.attempt]
  if (delay === undefined) {
    live = null
    publish({
      phase: "idle",
      error: "Lost the connection and could not get it back.",
    })
    return
  }

  const attempt = session.attempt + 1
  publish(
    session.role === "host"
      ? { phase: "hosting", code: session.code, guests: 0, shared: sharedPaths() }
      : { phase: "connecting", code: session.code }
  )

  retry = setTimeout(() => {
    void connect(session.role, session.code, session.resume).then(() => {
      if (live) live.attempt = attempt
    })
  }, delay)
}

function describe(reason: string): string {
  switch (reason) {
    case "host-left":
      return "The host disconnected, so the session ended."
    case "host-stopped":
      return "The host stopped sharing."
    case "session-full":
      return "That session already has as many peers as it allows."
    case "unknown-code":
      return "No session is using that code."
    case "rate-limited":
      return "Too many attempts. Wait a minute and try again."
    default:
      return "The session ended."
  }
}
