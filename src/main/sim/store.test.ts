/**
 * Sim evidence, and the one thing it must not get wrong.
 *
 * `sim_observation` is keyed by aircraft, and that column is the entire reason
 * the table exists — it is what `in sim` will mean. Attributing a change to the
 * wrong aircraft would not fail, it would quietly teach the ranking something
 * untrue, and nothing downstream could tell.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { closeDatabase, initDatabase, type Database } from "../db"
import { resetVariableCache } from "../vars"
import {
  flushSimEvidence,
  observe,
  observedRates,
  onSimEnumeration,
  pendingSimEvidence,
  resetSimEvidence,
  startWatching,
} from "./store"

let db: Database

beforeEach(() => {
  vi.useRealTimers()
  closeDatabase()
  resetVariableCache()
  resetSimEvidence()
  db = initDatabase(":memory:")
})

const rows = (sql: string) => db.prepare(sql).all() as Record<string, unknown>[]

describe("enumeration", () => {
  it("stores every name as a variable the sim is known to have", () => {
    observe({ kind: "vars", from: 0, names: ["L:AdfOnOffKnob", "L:DmeOnOffKnob"] })
    flushSimEvidence()

    expect(
      rows(`SELECT v.full_name FROM sim_variable s
              JOIN variable v ON v.id = s.variable_id
             ORDER BY v.full_name`)
    ).toEqual([{ full_name: "L:AdfOnOffKnob" }, { full_name: "L:DmeOnOffKnob" }])
  })

  it("is idempotent across sessions, updating last_seen rather than duplicating", () => {
    observe({ kind: "vars", from: 0, names: ["L:Thing"] })
    flushSimEvidence()
    observe({ kind: "vars", from: 0, names: ["L:Thing"] })
    flushSimEvidence()

    expect(rows("SELECT variable_id FROM sim_variable")).toHaveLength(1)
  })

  it("leaves the unit unconfirmed — enumeration says nothing about units", () => {
    observe({ kind: "vars", from: 0, names: ["L:Thing"] })
    flushSimEvidence()

    expect(rows("SELECT units, units_confirmed FROM sim_variable")).toEqual([
      { units: null, units_confirmed: 0 },
    ])
  })
})

describe("observation", () => {
  it("counts changes against the loaded aircraft", () => {
    observe({ kind: "aircraft", key: "pa24-250", path: "x/Airplanes/pa24-250/y.cfg" })
    observe({ kind: "var", name: "L:DmeOnOffKnob", value: 1 })
    observe({ kind: "var", name: "L:DmeOnOffKnob", value: 0 })
    flushSimEvidence()

    expect(
      rows(`SELECT v.full_name, o.aircraft, o.changes FROM sim_observation o
              JOIN variable v ON v.id = o.variable_id`)
    ).toEqual([{ full_name: "L:DmeOnOffKnob", aircraft: "pa24-250", changes: 2 }])
  })

  it("accumulates across flushes rather than replacing", () => {
    observe({ kind: "aircraft", key: "pa24-250", path: "p" })
    observe({ kind: "var", name: "L:Thing", value: 1 })
    flushSimEvidence()
    observe({ kind: "var", name: "L:Thing", value: 2 })
    flushSimEvidence()

    expect(rows("SELECT changes FROM sim_observation")).toEqual([{ changes: 2 }])
  })

  it("keeps the same variable separate per aircraft", () => {
    observe({ kind: "aircraft", key: "pa24-250", path: "p" })
    observe({ kind: "var", name: "L:Shared", value: 1 })
    observe({ kind: "aircraft", key: "bksq-baron", path: "b" })
    observe({ kind: "var", name: "L:Shared", value: 1 })
    flushSimEvidence()

    expect(
      rows("SELECT aircraft, changes FROM sim_observation ORDER BY aircraft")
    ).toEqual([
      { aircraft: "bksq-baron", changes: 1 },
      { aircraft: "pa24-250", changes: 1 },
    ])
  })

  it("does not attribute a previous aircraft's changes to the next one", () => {
    // The case worth a test of its own: changes accumulate in memory, and an
    // aircraft swap arrives as just another event. Without flushing first,
    // everything from the Piper would be credited to the Baron.
    observe({ kind: "aircraft", key: "pa24-250", path: "p" })
    observe({ kind: "var", name: "L:PiperOnly", value: 1 })
    observe({ kind: "aircraft", key: "bksq-baron", path: "b" })
    flushSimEvidence()

    expect(
      rows(`SELECT v.full_name, o.aircraft FROM sim_observation o
              JOIN variable v ON v.id = o.variable_id`)
    ).toEqual([{ full_name: "L:PiperOnly", aircraft: "pa24-250" }])
  })

  it("records a change as existence too, for values that beat the enumeration", () => {
    observe({ kind: "aircraft", key: "pa24-250", path: "p" })
    observe({ kind: "var", name: "L:Early", value: 1 })
    flushSimEvidence()

    expect(rows("SELECT variable_id FROM sim_variable")).toHaveLength(1)
  })

  it("drops changes seen before any aircraft is known", () => {
    // There is nowhere truthful to put them: the column is the point of the
    // table, and inventing a value for it would be worse than the loss.
    observe({ kind: "var", name: "L:Orphan", value: 1 })
    flushSimEvidence()

    expect(rows("SELECT * FROM sim_observation")).toEqual([])
  })
})

describe("batching", () => {
  it("writes nothing until flushed", () => {
    observe({ kind: "vars", from: 0, names: ["L:A", "L:B"] })

    expect(pendingSimEvidence()).toMatchObject({ names: 2 })
    expect(rows("SELECT * FROM sim_variable")).toEqual([])
  })

  it("flushes on a timer without being asked", () => {
    vi.useFakeTimers()
    observe({ kind: "vars", from: 0, names: ["L:A"] })
    vi.advanceTimersByTime(6_000)

    expect(rows("SELECT * FROM sim_variable")).toHaveLength(1)
  })

  it("clears the queue so a second flush does not double-count", () => {
    observe({ kind: "aircraft", key: "pa24-250", path: "p" })
    observe({ kind: "var", name: "L:Thing", value: 1 })
    flushSimEvidence()
    flushSimEvidence()

    expect(rows("SELECT changes FROM sim_observation")).toEqual([{ changes: 1 }])
  })

  it("survives a database that cannot be written", () => {
    // Bookkeeping on a background timer. A broken database is not a reason to
    // take down a session that is otherwise working.
    observe({ kind: "aircraft", key: "pa24-250", path: "p" })
    observe({ kind: "var", name: "L:Thing", value: 1 })
    closeDatabase()

    expect(() => flushSimEvidence()).not.toThrow()
  })
})

/**
 * The denominator, and why it is stored rather than derived.
 *
 * `sim_observation.changes` is half a rate. The other half was assumed to be
 * `last_seen - first_seen` and is not: both are wall-clock stamps taken at
 * flush time, so their difference spans every hour the app was closed. A
 * variable that moved a thousand times across a week read as 0.0017 a second.
 */
