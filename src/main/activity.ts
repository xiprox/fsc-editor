/**
 * Which variable did that switch move?
 *
 * The whole of v1 is this question, and the answer is a ranking over a stream
 * of events that mostly has nothing to do with it. Pure, and a function of the
 * events alone — no clock, no connection, no state — so it can be developed and
 * tested against a captured session with the simulator closed.
 *
 * ## The measurement that shaped it
 *
 * Flipping the PA-24's battery master, in a real capture:
 *
 * | | |
 * | --- | --- |
 * | variables changing within 400 ms | **192** |
 * | of those, not ambient | **14** |
 * | ranked first | `L:Battery1Switch`, correct |
 *
 * The design had proximity as the ranking and ambient demotion as a refinement
 * of it. That is backwards. A 400 ms window around a cockpit interaction
 * catches a hundred and ninety-two variables, because a running simulator is
 * a hundred heartbeats, counters and physics integrators all moving at once —
 * proximity, alone, narrows nothing.
 *
 * What narrows it is **whether moving is unusual for this variable**. Near that
 * anchor the median candidate had changed 961 times in 76 seconds; the ones the
 * switch actually caused had changed twice. So the baseline is the ranking, and
 * proximity is the tie-break it earns afterwards — where it does real work,
 * because the effects arrive in flat bands (46 ms, 123 ms, 200 ms) that
 * separate the switch from what the switch caused.
 */

import {
  AMBIENT_PER_SECOND,
  DIRECT_MS,
  ECHO_MS,
  MARK_DIRECT_MS,
  inBurstAt,
  JITTER_MS,
  MARK_ABSORB_MS,
  MARK_AFTER_MS,
  MARK_BEFORE_MS,
  MIN_QUIET_MS,
  SAMPLE_MS,
  SNAPSHOT_DISTINCT,
  SNAPSHOT_FRACTION,
  SNAPSHOT_MS,
  WINDOW_AFTER_MS,
  WINDOW_BEFORE_MS,
  type Anchor,
  type Mark,
  type Candidate,
  type Finding,
} from "@shared/activity"
import type { CapturedEvent } from "@shared/sim"

/**
 * What the ranking knows beyond the events themselves.
 *
 * Both are facts the buffer cannot contain: how big the aircraft's table is
 * (the ring keeps the count, not the enumeration) and what previous sessions
 * measured (the database). Optional, and absent is a working state — it is what
 * every test and every capture read from disk does.
 */
export interface Ranking {
  /** Size of the aircraft's `L:` table. See `SNAPSHOT_FRACTION`. */
  enumerated?: number
  /** Rates from earlier sessions with this aircraft. See `observedRates`. */
  history?: ReadonlyMap<string, number>
  /**
   * Controls each variable has coincided with before now. See
   * `observedCoincidences`.
   *
   * Unioned with what this session has seen rather than compared to it: a
   * variable that answered to the beacon last week and the beacon again today
   * has coincided with one control, not two, and two counts cannot say that.
   */
  seen?: ReadonlyMap<string, ReadonlySet<string>>
}

/** One `var` event, flattened to what ranking needs. */
interface Change {
  t: number
  name: string
  value: number
}

/**
 * The interactions in a stream, with echoes and machine bursts removed.
 *
 * Three collapse rules apply here and none substitutes for another: the burst
 * rule drops hundreds of controls reporting at once, the echo rule folds the
 * duplicate every interaction produces, and the repeat count keeps one control
 * touched eight times as one anchor that says eight.
 */
