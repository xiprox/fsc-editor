/**
 * Reading a scalar's value back out of the line it was written on.
 *
 * The pair is easy to confuse and the two answers differ by exactly the
 * quotes: `plainValue` says how much of the line the scalar occupies, and
 * `scalarValue` says what it means. Anything that runs the text wants the
 * second one.
 */

import { describe, expect, it } from "vitest"

import { plainValue, scalarValue, valueSlice } from "./grammar.ts"
import { offsetIn, positionIn } from "./expression.ts"

describe("plainValue", () => {
  it("drops a trailing comment from a plain scalar", () => {
    expect(plainValue("(>K:TOGGLE) # the guarded one")).toBe("(>K:TOGGLE)")
  })

  it("keeps the quotes, because it measures rather than reads", () => {
    expect(plainValue('"`${value}`"')).toBe('"`${value}`"')
  })
})

describe("scalarValue", () => {
  it("reads a plain scalar the way plainValue does", () => {
    expect(scalarValue("(>K:TOGGLE) # the guarded one")).toBe("(>K:TOGGLE)")
  })

  it("takes the quotes off a double-quoted scalar", () => {
    expect(scalarValue('"`${value} (>H:Beacon_Toggle)`"')).toBe(
      "`${value} (>H:Beacon_Toggle)`"
    )
  })

  it("keeps a # inside quotes and drops the comment after them", () => {
    // The CRJ guards carry a banner of them inside the value itself.
    expect(scalarValue('"### (>K:FOO)" # a note')).toBe("### (>K:FOO)")
  })

  it("takes the quotes off a single-quoted scalar", () => {
    expect(scalarValue("'1 (>K:STARTER1_SET)' # STARTER1_SET")).toBe(
      "1 (>K:STARTER1_SET)"
    )
  })

  it("reads '' as the one quote a single-quoted scalar can hold", () => {
    expect(scalarValue("'it''s'")).toBe("it's")
  })

  it("resolves the escapes a double-quoted scalar can hold", () => {
    expect(scalarValue('"a\\"b\\\\c\\td"')).toBe('a"b\\c\td')
    expect(scalarValue('"\\u2713 \\x41"')).toBe("\u2713 A")
  })

  it("keeps the character an unknown escape escaped", () => {
    // YAML calls it an error. Refusing to read the rest of the line over it
    // would be the worse answer while somebody is still typing.
    expect(scalarValue('"a\\qb"')).toBe("aqb")
    expect(scalarValue('"a\\u00zz"')).toBe("au00zz")
  })

  it("reads an unterminated quote as everything after it", () => {
    expect(scalarValue('"`${value}')).toBe("`${value}")
    expect(scalarValue("'half")).toBe("half")
  })
})

describe("valueSlice", () => {
  it("gives a plain scalar back at offset 0", () => {
    expect(valueSlice("(>K:TOGGLE) # the guarded one")).toEqual({
      value: "(>K:TOGGLE)",
      at: 0,
    })
  })

  it("steps one past the opening quote of a clean pair", () => {
    expect(valueSlice('"`${value}`"')).toEqual({ value: "`${value}`", at: 1 })
    expect(valueSlice("'0 (>K:X)'")).toEqual({ value: "0 (>K:X)", at: 1 })
  })

  it("reads an unterminated quote raw rather than guessing", () => {
    expect(valueSlice('"`${value}')).toEqual({ value: '"`${value}', at: 0 })
  })

  it("refuses a double-quoted value with an escape in it", () => {
    // Two characters on the line, one in the value — so no constant offset
    // maps between them.
    expect(valueSlice('"a\\nb"')).toBeNull()
  })

  it("refuses a single-quoted value with a doubled quote in it", () => {
    // The case a backslash check misses: `''` is how single-quoted YAML
    // spells one quote, and it shortens the value by a character.
    expect(valueSlice("'it''s'")).toBeNull()
  })
})

describe("positionIn", () => {
  it("inverts offsetIn across a block scalar, byte for byte", () => {
    // Two body lines under a `set: |` at indent 4, stripped to 6.
    const expression = {
      text: "switch (value) {\n  case 0: return ''\n}",
      startLine: 10,
      startColumn: 7,
      strippedIndent: 6,
      block: true,
      javascript: true,
      units: "",
    }

    for (const offset of [0, 5, 16, 17, 20, 36, 37, 38]) {
      const position = positionIn(expression, offset)
      expect(
        offsetIn(expression, position.lineNumber, position.column),
        `offset ${offset}`
      ).toBe(offset)
    }
  })

  it("maps a one-line expression by plain arithmetic", () => {
    const expression = {
      text: "1 (>L:X)",
      startLine: 3,
      startColumn: 10,
      strippedIndent: 0,
      block: false,
      javascript: false,
      units: "",
    }

    expect(positionIn(expression, 3)).toEqual({ lineNumber: 3, column: 13 })
  })
})
