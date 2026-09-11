/**
 * Finding the entries a run button belongs on.
 *
 * The case worth most of these assertions is the entry with no `set:`, because
 * it is 60% of the corpus and because it is the one where the button has to
 * move to a different line.
 */

import { describe, expect, it } from "vitest"

import { runnableAt, runnableEntriesIn } from "./run-entries"

const profile = (...lines: string[]): string => lines.join("\n")

describe("runnableEntriesIn", () => {
  it("puts the button on the get: line when there is no setter", () => {
    const text = profile("shared:", "  - get: L:CabinVentLever, Percent")

    expect(runnableEntriesIn(text)).toEqual([
      {
        line: 2,
        column: 5,
        getLine: 2,
        endLine: 2,
        entry: { name: "L:CabinVentLever", units: "Percent", set: undefined },
      },
    ])
  })

  it("puts it on the set: line when there is one, and keeps the get: line", () => {
    const text = profile(
      "shared:",
      "  - get: L:Com1Freq",
      "    set: `${value * 100} (>L:Com1FreqInnerKnob)`"
    )

    expect(runnableEntriesIn(text)).toMatchObject([
      {
        line: 3,
        getLine: 2,
        entry: { set: "`${value * 100} (>L:Com1FreqInnerKnob)`" },
      },
    ])
  })

  it("reads a block scalar's body as the setter", () => {
    // The value is not on the `set:` line at all — the line only opens it.
    const text = profile(
      "shared:",
      "  - get: L:Guard",
      "    set: |",
      "      switch (value) {",
      "        default: return '1 (>B:GUARD_On)'",
      "      }"
    )

    const [entry] = runnableEntriesIn(text)

    expect(entry.line).toBe(3)
    expect(entry.entry.set).toContain("switch (value)")
  })

  it("drops a trailing comment from a one-line setter", () => {
    const text = profile(
      "shared:",
      "  - get: L:Foo",
      "    set: (>K:TOGGLE) # the guarded one"
    )

    expect(runnableEntriesIn(text)[0].entry.set).toBe("(>K:TOGGLE)")
  })

  it("unquotes a one-line setter, which is how the corpus writes them", () => {
    // 6,030 of the corpus's one-line setters are quoted, because a backtick
    // cannot open a plain scalar. Left quoted, the expression is a string
    // literal that evaluates to its own source text rather than to code.
    const text = profile(
      "shared:",
      "  - get: L:Beacon",
      '    set: "`${value} (>H:Beacon_Toggle)`"'
    )

    expect(runnableEntriesIn(text)[0].entry.set).toBe(
      "`${value} (>H:Beacon_Toggle)`"
    )
  })

  it("unquotes a single-quoted setter, trailing comment and all", () => {
    const text = profile(
      "shared:",
      "  - get: L:Starter",
      "    set: '1 (>K:STARTER1_SET)' # STARTER1_SET"
    )

    expect(runnableEntriesIn(text)[0].entry.set).toBe("1 (>K:STARTER1_SET)")
  })

  it("does not let one entry's setter belong to the next entry", () => {
    const text = profile(
      "shared:",
      "  - get: L:First",
      "    set: (>K:FIRST)",
      "  - get: L:Second"
    )

    expect(runnableEntriesIn(text)).toMatchObject([
      { line: 3, entry: { name: "L:First", set: "(>K:FIRST)" } },
      { line: 4, entry: { name: "L:Second", set: undefined } },
    ])
  })

  it("ignores a skp: on the way to the setter", () => {
    const text = profile(
      "shared:",
      "  - get: L:Foo",
      "    skp: L:Bar",
      "    set: (>K:FOO)"
    )

    expect(runnableEntriesIn(text)[0]).toMatchObject({
      line: 4,
      entry: { set: "(>K:FOO)" },
    })
  })

  it("resolves units the way FS Copilot does", () => {
    const text = profile(
      "shared:",
      "  - get: L:Silent",
      "  - get: K:TOGGLE_MASTER_BATTERY",
      "  - get: A:BATTERY VOLTAGE, Volts"
    )

    expect(runnableEntriesIn(text).map((one) => one.entry.units)).toEqual([
      "Number",
      "",
      "Volts",
    ])
  })

  it("skips a get: line that has not been finished", () => {
    expect(runnableEntriesIn(profile("shared:", "  - get: "))).toEqual([])
  })
})

describe("the entry's extent", () => {
  it("runs from the get: line to the last line that belongs to it", () => {
    // What the dimming lights up. A block setter's body is the code being
    // tested, so it has to be inside the lit range.
    const text = profile(
      "shared:",
      "  - get: L:Guard",
      "    set: |",
      "      switch (value) {",
      "      }",
      "",
      "  - get: L:Next"
    )

    expect(runnableEntriesIn(text)[0]).toMatchObject({ getLine: 2, endLine: 5 })
  })

  it("does not stretch over the blank line before the next entry", () => {
    const text = profile("shared:", "  - get: L:Foo", "", "  - get: L:Bar")

    expect(runnableEntriesIn(text)[0]).toMatchObject({ getLine: 2, endLine: 2 })
  })
})

describe("runnableAt", () => {
  it("finds the entry whose button is on a line", () => {
    const entries = runnableEntriesIn(
      profile("shared:", "  - get: L:Foo", "    set: (>K:FOO)")
    )

    expect(runnableAt(entries, 3)?.entry.name).toBe("L:Foo")
    // The `get:` line carries no button when the entry has a setter.
    expect(runnableAt(entries, 2)).toBeUndefined()
  })
})
