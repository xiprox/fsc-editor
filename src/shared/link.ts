/**
 * The wire between the Link module and the app.
 *
 * **This file and `link/src/module.cpp` must agree.** They cannot share a
 * header — one is compiled to wasm by clang and the other bundled by vite — so
 * the values are written twice and the C++ side carries a pointer back here.
 * Changing anything in this file means changing both.
 *
 * ## Why text, in a hot path
 *
 * Records are packed as text lines rather than a binary struct, which looks
 * like the wrong trade for something running at 20 Hz. It is not, because the
 * volume is bounded by what actually moves: a cockpit at rest produces nothing,
 * and a busy moment produces a few dozen changes. Enumeration is the only bulk
 * transfer and it happens once.
 *
 * What text buys is that a malformed message is *readable* — a wrong offset in
 * a binary format looks like plausible garbage, and the last three bugs in this
 * project all hid inside things that failed silently. If profiling ever says
 * this is the bottleneck, the format changes; it will not be a guess.
 */

/**
 * Module to app. The app never writes here.
 *
 * 8 KB is SimConnect's per-area ceiling, and one area holds exactly one value —
 * so a message is 8 KB and anything larger is chunked across frames.
 */
export const LINK_OUT = "FSCEDITOR_LINK_OUT"

/** App to module: a command, and nothing else. */
export const LINK_CMD = "FSCEDITOR_LINK_CMD"

export const LINK_AREA_BYTES = 8192

/**
 * The protocol version, carried in the handshake from the first release.
 *
 * An app that expects newer than the module offers says so and offers to
 * reinstall, rather than failing in whatever way a mismatched wire fails in.
 * 04-connection calls this out as a state the chip has to be able to show.
 *
 * | | |
 * | --- | --- |
 * | 1 | `start` / `stop` / `enumerate`, and `hello` / `names` / `values` back |
 * | 2 | commands carry an argument, and `exec` runs calculator code |
 * | 3 | `rescan` — "did the table grow?" without re-reporting every value |
 * | 4 | `watch-reset` / `watch-add` read named `Z:`/`E:` refs by typed id; `watched` maps handles back |
 * | 5 | the `watched` mapping carries resolution — `<handle> <resolved> <name>` — and is re-sent when it moves |
 * | 6 | that field is three-state: `0` absent, `1` present, `2` not tried yet |
 */
export const LINK_PROTOCOL = 6

/**
 * The first protocol whose resolution field can be believed.
 *
 * Its own constant rather than `LINK_PROTOCOL`, because these move for
 * different reasons: a later bump for some unrelated command must not
 * re-open the question of whether resolution is trustworthy. Under 5 the
 * mapping called every not-yet-tried ref absent, so an older module's
 * verdicts are withheld from the rules entirely rather than shown briefly
 * and wrongly.
 */
export const RESOLUTION_PROTOCOL = 6

/**
 * Where watch handles start, far above any `L:` table id.
 *
 * Watched refs share the `values` stream with the enumerated table, so their
 * ids must never collide with its. The module walks `L:` ids to a ceiling of
 * 20,000; a value line at or past this base is a watch handle, resolved
 * through the `watched` mapping instead of the enumeration.
 */
export const WATCH_HANDLE_BASE = 1_000_000

/**
 * What the app can ask for.
 *
 * `start` is not implicit: the module boots with the simulator and the app
 * connects whenever it likes, so streaming before anyone is listening would
 * burn a frame budget on messages nobody reads.
 *
 * A command is `<name>` or `<name> <argument>` — one line of text in an 8 KB
 * area, so an argument is effectively free and the wire stays readable in a
 * transcript. It was a bare string union until `exec` needed to carry code.
 */
export type LinkCommand =
  /**
   * `enumerate` walks the `L:` table from scratch and forgets every value with
   * it, so the next tick re-reports all ~6,150. That is what an aircraft change
   * wants — the old aeroplane's values are stale and a blank is honester than a
   * number from a cockpit that is gone.
   *
   * `rescan` is the same walk without the forgetting: it appends whatever
   * registered since the last one and sends only those names, leaving every
   * known value where it is. It exists because the app re-walks on a backoff
   * after an aircraft change, waiting for the table to stop growing, and that
   * question is about names — asking it with `enumerate` bought four or five
   * complete value floods per swap.
   */
  /**
   * `probe` runs the module's typed-API smoke test — a maintainer diagnostic
   * sent by `link:read`, never by the app, which is why it arrived without a
   * protocol bump: the one failure a bump guards against is the app waiting on
   * a command an old module ignores, and the app never waits on this.
   */
  | { name: "start" | "stop" | "enumerate" | "rescan" | "probe" }
  /**
   * The watch set for names the module reads by typed id — `Z:` and `E:`,
   * the namespaces whose descriptor says `read: "watch"`.
   *
   * Replacement, not diffing: `watch-reset` clears and `watch-add` appends,
   * and the app sends both every time the set changes. The set is small —
   * a viewport's worth of rows at most, thirteen names across the whole
   * corpus today — so resending it wholesale costs less than either side
   * tracking a delta correctly.
   *
   * The first command of protocol 4 to span lines: names follow the verb one
   * per line, because a variable name can contain spaces and a space-split
   * argument would eat them.
   */
  | { name: "watch-reset" }
  | { name: "watch-add"; names: string[] }
  /**
   * Run calculator code, and say what happened.
   *
   * `token` is the caller's, echoed back on the reply. It exists because the
   * output area is one broadcast channel that every client reads: the app and
   * a `link:read` alongside it both see every reply, and without a token each
   * would read the other's run as the answer to its own. The module already
   * learned this lesson once about names — see `module.cpp` on why `start`
   * re-sends the enumeration.
   */
  | { name: "exec"; token: number; code: string }

