/**
 * The app's half of the Link protocol.
 *
 * Turns the module's ClientData messages into `SimEvent`s and hands them to the
 * same emit the SimConnect client uses. Nothing downstream knows or cares which
 * transport an event arrived on — that is what `via` is for, and it exists so
 * this file can stay a translator rather than a second source of truth.
 *
 * Deliberately separate from `session.ts`: that file owns a SimConnect
 * connection and knows about aircraft and input events, and this one owns a
 * protocol. Folding them together would make the module's absence — the normal
 * case, until somebody installs it — a branch in every function there.
 */

import {
  formatLinkCommand,
  LINK_AREA_BYTES,
  LINK_CMD,
  LINK_OUT,
  LINK_PROTOCOL,
  WATCH_HANDLE_BASE,
  parseExecLine,
  parseLinkMessage,
  parseNameLine,
  parseWatchedLine,
  parseValueLine,
  RESOLUTION_PROTOCOL,
  type LinkCommand,
  type LinkMessage,
  type WatchedRef,
} from "@shared/link"
import type { SimEvent } from "@shared/sim"

/** Ours, and distinct from the client's request ids in `session.ts`. */
const REQ = { CMD: 0xe000, OUT: 0xe001 }

/**
 * One entry of the module's watch mapping.
 *
 * `resolved` is protocol 5's addition, and the reason the mapping is now
 * re-sent when it moves: a ref that does not resolve reports no values, so
 * before this the app could not tell "this variable is not on this aircraft"
 * from "nobody has touched that switch".
 *
 * The shape lives in `@shared/link` because the renderer's rules read it;
 * re-exported here so every existing importer of this file is unaffected.
 */
export type { WatchedRef }

interface State {
  /** Names by id, as the module enumerated them. Ids are stable. */
  names: string[]
  /**
   * Watched names by handle — the module's `watched` mapping, replaced whole
   * on receipt. Names are verbatim as the app asked for them, prefix and all,
   * unlike the enumeration's bare `L:` names.
   */
  watched: Map<number, WatchedRef>
  /**
   * A mapping still arriving in chunks. Swapped into `watched` only when the
   * final chunk lands, so a half-received map never resolves values.
   */
  pendingWatched: Map<number, WatchedRef> | null
  /** The module's own version, once it has said hello. */
  version: string | null
  protocol: number | null
  /** Set once the handshake names a variable count, so it is only logged once. */
  announced: boolean
}

let state: State = {
  names: [],
  watched: new Map(),
  pendingWatched: null,
  version: null,
  protocol: null,
  announced: false,
}

export function resetLink(): void {
  const had = unresolvedSignature(state.watched)

  state = {
    names: [],
    watched: new Map(),
    pendingWatched: null,
    version: null,
    protocol: null,
    announced: false,
  }

  // A disconnect withdraws the verdict rather than confirming it: the module
  // is not saying these refs resolve, it is not saying anything. Listeners are
  // woken so the diagnostics go quiet instead of freezing on the last answer.
  if (had) for (const listener of resolutionListeners) listener()
}

/** What the app knows about the module right now, for the footer chip. */
export function linkState(): {
  present: boolean
  version: string | null
  variables: number
  outdated: boolean
} {
  return {
    present: state.version !== null,
    version: state.version,
    variables: state.names.length,
    // 04-connection's fifth state: a module older than the app expects should
    // offer a reinstall rather than fail in whatever way a mismatched wire
    // fails in.
    outdated: state.protocol !== null && state.protocol < LINK_PROTOCOL,
  }
}

/**
 * Handles one 8 KB read of the module's output area.
 *
 * Returns the events it produced rather than emitting them, so the caller keeps
 * one emission point and the parsing stays testable without a simulator.
 */
/**
 * The watch mapping as it stands — handle to name and resolution.
 *
 * Exported because resolution is evidence now, not plumbing: a watched ref
 * that will not resolve is a profile line naming a variable this aircraft
 * does not have, which is a diagnostic rather than an internal detail.
 */
export function watchedRefs(): ReadonlyMap<number, WatchedRef> {
  return state.watched
}

