/**
 * The live-value store: one map, two transports, and what comes back out.
 *
 * These are the rules that made this a file rather than a couple of lines in
 * the connection handler, and every one of them is a bug that already happened
 * or was one step away.
 */

import { beforeEach, describe, expect, it } from "vitest"

import {
  recordValue,
  recordValues,
  resetValues,
  setWatch,
  takeDirty,
  valueCount,
  watchedValues,
} from "./live-values"

beforeEach(() => {
  resetValues()
  setWatch([])
  takeDirty()
})

const watch = (name: string, units = "Number") => ({ name, units })

describe("one map, two transports", () => {
  /**
   * The reason this file exists.
   *
   * `A:` arrives as a full set once a second, `L:` as deltas at 15 Hz, and the
   * renderer replaces its whole map on receipt. Emitting each transport's news
   * separately meant each one erasing the other's hints on alternate messages.
   */
  it("emits A: and L: together, not one at a time", () => {
    setWatch([watch("A:BATTERY VOLTAGE", "Volts"), watch("L:DmeOnOffKnob")])

    recordValues([{ name: "A:BATTERY VOLTAGE", units: "Volts", value: 24.1 }])
    recordValue("L:DmeOnOffKnob", 1)

    expect(watchedValues()).toEqual([
      { name: "A:BATTERY VOLTAGE", units: "Volts", value: 24.1 },
      { name: "L:DmeOnOffKnob", units: "Number", value: 1 },
    ])
  })

  it("keeps the newest value for a name", () => {
    setWatch([watch("L:Knob")])

    recordValue("L:Knob", 1)
    recordValue("L:Knob", 2)

    expect(watchedValues()).toEqual([{ name: "L:Knob", units: "Number", value: 2 }])
  })
})

describe("what comes out", () => {
  it("emits only what is watched", () => {
    setWatch([watch("L:Watched")])

    recordValue("L:Watched", 1)
    recordValue("L:Ignored", 2)

    expect(watchedValues()).toEqual([
      { name: "L:Watched", units: "Number", value: 1 },
    ])
  })

  /**
   * The whole reason every `L:` is kept rather than only the watched ones.
   *
   * The module sends deltas, so a switch nobody has touched since enumeration
   * never reports again. If the store dropped unwatched values, opening a
   * profile would light up only the variables that happened to move while it
   * was closed — which is the opposite of what somebody writing a profile
   * needs.
   */
  it("has a value ready for a variable watched after it was last seen", () => {
    recordValue("L:NeverTouchedSince", 3)
    expect(watchedValues()).toEqual([])

    setWatch([watch("L:NeverTouchedSince")])

    expect(watchedValues()).toEqual([
      { name: "L:NeverTouchedSince", units: "Number", value: 3 },
    ])
  })

  it("says nothing about a variable it has never seen", () => {
    setWatch([watch("L:NotInThisAircraft")])
    expect(watchedValues()).toEqual([])
  })

  /**
   * Units come from the profile line, not from the wire.
   *
   * `L:` is read raw — the module has no idea what unit a line asked for — so
   * the label is the request. Measured as safe: of 19,977 `L:` `get:` lines in
   * the corpus, 74% carry no unit and 99.7% of the rest are Number, Bool,
   * Percent or Enum. It is what lets `Bool` render as a boolean.
   */
  it("labels a raw value with the units the line asked for", () => {
    setWatch([watch("L:Switch", "Bool")])
    recordValue("L:Switch", 1)

    expect(watchedValues()).toEqual([
      { name: "L:Switch", units: "Bool", value: 1 },
    ])
  })

  /**
   * The renderer keys hints by name alone, so two entries for one variable
   * would be a longer message saying the same thing — and the second would
   * overwrite the first there anyway.
   */
  it("collapses two get: lines naming the same variable", () => {
    setWatch([watch("L:Switch", "Bool"), watch("L:Switch", "Number")])
    recordValue("L:Switch", 1)

    expect(watchedValues()).toEqual([
      { name: "L:Switch", units: "Bool", value: 1 },
    ])
  })
})