export function anchorsIn(events: CapturedEvent[], marks: Mark[] = []): Anchor[] {
  const inputs = events.filter(
    (event): event is CapturedEvent & { kind: "input" } => event.kind === "input"
  )

  // Marks ride the stream as well as arriving as an argument, and both are
  // real: live, they come from `marks.ts` and never enter the ring; from a
  // capture file, the argument is empty and the stream is all there is. Merging
  // here is what makes a capture reproduce its own session — `findingsFor` over
  // a file, with nothing else passed in, gives what the panel showed at the
  // time. Deduplicated by instant, because a mark *is* an instant.
  const seen = new Set(marks.map((one) => one.t))
  const all = [
    ...marks,
    ...events
      .filter((event) => event.kind === "mark" && !seen.has(event.t))
      .map((event) => ({ t: event.t })),
  ]

  const kept = inputs.filter(
    (_event, index) =>
      !inBurstAt(
        inputs.length,
        (i) => inputs[i]!.t,
        (i) => inputs[i]!.name,
        index
      )
  )
  const anchors: Anchor[] = []

  for (const event of kept) {
    const last = anchors[anchors.length - 1]

    // Same control, close enough together, is one thing happening. The value is
    // not compared: a knob being turned reports a different number each time
    // and is still one turn.
    if (last && last.name === event.name && event.t - last.t <= ECHO_MS) {
      last.repeats += 1
      last.value = event.value
      last.t = event.t
      continue
    }

    anchors.push({
      kind: "input",
      t: event.t,
      name: event.name,
      value: event.value,
      before: WINDOW_BEFORE_MS,
      after: WINDOW_AFTER_MS,
      direct: DIRECT_MS,
      repeats: 1,
    })
  }

  return [...anchors, ...marksWorthAnchoring(all, anchors)].sort((a, b) => a.t - b.t)
}

/**
 * The marks that still need to be their own anchor.
 *
 * **An interaction is a better anchor than a mark**, and 08-marks is precise
 * about why: the hotkey carries 200–400 ms of human reaction latency and the
 * input event carries the simulator's own timestamp of the click. Anchoring on
 * the interaction tightens proximity from a fuzzy half-second to tens of
 * milliseconds, which is the difference between four candidates and one.
 *
 * So a mark with an interaction *right next to it* produces no finding of its
 * own. It has not been ignored — it did its job, which was to say which of the
 * things you touched you meant, and the finding it points at is already there
 * and sharper than anything the mark could have anchored.
 *
 * **Next to it, not anywhere in its window.** The window is twelve seconds of
 * history and judging absorption against all of it was wrong the moment the
 * window turned around: flip a reported switch, work an unreported control eight
 * seconds later, press the key, and the capture would quietly answer about the
 * switch. `MARK_ABSORB_MS` is reaction latency plus slack, which is the width
 * over which the two are plausibly one gesture.
 *
 * What is left is the case the feature exists for: a control the simulator does
 * not report at all. Nothing else in the stream marks that moment.
 */
function marksWorthAnchoring(marks: Mark[], inputs: Anchor[]): Anchor[] {
  const sorted = [...marks].sort((a, b) => a.t - b.t)

  return sorted
    .filter(
      (mark) =>
        !inputs.some(
          (input) =>
            input.t >= mark.t - MARK_ABSORB_MS && input.t <= mark.t + MARK_ABSORB_MS
        )
    )
    .map((mark, index, kept) => {
      // "A second press within the window ends it early. Same mechanism, no
      // extra concept — it is just the next anchor closing the previous one."
      //
      // The *previous* press now, because the window looks backwards: two
      // captures in quick succession are two questions about two different
      // moments, and the older one must not swallow the newer one's history.
      const previous = kept[index - 1]
      const before = previous
        ? Math.min(MARK_BEFORE_MS, mark.t - previous.t)
        : MARK_BEFORE_MS

      return {
        kind: "mark" as const,
        t: mark.t,
        name: "Mark",
        before,
        after: MARK_AFTER_MS,
        direct: MARK_DIRECT_MS,
        repeats: 1,
      }
    })
}

/**
 * How often each variable changes **while nothing is happening**.
 *
 * The qualifier is the whole point, and getting it wrong inverts the result for
 * the most interesting case. Measured naively over the whole stream, a knob
 * turned 118 times in two seconds looks like it changes 1.5 times a second —
 * ambient, by any threshold that catches a heartbeat — and the feature would
 * confidently discard the one variable the user was asking about.
 *
 * So the windows around anchors are cut out of both the numerator and the
 * denominator. What is left is the variable's resting rate, which is what
 * "unusual" has to be measured against.
 */
