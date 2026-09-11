/**
 * Does a replay actually deliver live values to the renderer, repeatedly, for
 * both namespaces?
 *
 * Stage 3's known symptom was a hint that appears once and then freezes. That
 * has two possible causes on opposite sides of the IPC bridge — main stops
 * sending, or Monaco stops repainting — and no amount of looking at the screen
 * separates them. This pins the main-side half.
 *
 * ## It drives the real `startSim`
 *
 * An earlier version of this file mirrored `startSim`'s replay branch by hand,
 * because "the session module reaches for Electron's `app` on import". That has
 * not been true for some time, and the copy did exactly what a hand-kept copy
 * does: the replay branch was rewritten to feed the shared value store and this
 * test went on passing, still asserting the behaviour of code that had been
 * deleted. It said it would be "the thing that notices", and it was not.
 *
 * So it imports the real module, with `FSCE_SIM_REPLAY` set the way the sandbox
 * script sets it. `vi.resetModules()` per test because `session.ts` reads that
 * variable once, at import, and because the value store it writes into is
 * module state that must not leak between cases.
 */

import { join } from "node:path"
import { tmpdir } from "node:os"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CapturedEvent, SimValue, SimVarWatch } from "@shared/sim"

import { readCapture } from "./replay"

const A_VARS = join(import.meta.dirname, "fixtures", "live-values.ndjson")
const L_VARS = join(import.meta.dirname, "fixtures", "link-session.ndjson")
const REAL_L_VARS = join(
  import.meta.dirname,
  "fixtures",
  "bonanza-l-values.ndjson.gz"
)

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
})

afterEach(() => {
  delete process.env.FSCE_SIM_REPLAY
  delete process.env.FSCE_SIM_REPLAY_SPEED
  vi.useRealTimers()
})

/**
 * Replays a capture through the real session module and collects every value
 * set it pushes at the renderer.
 *
 * `watchSimVars` before `startSim` on purpose: that is the order the app hits
 * in practice, since the renderer sends its watch set as soon as a file is
 * open, which is usually before MSFS is reachable. It also only works because
 * the watch set is recorded before the connection check — see `watchSimVars`.
 */
async function replay(
  file: string,
  watch: SimVarWatch[],
  ms = 70_000
): Promise<SimValue[][]> {
  process.env.FSCE_SIM_REPLAY = file
  /*
   * Real time, on fake timers, and not the `speed 0` the old test used.
   *
   * Speed 0 fires a whole session inside one tick, which the 250 ms flush then
   * correctly collapses into a single batch — so "does main keep sending?"
   * became unanswerable the moment coalescing existed. The timing *is* the
   * behaviour under test here. Fake timers make a minute free.
   */
  process.env.FSCE_SIM_REPLAY_SPEED = "1"

  const sim = await import("./session")

  const batches: SimValue[][] = []
  sim.onSimValues((values) => batches.push(values))

  sim.watchSimVars(watch)
  sim.startSim(tmpdir())

  await vi.advanceTimersByTimeAsync(ms)
  sim.stopSim()

  return batches
}

describe("the A: fixture", () => {
  it("is well formed and contains simvar events", () => {
    const events = readCapture(A_VARS)
    const simvars = events.filter((event) => event.kind === "simvar")

    expect(events.length).toBeGreaterThan(300)
    expect(simvars.length).toBeGreaterThan(300)
  })

  it("changes its values over time rather than repeating one reading", () => {
    const readings = readCapture(A_VARS)
      .filter(
        (event): event is CapturedEvent & { kind: "simvar" } =>
          event.kind === "simvar" && event.name === "A:KOHLSMAN SETTING MB:1"
      )
      .map((event) => event.value)

    // A frozen hint is indistinguishable from a frozen source, so the fixture
    // has to be visibly moving for the tests below to mean anything.
    expect(new Set(readings).size).toBeGreaterThan(50)
  })
})

