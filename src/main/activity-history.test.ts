/**
 * What one session teaches the next.
 *
 * Everything else the ranking uses is measured over the last two minutes in
 * memory, so it starts from nothing each time the app opens. That makes the
 * first mark of a session the worst answer of the session — and the first mark
 * is the one people make, because you start the app in order to go and find a
 * switch.
 *
 * These cover the loop end to end: an interaction is recorded once its window
 * closes, read back as controls rather than counts, and unioned into the
 * promiscuity the next session ranks with.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MARK_AFTER_MS } from "@shared/activity"
import type { CapturedEvent } from "@shared/sim"

import { findingsFor } from "./activity"
import { observeActivity, resetActivity } from "./activity-buffer"
import {
  armFromHotkey,
  captureMode,
  captures,
  clearCaptures,
  ignoredControls,
  noteInteraction,
  noteMark,
  resetActivityHistory,
  setCaptureMode,
  setIgnored,
  watchAircraft,
} from "./activity-history"
import { closeDatabase, initDatabase, type Database } from "./db"
import { markAt, resetMarks } from "./marks"
import { resetVariableCache } from "./vars"
import { observedCoincidences, recordCoincidence } from "./sim/store"

let db: Database

beforeEach(() => {
  vi.useFakeTimers()
  closeDatabase()
  resetVariableCache()
  resetActivity()
  resetActivityHistory()
  resetMarks()
  db = initDatabase(":memory:")
})

afterEach(() => {
  resetActivityHistory()
  vi.useRealTimers()
})

const rows = (sql: string) => db.prepare(sql).all() as Record<string, unknown>[]

function change(t: number, name: string, value: number): CapturedEvent {
  return { t, via: "link", kind: "var", name, value }
}

function input(t: number, name: string): CapturedEvent {
  return { t, via: "client", kind: "input", name, hash: "0", value: 1 }
}

describe("recording what a control coincided with", () => {
  it("stores one row per variable and control", () => {
    recordCoincidence("pa24-250", "SWITCH_BEACON", ["L:BeaconLightSwitch", "L:Snd"])

    expect(rows(`SELECT control FROM sim_coincidence`)).toHaveLength(2)
  })

  /**
   * Counted by *control*, not by anchor. Flipping one switch four times is four
   * anchors with its variable in every window — counting those would make the
   * answer look like it answers to everything.
   */
  it("counts a control once however many times it is used", () => {
    for (let n = 0; n < 4; n += 1) {
      recordCoincidence("pa24-250", "SWITCH_BEACON", ["L:BeaconLightSwitch"])
    }
    recordCoincidence("pa24-250", "SWITCH_STARTER", ["L:BeaconLightSwitch"])

    const seen = observedCoincidences("pa24-250")
    expect(seen.get("L:BeaconLightSwitch")).toEqual(
      new Set(["SWITCH_BEACON", "SWITCH_STARTER"])
    )

    // The repeats are still visible for anyone who wants them.
    const [beacon] = rows(
      `SELECT anchors FROM sim_coincidence c
       JOIN variable v ON v.id = c.variable_id
       WHERE c.control = 'SWITCH_BEACON'`
    )
    expect(beacon!.anchors).toBe(4)
  })

  it("keeps aircraft apart", () => {
    recordCoincidence("pa24-250", "SWITCH_BEACON", ["L:BeaconLightSwitch"])

    expect(observedCoincidences("a320").size).toBe(0)
    expect(observedCoincidences(null).size).toBe(0)
  })
})