/**
 * A command as the module reads it, or null if it cannot be sent.
 *
 * Null rather than a truncated command, which is the whole reason this
 * function exists: the area is fixed-size and `Buffer.write` fills what fits
 * and drops the rest silently. Truncated *calculator code* is the bad case —
 * `1 (>K:ENGINE_AUTO_SHUTDOWN)` cut anywhere still parses as something, and
 * the sim would run that something.
 *
 * The length that matters is the formatted line's, so it is measured rather
 * than budgeted: a second constant saying how much code fits would be a second
 * thing to keep true. For scale, the longest `set:` expression in the
 * 65-profile corpus is 5,578 characters and the median is 45.
 */
export function formatLinkCommand(command: LinkCommand): string | null {
  if (command.name === "watch-add") {
    // A name with a newline would smuggle extra entries into the list; one
    // with a NUL would end the command early on the C++ side. Refused whole
    // rather than filtered, because a watch set that silently lost a name is
    // a hint that never appears with nothing saying why.
    if (command.names.length === 0) return null
    if (command.names.some((name) => !name || /[\n\0]/.test(name))) return null

    const text = `watch-add\n${command.names.join("\n")}`
    return new TextEncoder().encode(text).length < LINK_AREA_BYTES ? text : null
  }

  if (command.name !== "exec") return command.name

  // A NUL ends the command on the C++ side, so code containing one would be
  // silently cut there instead of here.
  if (command.code.includes("\0")) return null
  if (!Number.isInteger(command.token) || command.token < 0) return null

  const line = `exec ${command.token} ${command.code}`

  // `TextEncoder` rather than `Buffer`: this file is the one both halves of
  // the wire read, and it has no imports so that a node script can take it as
  // it stands.
  return new TextEncoder().encode(line).length < LINK_AREA_BYTES ? line : null
}

/**
 * Splits a watch set into `watch-add` commands that each fit the area.
 *
 * Greedy: names go into the current chunk until the formatted command would
 * not fit, then a new chunk starts. A single name too long for an empty
 * command is dropped — it could never be sent, and a chunk of one unsendable
 * name would loop forever. In practice one chunk holds hundreds of names and
 * the corpus needs one.
 */
export function packWatchAdds(names: string[]): LinkCommand[] {
  const commands: LinkCommand[] = []
  let chunk: string[] = []

  for (const name of names) {
    if (formatLinkCommand({ name: "watch-add", names: [...chunk, name] })) {
      chunk.push(name)
      continue
    }

    if (chunk.length) commands.push({ name: "watch-add", names: chunk })
    // Alone in a fresh chunk, or not at all.
    chunk = formatLinkCommand({ name: "watch-add", names: [name] })
      ? [name]
      : []
  }

  if (chunk.length) commands.push({ name: "watch-add", names: chunk })
  return commands
}

/**
 * The first line of every message: `kind seq remaining`.
 *
 * `remaining` is how many messages of this kind still follow, so a reader knows
 * an enumeration is complete without a sentinel — and knows it was *cut short*
 * if the stream stops with remaining above zero.
 */
export type LinkMessageKind =
  "hello" | "names" | "values" | "exec" | "probe" | "watched"

export interface LinkMessage {
  kind: LinkMessageKind
  seq: number
  remaining: number
  /** Payload lines, already split and with the header removed. */
  lines: string[]
}

/**
 * Parses one 8 KB area read.
 *
 * Returns null rather than throwing for anything it does not recognize. This is
 * fed by a foreign process on a channel any other client could also write to,
 * and a malformed message must cost one dropped read rather than the
 * connection.
 */