/**
 * Told when the module's verdict on a watched ref moved.
 *
 * Resolution is the one piece of evidence in this file that is *news*. The
 * mapping itself is not: it is re-sent after every `watch-add`, which happens
 * whenever a tab opens or a `get:` line is typed, and waking the renderer for
 * those would rebuild an answer that has not changed. So the signal is
 * computed from the unresolved set rather than from the message — see
 * `receiveWatched`.
 */
const resolutionListeners = new Set<() => void>()

export function onWatchResolution(listener: () => void): () => void {
  resolutionListeners.add(listener)
  return () => resolutionListeners.delete(listener)
}

/**
 * The watch mapping as a flat list, for the wire to the renderer.
 *
 * Null rather than empty when the module has not said hello: "nothing is
 * watched" and "nobody is answering" are the same array and opposite facts,
 * and the rule that reads this must stay silent for the second.
 */
export function watchResolution(): WatchedRef[] | null {
  // Withheld from a module too old to distinguish "not there" from "not
  // tried" — see RESOLUTION_PROTOCOL. The chip already offers a reinstall in
  // that state; showing a warning on every watched variable meanwhile would
  // be the worse half of both answers.
  if (state.protocol === null || state.protocol < RESOLUTION_PROTOCOL)
    return null
  return [...state.watched.values()]
}

/**
 * The names the module is watching and could not resolve, sorted — the
 * signal's identity, not its payload. Compared as a string so a re-sent
 * mapping that says the same thing wakes nobody.
 */
function unresolvedSignature(map: ReadonlyMap<number, WatchedRef>): string {
  const names: string[] = []
  // Absent only. A ref that has not been tried yet is not news — it is the
  // state every ref is in the instant a `watch-add` is answered.
  for (const ref of map.values())
    if (ref.resolved === false) names.push(ref.name)
  return names.sort().join("\n")
}

export function receiveLink(raw: string): SimEvent[] {
  const message = parseLinkMessage(raw)
  // Not an error worth reporting: this area can be written by anything with a
  // SimConnect connection, and a message we do not understand is one to ignore
  // rather than one to fall over on.
  if (!message) return []

  if (message.kind === "hello") return receiveHello(message.lines)
  if (message.kind === "names") return receiveNames(message.lines)
  if (message.kind === "exec") return receiveExec(message.lines)
  if (message.kind === "watched") return receiveWatched(message)
  // A maintainer diagnostic, answered for whichever `link:read` asked. Not an
  // event, and — the part worth a guard — not values: without this it would
  // fall through, and any probe line opening with two numbers would be
  // recorded as a variable that moved.
  if (message.kind === "probe") return []

  return receiveValues(message.lines)
}

/**
 * One reply per `exec`, carrying the token its caller sent.
 *
 * Replies for tokens nobody here is waiting on are passed along rather than
 * filtered: the area is a broadcast, so a `link:read` running a setter beside
 * the app produces one of these, and it belongs in the capture as much as our
 * own does — something ran in this aircraft at that moment, which is exactly
 * the kind of fact a finding is ranked against. Whose it was is the caller's
 * question, and the token is how it answers.
 */
function receiveExec(lines: string[]): SimEvent[] {
  const events: SimEvent[] = []

  for (const line of lines) {
    const parsed = parseExecLine(line)
    if (!parsed) continue

    events.push({ kind: "exec", ...parsed })
  }

  return events
}

function receiveHello(lines: string[]): SimEvent[] {
  const [line] = lines
  if (!line) return []

  const [version, protocol, variables] = line.split(" ")
  if (!version) return []

  state.version = version
  state.protocol = Number(protocol)

  // The module writes a hello into the area at init, so a client connecting
  // later reads a stale one describing zero variables. That is the "it loaded"
  // signal, not the handshake — only the reply to `start` carries a count.
  const count = Number(variables)
  if (!Number.isFinite(count) || count === 0) return []
  if (state.announced) return []

  state.announced = true

  return [
    {
      kind: "link",
      version,
      protocol: state.protocol,
      variables: count,
    },
  ]
}

/**
 * The complete handle→name mapping, replacing what was held.
 *
 * The module sends the whole map after every `watch-add` and `watch-reset` —
 * an empty message is a reset taking effect — so ordering against the
 * commands cannot strand a stale handle. Chunked maps accumulate in
 * `pendingWatched` and swap in whole; lines reuse the `<id> <name>` shape of
 * enumeration, parsed by the same function.
 *
 * No events: the mapping is plumbing for `receiveValues`, not news.
 */
