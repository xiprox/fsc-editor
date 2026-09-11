/**
 * Cuts a window out of a capture, and leaves it able to stand alone.
 *
 *   npm run sim:slice -- <capture> --from 486 --to 540 [--out <file>] [--raw]
 *
 * Stage 4 needs a fixture with real cockpit interaction *and* the `L:` stream
 * around it, and the only capture that has both is 93.6 MB — 1,756 input events
 * and 1,101,839 deltas over ten minutes. Ten minutes of a simulator breathing
 * is not a test fixture; six seconds of it around a knob being turned is.
 *
 * ## What "stand alone" costs
 *
 * A window taken literally is unreadable. `readCapture` and everything
 * downstream expects a session: which aircraft, what the input events are
 * called, what the `L:` names are. All of that is announced in the first
 * seconds and never repeated, so the slice carries the last announcement of
 * each from before the window — that is what `header` below is.
 *
 * The header events are also **re-timed**, to a second before the window opens.
 * Left at their original stamps, replay would sit through the eight minutes
 * between the enumeration and the interesting part, because it plays gaps
 * faithfully. Timing *inside* the window is untouched, which is the whole point
 * of the exercise: proximity ranking is a claim about milliseconds.
 *
 * ## Gzip by default
 *
 * NDJSON of mostly-repeated variable names compresses by roughly an order of
 * magnitude, and `readCapture` handles `.gz` transparently. A fixture is
 * committed forever; `--raw` is there for looking at one by eye.
 */

import { gzipSync } from "node:zlib"
import { basename } from "node:path"
import { readFileSync, statSync, writeFileSync } from "node:fs"

import type { CapturedEvent } from "../src/shared/sim.ts"

const args = process.argv.slice(2)

/** Indices belonging to a `--flag`, so the positional argument can be found. */
const consumed = new Set<number>()

function flag(name: string): string | undefined {
  const at = args.indexOf(`--${name}`)
  if (at < 0) return undefined

  consumed.add(at)
  consumed.add(at + 1)
  return args[at + 1]
}

const from = Number(flag("from"))
const to = Number(flag("to"))
const outName = flag("out")
const raw = args.includes("--raw")

// After the flags have claimed theirs, so `--from 486` cannot be mistaken for
// the capture. `sim-sandbox.ts` had exactly that bug once, with `--speed`.
const source = args.find(
  (arg, index) => !consumed.has(index) && !arg.startsWith("--")
)
if (!source || !Number.isFinite(from) || !Number.isFinite(to)) {
  console.error("usage: npm run sim:slice -- <capture> --from <s> --to <s> [--out <file>] [--raw]")
  console.error("       seconds are offsets from the first event in the capture")
  process.exit(2)
}

const events: CapturedEvent[] = []
for (const line of readFileSync(source, "utf8").split("\n")) {
  if (!line.trim()) continue
  try {
    events.push(JSON.parse(line) as CapturedEvent)
  } catch {
    // A capture is appended to while a session runs, so the last line of one
    // that was killed is a partial record. Skipping it is the documented shape.
  }
}

if (!events.length) {
  console.error(`${source} holds no events`)
  process.exit(1)
}

const start = events[0]!.t
const at = (event: CapturedEvent): number => (event.t - start) / 1000

/**
 * The last announcement of each kind before the window.
 *
 * `vars` is the exception and keeps every chunk: the enumeration arrives split
 * across messages, so the last one alone is the last hundred names.
 */
const chunks: CapturedEvent[] = []
const latest = new Map<string, CapturedEvent>()

for (const event of events) {
  if (at(event) >= from) break

  if (event.kind === "vars") chunks.push(event)
  else if (event.kind === "open" || event.kind === "aircraft" || event.kind === "input-events") {
    latest.set(event.kind, event)
  }
}

// `open` first, because @shared/sim calls it the first line of every capture
// and its de facto header. Built in order rather than unshifted into place —
// unshifting each in turn reverses them, which is how this shipped once and put
// `input-events` at the top of a file whose first line is supposed to say what
// it connected to.
const header: CapturedEvent[] = [
  ...(["open", "aircraft", "input-events"] as const)
    .map((kind) => latest.get(kind))
    .filter((event): event is CapturedEvent => event !== undefined),
  ...chunks,
]

const window = events.filter((event) => at(event) >= from && at(event) <= to)
if (!window.length) {
  console.error(`no events between ${from}s and ${to}s (capture is ${at(events.at(-1)!).toFixed(0)}s)`)
  process.exit(1)
}

// A second of headroom, and one millisecond per header event so their order
// survives a reader that sorts on `t`.
const base = window[0]!.t - 1_000 - header.length
const sliced: CapturedEvent[] = [
  ...header.map((event, index) => ({ ...event, t: base + index })),
  ...window,
]

const stem = outName ?? `${basename(source, ".ndjson")}-${from}-${to}.ndjson`
// An `--out` that already ends in `.gz` meant it: appending a second one
// produced `…ndjson.gz.gz`, which is the name every fixture would have had if
// anyone had passed the obvious thing.
const out = raw || stem.endsWith(".gz") ? stem : `${stem}.gz`
const text = sliced.map((event) => JSON.stringify(event)).join("\n") + "\n"

writeFileSync(out, raw ? text : gzipSync(text, { level: 9 }))

const kinds: Record<string, number> = {}
for (const event of sliced) kinds[event.kind] = (kinds[event.kind] ?? 0) + 1

console.log(`${out}`)
console.log(`  ${sliced.length} events over ${(to - from).toFixed(1)}s`)
console.log(`  ${(statSync(out).size / 1024).toFixed(0)} KB${raw ? "" : ` (from ${(text.length / 1024).toFixed(0)} KB)`}`)
console.log(`  ${Object.entries(kinds).map(([kind, n]) => `${kind}=${n}`).join("  ")}`)