export function baselinesIn(
  events: CapturedEvent[],
  anchors: Anchor[],
  context: Ranking = {}
): Map<string, number> {
  const changes = changesIn(events, context.enumerated ?? 0)
  const rates = new Map<string, number>()
  if (!changes.length) return rates

  const windows = anchors.map((anchor) => ({
    from: anchor.t - anchor.before,
    to: anchor.t + anchor.after,
  }))

  const covered = (t: number): boolean =>
    windows.some((window) => t >= window.from && t <= window.to)

  const span = events[events.length - 1]!.t - events[0]!.t

  // Floored, not clamped to 1 ms. Anchor windows can cover almost all of a
  // young buffer — two marks are 30 seconds of window against a buffer that
  // may be 24 seconds old — and dividing by what is left then turns two
  // enumeration reports into an ambient variable. See `MIN_QUIET_MS`, which
  // carries the measurement.
  const quiet = Math.max(MIN_QUIET_MS, span - merged(windows))

  const counts = new Map<string, number>()
  for (const change of changes) {
    if (covered(change.t)) continue
    counts.set(change.name, (counts.get(change.name) ?? 0) + 1)
  }

  // Every variable seen at all gets a rate, including zero. A variable that
  // only ever moved next to an anchor is the strongest possible candidate, and
  // it must not be missing from the map.
  for (const change of changes) {
    if (rates.has(change.name)) continue

    const live = ((counts.get(change.name) ?? 0) / quiet) * 1000

    /*
     * The higher of what this session shows and what previous ones measured.
     *
     * Max rather than an average or a preference, because the two disagree in
     * only one interesting direction. A buffer two minutes long can fail to
     * show that a variable churns — it may not have churned yet — and that
     * error promotes a heartbeat into the answer. It cannot invent churn that
     * never happened. So the higher reading is the better-informed one, and
     * being wrong here costs a candidate rather than the answer.
     *
     * The cost is real and worth naming: a variable that was ambient on this
     * aircraft in some earlier session stays demoted even if it is quiet now.
     * A variable is not usually the control you are hunting *and* a thing that
     * moves constantly, so that trade is one-sided in practice.
     */
    rates.set(change.name, Math.max(live, context.history?.get(change.name) ?? 0))
  }

  return rates
}

/** Total length of the windows, overlaps counted once. */
function merged(windows: { from: number; to: number }[]): number {
  const sorted = [...windows].sort((a, b) => a.from - b.from)
  let total = 0
  let at = -Infinity

  for (const window of sorted) {
    const from = Math.max(window.from, at)
    if (window.to > from) {
      total += window.to - from
      at = window.to
    }
  }

  return total
}

/**
 * Every change worth ranking, with table re-reports removed.
 *
 * The filter lives here rather than at each caller so baselines and candidates
 * can never disagree about what happened: a snapshot excluded from one and not
 * the other would make a variable's rate a function of which question was
 * being asked.
 */
function changesIn(events: CapturedEvent[], enumerated = 0): Change[] {
  const changes: Change[] = []
  let table = enumerated

  for (const event of events) {
    if (event.kind === "var") changes.push({ t: event.t, name: event.name, value: event.value })
    else if (event.kind === "simvar")
      changes.push({ t: event.t, name: event.name, value: event.value })
    // A capture carries the walk that a live ring has already discarded, so a
    // fixture works out its own table size and a caller does not have to know
    // whether it is holding one.
    else if (event.kind === "vars")
      table = Math.max(table, event.from + event.names.length)
  }

  const spans = snapshotsIn(changes, table)
  if (!spans.length) return changes

  return changes.filter(
    (change) => !spans.some((span) => change.t >= span.from && change.t <= span.to)
  )
}

/**
 * When the module re-reported the whole table, rather than reporting movement.
 *
 * A sliding second, counting distinct names. `SNAPSHOT_DISTINCT` carries the
 * measurement that makes the count meaningful; what matters here is that the
 * window is evaluated once per *sample* rather than once per event, because the
 * wire delivers ~192 values under a single timestamp and a partial sample would
 * be counted against a threshold the whole sample has to clear.
 *
 * Everything inside a flagged span goes, not merely the first report of each
 * variable in it. During a table re-report the aircraft is being enumerated or
 * has just changed, and nothing in that second is attributable to anything a
 * person did — dropping a real change that happened to coincide costs a second
 * of a two-minute buffer, where keeping the snapshot costs the whole answer.
 */
