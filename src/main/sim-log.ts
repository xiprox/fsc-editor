/**
 * The simulator's event stream, tee'd into the Log panel at a rate a person
 * can read.
 *
 * Every other producer in this app logs at human speed — a file saved, a
 * connection made, a module installed. The sim stream is different in kind: the
 * `L:` deltas were measured at ~1,000 a second in an ordinary session, and an
 * aircraft change makes the module re-report **all ~6,150 variables inside a
 * single frame**. Logged one row each, that stream is not a log of anything.
 *
 * Two things went wrong when it was:
 *
 * **The panel stopped working.** `LOG_BUFFER_MAX` is 5,000 entries, so at a
 * thousand values a second the ring holds *five seconds*. Every `info` row
 * worth reading — connected, aircraft loaded, module installed — was evicted by
 * the firehose within seconds of a session starting. The panel that exists to
 * show what the app is doing could only ever show the last five seconds of the
 * one thing nobody needed to see.
 *
 * **And it cost more than it was worth.** A row that is never read still pays
 * for its own construction and its trip across the bridge, ~6,150 times per
 * enumeration, on the main thread — which is the thread holding the window's
 * message loop.
 *
 * So values are counted here and reported once per window. Nothing is lost that
 * was ever authoritative: @shared/log is explicit that the panel is a view and
 * the capture on disk is the record, and the capture still holds every single
 * value event.
 */

import type { CapturedEvent, SimVia } from "@shared/sim"

import { log } from "./log"

/**
 * How long values are counted before a row is emitted.
 *
 * A readability window, not a transport one — `LOG_FLUSH_MS` already handles
 * the bridge. The module ticks at 15 Hz, so anything shorter than ~70 ms is one
 * row per tick and the feed scrolls faster than it can be read; much longer and
 * a row stops sitting next to the interaction that caused it. 250 ms gives four
 * rows a second in the steady state, and folds a whole re-enumeration burst
 * into one or two.
 */
const VALUE_WINDOW_MS = 250

/**
 * How many values one row keeps for its expanded view.
 *
 * Bounded because a row *retains* what it keeps, for as long as it is in the
 * ring. A flood window sees 6,150 distinct variables, and 5,000 rows each
 * holding thousands of value objects is tens of megabytes of retained garbage
 * for a panel that is closed most of the time — the same mistake
 * `activity-buffer.ts` was written to avoid.
 *
 * Fifty is enough to see what kind of thing is moving, which is the question a
 * summary row can honestly answer. The one that needs all of them —
 * "did `L:Foo` arrive?" — is a question for the capture.
 */
const SAMPLE_MAX = 50

interface Window {
  kind: string
  via: SimVia
  /** Values seen, including repeats of one variable. */
  count: number
  /** Distinct variables among them. */
  names: Set<string>
  sample: { name: string; value: number }[]
}

/**
 * One window per kind and transport.
 *
 * Keyed by both because a row says `via`, and folding `A:` from the client
 * together with `L:` from the module would make that word a guess. They also
 * genuinely differ: `A:` is a whole watch set once a second, `L:` is a delta at
 * 15 Hz.
 */
const windows = new Map<string, Window>()
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * Takes one event from the stream.
 *
 * Values are counted. Everything else is logged as it always was — input
 * events, aircraft changes, enumerations and the rest arrive at rates a reader
 * can follow, and the panel's own burst collapse is built around seeing them
 * individually.
 */
export function logSimEvent(event: CapturedEvent): void {
  // Matched on the kind rather than on having a name and a value, because an
  // input event has both — and its value can be a string, which is exactly the
  // thing a counter of numbers must not be handed.
  if (event.kind === "var" || event.kind === "simvar") {
    absorb(event.kind, event.via, event.name, event.value)
    return
  }

  // Anything pending belongs *before* this, and a log read for causality — the
  // switch, then what moved — is the only reason to look at this panel during a
  // session. Holding a window open across an interaction would file the values
  // that preceded the flip underneath it.
  flushValueLog()

  log("sim", "debug", event.kind, `${summarize(event)}  ·  via ${event.via}`, event)
}

function absorb(kind: string, via: SimVia, name: string, value: number): void {
  const key = `${kind}|${via}`

  let window = windows.get(key)
  if (!window) {
    window = { kind, via, count: 0, names: new Set(), sample: [] }
    windows.set(key, window)
  }

  window.count += 1
  window.names.add(name)
  if (window.sample.length < SAMPLE_MAX) window.sample.push({ name, value })

  if (!timer) timer = setTimeout(flushValueLog, VALUE_WINDOW_MS)
}

/** Emits a row for each window with anything in it, and starts them over. */
export function flushValueLog(): void {
  clearTimeout(timer)
  timer = undefined

  if (!windows.size) return

  const open = [...windows.values()]
  windows.clear()

  for (const window of open) {
    const variables = window.names.size
    const omitted = window.count - window.sample.length

    log(
      "sim",
      "debug",
      window.kind,
      `${window.count} values from ${variables} ${
        variables === 1 ? "variable" : "variables"
      }  ·  via ${window.via}`,
      {
        values: window.count,
        variables,
        sample: window.sample,
        ...(omitted > 0 ? { omitted } : {}),
      }
    )
  }
}

/**
 * Drops anything counted but not yet reported.
 *
 * For tests, which need a clean window between cases. A disconnect needs
 * nothing: `teardown` emits a `closed` event, and every non-value event reports
 * the open windows on its way past — so a session's last values land in the
 * feed above the line saying it ended, which is where they belong.
 */
export function resetSimLog(): void {
  clearTimeout(timer)
  timer = undefined
  windows.clear()
}

/**
 * One line for a row. Everything else is in the detail, which is fetched only
 * when somebody expands it.
 */
function summarize(event: CapturedEvent): string {
  switch (event.kind) {
    case "open":
      return `${event.app} ${event.appVersion} (${event.protocol})`
    case "aircraft":
      return event.key ?? event.path
    case "input-events":
      return `${event.events.length} enumerated`
    case "input":
      return `${event.name} = ${event.value}`
    case "simvar":
      return `${event.name} = ${event.value} ${event.units}`
    case "link":
      return `module ${event.version} (protocol ${event.protocol}), ${event.variables} variables`
    case "vars":
      return `${event.names.length} names from id ${event.from}`
    case "var":
      return `${event.name} = ${event.value}`
    case "exec":
      return `#${event.token} ${event.ok ? "ok" : "err"} -> ${event.value}`
    case "mark":
      return "hotkey"
    case "closed":
      return event.reason
  }
}