export function parseLinkMessage(raw: string): LinkMessage | null {
  // The area is a fixed-size buffer, so everything after the payload is NUL.
  const text = raw.replace(/\0[\s\S]*$/, "")
  const newline = text.indexOf("\n")
  if (newline < 0) return null

  const header = text.slice(0, newline).split(" ")
  if (header.length < 3) return null

  const [kind, seq, remaining] = header
  if (
    kind !== "hello" &&
    kind !== "names" &&
    kind !== "values" &&
    kind !== "exec" &&
    kind !== "probe" &&
    kind !== "watched"
  )
    return null

  const seqNumber = Number(seq)
  const remainingNumber = Number(remaining)
  if (!Number.isFinite(seqNumber) || !Number.isFinite(remainingNumber))
    return null

  return {
    kind,
    seq: seqNumber,
    remaining: remainingNumber,
    lines: text
      .slice(newline + 1)
      .split("\n")
      .filter((line) => line.length > 0),
  }
}

/**
 * One entry of the module's watch mapping, as both sides speak of it.
 *
 * Shared rather than main's own because resolution leaves main now: a ref the
 * sim will not resolve is a diagnostic about a profile line, so the renderer
 * needs the same fields main holds.
 */
export interface WatchedRef {
  /** Verbatim as the app asked for it — prefix and index included. */
  name: string
  /**
   * What the module found, in three states rather than two.
   *
   * `null` is **not tried yet**, and it is the state every ref is in at the
   * moment `watch-add` is answered: the mapping goes out before the tick has
   * resolved anything. Protocol 5 had no way to say that and called those
   * refs unresolved, so the app briefly believed every variable it had just
   * asked about was missing from the aircraft. Only `false` is evidence.
   */
  resolved: boolean | null
}

/** `<id> <name>` — enumeration. Ids are stable, so they are worth carrying. */
/**
 * `<handle> <state> <name>` — one line of the protocol-6 `watched` map.
 *
 * Its own parser rather than a widened `parseNameLine`, because the two
 * messages are not the same shape any more and a name may contain spaces
 * (`E:ZULU TIME`): only the first two fields are split.
 *
 * Resolution is the message's point as much as the mapping is. An
 * unresolved ref reports no values *by definition*, so before protocol 5 the
 * app saw only silence — which is exactly what an untouched switch looks
 * like. This is what lets it say "not present on this aircraft" instead.
 *
 * The third state arrived in protocol 6 and is the difference between "not
 * there" and "not looked yet". `0` absent, `1` present, `2` unknown; a `2`
 * parses to `null`, and anything else is refused — which is what a
 * protocol-4 module's two-field line looks like from here.
 */
export function parseWatchedLine(
  line: string
): { id: number; resolved: boolean | null; name: string } | null {
  const first = line.indexOf(" ")
  if (first <= 0) return null
  const second = line.indexOf(" ", first + 1)
  if (second <= first) return null

  const id = Number(line.slice(0, first))
  const state = line.slice(first + 1, second)
  const name = line.slice(second + 1)
  if (!Number.isInteger(id) || id < 0 || !name) return null
  if (state !== "0" && state !== "1" && state !== "2") return null

  return { id, resolved: state === "2" ? null : state === "1", name }
}

export function parseNameLine(
  line: string
): { id: number; name: string } | null {
  const space = line.indexOf(" ")
  if (space <= 0) return null

  const id = Number(line.slice(0, space))
  const name = line.slice(space + 1)
  if (!Number.isInteger(id) || id < 0 || !name) return null

  return { id, name }
}

/**
 * `<id> <value>` — one variable that moved.
 *
 * By id, not by name: the app already holds the enumeration, and at 20 Hz the
 * name would be the overwhelming majority of every message for no information.
 */
export function parseValueLine(
  line: string
): { id: number; value: number } | null {
  const space = line.indexOf(" ")
  if (space <= 0) return null

  const id = Number(line.slice(0, space))
  const value = Number(line.slice(space + 1))
  if (!Number.isInteger(id) || id < 0 || !Number.isFinite(value)) return null

  return { id, value }
}

/**
 * `<token> <ok|err> <value>` — what one `exec` did.
 *
 * `ok` is the calculator's own verdict on the code, not ours and not the
 * aircraft's: it says the expression parsed and ran, never that the write
 * landed anywhere. Whether anything moved is answered by watching the
 * variables afterwards, which is a different question and a different file.
 *
 * The value is whatever the expression left on the stack — meaningful for
 * `(A:...)` and typically 0 for a write, so it is carried rather than
 * interpreted.
 */
export function parseExecLine(
  line: string
): { token: number; ok: boolean; value: number } | null {
  const [token, status, value] = line.split(" ")

  const tokenNumber = Number(token)
  if (!Number.isInteger(tokenNumber) || tokenNumber < 0) return null
  if (status !== "ok" && status !== "err") return null

  const valueNumber = Number(value)

  return {
    token: tokenNumber,
    ok: status === "ok",
    // A module that ran the code but had nothing to report still said `ok`;
    // an unreadable number is a zero rather than a dropped reply, because the
    // reply is what a caller is waiting on.
    value: Number.isFinite(valueNumber) ? valueNumber : 0,
  }
}
