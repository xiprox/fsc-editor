/**
 * What the Activity feed is made of.
 *
 * Raw events persist; **findings are a view computed over them**. The shape of
 * a `SimEvent` is settled and evidence, and these are not: how a candidate is
 * ranked, what counts as ambient, where the tier boundary sits are all things
 * the build is still learning. Deriving them at read time keeps the uncertain
 * part out of the schema and off disk.
 *
 * No runtime imports: main computes, the renderer draws.
 */

/**
 * Why a finding exists — the moment something is being explained.
 *
 * `input` is a cockpit control the simulator reported. `mark` is stage 5's
 * hotkey, for a control the sim does *not* report, which is the case the whole
 * feature exists for.
 */
export type AnchorKind = "input" | "mark"

export interface Anchor {
  kind: AnchorKind
  /** App clock, matching `CapturedEvent.t`. */
  t: number
  /** The input event's name, or the mark's label. */
  name: string
  value?: number | string
  /**
   * How far either side of `t` this anchor explains, in milliseconds.
   *
   * Carried per anchor rather than fixed, because the two kinds are not the
   * same question. An input event is the simulator's own timestamp of a click
   * and its effects land inside half a second; a mark is a human pressing a key
   * while looking at another application, which 08-marks measures at 200–400 ms
   * of reaction latency and a much wider window either side.
   */
  before: number
  after: number
  /**
   * Within this many milliseconds after `t`, a change is the control itself
   * rather than something the control caused.
   *
   * Per anchor for the same reason as `before` and `after`, and getting it
   * wrong is worse here because it is what the panel labels rows with. An
   * input event carries the simulator's own timestamp of the click, so a
   * hundred milliseconds is generous. **A mark carries a person**: the press
   * comes first and the hand arrives afterwards, so the control's own variable
   * lands whole seconds later — the cabin vent lever this was found on reports
   * between +797 ms and +1363 ms. Judged by an input event's hundred
   * milliseconds, every mark answers "0 direct, 76 downstream", which tells
   * somebody the variable they were looking for is a side effect of itself.
   */
  direct: number
  /**
   * How many raw events collapsed into this one.
   *
   * An interaction almost always reports twice — 25–55 ms apart, measured — and
   * a control held or turned reports many times. Both are one thing a person
   * did, and the count is kept because "I turned it eight times" is worth
   * seeing where "it fired twice" is noise.
   */
  repeats: number
}

/**
 * How soon after the anchor a variable moved.
 *
 * Measured rather than invented. Flipping the PA-24's battery master moves
 * `L:Battery1Switch` at 46 ms, `L:BatteryElecPower` at 123 ms, and the eleven
 * things downstream of the bus at 200 ms — three flat bands, not a gradient.
 * `direct` is the first band: the variable the switch *is*, rather than what
 * the switch caused.
 */
export type Tier = "direct" | "downstream"