describe("the L: fixture", () => {
  it("enumerates every name before reporting any value", () => {
    const events = readCapture(L_VARS)

    const firstValue = events.findIndex((event) => event.kind === "var")
    const lastNames = events.map((event) => event.kind).lastIndexOf("vars")

    // The bug this catches is real and already happened once live: a second
    // client connected, got no enumeration, and received a stream of ids it
    // could not decode. Values before names is that failure on disk.
    expect(lastNames).toBeLessThan(firstValue)
  })

  it("reports every enumerated variable at least once", () => {
    const events = readCapture(L_VARS)

    const named = new Set(
      events.flatMap((event) => (event.kind === "vars" ? event.names : []))
    )
    const valued = new Set(
      events.flatMap((event) => (event.kind === "var" ? [event.name] : []))
    )

    // The module seeds `last` with NaN so the first tick after enumeration
    // reports everything. Without that an app connecting mid-flight sees only
    // what happens to move afterwards, and most switches never do.
    expect(named.size).toBeGreaterThan(200)
    expect(valued).toEqual(named)
  })
})

describe("replay drives A: values", () => {
  it("keeps sending, rather than emitting one set and stopping", async () => {
    const batches = await replay(A_VARS, [
      { name: "A:KOHLSMAN SETTING MB:1", units: "Millibars" },
      { name: "A:TRANSPONDER CODE:1", units: "Number" },
    ])

    // The whole point: main keeps sending. One batch would mean the freeze is
    // upstream of Monaco and the editor was never at fault.
    expect(batches.length).toBeGreaterThan(10)
  })

  it("carries a moving value through to the emitted set", async () => {
    const batches = await replay(A_VARS, [
      { name: "A:KOHLSMAN SETTING MB:1", units: "Millibars" },
    ])

    const readings = batches
      .map((batch) => batch.find((v) => v.name === "A:KOHLSMAN SETTING MB:1"))
      .filter((value) => value !== undefined)
      .map((value) => value.value)

    expect(readings.length).toBeGreaterThan(10)
    expect(new Set(readings).size).toBeGreaterThan(10)
  })

  it("never leaks a variable no open file asks about", async () => {
    const batches = await replay(A_VARS, [
      { name: "A:KOHLSMAN SETTING MB:1", units: "Millibars" },
    ])

    // The fixture ticks six variables. Five of them are not watched here and
    // must never appear — main holds values for everything it hears about, and
    // the watch set is the only thing keeping the rest off the wire.
    const names = new Set(batches.flat().map((value) => value.name))
    expect([...names]).toEqual(["A:KOHLSMAN SETTING MB:1"])

    // The empty first batch is deliberate, not a gap: `watchSimVars` flushes as
    // soon as the set changes, and at that moment there are no values. Sending
    // it is what clears hints belonging to a file that has just been closed.
    expect(batches[0]).toEqual([])
  })
})

describe("replay drives L: values", () => {
  /** Three real `pa24-250.yaml` names, which the fixture is generated from. */
  const watched: SimVarWatch[] = [
    { name: "L:BreakerAutopilot", units: "" },
    { name: "L:AdfOnOffKnobVolume", units: "" },
    { name: "L:Magnetos1", units: "Number" },
  ]

  it("reaches the renderer at all", async () => {
    const batches = await replay(L_VARS, watched)

    // Everything below is a refinement of this one line, which is the whole
    // feature: an `L:` variable read by the module inside MSFS arriving at the
    // editor as a value it can put on a line.
    expect(batches.length).toBeGreaterThan(0)
    expect(batches.at(-1)!.length).toBeGreaterThan(0)
  })

  it("has a value for every watched line, including ones nothing touched", async () => {
    const batches = await replay(L_VARS, watched)

    // The module sends deltas, so this only holds because main keeps every
    // enumerated value rather than only the watched ones. A switch nobody
    // touches is exactly the line a profile author is looking at.
    expect(batches.at(-1)!.map((value) => value.name).sort()).toEqual(
      watched.map((entry) => entry.name).sort()
    )
  })

  it("labels values with the units the profile line asked for", async () => {
    const batches = await replay(L_VARS, watched)

    const magneto = batches
      .at(-1)!
      .find((value) => value.name === "L:Magnetos1")

    // `L:` is read raw — the module has no idea what a line asked for — so the
    // units are the request, echoed back for formatting.
    expect(magneto?.units).toBe("Number")
  })

  it("stays quiet unless a watched value moved", async () => {
    const batches = await replay(L_VARS, watched)
    const deltas = readCapture(L_VARS).filter((event) => event.kind === "var")

    /*
     * 1,179 `var` events over ~23 seconds become 13 messages.
     *
     * Almost all of that reduction is the watch filter rather than the flush —
     * three variables are watched out of 279 — and that is the important half:
     * a live cockpit is mostly two clocks ticking, measured at 88% of the
     * stream, and none of it belongs on the wire. The 16 ms flush only merges
     * the chunks of a single module tick.
     *
     * Sized generously on purpose. Pinning it to 13 would make this a change
     * detector for the fixture's contents rather than a statement about the
     * filter.
     */
    expect(deltas.length).toBeGreaterThan(1_000)
    expect(batches.length).toBeLessThan(50)
  })

  it("says nothing about a variable this aircraft does not have", async () => {
    const batches = await replay(L_VARS, [
      { name: "L:NotInThisAircraftAtAll", units: "" },
    ])

    // No value means no hint — 09-live-values' rule. A placeholder would read
    // as broken rather than as not-connected-yet.
    for (const batch of batches) expect(batch).toEqual([])
  })
})