function snapshotsIn(
  changes: Change[],
  enumerated: number
): { from: number; to: number }[] {
  // Half the aircraft's table, or a flat count where no walk was seen. See
  // `SNAPSHOT_FRACTION` for why a fraction and not a constant.
  const limit =
    enumerated > 0 ? Math.ceil(enumerated * SNAPSHOT_FRACTION) : SNAPSHOT_DISTINCT

  if (changes.length <= limit) return []

  const spans: { from: number; to: number }[] = []
  const counts = new Map<string, number>()
  let from = 0

  const drop = (name: string): void => {
    const left = (counts.get(name) ?? 0) - 1
    if (left > 0) counts.set(name, left)
    else counts.delete(name)
  }

  for (let to = 0; to < changes.length; to += 1) {
    const at = changes[to]!
    counts.set(at.name, (counts.get(at.name) ?? 0) + 1)

    while (changes[from]!.t < at.t - SNAPSHOT_MS) {
      drop(changes[from]!.name)
      from += 1
    }

    // Mid-sample: the rest of this timestamp has not been counted yet.
    if (changes[to + 1]?.t === at.t) continue
    if (counts.size <= limit) continue

    const open = spans[spans.length - 1]
    const span = { from: at.t - SNAPSHOT_MS, to: at.t }

    // Consecutive seconds over the threshold are one snapshot, not several.
    if (open && span.from <= open.to) open.to = span.to
    else spans.push(span)
  }

  return spans
}

/**
 * One finding per interaction, best candidate first.
 *
 * Ordering is baseline-filtered, then by *when*: among variables that rarely
 * move, the one that moved first is the one the control is. That is not a
 * heuristic borrowed from somewhere — it is what the capture shows, three flat
 * bands with the switch alone in the first.
 *
 * **Forwards in time first.** The window opens slightly before the anchor to
 * absorb jitter between two transports, and sorting on the raw offset made that
 * tolerance into a preference: a variable that moved 3 ms *before* the control
 * was touched outranked the one that moved 30 ms after it. Found by reading the
 * real output rather than by a failing test, because the case with a known
 * right answer — the battery master, whose effects land at +30 and +42 ms —
 * happened not to have any noise in its pre-window.
 *
 * A cause does not follow its effect, so anything before the anchor sorts last
 * and is never `direct`.
 */
export function findingsFor(
  events: CapturedEvent[],
  marks: Mark[] = [],
  context: Ranking = {}
): Finding[] {
  return rankAll(events, marks, context).windows.map(({ anchor, candidates }) => ({
    anchor,
    candidates,
  }))
}

/**
 * Both passes of the ranking, which is the only place it is complete.
 *
 * Two passes because `promiscuity` is not a property of a candidate — it is a
 * property of a candidate *across every other anchor in the buffer*, and it
 * cannot be known while the first window is still being built. So: collect
 * every window, count which variables answered to how many different controls,
 * then order.
 *
 * `findingsFor` and `explainAll` both come through here rather than each
 * running their own version. A dump that explained a ranking nobody computed
 * would be worse than no dump.
 */
function rankAll(
  events: CapturedEvent[],
  marks: Mark[],
  context: Ranking
): { windows: Explained[]; controls: Map<string, Set<string>> } {
  const anchors = anchorsIn(events, marks)
  if (!anchors.length) return { windows: [], controls: new Map() }

  const baselines = baselinesIn(events, anchors, context)
  const changes = changesIn(events, context.enumerated ?? 0)

  const windows = anchors.map((anchor) => ({
    anchor,
    ...windowFor(anchor, changes, baselines),
  }))

  // By anchor *name*. See `Candidate.promiscuity` for why that is the whole
  // trick: repeats of one control must not look like variety, and every mark
  // shares a name so they collapse to one.
  //
  // Seeded from previous sessions, which is the only way this signal ever
  // reaches a mark: every mark carries the same name, so a session made
  // entirely of marks has one control in it and scores everything 1.
  const controls = new Map<string, Set<string>>()
  for (const [name, before] of context.seen ?? []) {
    controls.set(name, new Set(before))
  }

  for (const window of windows) {
    for (const candidate of window.candidates) {
      const seen = controls.get(candidate.name) ?? new Set<string>()
      seen.add(window.anchor.name)
      controls.set(candidate.name, seen)
    }
  }

  const signatures = signaturesFor(changes)

  for (const window of windows) {
    for (const candidate of window.candidates) {
      candidate.promiscuity = controls.get(candidate.name)?.size ?? 1
    }
    window.candidates.sort(byRank(window.anchor))
    window.candidates = grouped(window.candidates, signatures)
  }

  return { windows, controls }
}