export interface Candidate {
  name: string
  /** The value it settled on inside the window. */
  value: number
  /** Milliseconds after the anchor. */
  offset: number
  tier: Tier
  /**
   * Changes per second while nothing was happening.
   *
   * The ranking signal, and the one that does the work: 192 variables move
   * within 400 ms of a cockpit interaction, and 14 of them move rarely enough
   * for that to mean anything.
   */
  baseline: number
  /**
   * How many **different controls** this variable has answered to.
   *
   * A variable that moves for everything you touch is telling you about
   * touching, not about the control. Measured over a PA-24 session with 67
   * anchors across 12 distinct controls, the separation is not subtle:
   *
   * | | |
   * | --- | --- |
   * | `L:InGameTime`, `L:Count2…900`, `L:Eyelids4` | 11 of 12 |
   * | `L:p42_cp_motion_pause`, `L:Blinking4Offset` | 10 of 12 |
   * | `L:scalarLiftStabL/R`, `L:FM_Dragfin` | 8 of 12 |
   * | **every** variable a control actually moved | **1 of 12** |
   *
   * Click sounds, blink offsets, camera accumulators and a set of counters.
   * They are not ambient — they only move when you touch something, so no rate
   * threshold will ever see them — and they took the top of the list.
   *
   * **Different controls, not different anchors.** Flipping the beacon four
   * times makes four anchors and `L:BeaconLightSwitch` is in all four windows;
   * counting anchors would demote the answer as promiscuous. Anchors are
   * counted by name, which also collapses every mark into one — deliberately,
   * since two marks on the same control would otherwise demote the very thing
   * they were both pointing at.
   *
   * This is complementary to `baseline` rather than a replacement: `L:Count900`
   * ticks too rarely to be ambient but sits near everything, and a heartbeat is
   * the reverse. Neither catches both.
   */
  promiscuity: number
  /**
   * Other variables that move in lockstep with this one, and are not listed
   * separately because they are not separate answers.
   *
   * An aircraft keeps several names for one fact. Pulling the cabin vent moves
   * `L:CabinVentLeftLever`, `L:CabinVentLever1`, `L:CabinVents`,
   * `L:CabinFrontVents` and `L:CabinPushPullLevers` on the same sample, every
   * time; a switch usually has an `X` and an `XPAST`; a sound has `_p` and `_v`
   * siblings. Six rows saying one thing crowds out the five other things a
   * window found — measured on the six-control fixture, ten candidates are five
   * distinct instants.
   *
   * Grouped on the variable's **whole history in the buffer** being identical,
   * not on sharing one 66 ms sample. Sharing a sample means "the wire delivered
   * these together" and sweeps in coincidences; sharing every sample means the
   * aircraft moves them as one thing.
   */
  aliases: string[]
}

export interface Finding {
  anchor: Anchor
  /** Best first. Ambient variables are not here at all. */
  candidates: Candidate[]
}

/**
 * The echo window: two reports of one interaction, not two interactions.
 *
 * Stage 0 found every input event firing twice. Measured across a real session:
 * 43 pairs at 17–21 ms, nine at 37–40 ms, and the nearest *genuine* repeat at
 * 261 ms — a course knob reporting the same value twice during a continuous
 * turn, which must not be swallowed. 100 ms sits in the gap with room either
 * side.
 */
export const ECHO_MS = 100

/**
 * A burst of many *distinct* controls at once is a machine, never a person.
 *
 * An aircraft change snapshots every input event 4–8 seconds before announcing
 * itself: 318 distinct events in 2 ms, measured. Anchoring those would produce
 * 318 findings attributed to whatever aircraft was leaving.
 *
 * Distinct is what matters. One control reporting 118 times is somebody turning
 * a knob, and that is the opposite of this.
 */
export const BURST_DISTINCT = 20
export const BURST_MS = 50

/**
 * Is the item at `index` part of a machine burst?
 *
 * Index-based accessors rather than an array of anything, because the two
 * callers hold different records and neither should have to build a third: the
 * Activity ranking asks about input events, and the Log panel asks about
 * `LogEntry` rows. What they share is not a shape, it is the rule — **many
 * *distinct* things at once is a machine, never a person** — and that rule is
 * exactly two accessors wide.
 *
 * The alternative was the panel growing its own copy of a constant and a loop,
 * which is the specific thing the stage 4 plan warned about: two collapse rules
 * that agree today and drift the first time either is tuned.
 *
 * Distinctness is what carries it. One control reporting a hundred times in a
 * second is somebody turning a knob and must survive; twenty controls reporting
 * once each in two milliseconds is the simulator dumping state.
 */
export function inBurstAt(
  count: number,
  timeAt: (index: number) => number,
  keyAt: (index: number) => string,
  index: number
): boolean {
  const at = timeAt(index)
  const keys = new Set<string>()

  for (let i = index; i >= 0 && at - timeAt(i) <= BURST_MS; i -= 1) keys.add(keyAt(i))
  for (let i = index; i < count && timeAt(i) - at <= BURST_MS; i += 1) keys.add(keyAt(i))

  return keys.size >= BURST_DISTINCT
}

/** How long after an anchor a change can still be attributed to it. */
export const WINDOW_BEFORE_MS = 50