function receiveWatched(message: LinkMessage): SimEvent[] {
  const target = state.pendingWatched ?? new Map<number, WatchedRef>()

  for (const line of message.lines) {
    const parsed = parseWatchedLine(line)
    if (!parsed) continue
    target.set(parsed.id, { name: parsed.name, resolved: parsed.resolved })
  }

  if (message.remaining > 0) {
    state.pendingWatched = target
    return []
  }

  const before = unresolvedSignature(state.watched)
  state.watched = target
  state.pendingWatched = null

  // The mapping arrives after every watch-add as well as when resolution
  // moves, so the *contents* decide whether this is news.
  if (unresolvedSignature(target) !== before)
    for (const listener of resolutionListeners) listener()

  return []
}

function receiveNames(lines: string[]): SimEvent[] {
  const chunk: string[] = []
  let from = -1

  for (const line of lines) {
    const parsed = parseNameLine(line)
    if (!parsed) continue

    if (from < 0) from = parsed.id
    state.names[parsed.id] = parsed.name
    // Namespaced here rather than at every reader. The module sends bare names
    // because inside the sim there is nothing else they could be; everywhere
    // else in this app a variable is `L:Foo`, and the database keys on that.
    chunk.push(`L:${parsed.name}`)
  }

  if (!chunk.length) return []

  return [{ kind: "vars", from, names: chunk }]
}

/**
 * One event per variable that moved.
 *
 * Named rather than numbered, unlike the wire: a capture has to be readable
 * without the enumeration that gave the ids meaning. A value whose id is not in
 * the enumeration is dropped, which happens when the module has re-enumerated
 * and the app has not caught up yet.
 */
function receiveValues(lines: string[]): SimEvent[] {
  const events: SimEvent[] = []

  for (const line of lines) {
    const parsed = parseValueLine(line)
    if (!parsed) continue

    // Watch handles live far above any table id and resolve through the
    // `watched` mapping, verbatim — those names arrived prefixed, because the
    // app wrote them. Only the enumeration's bare names take an `L:`.
    if (parsed.id >= WATCH_HANDLE_BASE) {
      const name = state.watched.get(parsed.id)?.name
      if (name) events.push({ kind: "var", name, value: parsed.value })
      continue
    }

    const name = state.names[parsed.id]
    if (!name) continue

    events.push({ kind: "var", name: `L:${name}`, value: parsed.value })
  }

  return events
}

/** The SimConnect calls the client makes on the module's behalf. */
export interface LinkChannel {
  mapClientDataNameToID(name: string, id: number): unknown
  addToClientDataDefinition(id: number, offset: number, size: number): unknown
  requestClientData(
    dataId: number,
    requestId: number,
    defineId: number,
    period: number
  ): unknown
  setClientData(dataId: number, defineId: number, data: Buffer): unknown
}

/**
 * Subscribes to the module's output area.
 *
 * The app never creates these areas — the module does, at `module_init`. An
 * exception here means it is not running, which is the ordinary case and not
 * something to report as a failure.
 */
export function subscribeLink(channel: LinkChannel, onSet: number): void {
  channel.mapClientDataNameToID(LINK_OUT, REQ.OUT)
  channel.addToClientDataDefinition(REQ.OUT, 0, LINK_AREA_BYTES)
  channel.requestClientData(REQ.OUT, REQ.OUT, REQ.OUT, onSet)

  channel.mapClientDataNameToID(LINK_CMD, REQ.CMD)
  channel.addToClientDataDefinition(REQ.CMD, 0, LINK_AREA_BYTES)
}

/**
 * Writes one command into the module's command area.
 *
 * False means it was not sent — the code did not fit, or carried a NUL — and
 * the caller has something to tell the user. Every command without an argument
 * fits by construction, so only `exec` can fail here.
 */
export function sendLinkCommand(
  channel: LinkChannel,
  command: LinkCommand
): boolean {
  const line = formatLinkCommand(command)
  if (line === null) return false

  const payload = Buffer.alloc(LINK_AREA_BYTES)
  payload.write(line, 0, "utf8")
  channel.setClientData(REQ.CMD, REQ.CMD, payload)

  return true
}

export const LINK_REQUEST = REQ