describe("observed time", () => {
  // The outer setup runs real timers; every claim here is a difference between
  // two wall-clock reads, so the clock has to be the thing under control.
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  const watched = () =>
    rows(`SELECT aircraft, observed_ms FROM sim_aircraft`) as unknown as {
      aircraft: string
      observed_ms: number
    }[]

  it("banks nothing until the clock is started", () => {
    observe({ kind: "aircraft", key: "pa24-250", path: "" })
    observe({ kind: "var", name: "L:Thing", value: 1 })
    flushSimEvidence()

    expect(watched()).toHaveLength(0)
  })

  it("accumulates the time between flushes", () => {
    startWatching(0)
    observe({ kind: "aircraft", key: "pa24-250", path: "" })
    observe({ kind: "var", name: "L:Thing", value: 1 })

    vi.setSystemTime(4_000)
    flushSimEvidence()

    expect(watched()[0]!.observed_ms).toBe(4_000)
  })

  /**
   * The gap a closed app leaves. A flush runs on a timer that only ticks while
   * events arrive, so a suspended machine or a session that ended without a
   * disconnect leaves a stretch nobody watched — and counting it would inflate
   * the denominator, which makes every rate look lower and promotes heartbeats
   * into answers.
   */
  it("refuses to count a gap as observation", () => {
    startWatching(0)
    observe({ kind: "aircraft", key: "pa24-250", path: "" })
    observe({ kind: "var", name: "L:Thing", value: 1 })

    // An hour later.
    vi.setSystemTime(3_600_000)
    flushSimEvidence()

    expect(watched()[0]!.observed_ms).toBeLessThanOrEqual(10_000)
  })

  it("offers no rates until there is enough observation to make one", () => {
    startWatching(0)
    observe({ kind: "aircraft", key: "pa24-250", path: "" })
    observe({ kind: "var", name: "L:Thing", value: 1 })
    vi.setSystemTime(5_000)
    flushSimEvidence()

    // Five seconds is not a measurement.
    expect(observedRates("pa24-250").size).toBe(0)
  })

  it("turns counts into rates once it has", () => {
    startWatching(0)
    observe({ kind: "aircraft", key: "pa24-250", path: "" })
    for (let n = 0; n < 120; n += 1) observe({ kind: "var", name: "L:Busy", value: n })
    observe({ kind: "var", name: "L:Quiet", value: 1 })

    // Flushed six times over a minute, so the cap never bites.
    for (let at = 10_000; at <= 60_000; at += 10_000) {
      vi.setSystemTime(at)
      flushSimEvidence()
    }

    const rates = observedRates("pa24-250")
    expect(rates.get("L:Busy")).toBeCloseTo(2, 1)
    expect(rates.get("L:Quiet")).toBeCloseTo(1 / 60, 2)
  })

  it("knows nothing about an aircraft it has never watched", () => {
    expect(observedRates("a320").size).toBe(0)
    expect(observedRates(null).size).toBe(0)
  })
})