/**
 * How far before an anchor still counts as *at* it.
 *
 * `L:` values arrive through our WASM module and input events through
 * SimConnect, two transports with independent latencies, so the offset between
 * a control and its own variable carries tens of milliseconds of noise that
 * has nothing to do with causation. The window has always opened 50 ms early to
 * absorb that. The **sort** did not, and treated any negative offset as proof
 * the change preceded the cause.
 *
 * Measured on a live session — eleven pitot-heat flips and two battery master
 * flips, where the right answer is known:
 *
 * | ordering | right answer first | in the top three | mean position |
 * | --- | --- | --- | --- |
 * | negatives sort last | 4 of 13 | 6 of 13 | 5.1 |
 * | **within jitter, sort by distance** | **8 of 13** | **13 of 13** | **1.5** |
 *
 * `L:Battery1Switch` — the variable the whole ranking was built on — placed
 * **15th of 16** in both battery anchors, for reporting 2 ms early. A tolerance
 * that exists in the window and not in the ordering is not a tolerance.
 *
 * 50 ms and 100 ms score identically, so this sits in the flat part; it is the
 * same number as `WINDOW_BEFORE_MS` because it is the same fact about the same
 * two transports.
 */
export const JITTER_MS = 50

/**
 * One sample of the module's stream. Offsets closer together than this are not
 * ordered information.
 *
 * Two reasons, and the second is the one that bites. The module sends at 15 Hz,
 * so nothing that happens between ticks can be distinguished — everything in
 * one message describes the same instant. And the app stamps each value with
 * `Date.now()` as it *parses*, so the ~192 values in one 8 KB message land 0–3
 * milliseconds apart: an artefact of parse order, which is variable-id order,
 * which is nothing.
 *
 * Ranking on raw milliseconds therefore ranks on variable id whenever a control
 * and its effects arrive together — and a battery master's effects all arrive
 * together. Measured on eighteen anchors with known answers:
 *
 * | ordering | right answer first | mean position |
 * | --- | --- | --- |
 * | raw offset | 12 of 18 | 2.22 |
 * | **quantised to a sample** | **14 of 18** | **1.22** |
 *
 * `L:Battery1Switch` moved from eighth and tenth to second in both, behind
 * `L:Battery1Volts` — which is a genuine tie no signal here can break, since
 * the switch and its own voltage really do land in the same sample.
 *
 * Below a sample, the tie-break falls through to `baseline`, which is the right
 * question to ask next: among things that arrived together, the one that moves
 * least often is the likelier control.
 */
export const SAMPLE_MS = 67
export const WINDOW_AFTER_MS = 600

/** The first timing band. See `Tier`. */
export const DIRECT_MS = 100

/**
 * The same band for a capture, which is a person and not a timestamp.
 *
 * An input event carries the simulator's own instant of the click, so a hundred
 * milliseconds is generous. A capture carries a hand leaving a control and
 * reaching for a key: 08-marks measures 200–400 ms of reaction latency, and
 * that is the floor rather than the figure — noticing something, deciding it is
 * worth keeping and then pressing is slower than reacting to a light.
 *
 * Two seconds, measured from the press in **both** directions, because the
 * gesture straddles it: the control moved before, and its slower effects are
 * still arriving after. Wide enough to hold an ordinary act-then-press, narrow
 * enough to still separate that from the physics and camera values that turn up
 * seconds away.
 */
export const MARK_DIRECT_MS = 2_000

/**
 * A mark: a moment somebody pressed the hotkey.
 *
 * No label and no duration. 08-marks is emphatic that this is stateless because
 * of *where* it is pressed — the simulator is fullscreen in front of you, and a
 * toggle you have lost track of cannot be checked without alt-tabbing, which is
 * the exact cost the hotkey exists to avoid.
 */
export interface Mark {
  t: number
}

/**
 * The window around a capture: **−12 s / +2 s**. Backwards.
 *
 * You do the thing, then press the key. That is one sentence to explain and it
 * is what people actually do — the intent to capture forms *after* something
 * interesting happens, not before.
 *
 * It was forward-biased first, −3 s / +12 s, on one line of 08-marks:
 * "press-then-act is the common gesture". The rest of that document says the
 * opposite. "Press it whenever something happens" is act-then-press. "**You
 * cannot press start too late** — the interesting thing sometimes announces
 * itself afterwards, and this takes the window *before* it" is an argument for
 * exactly this shape. And the 200–400 ms it measures is *reaction* latency,
 * which only exists when the event comes first.
 *
 * The practical difference is the one that decided it: forwards, the panel had
 * to wait twelve seconds after the press before it could say anything, with no
 * indication of why. Backwards, the evidence is already in the ring when the
 * key is pressed, so the answer is there immediately and the tail is only wide
 * enough to catch effects still landing.
 */
