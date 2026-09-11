/**
 * The Remote Connect wire format, shared by the app and the relay.
 * See docs/remote-connect.md for the shape and the trust model.
 *
 * This file is the contract between three parties that ship separately — the
 * host, the guest, and a Worker deployed on its own schedule — so it holds no
 * runtime imports and nothing that is not a type or a constant.
 *
 * Two layers live here and are deliberately not mixed. `RelayFrame` is what the
 * relay reads: an envelope naming who a message came from and who it is for.
 * `HostMessage` and `GuestMessage` are the payloads it carries, which the relay
 * never inspects. Keeping the split honest is what lets the Worker stay a router
 * and lets the protocol change without redeploying it.
 */

/**
 * Excludes `I`, `L`, `O`, `U`, `0` and `1`: codes get read aloud over voice chat
 * and typed by someone who is looking at a sim, so the pairs that get misheard
 * or mistyped are simply not in the alphabet. `U` goes too — it is the one
 * letter that turns a random code into a word people will not want to read out.
 */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ"

export const CODE_LENGTH = 6

/** Where the hyphen goes when a code is shown to a person: `K7RM2Q` → `K7R-M2Q`. */
export const CODE_GROUP = 3

/**
 * One host plus this many guests. A cap rather than a design limit: it bounds
 * what a broadcast costs and what a runaway client can do to the relay.
 */
export const MAX_GUESTS = 8

/**
 * Sanity guards on anything arriving over the network, not product limits. A
 * profile is a few kilobytes; anything approaching these is a broken or hostile
 * host, and the guest should refuse it rather than try to render it.
 *
 * Both sit well inside Cloudflare's 32 MiB per-message ceiling, so a file is
 * always one frame and the protocol needs no chunking.
 */
export const MAX_FILE_BYTES = 16 * 1024 * 1024
export const MAX_MANIFEST_ENTRIES = 20_000

/**
 * How long the relay holds a session open after the host's socket drops.
 *
 * "The host leaves and the session ends" is the rule, and this is what keeps a
 * dropped wifi connection from counting as leaving. Long enough to cover a
 * reconnect, short enough that a closed laptop does not hold a code.
 */
export const HOST_GRACE_MS = 30_000

/**
 * Close codes in the 4000 range, which is the block WebSocket reserves for the
 * application. The relay reads the first to tell leaving from dropping; the
 * guest reads the second to learn why its session ended, since `CloseReason`
 * travels in the close frame's reason text.
 */
export const CLOSE_INTENTIONAL = 4001
export const CLOSE_SESSION_ENDED = 4002

/** Identifies one connected guest for the life of its socket. */
export type GuestId = string

/** One file as the host sees it. Enough to colour a row, without its contents. */
export interface ManifestEntry {
  /** Path relative to the host's workspace root, always forward-slashed. */
  relPath: string
  size: number
  mtimeMs: number
  /**
   * SHA-256 of the file with newlines normalized to `\n`.
   *
   * Normalized because the two ends are separate Windows installs with their own
   * checkout habits: hashing raw bytes would report every file as differing the
   * moment one side wrote CRLF, which is the common case and would make the
   * whole comparison useless.
   */
  hash: string
}

/**
 * Where the host's attention is, and what they have not saved yet.
 *
 * Deliberately not "is typing". Keystrokes flicker between every pause, and they
 * do not answer the question a guest following along actually has, which is
 * *"is what I am looking at current?"* — that is answered by whether the host has
 * unsaved changes, which is a steady state rather than an event.
 *
 * The draft itself is never sent. A half-written `set:` expression is not
 * something a guest can act on, and the moment it becomes actionable is the save
 * — which arrives as a manifest delta like any other change. This says *wait*;
 * the save says *ready*.
 */
export interface Presence {
  /** The profile the host is looking at, relative to their root. */
  activeFile: string | null
  /** 1-based first visible line, which the guest resolves to a section name. */
  activeLine: number
  /** Profiles with unsaved changes on the host. */
  dirty: string[]
}