/**
 * One number per variable, standing for every instant it changed.
 *
 * Two variables with the same signature moved together every single time in
 * this buffer, which is what makes them one fact rather than two — see
 * `Candidate.aliases`. Hashed rather than kept as a list of timestamps because
 * a busy variable has twelve thousand of them and there are five thousand
 * variables; the strings alone would be tens of megabytes for a question asked
 * once a second.
 */
function signaturesFor(changes: Change[]): Map<string, number> {
  const hashes = new Map<string, number>()

  for (const change of changes) {
    // FNV-1a over the timestamp, folded into whatever the name has so far.
    // Order matters and repetition matters, which is what makes it a signature
    // rather than a set.
    let hash = hashes.get(change.name) ?? 0x811c9dc5
    let t = change.t

    for (let byte = 0; byte < 6; byte += 1) {
      hash ^= t & 0xff
      hash = Math.imul(hash, 0x01000193)
      t = Math.floor(t / 256)
    }

    hashes.set(change.name, hash)
  }

  return hashes
}

/**
 * Collapses lockstep variables into the best-ranked one, keeping the rest.
 *
 * Runs after the sort, so the survivor is the one the ranking chose and the
 * aliases hang off it in the order they were already in. Nothing is discarded:
 * an alias is still on screen, just not occupying a row of its own.
 */
function grouped(
  candidates: Candidate[],
  signatures: Map<string, number>
): Candidate[] {
  const first = new Map<number, Candidate>()
  const kept: Candidate[] = []

  for (const candidate of candidates) {
    const signature = signatures.get(candidate.name)
    if (signature === undefined) {
      kept.push(candidate)
      continue
    }

    const already = first.get(signature)
    if (already) {
      already.aliases.push(candidate.name)
      continue
    }

    first.set(signature, candidate)
    kept.push(candidate)
  }

  return kept
}

/** Close enough to the anchor to be the control rather than its consequence. */
function within(anchor: Anchor, offset: number): boolean {
  if (anchor.kind === "mark") return Math.abs(offset) <= anchor.direct
  return offset >= -JITTER_MS && offset <= anchor.direct
}

/** How many samples from the anchor, which is as fine as timing gets here. */
function sample(offset: number): number {
  return Math.floor(Math.abs(offset) / SAMPLE_MS)
}

/**
 * Best first, for one anchor.
 *
 * **For an input event, a cause does not follow its effect**, so a change more
 * than a sample's jitter before the click sorts last whatever else is true of
 * it. Then specificity, then proximity — that order is the correction made
 * after watching proximity hand the top of the list to a click sound for three
 * anchors running. The module samples at 15 Hz, so everything inside one 66 ms
 * tick carries an identical offset and proximity frequently cannot separate the
 * answer from its own side effects; it does real work between ticks and none at
 * all within one.
 *
 * **For a capture there is no such arrow**, and applying one would invert the
 * feature. A capture's window runs twelve seconds *backwards* — you do the
 * thing and then press the key — so the answer is always before the anchor, by
 * however long it took to reach for the keyboard. Penalising that would put
 * every real answer in the same demoted bucket and rank the two seconds of tail
 * above all of it. Distance from the press is the whole signal, in both
 * directions.
 *
 * Baseline stays as the tie-break under both, and the name under that, so the
 * order is total and a test can assert on it.
 */
function byRank(anchor: Anchor): (a: Candidate, b: Candidate) => number {
  const early =
    anchor.kind === "input"
      ? (candidate: Candidate) => Number(candidate.offset < -JITTER_MS)
      : () => 0

  return (a, b) =>
    early(a) - early(b) ||
    a.promiscuity - b.promiscuity ||
    sample(a.offset) - sample(b.offset) ||
    a.baseline - b.baseline ||
    a.name.localeCompare(b.name)
}

/**
 * Everything in an anchor's window, kept and discarded, with the reason.
 *
 * `candidatesFor` is this without the discards, and the split exists because
 * the discards are the interesting half when the ranking is *wrong*. A
 * candidate list that does not contain the variable somebody was looking for
 * says nothing about why: it was never in the window, or it was in the window
 * and rejected as ambient at a rate this can now name. Those are different
 * bugs and they were previously indistinguishable from the outside.
 */