/**
 * The same delivery, against a session that actually happened.
 *
 * `link-session.ndjson` is generated, and a generator only produces the shape
 * its author had in mind: one enumeration, every name reported exactly once,
 * nothing arriving late. That shape is worth keeping — the tests above are
 * about the module's contract and want a clean example of it — but it is not
 * what a cockpit does. In this fifteen seconds the settle ladder is still
 * walking while values flow, 7,592 names are enumerated and 340 of them ever
 * move, and eight arrive after values have already started.
 *
 * Cut from a Black Square Bonanza with `npm run sim:slice`. See the fixtures
 * README for why the two exist side by side.
 */
describe("replay drives L: values from a real session", () => {
  /**
   * Three Bonanza instruments that move — oil, VSI, compass — and one that
   * does not exist yet when the slice opens.
   */
  const watched: SimVarWatch[] = [
    { name: "L:BKSQ_OIL_TEMP_1", units: "" },
    { name: "L:BKSQ_VerticalSpeed_1", units: "" },
    { name: "L:BKSQ_MagneticCompassHeading", units: "" },
    { name: "L:BKSQ_VOR_1_DERIVATIVE", units: "" },
  ]

  /**
   * One replay, shared by every case below.
   *
   * A real enumeration is 7,592 names rather than the generated fixture's 279,
   * and carrying that many through the store costs about six seconds — per
   * replay. Four cases replaying separately would have added half a minute to
   * a five-second suite to ask four questions of the same session. Nothing
   * here mutates what it is given, and the cache holds plain arrays rather
   * than module state, so `vi.resetModules()` between cases is irrelevant to
   * it.
   */
  let shared: SimValue[][] | null = null
  const run = async (): Promise<SimValue[][]> =>
    (shared ??= await replay(REAL_L_VARS, watched, 20_000))

  /** The first case to run pays for the replay. See `run`. */
  const SLOW = 30_000

  it(
    "keeps delivering for as long as the aircraft runs",
    async () => {
      const batches = await run()

      expect(batches.length).toBeGreaterThan(10)
      expect(batches.at(-1)!.length).toBeGreaterThan(0)
    },
    SLOW
  )

  it(
    "carries a moving instrument through to the emitted set",
    async () => {
      const batches = await run()

      const readings = batches
        .flat()
        .filter((value) => value.name === "L:BKSQ_OIL_TEMP_1")
        .map((value) => value.value)

      // An oil temperature climbing through a start is the plainest thing a
      // profile author watches, and the fixture holds 170 distinct readings of
      // it. Asserting far below that keeps this a statement about delivery
      // rather than a change detector for the slice.
      expect(new Set(readings).size).toBeGreaterThan(20)
    },
    SLOW
  )

  it(
    "delivers a variable that registered after values had begun",
    async () => {
      const batches = await run()

      /*
       * The one thing only a real capture can ask.
       *
       * This name is not in the enumeration that opens the slice: it arrives
       * in a later walk, seconds after the module is already streaming values
       * for everything else — which is what an aircraft registering its
       * avionics late looks like from outside. The app has to accept a name it
       * has never seen mid-stream and start reporting it, and nothing was
       * checking that, because a generated fixture announces everything up
       * front by construction.
       */
      const late = batches
        .flat()
        .filter((value) => value.name === "L:BKSQ_VOR_1_DERIVATIVE")

      expect(late.length).toBeGreaterThan(0)
    },
    SLOW
  )

  it(
    "never leaks a variable no open file asks about",
    async () => {
      const batches = await run()

      // 340 variables move in this window and four are watched. The watch set
      // is the only thing keeping the other 336 off the wire — and on a real
      // capture that filter is carrying far more than the generated fixture
      // ever asked it to.
      const names = [...new Set(batches.flat().map((value) => value.name))]

      expect(names.sort()).toEqual(watched.map((entry) => entry.name).sort())
    },
    SLOW
  )
})