export const MARK_BEFORE_MS = 12_000

/**
 * The tail, kept short on purpose.
 *
 * A capture cannot be shown as settled until its window closes, so this is felt
 * directly: every millisecond of tail is a millisecond between pressing the key
 * and the answer holding still. It does not delay the answer *appearing* — the
 * evidence is already in the ring when the key is pressed, which is the point
 * of looking backwards — but a list that keeps shifting for two seconds after a
 * press reads as a slow one.
 *
 * Half a second is not arbitrary either way. A control's effects arrive in flat
 * bands measured at 46, 123 and 200 ms, and the press lands 200–400 ms after
 * the act, so everything belonging to the gesture is already in by the time the
 * key goes down; this is slack for the slowest downstream effect and for one
 * more 15 Hz sample. Much below 300 ms and real effects start falling outside.
 *
 * Anyone who needs more can simply press a moment later, which is a thing a
 * person learns in one try — where waiting on the panel is a thing they endure
 * every time.
 */
export const MARK_AFTER_MS = 500

/**
 * How close an interaction has to be to a capture to speak for it.
 *
 * A mark next to an input event produces no anchor of its own, because the
 * input event carries the simulator's own timestamp of the click where the mark
 * carries a human's reaction — anchoring on the sharper of the two is worth
 * more than anchoring on the one that was requested.
 *
 * That trade only holds when the two are plausibly the same gesture. Judged
 * against the whole twelve-second window it stops being true: flip a reported
 * switch, work an unreported control eight seconds later, press the key, and
 * the capture would answer about the switch. Reaction latency plus slack is the
 * honest width.
 */
export const MARK_ABSORB_MS = 2_000

/**
 * What an interaction in the sim does to the capture list.
 *
 * - `off` — nothing. Capture and its hotkey still work.
 * - `once` — the next interaction becomes a row, and the mode drops to `off`.
 * - `always` — every interaction becomes a row.
 *
 * `once` is the only one that changes by itself. Main keeps what was *chosen*
 * apart from what is *in effect*: a spent `once` reads as `off` in the panel,
 * and clearing the list arms it again, where a chosen `off` stays off.
 */
export type CaptureMode = "off" | "once" | "always"

/**
 * The two things worth doing without leaving the cockpit.
 *
 * `capture` takes one; `arm` puts auto-capture on `once` when it is `off`, and
 * does nothing otherwise. Both exist for the same reason the hotkey does at all — the
 * simulator is fullscreen, and a control that needs alt-tab is a control that
 * costs you the thing you were about to observe.
 */
export type HotkeyAction = "capture" | "arm"

/**
 * What the hotkeys are bound to until somebody changes them.
 *
 * Three modifiers each, because `globalShortcut.register` can only see clashes
 * with other applications' `RegisterHotKey` bindings — **MSFS's own keybindings
 * are read through raw input and are invisible to it.** A key bound in the
 * simulator registers cleanly here and then does both things, so the defaults
 * have to be combinations the simulator is unlikely to want.
 */
export const DEFAULT_HOTKEYS: Record<HotkeyAction, string> = {
  capture: "CommandOrControl+Alt+S",
  arm: "CommandOrControl+Alt+A",
}

/** Kept as the name the rest of the app already says. */
export const DEFAULT_MARK_HOTKEY = DEFAULT_HOTKEYS.capture

/**
 * Above this, a variable is ambient and is not a candidate for anything.
 *
 * The distribution makes this an easy call rather than a tuned one: near a real
 * interaction the median variable changes 961 times in 76 seconds and the
 * twenty-fifth percentile is 463, while everything the interaction actually
 * caused changed twice. Any threshold between roughly 0.05/s and 5/s gives the
 * same answer, so this sits in the middle of the flat part.
 */
export const AMBIENT_PER_SECOND = 0.5

