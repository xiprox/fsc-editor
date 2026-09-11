/**
 * Reading units out of a `get:` line.
 *
 * Worth testing on its own because the distinction it draws is invisible
 * afterwards: `Number` written deliberately and `Number` inferred from silence
 * resolve to the same string, and 73% of the corpus's `L:` lines are the second
 * kind. Anything that ranks or suggests a unit needs to know which it is
 * looking at.
 */

import { describe, expect, it } from "vitest"

import { scanEntries, splitUnits } from "./entries.ts"

describe("splitUnits", () => {
  it("reports a written unit as explicit", () => {
    expect(splitUnits("L:AdfKnob, Percent")).toEqual({
      name: "L:AdfKnob",
      units: "Percent",
      explicit: true,
    })
  })

  it("reports the default as not explicit", () => {
    // The common case by a wide margin, and the reason the flag exists.
    expect(splitUnits("L:AdfKnob")).toEqual({
      name: "L:AdfKnob",
      units: "Number",
      explicit: false,
    })
  })

  it("counts a written `Number` as a decision, not a default", () => {
    // Same resolved value, opposite meaning: somebody typed this one.
    expect(splitUnits("L:AdfKnob, Number").explicit).toBe(true)
  })

  it("still defaults events to no unit at all", () => {
    expect(splitUnits("K:TOGGLE_MASTER_BATTERY")).toEqual({
      name: "K:TOGGLE_MASTER_BATTERY",
      units: "",
      explicit: false,
    })
  })

  it("takes only the second field, as FS Copilot does", () => {
    // `Position 16k, Number` is one unit with a stray trailing field, not two.
    expect(splitUnits("A:FOO, Position 16k, Number")).toEqual({
      name: "A:FOO",
      units: "Position 16k",
      explicit: true,
    })
  })
})

describe("scanEntries", () => {
  const profile = `shared:
  - get: L:Written, Percent
  - get: L:Silent
  - get: A:BATTERY VOLTAGE, Volts
`

  it("carries explicitness through to the entry", () => {
    const entries = scanEntries("a.yaml", profile)

    expect(entries.map((e) => [e.name, e.units, e.unitsExplicit])).toEqual([
      ["L:Written", "Percent", true],
      ["L:Silent", "Number", false],
      ["A:BATTERY VOLTAGE", "Volts", true],
    ])
  })

  it("does not treat a trailing comment as part of the unit", () => {
    // The grammar strips comments before the value is split. Without that,
    // `Bool # TQ TOGA 1` becomes a unit, and the corpus grows hundreds of
    // one-off units that are really annotations.
    const [entry] = scanEntries(
      "a.yaml",
      "shared:\n  - get: L:Foo, Bool # a note\n"
    )

    expect(entry?.units).toBe("Bool")
    expect(entry?.unitsExplicit).toBe(true)
  })

  it("records the line each of an entry's parts was written on", () => {
    const entries = scanEntries(
      "a.yaml",
      [
        "shared:",
        "  - get: L:First",
        "    set: (>K:ONE)",
        "    skp: L:Other",
        "",
        "  - get: L:Second",
      ].join("\n")
    )

    expect(entries.map((e) => e.at)).toEqual([
      { get: 2, set: 3, skp: 4, end: 4 },
      { get: 6, end: 6 },
    ])
  })

  it("addresses a block scalar by its key line, not its body", () => {
    // The body is where the value lives, but the key is where the entry —
    // and anything positioning a verdict about it — meets the value again.
    const [entry] = scanEntries(
      "a.yaml",
      ["shared:", "  - get: L:First", "    set: >", "      1 (>L:X)"].join("\n")
    )

    // `end` is the body, though — the entry occupies the line its value is
    // written on even where nothing addresses the entry by it.
    expect(entry?.at).toEqual({ get: 2, set: 3, end: 4 })
    expect(entry?.set).toBe("1 (>L:X)")
  })
})

/**
 * The extent — where the entry stops.
 *
 * Read by the Trace panel's locator, which prints `lines 31-33`, and by the
 * run popover, which dims everything outside it. Both are wrong in a way the
 * reader can see if this is off by a line, and the one hard case is a literal
 * block: a blank line inside the value belongs to it, and the blank line
 * before the next entry does not.
 */
describe("scanEntries — at.end", () => {
  const ends = (...lines: string[]) =>
    scanEntries("a.yaml", lines.join("\n")).map((e) => [e.at.get, e.at.end])

  it("is the get: line for an entry that occupies one", () => {
    expect(ends("shared:", "  - get: L:Only")).toEqual([[2, 2]])
  })

  it("reaches the last key, whichever key that is", () => {
    // `skp:` after `set:` — the extent is the entry's last line, not the last
    // line anything else happens to care about.
    expect(
      ends("shared:", "  - get: L:A", "    set: (>K:ONE)", "    skp: L:B")
    ).toEqual([[2, 4]])
  })

  it("keeps a blank line inside a literal block, and drops the one after it", () => {
    // The hard case. Line 6 is scanned as `scalarBody` because a literal
    // block's blank lines are part of its value; line 8 is an ordinary blank
    // separating two entries. The first extends the entry, the second does
    // not — and the whole rule is that the scanner has already told them
    // apart, so the test is whether the line holds anything.
    expect(
      ends(
        "shared:",
        "  - get: L:A",
        "    set: |",
        "      1",
        "",
        "      2 (>L:X)",
        "",
        "  - get: L:B"
      )
    ).toEqual([
      [2, 6],
      [8, 8],
    ])
  })

  it("does not run past a block key", () => {
    expect(
      ends("shared:", "  - get: L:A", "master:", "  - get: L:B")
    ).toEqual([
      [2, 2],
      [4, 4],
    ])
  })

  it("is not extended by the prose documenting the next entry", () => {
    // A comment between entries is documentation for the one below, and it is
    // not part of either extent.
    expect(
      ends("shared:", "  - get: L:A", "  # why the next one exists", "  - get: L:B")
    ).toEqual([
      [2, 2],
      [4, 4],
    ])
  })
})