describe("the moment an anchor is finished", () => {
  /**
   * The collector runs on a timer per control, not per event. The simulator
   * reports every interaction at least twice, and a knob being turned reports a
   * hundred times — one recording per event would teach the ranking that the
   * knob's own variable answers to a hundred controls.
   */
  it("records once, after the window has closed", () => {
    watchAircraft("pa24-250")

    for (let t = 0; t < 40_000; t += 500) {
      observeActivity(change(t, "L:Idle", t))
    }
    observeActivity(input(40_000, "SWITCH_BEACON"))
    observeActivity(input(40_020, "SWITCH_BEACON"))
    observeActivity(change(40_040, "L:BeaconLightSwitch", 1))

    noteInteraction("SWITCH_BEACON", 0)
    noteInteraction("SWITCH_BEACON", 0)

    expect(rows(`SELECT 1 FROM sim_coincidence`)).toHaveLength(0)

    vi.advanceTimersByTime(1_000)

    const seen = observedCoincidences("pa24-250")
    expect(seen.get("L:BeaconLightSwitch")).toEqual(new Set(["SWITCH_BEACON"]))
  })

  it("records nothing when no aircraft is loaded", () => {
    watchAircraft(null)
    observeActivity(input(0, "SWITCH_BEACON"))
    noteInteraction("SWITCH_BEACON", 0)
    vi.advanceTimersByTime(1_000)

    expect(rows(`SELECT 1 FROM sim_coincidence`)).toHaveLength(0)
  })

  /** A timer that outlived its connection would rank an emptied buffer. */
  it("drops pending work when the session ends", () => {
    watchAircraft("pa24-250")
    observeActivity(input(0, "SWITCH_BEACON"))
    noteInteraction("SWITCH_BEACON", 0)

    resetActivityHistory()
    vi.advanceTimersByTime(1_000)

    expect(rows(`SELECT 1 FROM sim_coincidence`)).toHaveLength(0)
  })
})

describe("what history does for a mark", () => {
  /**
   * The case this whole table exists for.
   *
   * Every mark carries the same name, so a session made only of marks has one
   * control in it and scores every candidate 1 — promiscuity, the strongest
   * signal the ranking has, is **inert exactly where it is needed most**. Only
   * what previous sessions learned can separate the list.
   */
  // Act, then press: the changes come *before* the capture, which is the
  // gesture the window is shaped for.
  const events = [
    ...Array.from({ length: 60 }, (_, n) => change(n * 500, "L:Idle", n)),
    change(29_000, "L:CockpitSwitchSnd", 1),
    change(29_200, "L:CabinVentLever", 42),
    { t: 30_000, via: "app" as const, kind: "mark" as const },
  ]

  it("scores everything alike without it", () => {
    const [finding] = findingsFor(events)
    const promiscuity = finding!.candidates.map((one) => one.promiscuity)

    expect(new Set(promiscuity)).toEqual(new Set([1]))
  })

  it("demotes what previous sessions saw everywhere", () => {
    const [finding] = findingsFor(events, [], {
      seen: new Map([
        ["L:CockpitSwitchSnd", new Set(["SWITCH_A", "SWITCH_B", "SWITCH_C"])],
        ["L:CabinVentLever", new Set(["SWITCH_A"])],
      ]),
    })

    expect(finding!.candidates[0]!.name).toBe("L:CabinVentLever")

    const sound = finding!.candidates.find((one) => one.name === "L:CockpitSwitchSnd")
    expect(sound!.promiscuity).toBe(4)
  })

  /**
   * Unioned, not added. A variable that answered to the beacon last week and
   * the beacon again today has coincided with one control, not two — and if
   * this counted instead of unioning, every answer would be demoted a little
   * further every session until nothing was specific to anything.
   */
  it("does not double-count a control seen in both", () => {
    const withInput = [...events, input(30_100, "SWITCH_A"), change(30_140, "L:Thing", 1)]

    const [finding] = findingsFor(withInput, [], {
      seen: new Map([["L:Thing", new Set(["SWITCH_A"])]]),
    })

    const thing = finding!.candidates.find((one) => one.name === "L:Thing")
    expect(thing?.promiscuity).toBe(1)
  })
})

/**
 * Captures are what somebody asked for. Everything else is background.
 *
 * The bug these exist for: arming started life in the renderer as a filter over
 * a list recomputed from the ring, so every interaction still became a row and
 * the panel merely hid the ones nobody asked about. Flipping a switch two dozen
 * times to watch values, then re-arming, released two dozen rows at once.
 * Hiding can be undone; not creating cannot.
 */
