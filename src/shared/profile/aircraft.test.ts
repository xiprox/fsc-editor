import { describe, expect, it } from "vitest"

import {
  newProfile,
  profileFilename,
  profileIsFor,
  profileKey,
} from "./aircraft.ts"
import { formatProfile } from "./format.ts"
import { parseOutline } from "./outline.ts"

describe("profileIsFor", () => {
  it("matches the aircraft's own profile, case aside", () => {
    expect(profileIsFor("pa24-250.yaml", "pa24-250")).toBe(true)
    expect(profileIsFor("PA24-250.yaml", "Pa24-250")).toBe(true)
  })

  it("refuses another aircraft's profile, a working copy and a module", () => {
    expect(profileIsFor("a220.yaml", "pa24-250")).toBe(false)
    expect(profileIsFor("pa24-250-old.yaml", "pa24-250")).toBe(false)
    expect(profileIsFor("modules/pa24-250.yaml", "pa24-250")).toBe(false)
  })

  it("is false with no file or no aircraft", () => {
    expect(profileIsFor(null, "pa24-250")).toBe(false)
    expect(profileIsFor("pa24-250.yaml", null)).toBe(false)
  })
})

describe("profileKey", () => {
  it("reads the aircraft out of a root-level profile", () => {
    expect(profileKey("pa24-250.yaml")).toBe("pa24-250")
    expect(profileKey("bksq-aircraft-baronpropress.yml")).toBe(
      "bksq-aircraft-baronpropress"
    )
  })

  it("is case-insensitive, because the sim's key and the file need not agree", () => {
    expect(profileKey("PA24-250.YAML")).toBe("pa24-250")
  })

  // The whole point of the rule: FS Copilot loads `<key>.yaml` and nothing
  // else, so a suffixed file is a working copy the sim ignores.
  it("refuses a suffixed name rather than folding it", () => {
    expect(profileKey("pa24-250-default.yaml")).toBe("pa24-250-default")
    expect(profileKey("pa24-250-old.yaml")).toBe("pa24-250-old")
  })

  it("refuses anything in a subdirectory", () => {
    expect(profileKey("modules/pa24-250.yaml")).toBeNull()
    expect(profileKey("modules\\pa24-250.yaml")).toBeNull()
  })

  it("refuses what is not a profile at all", () => {
    expect(profileKey("pa24-250.txt")).toBeNull()
    expect(profileKey(".yaml")).toBeNull()
  })
})

