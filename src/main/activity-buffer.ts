/**
 * The last couple of minutes of the simulator, in memory.
 *
 * Findings are computed on demand over raw events — see `activity.ts` — which
 * only works if the raw events are still somewhere when somebody asks. This is
 * that somewhere: a fixed-size ring in the main process that the whole stream
 * runs through and nothing else has to know about.
 *
 * ## Why it is packed rather than an array of events
 *
 * Because of what the rate turned out to be. 08-marks sized this on "a
 * pessimistic thousand changes a second" and the measurement came back at 957 —
 * 861,742 `L:` deltas in a fifteen-minute session, most of them heartbeats and
 * counters nobody will ever look at. Two minutes of that is ~115,000 records.
 *
 * As `CapturedEvent` objects that is tens of megabytes and a great deal of
 * garbage, permanently, for a feature that is idle most of the time. Packed
 * into three typed arrays with the names interned it is **2.4 MB and no
 * allocation at all** in the steady state, which is what lets this run always
 * rather than only while a panel is open.
 *
 * Events are rebuilt into ordinary objects in `slice`, at the moment somebody
 * asks a question. That happens when a panel is looking or a mark fires, not
 * sixty times a second.
 *
 * ## Anchors are kept separately
 *
 * Input events are rare — a few thousand in a long session against a million
 * changes — and they carry a string value that does not pack. Keeping them in a
 * plain array costs nothing and avoids bending the record layout around the
 * thing that does not fit it.
 */

import type { CapturedEvent } from "@shared/sim"
import { readOf } from "@shared/vars"

/**
 * How much history is held.
 *
 * 08-marks wants a mark to be able to look 60 seconds backwards, and to still
 * be adjustable afterwards. Two minutes gives that with room for a session
 * running hotter than the one this was measured on.
 */
export const BUFFER_SECONDS = 120

/** Sized from the measured rate, with headroom. Fixed, and never grows. */
const CAPACITY = BUFFER_SECONDS * 1_500

/** Anchors are rare enough to keep whole, and only the recent ones matter. */
const ANCHOR_CAPACITY = 4_096

interface Ring {
  t: Float64Array
  name: Int32Array
  value: Float64Array
  /** Next slot to write. Wraps. */
  at: number
  /** How many slots hold a record, up to `CAPACITY`. */
  size: number
}

let ring: Ring = empty()
let anchors: (CapturedEvent & { kind: "input" })[] = []

/** How many `L:` variables the module said the aircraft has. */
let enumerated = 0

/** Interned variable names, so a record is three numbers. */
let names: string[] = []
const ids = new Map<string, number>()

function empty(): Ring {
  return {
    t: new Float64Array(CAPACITY),
    name: new Int32Array(CAPACITY),
    value: new Float64Array(CAPACITY),
    at: 0,
    size: 0,
  }
}

function idFor(name: string): number {
  const known = ids.get(name)
  if (known !== undefined) return known

  const id = names.length
  names.push(name)
  ids.set(name, id)
  return id
}

/**
 * Takes one event from the stream.
 *
 * Everything that is not a change or an interaction is dropped on the floor.
 * That is deliberate rather than lazy: the capture file is the record of what
 * happened, and this is a working set for one question — what moved near what
 * somebody did.
 */
export function observeActivity(event: CapturedEvent): void {
  if (event.kind === "input") {
    anchors.push(event)
    if (anchors.length > ANCHOR_CAPACITY) anchors = anchors.slice(-ANCHOR_CAPACITY)
    return
  }

  /*
   * The enumeration is not kept, but its *size* is.
   *
   * One number, and it is what tells a table re-report apart from a busy
   * second — see `snapshotsIn`. Without it the ranking would have to guess a
   * fixed count that works for a light single and an airliner alike, and those
   * differ by more than an order of magnitude. Highest id plus the chunk
   * length, maxed, because the table only ever grows within a session.
   */
  if (event.kind === "vars") {
    enumerated = Math.max(enumerated, event.from + event.names.length)
    return
  }

  if (event.kind !== "var" && event.kind !== "simvar") return

  ring.t[ring.at] = event.t
  ring.name[ring.at] = idFor(event.name)
  ring.value[ring.at] = event.value

  ring.at = (ring.at + 1) % CAPACITY
  if (ring.size < CAPACITY) ring.size += 1
}

/**
 * The buffer as events again, oldest first, optionally narrowed to a window.
 *
 * Rebuilding objects here rather than storing them is the trade the packed ring
 * exists to make: allocation happens when a question is asked, and questions
 * are rare. A window is worth passing whenever one is known — findings only
 * ever look at a second either side of an anchor, and rebuilding two minutes to
 * answer that would undo the point.
 */
export function slice(from = -Infinity, to = Infinity): CapturedEvent[] {
  const events: CapturedEvent[] = []

  for (const anchor of anchors) {
    if (anchor.t >= from && anchor.t <= to) events.push(anchor)
  }

  const start = ring.size === CAPACITY ? ring.at : 0

  for (let n = 0; n < ring.size; n += 1) {
    const index = (start + n) % CAPACITY
    const t = ring.t[index]!
    if (t < from || t > to) continue

    const name = names[ring.name[index]!]!

    events.push(
      // `units` does not survive the round trip, and is not stored because
      // nothing downstream of here reads it: ranking is about when a variable
      // moved and how unusual that is. Live values carry their own units, from
      // the watch entry, and never come from this buffer.
      //
      // `via` is recovered from the descriptor table: definition-read names
      // came through SimConnect, anything else in this buffer came off the
      // module's stream. When a third reader lands, the reader should stamp
      // its samples instead of this being inferred at all.
      readOf(name) === "definition"
        ? { t, via: "client", kind: "simvar", name, units: "", value: ring.value[index]! }
        : { t, via: "link", kind: "var", name, value: ring.value[index]! }
    )
  }

  // Anchors were appended ahead of the changes rather than merged in order, so
  // one sort puts the stream back the way it arrived. Stable, and on a slice
  // rather than on the ring.
  return events.sort((a, b) => a.t - b.t)
}

/** Everything held, for a caller that wants the whole working set. */
export function buffered(): {
  changes: number
  anchors: number
  names: number
  enumerated: number
} {
  return {
    changes: ring.size,
    anchors: anchors.length,
    names: names.length,
    enumerated,
  }
}

/** The size of the aircraft's `L:` table, or 0 before it has been walked. */
export function enumeratedCount(): number {
  return enumerated
}

/**
 * Drops the interactions, and keeps the values.
 *
 * What "clear entries" means, and the asymmetry is the whole of it: the list is
 * a list of anchors, so clearing the list clears anchors. The change ring stays
 * because every baseline is measured from it — emptying it would make the next
 * mark's candidates look *better* than they are, since a variable with no
 * history reads as one that never moves. Clearing a list should not silently
 * re-rank what comes after it.
 */
export function clearAnchors(): void {
  anchors = []
}

/**
 * Drops everything.
 *
 * On disconnect, and between tests. The interning table goes too: ids are
 * positions in an array that is about to be rebuilt, and a stale one would
 * decode a record as the wrong variable — which is the sort of bug that reads
 * as the simulator lying.
 */
export function resetActivity(): void {
  ring = empty()
  anchors = []
  names = []
  ids.clear()
  enumerated = 0
}
