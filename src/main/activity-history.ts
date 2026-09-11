/**
 * Captures the user asked for, and what every interaction teaches regardless.
 *
 * ## Two jobs, and the line between them
 *
 * Every input event teaches the ranking something — which variables coincide
 * with which controls, written to `sim_coincidence` and read back next session.
 * That runs on **everything**, always, and has nothing to do with what anybody
 * is looking at.
 *
 * A **capture** is different: it exists because somebody asked for one, by
 * arming auto-capture, pressing the button, or pressing the hotkey. It is a row
 * in the panel.
 *
 * Conflating those two produced the worst bug in the feature. Arming began life
 * in the renderer as a filter over a list recomputed from the ring, on the
 * reasoning that the learning had to keep running — which was true and
 * irrelevant, because the learning was never in the renderer. So interactions
 * kept becoming rows and the panel subtracted them, and re-arming released two
 * dozen of them at once. **Hiding can be undone; not creating cannot.** Arming
 * is a capture policy and it lives here.
 *
 * ## Why a capture is computed once and kept
 *
 * A finding for a closed anchor never changes. Its window has passed, the ring
 * holds everything that window will ever hold, and recomputing gives the same
 * answer until the data rolls out — after which it gives *nothing*, and a row
 * somebody is watching values on disappears. So a capture is computed when its
 * window closes and then kept, and the two-minute ring stops being able to take
 * the panel's contents away.
 *
 * What that costs: a kept capture is a snapshot of what was known when it
 * closed, so it does not improve when later flips teach the ranking more. Live
 * values on its rows keep working either way, which is what the row is for.
 *
 * ## What is deliberately not recorded as a coincidence
 *
 * **Marks.** They all share a name, so persisting them would build one control
 * called `Mark` that everything has coincided with — and every answer a mark
 * ever found would be demoted by every other mark. See the migration.
 */

import {
  MARK_AFTER_MS,
  MARK_BEFORE_MS,
  WINDOW_AFTER_MS,
  type Finding,
} from "@shared/activity"

import { findingsFor, type Ranking } from "./activity"
import { enumeratedCount, slice } from "./activity-buffer"
import { allMarks } from "./marks"
import { observedCoincidences, observedRates, recordCoincidence } from "./sim/store"

/**
 * How long after the last event before an anchor is finished.
 *
 * The window itself plus room for the module's next send: values arrive at
 * 15 Hz, so a change at the very end of the window is delivered up to 67 ms
 * after it, and finishing before that would drop exactly the slowest effects —
 * the ones a downstream variable is most likely to be.
 */
const SETTLE_MS = 250

/** Captures kept. Far more than anybody scrolls, small enough to ignore. */
const LIMIT = 100

interface Pending {
  kind: "input" | "mark"
  /** The anchor name to match on finalising. Marks all share one. */
  name: string
  /** When the interaction happened, which is what identifies its anchor. */
  at: number
  timer: ReturnType<typeof setTimeout>
}

/** Coincidence timers, one per control, debounced. Nothing to do with capture. */
const learning = new Map<string, ReturnType<typeof setTimeout>>()

let loaded: string | null = null
let armed = true
let pending: Pending | null = null
let taken: Finding[] = []
/**
 * Everyone told when the capture list or the armed state changes.
 *
 * A set, like every other listener in main: a single slot meant a second
 * subscriber silently replaced the first, which is a failure with no symptom
 * at the place it happens.
 */
const captureListeners = new Set<() => void>()

function notify(): void {
  for (const listener of captureListeners) listener()
}

/** Fires when the capture list or the armed state changes. */
export function onCaptureChange(listener: () => void): () => void {
  captureListeners.add(listener)
  return () => captureListeners.delete(listener)
}

export function watchAircraft(aircraft: string | null): void {
  loaded = aircraft
}

export function isArmed(): boolean {
  return armed
}

/**
 * Arms or disarms auto-capture.
 *
 * Disarming never discards a capture in flight: the user asked for that one
 * before they changed their mind about the next one.
 */
export function setArmed(next: boolean): void {
  if (armed === next) return
  armed = next
  notify()
}

/**
 * One input event. Always teaches; captures only when armed.
 *
 * The teaching half is debounced per *control*, because the simulator reports
 * every interaction at least twice and a knob a hundred times — a timer per
 * event would record a hundred coincidences for one gesture and teach the
 * ranking that the knob's own variable is promiscuous.
 */
export function noteInteraction(control: string, at: number): void {
  clearTimeout(learning.get(control))
  learning.set(
    control,
    setTimeout(() => {
      learning.delete(control)
      learn(control)
    }, WINDOW_AFTER_MS + SETTLE_MS)
  )

  // Disarmed, or already holding one: this interaction is background. It still
  // teaches, above, and it never becomes a row.
  if (!armed || pending) return

  armed = false
  begin({ kind: "input", name: control, at })
}