/**
 * Who gets woken, and how often.
 *
 * The listener rebuilds a 19,000-row index synchronously, so being woken for
 * nothing is not free — and an aircraft change re-enumerates the same ~6,150
 * names four or five times as the settle loop walks the table again.
 */
describe("the enumeration signal", () => {
  let stop: (() => void)[] = []

  afterEach(() => {
    // The registry is module-level and outlives a case, so a listener left
    // behind would still be counting during the next one.
    for (const off of stop) off()
    stop = []
  })

  const listen = () => {
    const woken: number[] = []
    stop.push(onSimEnumeration(() => woken.push(1)))
    return woken
  }

  it("fires when a name is recorded for the first time", () => {
    const woken = listen()

    observe({ kind: "vars", from: 0, names: ["L:New"] })
    flushSimEvidence()

    expect(woken).toHaveLength(1)
  })

  it("stays quiet when the same names are enumerated again", () => {
    observe({ kind: "vars", from: 0, names: ["L:Thing", "L:Other"] })
    flushSimEvidence()

    const woken = listen()

    // What a re-enumeration looks like: the whole table, none of it new.
    observe({ kind: "vars", from: 0, names: ["L:Thing", "L:Other"] })
    flushSimEvidence()

    expect(woken).toHaveLength(0)
  })

  it("fires when a re-enumeration turns up something that was not there", () => {
    observe({ kind: "vars", from: 0, names: ["L:Thing"] })
    flushSimEvidence()

    const woken = listen()

    // The reason the settle loop re-walks at all: an aircraft is still
    // registering its variables when the first walk happens.
    observe({ kind: "vars", from: 0, names: ["L:Thing", "L:LateAddition"] })
    flushSimEvidence()

    expect(woken).toHaveLength(1)
  })

  it("fires for a name first seen as a value rather than in the enumeration", () => {
    const woken = listen()

    observe({ kind: "aircraft", key: "pa24-250", path: "x/aircraft.cfg" })
    observe({ kind: "var", name: "L:BeatTheWalk", value: 1 })
    flushSimEvidence()

    expect(woken).toHaveLength(1)
  })

  it("stays quiet when only values arrived for names already known", () => {
    observe({ kind: "vars", from: 0, names: ["L:Thing"] })
    flushSimEvidence()

    const woken = listen()

    observe({ kind: "aircraft", key: "pa24-250", path: "x/aircraft.cfg" })
    observe({ kind: "var", name: "L:Thing", value: 1 })
    flushSimEvidence()

    expect(woken).toHaveLength(0)
  })
})