describe("when to bother the renderer", () => {
  it("is dirty when a watched value changes", () => {
    setWatch([watch("L:Knob")])
    takeDirty()

    recordValue("L:Knob", 1)
    expect(takeDirty()).toBe(true)
  })

  /**
   * An idle cockpit is not idle on the wire.
   *
   * Two clocks are 88% of a live `L:` stream — measured, four minutes of a
   * PA-24 — and every tick of them would otherwise be an IPC message and a
   * Monaco repaint for a number nobody is looking at.
   */
  it("is not dirty for a variable nobody is watching", () => {
    setWatch([watch("L:Knob")])
    takeDirty()

    recordValue("L:SomeClock", 63848)
    expect(takeDirty()).toBe(false)
  })

  it("is not dirty when a watched value arrives unchanged", () => {
    setWatch([watch("L:Knob")])
    recordValue("L:Knob", 1)
    takeDirty()

    recordValue("L:Knob", 1)
    expect(takeDirty()).toBe(false)
  })

  /**
   * A changed watch set is news even when no value moved: the renderer clears
   * and replaces, so a variable that has left the set has to stop having a
   * value or its hint sits there showing whatever it read last.
   */
  it("is dirty when the watch set changes", () => {
    takeDirty()
    setWatch([watch("L:Knob")])

    expect(takeDirty()).toBe(true)
  })

  it("clears the flag once taken", () => {
    setWatch([watch("L:Knob")])
    recordValue("L:Knob", 1)

    expect(takeDirty()).toBe(true)
    expect(takeDirty()).toBe(false)
  })
})

describe("reset", () => {
  it("forgets values but keeps the watch set", () => {
    setWatch([watch("L:Knob")])
    recordValue("L:Knob", 1)
    expect(valueCount()).toBe(1)

    resetValues()

    expect(valueCount()).toBe(0)
    // The watch set describes the open editors, not the connection. Reconnecting
    // should light the same lines up without the renderer re-sending it.
    recordValue("L:Knob", 2)
    expect(watchedValues()).toEqual([{ name: "L:Knob", units: "Number", value: 2 }])
  })
})

/**
 * `B:` is the one namespace where the watched name is not the name values
 * arrive under.
 *
 * The simulator's table holds input-event **IDs** and profiles write
 * `<ID>_<Preset>`, so the store has to bring the two together. Measured on the
 * A220, 2026-09-03: of 464 enumerated names exactly one ends in a generated
 * operation, so this is the normal case rather than an edge.
 */
describe("B: written names and input-event ids", () => {
  it("shows an id's value on a line that writes a preset", () => {
    setWatch([watch("B:AIRLINER_FCU_CHRONO_2_Push", "")])

    // What `absorbValues` records: the id, because that is what the sim
    // enumerated and what a firing is keyed by.
    recordValue("B:AIRLINER_FCU_CHRONO_2", 1)

    expect(watchedValues()).toEqual([
      { name: "B:AIRLINER_FCU_CHRONO_2_Push", units: "", value: 1 },
    ])
  })

  it("marks the set dirty when an id a watched preset resolves to moves", () => {
    setWatch([watch("B:AIRLINER_FCU_CHRONO_2_Push", "")])
    takeDirty()

    recordValue("B:AIRLINER_FCU_CHRONO_2", 1)

    // Without the alias map this is the failure that shows nothing in the
    // gutter: the value is stored, and nothing ever asks for it.
    expect(takeDirty()).toBe(true)
  })

  it("gives every preset of one control the same value", () => {
    // There is no per-preset value because there is no per-preset anything —
    // the table holds one entry for the control.
    setWatch([
      watch("B:AIRLINER_FCU_CHRONO_2_Push", ""),
      watch("B:AIRLINER_FCU_CHRONO_2_Set", ""),
    ])

    recordValue("B:AIRLINER_FCU_CHRONO_2", 2)

    expect(watchedValues()).toEqual([
      { name: "B:AIRLINER_FCU_CHRONO_2_Push", units: "", value: 2 },
      { name: "B:AIRLINER_FCU_CHRONO_2_Set", units: "", value: 2 },
    ])
  })

  it("prefers the written name when the sim enumerated it verbatim", () => {
    // `AIRLINER_FCU_SPD_PUSH` and `AIRLINER_FCU_SPD_PUSH_PUSH` are both real
    // A220 ids. A watch on the shorter one must not read the longer one's
    // value, nor strip itself down to `AIRLINER_FCU_SPD`.
    setWatch([watch("B:AIRLINER_FCU_SPD_PUSH", "")])

    recordValue("B:AIRLINER_FCU_SPD", 9)
    recordValue("B:AIRLINER_FCU_SPD_PUSH", 1)

    expect(watchedValues()).toEqual([
      { name: "B:AIRLINER_FCU_SPD_PUSH", units: "", value: 1 },
    ])
  })

  it("leaves other namespaces on exact-name lookup", () => {
    setWatch([watch("L:Knob_Push", "")])

    recordValue("L:Knob", 1)

    // Stripping is a `B:` rule. An `L:` name means itself.
    expect(watchedValues()).toEqual([])
  })
})
