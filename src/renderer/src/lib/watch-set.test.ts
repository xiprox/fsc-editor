/**
 * The watch set and where hints go.
 *
 * Both are derived from the profile grammar rather than from a regex over
 * lines, so the cases worth asserting are the ones where a naive reading would
 * get it wrong: a `set:` that mentions a variable, a block scalar containing
 * something that looks like an entry, and units that change the read.
 */

import { describe, expect, it } from "vitest"

import { getLinesIn, watchSetFor } from "./watch-set"

const profile = `# ── Electrical ──────────────────────────────────────────────
shared:
  - get: A:CIRCUIT CONNECTION ON:3, Bool
    set: 1 (>K:ELECTRICAL_CIRCUIT_TOGGLE)
  - get: L:AdfOnOffKnob
  - get: A:INDICATED ALTITUDE, Feet
master:
  - get: A:CIRCUIT CONNECTION ON:3, Bool
`

describe("getLinesIn", () => {
  it("finds every get: with the line it sits on, counting from one", () => {
    const found = getLinesIn(profile)

    expect(found.map((entry) => [entry.line, entry.watch.name])).toEqual([
      [3, "A:CIRCUIT CONNECTION ON:3"],
      [5, "L:AdfOnOffKnob"],
      [6, "A:INDICATED ALTITUDE"],
      [8, "A:CIRCUIT CONNECTION ON:3"],
    ])
  })

  it("splits units, and defaults them the way the corpus does", () => {
    const found = getLinesIn(profile)

    expect(found[0]?.watch.units).toBe("Bool")
    expect(found[2]?.watch.units).toBe("Feet")
    // No comma: Number for everything that is not an event.
    expect(found[1]?.watch.units).toBe("Number")
  })

  it("ignores a set: that happens to mention a variable", () => {
    const text = `shared:
  - get: A:BATTERY VOLTAGE, Volts
    set: (A:CIRCUIT CONNECTION ON:3, Bool) 1 ==
`
    expect(getLinesIn(text).map((e) => e.watch.name)).toEqual(["A:BATTERY VOLTAGE"])
  })

  it("does not read a get: out of a block scalar's body", () => {
    // The body is a JavaScript expression, not profile grammar. A regex over
    // lines would happily pick this up and watch a variable nobody asked for.
    const text = `shared:
  - get: A:BATTERY VOLTAGE, Volts
    set: |
      // - get: A:NOT A REAL WATCH, Bool
      return 1
`
    expect(getLinesIn(text).map((e) => e.watch.name)).toEqual(["A:BATTERY VOLTAGE"])
  })

  it("returns nothing for a profile with no entries", () => {
    expect(getLinesIn("# just a comment\n")).toEqual([])
  })
})

describe("watchSetFor", () => {
  it("deduplicates the same variable across blocks and files", () => {
    const set = watchSetFor([profile, profile])

    expect(set).toHaveLength(3)
    expect(set.map((entry) => entry.name)).toEqual([
      "A:CIRCUIT CONNECTION ON:3",
      "L:AdfOnOffKnob",
      "A:INDICATED ALTITUDE",
    ])
  })

  it("keeps one variable read in two units as two entries", () => {
    // They are two reads in the data definition, and collapsing them would
    // leave one of the two hints showing the other's number.
    const text = `shared:
  - get: A:PLANE HEADING DEGREES TRUE, Degrees
  - get: A:PLANE HEADING DEGREES TRUE, Radians
`
    expect(watchSetFor([text])).toEqual([
      { name: "A:PLANE HEADING DEGREES TRUE", units: "Degrees" },
      { name: "A:PLANE HEADING DEGREES TRUE", units: "Radians" },
    ])
  })

  it("carries every namespace, leaving the routing to main", () => {
    // The renderer does not decide what is reachable — main drops what it
    // cannot watch, so the module arriving in 2b changes one function there
    // and nothing here.
    const names = watchSetFor([profile]).map((entry) => entry.name)
    expect(names).toContain("L:AdfOnOffKnob")
  })

  it("is empty when nothing is open", () => {
    expect(watchSetFor([])).toEqual([])
  })
})
