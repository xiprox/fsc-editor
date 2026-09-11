/**
 * Resolving an entry to calculator code.
 *
 * The cases are FS Copilot's four branches, and the assertions are the exact
 * strings rather than shapes: this file's whole job is producing a string that
 * another program's parser will accept, so "looks about right" is not a test of
 * it. Where a case comes from `Definition.Set`, the C# is quoted beside it.
 */

import { describe, expect, it } from "vitest"

import { scanEntries } from "@shared/profile"

import {
  resolveSetter,
  setterKind,
  type SetterEntry,
  type SetterKind,
} from "./setter"

const AT = { value: 1, current: 0 }

describe("implicit — no set: at all", () => {
  it("writes the value to the get: variable, units and all", () => {
    expect(
      resolveSetter({ name: "L:Battery1Switch", units: "Number" }, AT)
    ).toEqual({
      ok: true,
      kind: "implicit",
      code: "1 (>L:Battery1Switch, Number)",
    })
  })

  it("omits the units clause when there are none, which is every K: and H:", () => {
    expect(resolveSetter({ name: "H:Autopilot_On", units: "" }, AT)).toEqual({
      ok: true,
      kind: "implicit",
      code: "1 (>H:Autopilot_On)",
    })
  })

  it("keeps the units it is given, because they change what gets written", () => {
    // `(>L:Foo, Percent)` and `(>L:Foo, Number)` write different numbers for
    // the same input, so this is not decoration.
    expect(
      resolveSetter({ name: "L:Flaps", units: "Percent" }, { ...AT, value: 50 })
    ).toMatchObject({ code: "50 (>L:Flaps, Percent)" })
  })

  it("resolves an entry straight out of a scanned profile", () => {
    // The end-to-end shape that matters: a `get:` line with nothing under it is
    // runnable, and nothing had to be assembled by hand to make it so.
    const [entry] = scanEntries(
      "pa24-250.yaml",
      "shared:\n  - get: L:CabinVentLever, Percent\n"
    )

    expect(entry.set).toBeUndefined()
    expect(resolveSetter(entry, { value: 25, current: 0 })).toMatchObject({
      kind: "implicit",
      code: "25 (>L:CabinVentLever, Percent)",
    })
  })

  it("refuses an entry with no name rather than writing to nowhere", () => {
    expect(resolveSetter({ name: "  ", units: "Number" }, AT)).toMatchObject({
      ok: false,
    })
  })
})

describe("javascript — a template literal", () => {
  it("evaluates with value in scope", () => {
    expect(
      resolveSetter(
        {
          name: "L:Com1Freq",
          units: "Number",
          set: "`${value * 100} (>L:Com1Freq)`",
        },
        { value: 1.2, current: 0 }
      )
    ).toEqual({ ok: true, kind: "javascript", code: "120 (>L:Com1Freq)" })
  })

  it("evaluates with current in scope, which is the branch that needs it", () => {
    const set = "`${value > current ? 1 : 0} (>K:AP_ALT_VAR_INC)`"

    expect(
      resolveSetter(
        { name: "A:AUTOPILOT ALTITUDE LOCK VAR", units: "Feet", set },
        {
          value: 5000,
          current: 3000,
        }
      )
    ).toMatchObject({ code: "1 (>K:AP_ALT_VAR_INC)" })

    expect(
      resolveSetter(
        { name: "A:AUTOPILOT ALTITUDE LOCK VAR", units: "Feet", set },
        {
          value: 3000,
          current: 5000,
        }
      )
    ).toMatchObject({ code: "0 (>K:AP_ALT_VAR_INC)" })
  })

  it("runs a statement body with a top-level return", () => {
    // 296 entries in the corpus are written this way — the CRJ family, the
    // Albatross, the TBM 850. Jint allows `return` at the top level of a
    // script and V8 does not, so these only resolve because the source gets a
    // second attempt wrapped in a function.
    const set = [
      "switch (value) {",
      "  case 0: return '0 (>B:GUARD_Off)'",
      "  default: return '1 (>B:GUARD_On)'",
      "}",
    ].join("\n")

    expect(
      resolveSetter(
        { name: "L:Guard", units: "Number", set },
        { value: 0, current: 0 }
      )
    ).toMatchObject({ code: "0 (>B:GUARD_Off)" })
    expect(
      resolveSetter(
        { name: "L:Guard", units: "Number", set },
        { value: 5, current: 0 }
      )
    ).toMatchObject({ code: "1 (>B:GUARD_On)" })
  })

  it("reads a leading brace as a block, the way Jint does", () => {
    // Not as an object literal, which is what parenthesising the source would
    // make it. Jint evaluates a script and returns its completion value, so
    // `{ value }` is a block whose value is the number — and a number is not
    // calculator code.
    const result = resolveSetter(
      { name: "L:Foo", units: "Number", set: "{ value }" },
      AT
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain("a number")
  })

  it("says what a non-string expression produced instead", () => {
    // FS Copilot catches this and returns string.Empty — a setter that silently
    // does nothing. The usual cause is a missing pair of backticks.
    const result = resolveSetter(
      { name: "L:Foo", units: "Number", set: "value ? 1 : 0" },
      AT
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toContain("a number")
  })

  it("reports a throwing expression rather than throwing itself", () => {
    const result = resolveSetter(
      { name: "L:Foo", units: "Number", set: "`${nothing.here}`" },
      AT
    )

    expect(result.ok).toBe(false)
    expect(result.ok === false && result.reason).toMatch(/nothing/)
  })

  it("stops an expression that would never finish", () => {
    // A profile is somebody else's file, and this one would take the window
    // down with it. The braces are also what classify it as JavaScript.
    const result = resolveSetter(
      { name: "L:Foo", units: "Number", set: "(() => { while (true) {} })()" },
      AT
    )

    expect(result.ok).toBe(false)
  })
})

describe("prepended — a set: starting with (", () => {
  it("puts the value in front", () => {
    expect(
      resolveSetter(
        {
          name: "K:TOGGLE_BEACON_LIGHTS",
          units: "",
          set: "(>K:TOGGLE_BEACON_LIGHTS)",
        },
        AT
      )
    ).toEqual({
      ok: true,
      kind: "prepended",
      code: "1 (>K:TOGGLE_BEACON_LIGHTS)",
    })
  })
})

describe("literal — a set: that is already code", () => {
  it("sends it exactly, ignoring the value", () => {
    expect(
      resolveSetter(
        { name: "L:Foo", units: "Number", set: "1 (>L:Foo)" },
        { value: 99, current: 0 }
      )
    ).toEqual({ ok: true, kind: "literal", code: "1 (>L:Foo)" })
  })
})

describe("setterKind", () => {
  const cases: [SetterKind, SetterEntry][] = [
    ["implicit", { name: "L:Foo", units: "Number" }],
    [
      "javascript",
      { name: "L:Foo", units: "Number", set: "`${value} (>L:Foo)`" },
    ],
    [
      "javascript",
      { name: "L:Foo", units: "Number", set: "value > 0 ? 1 : 0" },
    ],
    ["prepended", { name: "L:Foo", units: "Number", set: "(>L:Foo)" }],
    ["literal", { name: "L:Foo", units: "Number", set: "1 (>L:Foo)" }],
  ]

  for (const [expected, entry] of cases)
    it(`calls ${JSON.stringify(entry.set ?? null)} ${expected}`, () =>
      expect(setterKind(entry)).toBe(expected))
})
