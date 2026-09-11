/**
 * The Log panel's buffer, and every producer's way into it.
 *
 * It lives in main rather than the renderer for one reason that only shows up
 * in practice: a renderer reload wipes renderer state, and reloading is
 * constant during development — precisely when the log is being read. Main
 * holds the ring; the panel asks for the backlog when it mounts and follows
 * batches after that.
 *
 * Nothing here is authoritative. See the note at the top of @shared/log.
 */

import {
  LOG_BUFFER_MAX,
  LOG_FLUSH_MS,
  type LogEntry,
  type LogLevel,
  type LogSource,
} from "@shared/log"

/**
 * One entry, with the object it was logged about held beside it.
 *
 * The detail is kept as it arrived — not copied, not serialized. Making it
 * clone-safe is `logDetail`'s job, and it only happens for a row somebody
 * expanded. See `hasDetail` in @shared/log.
 *
 * Holding the caller's object rather than a copy of it is safe because every
 * producer here builds a fresh one per call — `record` in `sim/capture.ts`
 * constructs each `CapturedEvent` and hands it on. A caller that logged a
 * mutable object it went on to mutate would see the change reflected when the
 * row was expanded, which is worth knowing and has no instance in this app.
 */
interface Held {
  entry: LogEntry
  detail: unknown
}

let buffer: Held[] = []
let pending: LogEntry[] = []
let nextId = 1
let flush: ReturnType<typeof setTimeout> | undefined

let sink: (entries: LogEntry[]) => void = () => {}

/** Where batches go. Set once, by the IPC layer. */
export function onLogBatch(next: (entries: LogEntry[]) => void): void {
  sink = next
}

/**
 * Records one entry.
 *
 * Deliberately synchronous and deliberately unable to throw: this is called
 * from the middle of event handling, and a logger that can break its caller is
 * worse than no logger. Nothing is serialized here — a `detail` that will not
 * survive structured clone is dealt with in `logDetail`, at the point where it
 * would actually have to cross the bridge.
 */
export function log(
  source: LogSource,
  level: LogLevel,
  kind: string,
  message: string,
  detail?: unknown
): void {
  const entry: LogEntry = {
    id: nextId++,
    t: Date.now(),
    source,
    level,
    kind,
    message,
  }

  if (detail !== undefined && detail !== null) entry.hasDetail = true

  buffer.push({ entry, detail })
  if (buffer.length > LOG_BUFFER_MAX) {
    buffer = buffer.slice(-LOG_BUFFER_MAX)
  }

  pending.push(entry)
  if (!flush) {
    flush = setTimeout(() => {
      flush = undefined
      const batch = pending
      pending = []
      if (batch.length) sink(batch)
    }, LOG_FLUSH_MS)
  }
}

/**
 * The object behind one row, made safe to send, at the moment it is asked for.
 *
 * Undefined for a row that carried no detail, and for one that has already
 * fallen out of the ring — a panel can ask about an id that was evicted while
 * the click was in flight, and an empty pane is the right answer to that.
 *
 * The scan is linear over at most `LOG_BUFFER_MAX`. It runs when somebody
 * expands a row, which is a human action, so an index keyed by id would be
 * bookkeeping on every log call to save microseconds on a click.
 */
export function logDetail(id: number): unknown {
  const held = buffer.find((entry) => entry.entry.id === id)
  return held ? safe(held.detail) : undefined
}

/**
 * Anything that cannot cross the IPC bridge becomes a string.
 *
 * `bigint` is the one that actually bites — input event hashes are bigint on
 * the SimConnect side, and structured clone throws on them rather than
 * degrading. Cheaper to flatten here than to have every caller remember.
 */
function safe(detail: unknown): unknown {
  if (detail === undefined || detail === null) return undefined

  try {
    return JSON.parse(
      JSON.stringify(detail, (_key, value: unknown) =>
        typeof value === "bigint" ? `${value.toString()}n` : value
      )
    ) as unknown
  } catch {
    return String(detail)
  }
}

/** The backlog, for a panel that just mounted or a renderer that reloaded. */
export function logBacklog(): LogEntry[] {
  return buffer.map((held) => held.entry)
}

/**
 * The whole ring with its details attached, for the debug report.
 *
 * The panel fetches details one at a time because a person expands one row at a
 * time. A report is the other case: nobody is going to click five thousand
 * rows, and a log whose interesting half has to be asked for separately is a
 * log that arrives empty. Every detail goes through the same `safe` the panel's
 * would, so what lands in the file is what the panel would have shown.
 */
export function logSnapshot(): { entry: LogEntry; detail: unknown }[] {
  return buffer.map((held) => ({
    entry: held.entry,
    detail: safe(held.detail),
  }))
}

/**
 * Empties the ring and anything not yet flushed.
 *
 * The scheduled flush is cancelled *and* the handle reset, not just one of the
 * two: `log` only schedules when `flush` is unset, so leaving a stale handle
 * behind silently stops every future batch — the entries keep accumulating in
 * the ring and never reach the panel again.
 */
export function clearLog(): void {
  buffer = []
  pending = []
  clearTimeout(flush)
  flush = undefined
}

/**
 * Mirrors main's console into the panel.
 *
 * Warnings and errors from the main process currently go to a terminal, which
 * in a packaged build nobody has. Rather than rewrite every call site, the two
 * methods that matter are wrapped once — they still reach the terminal, and now
 * they also reach the one place a user could be asked to look.
 */
export function captureConsole(): void {
  const original = { warn: console.warn, error: console.error }

  const forward =
    (level: "warn" | "error") =>
    (...args: unknown[]): void => {
      original[level](...args)
      log("app", level, "console", args.map(text).join(" "))
    }

  console.warn = forward("warn")
  console.error = forward("error")
}

/**
 * Puts a crash in the ring before it is a crash.
 *
 * Everything else in this file records what the app *did*. This records the one
 * thing it stopped doing, and it is the entry a debug report most needs and was
 * least likely to have: an uncaught throw in main reached a terminal that a
 * packaged build does not have, and left nothing behind anywhere.
 *
 * Deliberately not `process.exit`. Electron's default for an uncaught exception
 * is to keep running, which is usually the better answer in a desktop app —
 * half a feature broken beats every unsaved draft lost — and changing that is
 * not a logging module's decision to make. This only makes sure the evidence
 * exists either way.
 *
 * The renderer's own errors arrive through `log:write` from a handler installed
 * on its side; they cannot be caught from here.
 */
export function captureCrashes(): void {
  process.on("uncaughtException", (error) => {
    log("app", "error", "uncaught", text(error), {
      name: error.name,
      message: error.message,
      stack: error.stack,
    })
  })

  process.on("unhandledRejection", (reason) => {
    log("app", "error", "unhandled-rejection", text(reason), {
      reason: reason instanceof Error ? reason.stack : String(reason),
    })
  })
}

function text(value: unknown): string {
  if (typeof value === "string") return value
  if (value instanceof Error) return value.stack ?? value.message
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