describe("input events", () => {
  /*
   * The gap this closes: Activity has always seen `kind: "input"` and the
   * index never did, so `B:` — the namespace whose names a person can read —
   * was the only one with no per-aircraft movement evidence.
   */
  it("records a firing as movement on the loaded aircraft", () => {
    observe({ kind: "aircraft", key: "synaptic-a220", path: "" })
    // The first arrival is the baseline reading, not a movement; the two
    // transitions after it are the press and the release.
    observe({ kind: "input", name: "AIRLINER_FCU_CHRONO_2", hash: "1", value: 0 })
    observe({ kind: "input", name: "AIRLINER_FCU_CHRONO_2", hash: "1", value: 1 })
    observe({ kind: "input", name: "AIRLINER_FCU_CHRONO_2", hash: "1", value: 0 })
    startWatching(Date.now() - 1000)
    flushSimEvidence()

    expect(
      rows(`SELECT v.full_name, o.aircraft, o.changes
              FROM sim_observation o
              JOIN variable v ON v.id = o.variable_id`)
    ).toEqual([
      {
        full_name: "B:AIRLINER_FCU_CHRONO_2",
        aircraft: "synaptic-a220",
        changes: 2,
      },
    ])
  })

  it("does not count a ticking event as movement", () => {
    /*
     * Measured on the A220: `AIRLINER_ALT_FLAP_TOGGLE` reports at 4 Hz with an
     * unchanged value and nobody touching the aeroplane. Counting arrivals
     * would make it the most-moved control on every flight.
     */
    observe({ kind: "aircraft", key: "synaptic-a220", path: "" })
    for (let i = 0; i < 20; i++)
      observe({ kind: "input", name: "AIRLINER_ALT_FLAP_TOGGLE", hash: "1", value: 0 })
    startWatching(Date.now() - 1000)
    flushSimEvidence()

    // Known to exist, never known to have moved.
    expect(
      rows(`SELECT v.full_name FROM sim_variable s
              JOIN variable v ON v.id = s.variable_id`)
    ).toEqual([{ full_name: "B:AIRLINER_ALT_FLAP_TOGGLE" }])
    expect(rows("SELECT * FROM sim_observation")).toEqual([])
  })

  it("forgets the last value when the aircraft changes", () => {
    // Hashes are reassigned on a swap, so a carried value would report the new
    // aeroplane's first reading as a movement.
    observe({ kind: "aircraft", key: "a", path: "" })
    observe({ kind: "input", name: "SWITCH", hash: "1", value: 1 })
    observe({ kind: "aircraft", key: "b", path: "" })
    observe({ kind: "input", name: "SWITCH", hash: "1", value: 0 })
    startWatching(Date.now() - 1000)
    flushSimEvidence()

    expect(rows("SELECT aircraft FROM sim_observation")).toEqual([])
  })

  it("prefixes the bare wire name, so it is one variable with its get: lines", () => {
    observe({ kind: "aircraft", key: "synaptic-a220", path: "" })
    observe({ kind: "input", name: "AIRLINER_FCU_CHRONO_2", hash: "1", value: 1 })
    startWatching(Date.now() - 1000)
    flushSimEvidence()

    expect(
      rows(`SELECT v.namespace, v.name FROM sim_variable s
              JOIN variable v ON v.id = s.variable_id`)
    ).toEqual([{ namespace: "B", name: "AIRLINER_FCU_CHRONO_2" }])
  })
})

