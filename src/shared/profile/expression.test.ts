/**
 * Which text `expressionAt` claims, and — the part that had a bug in it —
 * which text it does not.
 *
 * The guard used to read "any continuation that is not `get:`", so a `skp:`
 * value came back as an expression. Nothing downstream ran it: every other
 * caller asks for `key === "set"` or for `javascript` first. The hover does
 * not. It walks its territories in order and stops at the first one that
 * claims the line, so a `skp:` name got no hover at all.
 */

import { describe, expect, it } from "vitest"

import { expressionIn, offsetIn, positionIn } from "./expression.ts"

const profile = `shared:
  - get: A:INDICATED ALTITUDE, feet
    skp: L:ALT_MIRROR
    set: value * 2

  - get: L:GEAR
    set: |
      switch (value) {
        case 0: return '0 (>K:GEAR_SET)'
      }
`

describe("expressionAt", () => {
  it("claims a one-line set: value", () => {
    const expression = expressionIn(profile, 4)
    expect(expression?.text).toBe("value * 2")
    expect(expression?.units).toBe("feet")
  })

  it("claims a set: block scalar from its body", () => {
    const expression = expressionIn(profile, 9)
    expect(expression?.block).toBe(true)
    expect(expression?.text.startsWith("switch (value) {")).toBe(true)
  })

  it("does not claim a skp: value, which is a name and not code", () => {
    expect(expressionIn(profile, 3)).toBeNull()
  })

  it("does not claim a get: value", () => {
    expect(expressionIn(profile, 2)).toBeNull()
  })

  it("does not claim a skp: written as the first key of an entry", () => {
    const entry = `shared:
  - skp: L:ALT_MIRROR
    get: A:INDICATED ALTITUDE, feet
`
    expect(expressionIn(entry, 2)).toBeNull()
  })

  it("does not claim a block scalar opened by anything but set:", () => {
    const parked = `shared:
  - get: L:GEAR
    skp: |
      L:ALT_MIRROR
`
    expect(expressionIn(parked, 4)).toBeNull()
  })
})

/**
 * The quoting is YAML's and FS Copilot never sees it, so neither does the
 * expression. This is the whole of the fix that gave quoted setters their
 * JavaScript back: `text` is the value, and `startColumn` points at it.
 */
describe("expressionAt and YAML quoting", () => {
  const quoted = `shared:
  - get: K:2:KOHLSMAN_SET
    set: "\`\${value * 16} 2 (>K:KOHLSMAN_SET)\`"
`

  it("hands over the value, not the span", () => {
    expect(expressionIn(quoted, 3)?.text).toBe(
      "`${value * 16} 2 (>K:KOHLSMAN_SET)`"
    )
  })

  it("points startColumn inside the quote, so offsets need no shift", () => {
    const expression = expressionIn(quoted, 3)!
    // `    set: "` is 10 characters, so the value opens at column 11.
    expect(expression.startColumn).toBe(11)

    // The backtick is offset 0 and sits on column 11; `value` starts at
    // offset 2 and must land on the `v` in the document, column 13.
    expect(positionIn(expression, 0)).toEqual({ lineNumber: 3, column: 11 })
    expect(positionIn(expression, 2)).toEqual({ lineNumber: 3, column: 13 })
    expect(offsetIn(expression, 3, 13)).toBe(2)
  })

  it("judges a single-quoted literal setter by its value, not its quotes", () => {
    // `'` is a JavaScript trigger character, so reading the span rather than
    // the value made all 22 of these look like JavaScript to the editor,
    // where FS Copilot sees no trigger and sends the text as written.
    const literal = `shared:
  - get: L:AP
    set: '0 (>B:LIGHTING_ASCRJ_YOKEC_APDISC_BTN_KEY_PUSH)'
`
    const expression = expressionIn(literal, 3)!
    expect(expression.text).toBe(
      "0 (>B:LIGHTING_ASCRJ_YOKEC_APDISC_BTN_KEY_PUSH)"
    )
    expect(expression.javascript).toBe(false)
  })

  it("reads an unterminated quote raw, so a line being typed still resolves", () => {
    const typing = `shared:
  - get: L:AP
    set: "\`\${value}
`
    expect(expressionIn(typing, 3)?.text).toBe('"`${value}')
  })

  it("refuses a value YAML had to process, rather than mis-map it", () => {
    // `\\n` makes one character of value stop being one character of line,
    // so no constant offset maps between them.
    const escaped = `shared:
  - get: L:AP
    set: "a\\nb ? 1 : 0"
`
    expect(expressionIn(escaped, 3)).toBeNull()
  })
})