describe("newProfile", () => {
  const starter = newProfile("pa24-250", new Date(2026, 7, 25, 9))

  it("names the aircraft and stamps the one header FS Copilot parses", () => {
    expect(starter.startsWith("# A profile for pa24-250.\n")).toBe(true)
    expect(starter).toContain("\n# Updated: 2026-08-25\n")
  })

  // Late enough in the day that UTC has already rolled over east of
  // Greenwich, which is what `toISOString` would have stamped here.
  it("stamps the author's day rather than UTC's", () => {
    expect(newProfile("pa24-250", new Date(2026, 0, 1, 23, 30))).toContain(
      "# Updated: 2026-01-01"
    )
  })

  /*
   * Neither block may be left empty — the schema types every top-level key as
   * an array, so `shared:` with nothing under it parses as null and the file
   * opens with a squiggle across the whole of it. Counting rather than naming
   * the entries, so rewriting the examples does not mean rewriting this.
   */
  it("fills both blocks with live entries", () => {
    const entries = (block: string): string[] => {
      const body = starter.split(`\n${block}:\n`)[1] ?? ""
      return body
        .split(/\n(?=[a-z])/)[0]
        .split("\n")
        .filter((text) => /^\s+- get:/.test(text))
    }

    expect(entries("master").length).toBeGreaterThan(0)
    expect(entries("shared").length).toBeGreaterThan(0)
  })

  /*
   * Every setter in the file is one a reader will copy, so each has to be a
   * shape FS Copilot actually accepts. `resolveSetter` is the judge and lives
   * in main, which this file cannot import — so what is pinned here is the
   * cheaper half: that the four kinds are all present and spelled the way
   * `setterKind` reads them.
   */
  it("shows all four setter shapes", () => {
    // Implicit — a `get:` with no `set:` under it.
    expect(starter).toMatch(/- get: L:LandingLightSwitch_1\n\n/)
    // Prepended, literal `(`.
    expect(starter).toContain("set: (>B:LIGHTING_PANEL_1_Set)")
    // JavaScript, a template literal.
    expect(starter).toContain("(>K:2:BEACON_LIGHTS_SET)")
    // JavaScript, a block scalar.
    expect(starter).toContain("set: |")
  })

  /*
   * The delta-repeat example is the one entry here with real arithmetic in it,
   * and the rounding is the part that cannot be dropped: `Array(n)` throws
   * `Invalid array length` on a fractional `n`, and a `Feet` reading of a
   * simvar stored in metres is fractional whenever the conversion does not
   * land clean. A draft of this file shipped without it.
   *
   * The division by a step that the source profile does is deliberately *not*
   * pinned — see the note on `newProfile`.
   */
  it("rounds the delta before it reaches Array()", () => {
    expect(starter).toContain("const delta = Math.round(value - current)")
    expect(starter).toContain("if (delta === 0) return ''")
    expect(starter).toContain("Array(Math.abs(delta)).fill(event).join(' ')")
  })

  /*
   * A starter file whose first Ctrl+S visibly rewrote itself would teach that
   * saving moves your work around. Headings come from `renderHeading` and
   * entries from `ENTRY_INDENT` for exactly this reason; this is the assertion
   * that keeps the next edit to the prose honest about it.
   */
  it("is already in the shape the formatter would write", () => {
    expect(formatProfile(starter)).toBe(starter)
  })

  /*
   * The file's own `NOTES` comment promises the reader that a section shows up
   * in the sidebar, so the outline has to agree — including that `NOTES` is a
   * section at column 0, outside any block, which is the case `blocksOf` in
   * `file-tree.tsx` handles separately.
   */
  it("outlines the way its own notes section promises", () => {
    const outline = parseOutline(starter)

    expect(outline.map((node) => [node.kind, node.title])).toEqual([
      ["section", "NOTES"],
      ["block", "master"],
      ["block", "shared"],
    ])

    const titles = (name: string): string[] =>
      outline
        .find((node) => node.title === name)!
        .children.map((child) => child.title)

    expect(titles("master")).toEqual(["THROTTLE", "TRIM"])
    expect(titles("shared")).toEqual(["LIGHTS", "ELECTRICAL"])
  })
})

describe("profileFilename", () => {
  it("adds the extension people do not type", () => {
    expect(profileFilename("A320neo")).toEqual({
      ok: true,
      filename: "A320neo.yaml",
    })
  })

  it("leaves an extension that is already there, either spelling", () => {
    expect(profileFilename("a320.yaml")).toEqual({
      ok: true,
      filename: "a320.yaml",
    })
    expect(profileFilename("a320.YML")).toEqual({
      ok: true,
      filename: "a320.YML",
    })
  })

  it("trims, because a trailing space is a name Windows will not keep", () => {
    expect(profileFilename("  a320  ")).toEqual({
      ok: true,
      filename: "a320.yaml",
    })
  })

  it("refuses an empty name", () => {
    expect(profileFilename("   ")).toEqual({
      ok: false,
      reason: "A profile needs a name.",
    })
  })

  // Separators among them: a profile's folder decides whether FS Copilot
  // loads it as an aircraft or includes it as a module, so typing one into
  // the name field is not a thing this offers.
  it("refuses the characters a filename cannot hold", () => {
    for (const name of ["a320?", "modules/fuel", "modules\\fuel", "a:320"])
      expect(profileFilename(name).ok).toBe(false)
  })
})