describe("what becomes a capture", () => {
  const closeWindow = () => vi.advanceTimersByTime(1_000)

  beforeEach(() => {
    watchAircraft("pa24-250")
    for (let t = 0; t < 40_000; t += 500) observeActivity(change(t, "L:Idle", t))
  })

  /** One interaction, one capture, and the arm is spent. */
  it("captures the first interaction and disarms", () => {
    observeActivity(input(40_000, "SWITCH_BEACON"))
    observeActivity(change(40_040, "L:BeaconLightSwitch", 1))
    noteInteraction("SWITCH_BEACON", 40_000)

    expect(captureMode()).toBe("off")

    closeWindow()
    expect(captures()).toHaveLength(1)
    expect(captures()[0]!.anchor.name).toBe("SWITCH_BEACON")
  })

  /**
   * The case the refactor is for. Two dozen flips while disarmed produce no
   * rows — not hidden rows, *no* rows — so re-arming has nothing to release.
   */
  it("never makes a row from an interaction nobody asked for", () => {
    observeActivity(input(40_000, "SWITCH_BEACON"))
    observeActivity(change(40_040, "L:BeaconLightSwitch", 1))
    noteInteraction("SWITCH_BEACON", 40_000)
    closeWindow()

    for (let n = 1; n <= 24; n += 1) {
      const at = 41_000 + n * 500
      observeActivity(input(at, "SWITCH_BEACON"))
      observeActivity(change(at + 40, "L:BeaconLightSwitch", n % 2))
      noteInteraction("SWITCH_BEACON", at)
      closeWindow()
    }

    expect(captures()).toHaveLength(1)

    // And arming again does not release the backlog, because there is none.
    setCaptureMode("once")
    expect(captures()).toHaveLength(1)
  })

  /** Those flips are still teaching, which is the whole reason they run. */
  it("learns from the interactions it did not capture", () => {
    setCaptureMode("off")

    observeActivity(input(40_000, "SWITCH_BEACON"))
    observeActivity(change(40_040, "L:BeaconLightSwitch", 1))
    noteInteraction("SWITCH_BEACON", 40_000)
    closeWindow()

    expect(captures()).toHaveLength(0)
    expect(observedCoincidences("pa24-250").get("L:BeaconLightSwitch")).toEqual(
      new Set(["SWITCH_BEACON"])
    )
  })

  /** The hotkey and the button are a request, so they capture either way. */
  it("captures a mark even when disarmed", () => {
    setCaptureMode("off")
    observeActivity(change(40_040, "L:Mystery", 1))

    // Both halves, as the real path does it: the ring drops `mark` events, so a
    // mark anchor exists only because `marks.ts` is holding the instant.
    markAt(40_000)
    noteMark(40_000)
    vi.advanceTimersByTime(MARK_AFTER_MS + 1_000)

    expect(captures()).toHaveLength(1)
    expect(captures()[0]!.anchor.kind).toBe("mark")
  })

  /**
   * A capture that matched no anchor gives the arm back. An aircraft change
   * dumps hundreds of input events at once and `anchorsIn` drops them as a
   * machine burst — spending the arm on one of those would leave somebody
   * waiting for a capture that already silently happened and found nothing.
   */
  it("returns the arm when its interaction turned out not to be one", () => {
    noteInteraction("SWITCH_NOT_IN_THE_BUFFER", 40_000)
    expect(captureMode()).toBe("off")

    closeWindow()

    expect(captures()).toHaveLength(0)
    expect(captureMode()).toBe("once")
  })

  /** A capture outlives the ring it was computed from. */
  it("keeps a capture after its evidence has rolled away", () => {
    observeActivity(input(40_000, "SWITCH_BEACON"))
    observeActivity(change(40_040, "L:BeaconLightSwitch", 1))
    noteInteraction("SWITCH_BEACON", 40_000)
    closeWindow()

    expect(captures()).toHaveLength(1)
    const before = captures()[0]!.candidates.map((one) => one.name)

    // The ring is emptied under it, as two minutes of flying would do.
    resetActivity()

    expect(captures()).toHaveLength(1)
    expect(captures()[0]!.candidates.map((one) => one.name)).toEqual(before)
  })
})