/**
 * The hotkey, or the button. Always captures.
 *
 * Not conditional on being armed, because pressing it *is* the request — a
 * button that quietly did nothing while auto-capture was off would be the same
 * class of bug as the one this file was rewritten to fix.
 */
export function noteMark(at: number): void {
  if (pending) return

  armed = false
  begin({ kind: "mark", name: "Mark", at })
}

/** Finalised captures, plus the one in flight so a row appears immediately. */
export function captures(): Finding[] {
  if (!pending) return taken

  const live = findFor(pending)
  return live ? [...taken, live] : taken
}

function begin(what: Omit<Pending, "timer">): void {
  const after = what.kind === "mark" ? MARK_AFTER_MS : WINDOW_AFTER_MS

  pending = {
    ...what,
    timer: setTimeout(finalise, after + SETTLE_MS),
  }

  // Immediately. The window looks backwards, so the evidence is already in the
  // ring when the key goes down and the row arrives with its candidates rather
  // than as a placeholder waiting for its own window to fill.
  notify()
}

/**
 * Freezes the capture in flight.
 *
 * A capture with no anchor is not an empty finding, it is a capture that should
 * not have happened — an aircraft change dumps hundreds of input events at
 * once, `anchorsIn` drops them as a machine burst, and the arm that fired on
 * the first of them has to be given back rather than spent on nothing.
 */
function finalise(): void {
  const found = pending && findFor(pending)
  pending = null

  if (found) {
    taken.push(found)
    if (taken.length > LIMIT) taken = taken.slice(-LIMIT)
  } else {
    armed = true
  }

  notify()
}

/**
 * The anchor this capture is of, ranked against everything in the ring.
 *
 * Nearest by time rather than latest by time: while a capture is held, the
 * background keeps producing anchors for the same control, and "the last one
 * called `SWITCH_X`" would drift onto a flip nobody asked about.
 *
 * A mark falls back to a nearby *input* anchor, because that is what
 * `marksWorthAnchoring` decided: an interaction is a better anchor than a mark,
 * so a mark next to one produces no anchor of its own and the finding it was
 * pointing at is the input's.
 */
function findFor(what: Pending): Finding | undefined {
  // `allMarks()`, not an empty list: the ring drops `mark` events, so a mark
  // anchor only exists if the marks are handed in beside the changes.
  const found = findingsFor(slice(), allMarks(), context())

  const wanted = found.filter((one) =>
    what.kind === "mark"
      ? one.anchor.kind === "mark" && one.anchor.t === what.at
      : one.anchor.name === what.name
  )

  const near = wanted.length
    ? wanted
    : what.kind === "mark"
      ? found.filter(
          (one) =>
            one.anchor.t >= what.at - MARK_AFTER_MS &&
            one.anchor.t <= what.at + MARK_BEFORE_MS
        )
      : []

  return near.sort(
    (a, b) => Math.abs(a.anchor.t - what.at) - Math.abs(b.anchor.t - what.at)
  )[0]
}

/** What the ranking knows beyond the events. Rebuilt per call; both are cached. */
function context(): Ranking {
  return {
    enumerated: enumeratedCount(),
    history: observedRates(loaded),
    seen: observedCoincidences(loaded),
  }
}

/**
 * Ranks the whole buffer and writes down what this control coincided with.
 *
 * The whole buffer, not a window around the anchor, and that is not laziness:
 * baselines are rates measured against quiet time, so a slice cut to one window
 * would have almost no quiet time in it and would measure everything as
 * ambient.
 */
function learn(control: string): void {
  if (!loaded) return

  const latest = findingsFor(slice(), allMarks(), context())
    .filter((finding) => finding.anchor.name === control)
    .sort((a, b) => a.anchor.t - b.anchor.t)
    .pop()

  if (!latest) return

  // Aliases too. An alias moved in lockstep with the candidate that happened to
  // rank first, so it coincided with this control just as much — recording only
  // the representative would leave the other four names of one lever looking
  // specific forever.
  recordCoincidence(
    loaded,
    control,
    latest.candidates.flatMap((one) => [one.name, ...one.aliases])
  )
}

/** Drops captures and pending work. On disconnect, on clear, and in tests. */
export function resetActivityHistory(): void {
  for (const timer of learning.values()) clearTimeout(timer)
  learning.clear()

  if (pending) clearTimeout(pending.timer)
  pending = null
  taken = []
  armed = true
  loaded = null
}

/** Empties the list without forgetting the aircraft. What "clear entries" does. */
export function clearCaptures(): void {
  if (pending) clearTimeout(pending.timer)
  pending = null
  taken = []
  armed = true
  notify()
}