function windowFor(
  anchor: Anchor,
  changes: Change[],
  baselines: Map<string, number>
): { candidates: Candidate[]; rejected: Rejected[] } {
  const from = anchor.t - anchor.before
  const to = anchor.t + anchor.after

  const first = new Map<string, Candidate>()
  const discarded = new Map<string, Rejected>()

  for (const change of changes) {
    if (change.t < from || change.t > to) continue

    const baseline = baselines.get(change.name) ?? 0
    const offset = change.t - anchor.t

    if (baseline > AMBIENT_PER_SECOND) {
      if (!discarded.has(change.name)) {
        discarded.set(change.name, {
          name: change.name,
          value: change.value,
          offset,
          baseline,
          reason: "ambient",
        })
      }
      continue
    }

    const existing = first.get(change.name)

    /*
     * The occurrence **nearest the anchor** wins the offset; the value keeps
     * updating, because a knob settles.
     *
     * This used to keep the first occurrence in the window, which was the same
     * thing while every window ran forwards — first and nearest are one and the
     * same when the anchor is at the start. A capture's window runs twelve
     * seconds backwards, and there "first" is the *oldest*: a variable that
     * moved ten seconds ago and again just before the press would be ranked,
     * and labelled, by the ten-second figure.
     */
    if (existing) {
      existing.value = change.value

      if (Math.abs(offset) < Math.abs(existing.offset)) {
        existing.offset = offset
        existing.tier = within(anchor, offset) ? "direct" : "downstream"
      }
      continue
    }

    first.set(change.name, {
      name: change.name,
      value: change.value,
      offset,
      // Measured from the anchor in whichever directions that anchor expects.
      // An input event tolerates a sample of jitter before it, because a
      // control's own variable routinely reports a few milliseconds early and
      // calling that *downstream* says the switch is a consequence of itself. A
      // capture is symmetric: its answer is normally before the press.
      tier: within(anchor, offset) ? "direct" : "downstream",
      baseline,
      // Filled by `rankAll`, which is the only caller that can know either. One,
      // not zero: a variable seen in exactly this window has answered to
      // exactly one control, and the default should be the truth rather than a
      // sentinel that sorts first.
      promiscuity: 1,
      aliases: [],
    })
  }

  // Ordered here so a window is never returned unsorted, and ordered again by
  // `rankAll` once promiscuity is known. The second pass is the real one.
  return {
    candidates: [...first.values()].sort(byRank(anchor)),
    rejected: [...discarded.values()].sort(
      (a, b) => Math.abs(a.offset) - Math.abs(b.offset)
    ),
  }
}

/** A variable that was in the window and did not make the list. */
export interface Rejected {
  name: string
  value: number
  offset: number
  baseline: number
  reason: "ambient"
}

/**
 * Everything the ranking knew, for one anchor.
 *
 * Kept out of `Finding` deliberately: the panel renders an answer and this is
 * the working, which is orders of magnitude larger and interesting only when
 * somebody is asking why the answer is wrong.
 */
export interface Explained {
  anchor: Anchor
  candidates: Candidate[]
  rejected: Rejected[]
}

/**
 * The ranking with its working shown.
 *
 * Same inputs and the same code path as `findingsFor` — it must be, or a dump
 * would explain a computation nobody ran. What it adds is the rejected half of
 * every window and a count of how many *different* anchors each variable turned
 * up in, which is the measurement the current ranking does not make.
 *
 * That count is worth the file it costs. A cockpit click sound, an eyelid
 * blink, a camera-motion accumulator and an electrical-draw total all move
 * within 50 ms of *every* interaction, so they are not ambient by rate — they
 * genuinely only move when you touch something — and they outrank the actual
 * control whenever they land in an earlier 66 ms sample. A variable that
 * answers to every anchor is answering to none of them, and this is the number
 * that would say so.
 */
export function explainAll(
  events: CapturedEvent[],
  marks: Mark[] = [],
  context: Ranking = {}
): {
  anchors: Explained[]
  companions: { name: string; controls: number; under: string[] }[]
} {
  const { windows, controls } = rankAll(events, marks, context)

  return {
    anchors: windows,
    // Named, not just counted. "This answered to 11 of your 12 controls" is a
    // claim somebody should be able to check, and the list is what makes the
    // difference between a knob turned twice and a genuine companion legible
    // without going back to the anchors.
    companions: [...controls]
      .map(([name, under]) => ({
        name,
        controls: under.size,
        under: [...under].sort(),
      }))
      .sort((a, b) => b.controls - a.controls || a.name.localeCompare(b.name)),
  }
}