/**
 * Does a `B:` value reach the renderer at all?
 *
 * The bug this catches shipped, and was caught by looking at the app rather
 * than by anything here: `emit` does **not** feed the live-value store. Only
 * the replay and link paths call `absorbValues`; the SimConnect handlers each
 * do their own, the way the `simObjectData` one does. The input-event handlers
 * emitted and stopped, so every value was captured, recorded as evidence, and
 * never shown.
 *
 * A real capture, and one where somebody actually flipped a switch:
 * `pa24-beacon-input` is five seconds of `pa24-many-controls` around
 * `SWITCH_LIGHT_BEACON_2STATES` going 1 -> 0, with the `L:` delta stream
 * dropped — 10,715 events that took the replay from one second to forty and
 * have no bearing on how a `B:` value is assembled. The `vars` announcements
 * are kept, so the session still stands alone.
 */
describe("B: values", () => {
  const BEACON = join(
    import.meta.dirname,
    "fixtures",
    "pa24-beacon-input.ndjson.gz"
  )
  const NAME = "B:SWITCH_LIGHT_BEACON_2STATES"

  /** One replay for the whole block, as the `L:` block above does. */
  let shared: SimValue[][] | null = null
  const run = async (watch: string): Promise<SimValue[][]> =>
    (shared ??= await replay(BEACON, [{ name: watch, units: "" }], 6_000))

  const SLOW = 30_000

  it(
    "delivers an input event's value to the renderer",
    async () => {
      const values = (await run(NAME)).flat().filter((v) => v.name === NAME)

      expect(values.length).toBeGreaterThan(0)
      // Flipped on and then off. Both readings must arrive, or the hint
      // freezes at whatever it happened to see first.
      expect(new Set(values.map((value) => value.value))).toEqual(
        new Set([1, 0])
      )
    },
    SLOW
  )

  it(
    "never leaks an input event no open file asks about",
    async () => {
      const names = [...new Set((await run(NAME)).flat().map((v) => v.name))]

      expect(names).toEqual([NAME])
    },
    SLOW
  )
})

/**
 * The written name is not the name the value arrives under.
 *
 * Its own replay, because the watch set is what is being varied and the block
 * above caches one. Profiles write `<id>_<Preset>`; the simulator's table
 * holds ids, and of the A220's 464 names exactly one ends in an operation.
 */
describe("B: values through a preset suffix", () => {
  it(
    "shows an id's value on a line that writes a preset",
    async () => {
      const written = "B:SWITCH_LIGHT_BEACON_2STATES_Set"
      const batches = await replay(
        join(import.meta.dirname, "fixtures", "pa24-beacon-input.ndjson.gz"),
        [{ name: written, units: "" }],
        6_000
      )

      const values = batches.flat().filter((value) => value.name === written)

      expect(values.length).toBeGreaterThan(0)
      expect(new Set(values.map((value) => value.value))).toEqual(
        new Set([1, 0])
      )
    },
    30_000
  )
})
