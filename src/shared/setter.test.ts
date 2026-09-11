/**
 * Which fields a setter actually reads.
 *
 * The point of asking is that the common case is very light — an `L:` switch
 * with no `set:` wants a number and a button — and a popover that shows every
 * field every time makes it as heavy as the rare one. So the assertions that
 * matter here are the absences.
 */

import { describe, expect, it } from "vitest"

import { setterInputs, setterKind, type SetterEntry } from "./setter"

const entry = (set?: string): SetterEntry => ({
  name: "L:Foo",
  units: "Number",
  set,
})

describe("setterInputs", () => {
  it("asks an implicit setter for a value and nothing else", () => {
    // 60% of the corpus. The code is `<value> (>L:Foo, Number)` — the name and
    // the units are on the line you clicked, so a preview would be reading it
    // back to you.
    expect(setterInputs(entry())).toEqual({
      value: true,
      current: false,
      preview: false,
    })
  })

  it("previews a prepended setter, because somebody wrote that part", () => {
    expect(setterInputs(entry("(>K:TOGGLE_BEACON_LIGHTS)"))).toEqual({
      value: true,
      current: false,
      preview: true,
    })
  })

  it("asks a literal setter for nothing at all", () => {
    // Fixed code: what you typed would change nothing, so there is nothing to
    // type. Preview stays, because the code is the only thing to look at.
    expect(setterInputs(entry("1 (>L:Foo)"))).toEqual({
      value: false,
      current: false,
      preview: true,
    })
  })

  it("asks a JavaScript setter for what it mentions", () => {
    expect(setterInputs(entry("`${value} (>L:Foo)`"))).toMatchObject({
      value: true,
      current: false,
    })

    expect(
      setterInputs(entry("`${value > current ? 1 : 0} (>K:AP_ALT_VAR_INC)`"))
    ).toMatchObject({ value: true, current: true })
  })

  it("does not offer a field for a variable that merely looks like one", () => {
    // `L:CurrentAltitude` is not `current`, and `my_value` is not `value` —
    // word boundaries, because these are identifiers.
    expect(
      setterInputs(entry("`1 (>L:CurrentAltitude)` + `${my_value}`"))
    ).toMatchObject({ value: false, current: false })
  })

  it("offers a value field for a switch expression that reads it", () => {
    const set = [
      "switch (value) {",
      "  case 0: return '0 (>B:GUARD_Off)'",
      "}",
    ].join("\n")

    expect(setterInputs(entry(set))).toMatchObject({ value: true })
  })
})

describe("setterKind", () => {
  it("calls an absent setter implicit", () => {
    expect(setterKind(entry())).toBe("implicit")
  })

  it("agrees with the grammar about the three written forms", () => {
    expect(setterKind(entry("`${value}`"))).toBe("javascript")
    expect(setterKind(entry("(>K:FOO)"))).toBe("prepended")
    expect(setterKind(entry("1 (>L:Foo)"))).toBe("literal")
  })
})