/**
 * The least quiet time a rate may be inferred from.
 *
 * Without this the denominator collapses and the filter inverts. Measured, from
 * a dump taken 24 seconds after the app started, with two marks in it:
 *
 * | | |
 * | --- | --- |
 * | buffer span | 23.9 s |
 * | covered by the two mark windows | 21.8 s |
 * | quiet time left to measure against | **2.1 s** |
 * | what one out-of-window change then costs | 0.47/s |
 * | what **two** cost | 0.94/s — ambient |
 *
 * Every variable reports once per enumeration walk, and there are two walks on
 * connect, so on a young buffer *every variable in the aircraft* has two
 * changes and every one of them was rejected. 5,551 of 5,554. The cabin vent
 * lever the user was looking for was found at +1.1 s and discarded at 0.94/s.
 *
 * A mark's window is 15 seconds wide, so two marks can cover a buffer that has
 * not filled yet. That is not an edge case — it is what the first minute of
 * every session looks like, which is exactly when somebody is marking.
 *
 * So: below this much quiet time, rates are computed as if there were this
 * much. Permissive in the right direction — an under-measured rate keeps a
 * candidate that might be noise, where an over-measured one discards the
 * answer. The things that genuinely deserve rejecting are not close to the
 * line: in that same dump the real heartbeats measured 42/s, three orders of
 * magnitude above the vent lever, and stay rejected at any floor.
 */
export const MIN_QUIET_MS = 30_000

/**
 * A re-report of the whole table is not a set of changes.
 *
 * The module seeds its comparison array with NaN when it walks the `L:` table,
 * so the next tick reports **every variable once** — deliberately, because an
 * app connecting mid-flight should get a complete picture rather than only what
 * moves afterwards. It is a photograph, not movement.
 *
 * Ranked as movement it is catastrophic. Every variable in it "moved once, next
 * to your anchor, and never otherwise", which is the exact signature of a
 * perfect answer, so a mark taken shortly after connecting is answered with the
 * entire aircraft: 5,397 candidates, all at the same offset, all with a
 * baseline of zero.
 *
 * ## Why it is counted, and not detected some more obvious way
 *
 * **Not by watching for `vars` events**, which is where a walk announces
 * itself and would be exact in a live session. `slice-capture.ts` re-times a
 * fixture's header to a second before the window, `vars` events included, so
 * every fixture would open with what looks like a walk and the first real
 * change of every variable in it would be discarded.
 *
 * **Not as a fraction of the table**, which is what this looked like at first.
 * A capture sliced to start *after* a snapshot only ever sees the variables
 * that actually move — 294 of them in `pa24-many-controls` — and a one-second
 * window there routinely holds 224, which is 76% of everything the buffer
 * knows about. The denominator only exists when a snapshot has already
 * happened.
 *
 * **Not per sample.** The wire chunks values at ~192 per 8 KB message, so a
 * snapshot sample and a busy interaction sample are the same size.
 *
 * What is left is the count over a second, measured against **the size of the
 * table the module enumerated**. That number is known — the walk is where it
 * comes from — and using it is what keeps this honest across aircraft:
 *
 * | | distinct variables, 1 s window |
 * | --- | --- |
 * | `pa24-mark-cabin-vent`, away from the snapshot | max 213 |
 * | `pa24-many-controls`, throughout | max 224 |
 * | the snapshot itself | **5,554 — the whole table** |
 *
 * Half the table is 2,777 for that aircraft: twelve times the busiest second it
 * produced, and half the snapshot. A fixed count could not do this. A light
 * single enumerates a few hundred variables and a study-level airliner tens of
 * thousands, so any constant is simultaneously too high to catch the small
 * aircraft's snapshot and too low to survive the big one's ordinary traffic.
 * A fraction is the same statement about both.
 */
export const SNAPSHOT_MS = 1_000
export const SNAPSHOT_FRACTION = 0.5

/**
 * The threshold when the table size is not known.
 *
 * Only reachable where there was no enumeration to learn from: a synthetic
 * stream in a test, or a capture whose `vars` events fell outside the slice.
 * Live, the walk always precedes the values, so the fraction above is what
 * runs. Kept as four times the busiest second ever measured.
 */
export const SNAPSHOT_DISTINCT = 1_000