/**
 * Firings, and why they are counted separately from changes.
 *
 * A momentary control fires with the value 0 every time it is pressed, so the
 * value dedup above discards every press after the first — which made "pressed
 * ten times, never moved" and "arrived once, never again" the same record.
 * Those are the two cases `b-value-constant` exists to separate.
 */
describe("input event firings", () => {
  const press = (name: string, value = 0) =>
    observe({ kind: "input", name, hash: "1", value })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("counts presses of a control whose value never moves", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"))

    observe({ kind: "aircraft", key: "synaptic-a220", path: "" })

    // The first arrival is the baseline. Each later one is separated by more
    // than a tick could be, so each is somebody pressing the button.
    press("AIRLINER_FCU_ALT_PUSH")
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(5_000)
      press("AIRLINER_FCU_ALT_PUSH")
    }

    startWatching(Date.now() - 1000)
    flushSimEvidence()

    expect(
      rows(`SELECT v.full_name, o.changes, o.firings
              FROM sim_observation o
              JOIN variable v ON v.id = o.variable_id`)
    ).toEqual([
      {
        full_name: "B:AIRLINER_FCU_ALT_PUSH",
        // The whole point: worked four times, never moved once.
        changes: 0,
        firings: 3,
      },
    ])
  })

  it("counts no firings for a 4 Hz ticker", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"))

    observe({ kind: "aircraft", key: "synaptic-a220", path: "" })

    // Measured on the A220: 21 events arrive at a flat 4 Hz with nobody
    // touching the aeroplane, max gap 0.3 s across a 43-second window.
    for (let i = 0; i < 60; i++) {
      press("AIRLINER_LDG_LEVER")
      vi.advanceTimersByTime(250)
    }

    startWatching(Date.now() - 1000)
    flushSimEvidence()

    // Known to exist; never known to have been worked or to have moved.
    expect(rows("SELECT * FROM sim_observation")).toEqual([])
  })

  it("separates a worked control from a ticking one in the same window", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"))

    observe({ kind: "aircraft", key: "synaptic-a220", path: "" })

    for (let i = 0; i < 60; i++) {
      press("AIRLINER_LDG_LEVER")
      // Pressed once every five seconds while the other ticks at 4 Hz.
      if (i % 20 === 0) press("AIRLINER_FCU_ALT_PUSH")
      vi.advanceTimersByTime(250)
    }

    startWatching(Date.now() - 1000)
    flushSimEvidence()

    expect(
      rows(`SELECT v.full_name, o.firings
              FROM sim_observation o
              JOIN variable v ON v.id = o.variable_id`)
    ).toEqual([{ full_name: "B:AIRLINER_FCU_ALT_PUSH", firings: 2 }])
  })

  it("counts a firing beside a change on a latching control", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"))

    observe({ kind: "aircraft", key: "synaptic-a220", path: "" })

    // A light switch: worked, and its value moves with it. Both counters run,
    // which is what keeps the rule quiet for a control that reads properly.
    press("AIRLINER_OVH_LTS_BEACON", 1)
    vi.advanceTimersByTime(5_000)
    press("AIRLINER_OVH_LTS_BEACON", 0)

    startWatching(Date.now() - 1000)
    flushSimEvidence()

    expect(
      rows(`SELECT o.changes, o.firings
              FROM sim_observation o
              JOIN variable v ON v.id = o.variable_id`)
    ).toEqual([{ changes: 1, firings: 1 }])
  })

  it("forgets the arrival clock when the aircraft changes", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-09-04T12:00:00Z"))

    observe({ kind: "aircraft", key: "a", path: "" })
    press("SWITCH")

    // Long enough that a carried timestamp would make the new aeroplane's
    // first arrival look like a deliberate press.
    vi.advanceTimersByTime(60_000)
    observe({ kind: "aircraft", key: "b", path: "" })
    press("SWITCH")

    startWatching(Date.now() - 1000)
    flushSimEvidence()

    expect(rows("SELECT * FROM sim_observation")).toEqual([])
  })
})
