import { describe, expect, it } from "vitest"

import { scanLines } from "./grammar.ts"
import { formatProfile } from "./format.ts"

const kinds = (text: string): string[] =>
  scanLines(text).map((line) => line.kind)

describe("a parked entry with a block scalar", () => {
  const PARKED = [
    "shared:",
    "# - get: A:AUTOPILOT HEADING LOCK DIR, Degrees",
    "#   set: >",
    "#     (() => {",
    "#       let delta = value - current;",
    "#",
    "#       return '(>K:HEADING_BUG_INC)';",
    "#     })()",
    "  - get: K:HEADING_BUG_INC",
  ].join("\n")

  it("keeps the body parked, not prose", () => {
    expect(kinds(PARKED)).toEqual([
      "blockKey",
      "parked",
      "parked",
      "parked",
      "parked",
      "parked",
      "parked",
      "parked",
      "entry",
    ])
  })

  it("ends at a comment back at the key's column or left of it", () => {
    const text = [
      "shared:",
      "#   set: |",
      "#     value",
      "#   skp: L:X",
      "# a remark at the margin",
    ].join("\n")
    expect(kinds(text)).toEqual(["blockKey", "parked", "parked", "parked", "prose"])
  })

  it("ends at a blank line", () => {
    const text = ["shared:", "#   set: |", "#     value", "", "#     value"].join(
      "\n"
    )
    expect(kinds(text)).toEqual(["blockKey", "parked", "parked", "blank", "prose"])
  })

  it("ends at a live line", () => {
    const text = [
      "shared:",
      "#   set: |",
      "#     value",
      "  - get: L:X",
      "#     value",
    ].join("\n")
    expect(kinds(text)).toEqual(["blockKey", "parked", "parked", "entry", "prose"])
  })

  it("does not open on a parked key without a block indicator", () => {
    const text = ["shared:", "#   set: 1 (>L:X)", "#     a remark"].join("\n")
    expect(kinds(text)).toEqual(["blockKey", "parked", "prose"])
  })

  it("measures the key column past a parked dash", () => {
    const text = [
      "shared:",
      "# - set: >",
      "#     value",
      "#   skp: L:X",
    ].join("\n")
    expect(kinds(text)).toEqual(["blockKey", "parked", "parked", "parked"])
  })
})

/**
 * Two of the 65 installed profiles open with one — `AS_GNS430.yaml` and
 * `AS_GNS530.yaml` — and until 2026-09-19 it cost them everything. The cost
 * was invisible because it was not an error: the file simply had no blocks,
 * so every rule that needs one had nothing to judge.
 */
describe("a UTF-8 BOM on the first line", () => {
  const text = ["\uFEFFshared:", "  - get: L:X", "    set: 1 (>L:Y)"].join("\n")

  it("does not stop the first key being a block key", () => {
    const lines = scanLines(text)

    expect(lines[0].kind).toBe("blockKey")
    expect(lines[0].indent).toBe(0)
  })

  it("puts the entries in the block, which is what was really lost", () => {
    // `context.block` staying null is the whole failure: line 1 being a
    // `mapping` is only how it started.
    expect(scanLines(text)[1].context.block).toBe("shared")
  })

  it("keeps the raw line, so a column still means what Monaco means", () => {
    const [first] = scanLines(text)

    expect(first.text).toBe("\uFEFFshared:")
    expect(first.text.indexOf("shared", first.keyColumn)).toBe(1)
  })

  it("leaves it on the line when the file is written back", () => {
    // Removing it would be a save that changes a file nobody asked to
    // change. FS Copilot strips it on read either way.
    expect(formatProfile(text).startsWith("\uFEFF")).toBe(true)
  })

  it("is only the first line's business", () => {
    // Anywhere else it is an invisible character in the text, which is
    // `invisible-chars`' question and not the grammar's.
    const inside = ["shared:", "  - get: L:\uFEFFX"].join("\n")

    expect(scanLines(inside)[1].kind).toBe("entry")
  })
})
