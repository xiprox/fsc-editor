/**
 * A dump of everything Activity knew at one moment.
 *
 * ## Why this exists
 *
 * The panel shows an answer. When the answer is wrong — and on the PA-24 it
 * often is — the panel is the worst possible place to find out why, because
 * everything that would explain it has already been filtered out by the time
 * anything renders. A variable missing from a candidate list is missing for one
 * of four unrelated reasons: it never changed, it changed outside the window,
 * it was rejected as ambient, or it was ranked below the fold. Those need
 * different fixes and the UI cannot tell them apart.
 *
 * So this writes the working out: every anchor, every candidate, every
 * *rejected* candidate with its measured rate, the marks, the constants that
 * were in force, and the counts that say which variables answer to every anchor
 * rather than to one. It is meant to be read by whoever is tuning the ranking,
 * and handed over verbatim.
 *
 * ## Why this is not the capture
 *
 * The capture beside it holds the raw stream, and this deliberately does not
 * duplicate it — `capture` names that file so the two can be paired. What a
 * capture cannot hold is the *derived* half: baselines are computed from a
 * window of history that has already rolled out of the ring by the time anybody
 * looks, so recomputing them later from a capture gives different numbers than
 * the ones the panel actually used.
 *
 * ## Why it returns rather than writes
 *
 * It had its own button and its own folder once, which put the burden of
 * knowing that a dump existed, and of finding it afterwards, on the person
 * least able to carry it. It is now one file inside the debug report — see
 * docs/debug-report.md — so this hands back the object and the report owns
 * every question about where anything lands.
 */

import {
  AMBIENT_PER_SECOND,
  BURST_DISTINCT,
  BURST_MS,
  DIRECT_MS,
  ECHO_MS,
  MARK_AFTER_MS,
  MARK_BEFORE_MS,
  MIN_QUIET_MS,
  SNAPSHOT_DISTINCT,
  SNAPSHOT_FRACTION,
  SNAPSHOT_MS,
  WINDOW_AFTER_MS,
  WINDOW_BEFORE_MS,
} from "@shared/activity"

import { explainAll } from "./activity"
import {
  BUFFER_SECONDS,
  buffered,
  enumeratedCount,
  slice,
} from "./activity-buffer"
import { allMarks } from "./marks"
import { captureFile } from "./sim/capture"
import { observedCoincidences, observedRates } from "./sim/store"

/** Everything the ranking consulted, and everything it decided. */
export function activityDebug(aircraft: string | null): unknown {
  const events = slice()
  const marks = allMarks()
  const history = observedRates(aircraft)
  const seen = observedCoincidences(aircraft)
  const { anchors, companions } = explainAll(events, marks, {
    enumerated: enumeratedCount(),
    history,
    seen,
  })

  return {
    at: Date.now(),
    aircraft,
    capture: captureFile(),

    /*
     * The buffer's own account of itself. `changes` at capacity means the ring
     * wrapped, and the span below is then shorter than BUFFER_SECONDS claims —
     * which matters, because every baseline in this file is a rate measured
     * over that span and not over the two minutes the constant advertises.
     */
    buffer: {
      ...buffered(),
      seconds: BUFFER_SECONDS,
      from: events[0]?.t ?? null,
      to: events[events.length - 1]?.t ?? null,
      events: events.length,
    },

    /*
     * Recorded rather than assumed. A dump read six months from now has to be
     * interpretable against the thresholds that produced it, not against
     * whatever they were later tuned to.
     */
    constants: {
      AMBIENT_PER_SECOND,
      WINDOW_BEFORE_MS,
      WINDOW_AFTER_MS,
      DIRECT_MS,
      MARK_BEFORE_MS,
      MARK_AFTER_MS,
      ECHO_MS,
      BURST_DISTINCT,
      BURST_MS,
      MIN_QUIET_MS,
      SNAPSHOT_MS,
      SNAPSHOT_FRACTION,
      SNAPSHOT_DISTINCT,
    },

    /*
     * Every mark, including the ones that produced no anchor of their own.
     * That is not noise: a mark absorbed by a nearby input event is the single
     * most confusing outcome the feature has — the user pressed the key, the
     * panel shows something they did not press it for, and nothing anywhere
     * says the two are related.
     */
    marks: marks.map((mark) => ({
      t: mark.t,
      anchored: anchors.some(
        (one) => one.anchor.kind === "mark" && one.anchor.t === mark.t
      ),
    })),

    /*
     * What history contributed, so a rate in this file can be traced to the
     * session that measured it rather than to the two minutes on screen.
     */
    history: { variables: history.size, coincidences: seen.size },

    companions,
    anchors,
  }
}