/**
 * How a local file compares to the host's copy of it.
 *
 * There is deliberately no "only on my machine". Sharing runs one way — a guest
 * pulls from a host and can never push — so a profile the host does not have is
 * not something the session can act on, and listing it would offer a row with no
 * available verb. It would become meaningful the day sending does.
 */
export type FileStatus = "identical" | "modified" | "remote-only"

export type HostMessage =
  | { kind: "manifest"; files: ManifestEntry[] }
  | {
      kind: "manifest-delta"
      changed: ManifestEntry[]
      removed: string[]
    }
  /**
   * No hash: the guest already has one for this path from the manifest, and a
   * second copy travelling beside the content could only ever disagree with it.
   */
  | { kind: "file"; relPath: string; content: string }
  /** A file the guest asked for that the host could not read. */
  | { kind: "file-error"; relPath: string; message: string }
  | { kind: "presence"; presence: Presence }

export type GuestMessage = { kind: "get-file"; relPath: string }

/** Why a session ended, phrased for the guest who is about to be told. */
export type CloseReason =
  | "host-left"
  | "host-stopped"
  | "session-full"
  | "unknown-code"
  | "rate-limited"

export type RelayFrame =
  /** Guest → relay. The only frame sent before a session exists. */
  | { type: "join"; code: string }
  /**
   * Relay → host, on success. `resume` is what proves, if the socket drops and
   * comes back inside the grace window, that this is the same host — the code
   * alone admits a guest and must not also hand over the session.
   */
  | { type: "hosting"; code: string; resume: string }
  /** Relay → guest, on success. */
  | { type: "joined"; guestId: GuestId }
  /** Relay → host. */
  | { type: "guest-joined"; guestId: GuestId }
  | { type: "guest-left"; guestId: GuestId }
  /**
   * Host → relay → guests. `to` picks one guest; omitting it broadcasts, which
   * is what a manifest does and what a file response must never do.
   */
  | { type: "from-host"; to?: GuestId; message: HostMessage }
  /** Guest → relay → host. `from` is filled in by the relay, never the sender. */
  | { type: "from-guest"; from: GuestId; message: GuestMessage }
  | { type: "closed"; reason: CloseReason }

/** What the main process tells the renderer about the session. */
export type RemoteState =
  | { phase: "idle"; error?: string }
  /**
   * `shared` is the host's own choice, echoed back rather than kept in the
   * renderer, so the checkboxes on screen and the filter the manifest is built
   * through cannot drift apart. It names paths, not a count: the panel needs
   * both, and a count derived from the list is one that cannot disagree with it.
   */
  | { phase: "hosting"; code: string; guests: number; shared: string[] }
  | { phase: "connecting"; code: string }
  | { phase: "connected"; code: string; files: ManifestEntry[] }

export type RemoteEvent =
  | { kind: "state"; state: RemoteState }
  /** A file the guest asked for has arrived, or failed to. */
  | { kind: "file"; relPath: string; content: string }
  | { kind: "file-error"; relPath: string; message: string }
  /**
   * Separate from `state` because it changes on a different clock: presence
   * ticks while somebody types, and folding it into the session state would
   * republish the whole manifest each time.
   */
  | { kind: "presence"; presence: Presence }

/** `K7RM2Q` → `K7R-M2Q`. The hyphen is presentation only and never sent. */
export function formatCode(code: string): string {
  return code.length > CODE_GROUP
    ? `${code.slice(0, CODE_GROUP)}-${code.slice(CODE_GROUP)}`
    : code
}

/**
 * Accepts what a person actually types: lowercase, the display hyphen, spaces
 * pasted along from a chat message.
 *
 * Returns null rather than a partial code, so a caller cannot half-succeed.
 */
export function parseCode(input: string): string | null {
  const cleaned = input.toUpperCase().replace(/[^A-Z0-9]/g, "")

  if (cleaned.length !== CODE_LENGTH) return null
  if (![...cleaned].every((char) => CODE_ALPHABET.includes(char))) return null

  return cleaned
}