describe("the capture mode", () => {
  const closeWindow = () => vi.advanceTimersByTime(1_000)

  /** One interaction as the sim reports it, with the variable it moved. */
  function flip(at: number, control: string, variable: string, value = 1) {
    observeActivity(input(at, control))
    observeActivity(change(at + 40, variable, value))
    noteInteraction(control, at)
  }

  beforeEach(() => {
    watchAircraft("pa24-250")
    for (let t = 0; t < 40_000; t += 500) observeActivity(change(t, "L:Idle", t))
  })

  it("captures every interaction on always", () => {
    setCaptureMode("always")

    flip(40_000, "SWITCH_BEACON", "L:BeaconLightSwitch")
    closeWindow()
    flip(42_000, "SWITCH_NAV", "L:NavLightSwitch")
    closeWindow()

    expect(captures().map((one) => one.anchor.name)).toEqual([
      "SWITCH_BEACON",
      "SWITCH_NAV",
    ])
    expect(captureMode()).toBe("always")
  })

  /**
   * The case a single in-flight slot got wrong: the second switch arrives while
   * the first capture's window is still open.
   */
  it("keeps two controls worked half a second apart", () => {
    setCaptureMode("always")

    flip(40_000, "SWITCH_BEACON", "L:BeaconLightSwitch")
    flip(40_500, "SWITCH_NAV", "L:NavLightSwitch")

    // Both show while their windows are still open, oldest first.
    expect(captures().map((one) => one.anchor.name)).toEqual([
      "SWITCH_BEACON",
      "SWITCH_NAV",
    ])

    closeWindow()
    expect(captures()).toHaveLength(2)
  })

  /** The sim reports each interaction twice; that is one row. */
  it("folds a control's own repeats into one capture", () => {
    setCaptureMode("always")

    flip(40_000, "SWITCH_BEACON", "L:BeaconLightSwitch")
    observeActivity(input(40_020, "SWITCH_BEACON"))
    noteInteraction("SWITCH_BEACON", 40_020)
    closeWindow()

    expect(captures()).toHaveLength(1)
  })

  it("captures nothing on off", () => {
    setCaptureMode("off")

    flip(40_000, "SWITCH_BEACON", "L:BeaconLightSwitch")
    closeWindow()

    expect(captures()).toHaveLength(0)
  })

  /** Noise is a property of the aircraft, so the choice is kept with it. */
  it("remembers the mode per aircraft", () => {
    setCaptureMode("always")

    watchAircraft("a220")
    expect(captureMode()).toBe("once")

    setCaptureMode("off")
    watchAircraft("pa24-250")
    expect(captureMode()).toBe("always")

    watchAircraft("a220")
    expect(captureMode()).toBe("off")
  })

  /**
   * The sim sends the same aircraft several times per change. Reading the mode
   * again on each would re-arm a `once` that had just been spent.
   */
  it("does not re-arm when the same aircraft is reported again", () => {
    flip(40_000, "SWITCH_BEACON", "L:BeaconLightSwitch")
    expect(captureMode()).toBe("off")

    watchAircraft("pa24-250")
    expect(captureMode()).toBe("off")
  })

  it("arms from the hotkey only when off", () => {
    setCaptureMode("off")
    armFromHotkey()
    expect(captureMode()).toBe("once")

    setCaptureMode("always")
    armFromHotkey()
    expect(captureMode()).toBe("always")
  })

  it("re-arms a spent once on clear, and leaves a chosen off alone", () => {
    flip(40_000, "SWITCH_BEACON", "L:BeaconLightSwitch")
    closeWindow()
    expect(captureMode()).toBe("off")

    clearCaptures()
    expect(captureMode()).toBe("once")

    setCaptureMode("off")
    clearCaptures()
    expect(captureMode()).toBe("off")
  })

  /**
   * A mark next to a switch anchors to the switch's finding. On `always` both
   * are open at once, and they must finish as one row, not two copies of it.
   */
  it("does not duplicate a row when a mark lands on a captured control", () => {
    setCaptureMode("always")

    flip(40_000, "SWITCH_BEACON", "L:BeaconLightSwitch")
    markAt(40_100)
    noteMark(40_100)

    expect(captures()).toHaveLength(1)

    vi.advanceTimersByTime(MARK_AFTER_MS + 1_000)
    expect(captures().map((one) => one.anchor.name)).toEqual(["SWITCH_BEACON"])
  })
})

/**
 * A control the aircraft fires by itself. The A220's AIRLINER_ALT_FLAP_TOGGLE
 * reports at 4 Hz with nobody touching it, which is the case these are for.
 */
describe("ignoring a control", () => {
  const closeWindow = () => vi.advanceTimersByTime(1_000)

  function flip(at: number, control: string, variable: string, value = 1) {
    observeActivity(input(at, control))
    observeActivity(change(at + 40, variable, value))
    noteInteraction(control, at)
  }

  beforeEach(() => {
    watchAircraft("a220")
    for (let t = 0; t < 40_000; t += 500) observeActivity(change(t, "L:Idle", t))
  })

  it("never captures it, and leaves a waiting once for the next real one", () => {
    setIgnored("AIRLINER_ALT_FLAP_TOGGLE", true)

    flip(40_000, "AIRLINER_ALT_FLAP_TOGGLE", "L:FlapTick")
    closeWindow()
    expect(captures()).toHaveLength(0)
    expect(captureMode()).toBe("once")

    flip(42_000, "SWITCH_BEACON", "L:BeaconLightSwitch")
    closeWindow()
    expect(captures().map((one) => one.anchor.name)).toEqual(["SWITCH_BEACON"])
  })

  it("takes its rows off the list", () => {
    setCaptureMode("always")
    flip(40_000, "AIRLINER_ALT_FLAP_TOGGLE", "L:FlapTick")
    closeWindow()
    flip(42_000, "SWITCH_BEACON", "L:BeaconLightSwitch")
    closeWindow()

    setIgnored("AIRLINER_ALT_FLAP_TOGGLE", true)

    expect(captures().map((one) => one.anchor.name)).toEqual(["SWITCH_BEACON"])
  })

  /**
   * A mark next to an input anchors to that input's finding, so with a ticker
   * running every Capture press found the ticker instead of the lever.
   */
  it("keeps a mark from landing on it", () => {
    setIgnored("AIRLINER_ALT_FLAP_TOGGLE", true)

    observeActivity(input(40_000, "AIRLINER_ALT_FLAP_TOGGLE"))
    observeActivity(change(39_000, "L:CabinVentLever", 42))
    markAt(40_100)
    noteMark(40_100)
    vi.advanceTimersByTime(MARK_AFTER_MS + 1_000)

    expect(captures().map((one) => one.anchor.kind)).toEqual(["mark"])
  })

  it("is remembered per aircraft, and can be undone", () => {
    setIgnored("AIRLINER_ALT_FLAP_TOGGLE", true)
    expect(ignoredControls()).toEqual(["AIRLINER_ALT_FLAP_TOGGLE"])

    watchAircraft("pa24-250")
    expect(ignoredControls()).toEqual([])

    watchAircraft("a220")
    expect(ignoredControls()).toEqual(["AIRLINER_ALT_FLAP_TOGGLE"])

    setIgnored("AIRLINER_ALT_FLAP_TOGGLE", false)
    flip(40_000, "AIRLINER_ALT_FLAP_TOGGLE", "L:FlapTick")
    closeWindow()
    expect(captures()).toHaveLength(1)
  })
})
