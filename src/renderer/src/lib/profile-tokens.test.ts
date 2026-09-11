/**
 * The token provider, driven headless — the file's own header promises it
 * runs without Monaco, and this is where that promise pays.
 *
 * Scopes are asserted as (startIndex, scope) pairs at the positions that
 * matter, not exhaustively: the provider collapses runs, and pinning every
 * boundary would turn each cosmetic tweak into test surgery.
 */

import { describe, expect, it } from "vitest"

import type * as monaco from "monaco-editor"

import { profileTokens } from "./profile-tokens"

/** Tokenizes lines in order, returning the last line's tokens. */
function tokensOf(...lines: string[]): monaco.languages.IToken[] {
  let state = profileTokens.getInitialState()
  let result: monaco.languages.ILineTokens | null = null

  for (const line of lines) {
    result = profileTokens.tokenize(line, state)
    state = result.endState
  }

  return result!.tokens
}

/** The scope painting the given column, by the last token at or before it. */
function scopeAt(tokens: monaco.languages.IToken[], column: number): string {
  let scope = ""
  for (const token of tokens) {
    if (token.startIndex > column) break
    scope = token.scopes
  }
  return scope
}

const ENTRY = ["shared:", "  - get: A:PLANE ALTITUDE, feet"]

describe("get: lines", () => {
  it("colours prefix, name, units", () => {
    const tokens = tokensOf(...ENTRY)
    const text = ENTRY[1]!

    expect(scopeAt(tokens, text.indexOf("A:"))).toBe("ref.prefix")
    expect(scopeAt(tokens, text.indexOf("PLANE"))).toBe("ref.name")
    expect(scopeAt(tokens, text.indexOf(", feet"))).toBe("ref.unit")
  })

  it("measures a long prefix with the parser, not the first letter", () => {
    const line = "  - get: L:1:MyVar"
    const tokens = tokensOf("shared:", line)

    // All four characters of `L:1:` are prefix; the name starts after.
    expect(scopeAt(tokens, line.indexOf("L:1:"))).toBe("ref.prefix")
    expect(scopeAt(tokens, line.indexOf("1:"))).toBe("ref.prefix")
    expect(scopeAt(tokens, line.indexOf("MyVar"))).toBe("ref.name")
  })
})

describe("set: expressions", () => {
  it("colours a literal RPN setter: write target and number", () => {
    const line = "    set: 1 (>L:XMLVAR_Battery)"
    const tokens = tokensOf(...ENTRY, line)

    expect(scopeAt(tokens, line.indexOf("1 "))).toBe("rpn.number")
    expect(scopeAt(tokens, line.indexOf(">"))).toBe("ref.write")
    expect(scopeAt(tokens, line.indexOf("L:"))).toBe("ref.prefix")
    expect(scopeAt(tokens, line.indexOf("XMLVAR"))).toBe("ref.target")
  })

  it("colours a read the way a get: line is coloured", () => {
    // Reads were invisible to the old regex, which knew only `(>`.
    const line = "    set: (A:LIGHT LANDING, Bool) (>L:Copy)"
    const tokens = tokensOf(...ENTRY, line)

    expect(scopeAt(tokens, line.indexOf("A:"))).toBe("ref.prefix")
    expect(scopeAt(tokens, line.indexOf("LIGHT"))).toBe("ref.name")
    expect(scopeAt(tokens, line.indexOf(", Bool"))).toBe("ref.unit")
    expect(scopeAt(tokens, line.indexOf("L:Copy"))).toBe("ref.prefix")
  })

  it("paints the strings of a JavaScript setter as RPN", () => {
    // Every string in a JavaScript setter is a program fragment — the
    // corpus has no comparison operands — so the body inside the quotes is
    // painted as RPN, and a YAML-quoted value is unquoted before the kind
    // is decided. The adapter passes the shared verdict through unchanged.
    const line = "    set: \"value ? '(>K:AP_HDG_HOLD_ON)' : 'OFF'\""
    const tokens = tokensOf(...ENTRY, line)

    expect(scopeAt(tokens, line.indexOf("value"))).toBe("js.injected")
    expect(scopeAt(tokens, line.indexOf(">K"))).toBe("ref.write")
    expect(scopeAt(tokens, line.indexOf("AP_HDG"))).toBe("ref.target")
    expect(scopeAt(tokens, line.indexOf("OFF"))).toBe("rpn.word")
  })

  it("keeps JavaScript's own parens as JavaScript", () => {
    const line = '    set: "`${Math.round(value)} (>L:X)`"'
    const tokens = tokensOf(...ENTRY, line)

    expect(scopeAt(tokens, line.indexOf("("))).toBe("js.delimiter")
    expect(scopeAt(tokens, line.indexOf("value"))).toBe("js.injected")
  })

  it("carries a K:2: arity as prefix, and units inside a write", () => {
    const line = "    set: `3 ${value * 16} (>K:2:KOHLSMAN_SET)`"
    const tokens = tokensOf(...ENTRY, line)

    expect(scopeAt(tokens, line.indexOf("K:2:"))).toBe("ref.prefix")
    expect(scopeAt(tokens, line.indexOf("2:K"))).toBe("ref.prefix")
    expect(scopeAt(tokens, line.indexOf("KOHLSMAN"))).toBe("ref.target")
    // The hole interior is code again.
    expect(scopeAt(tokens, line.indexOf("value"))).toBe("js.injected")
  })

  it("survives an unterminated ref mid-keystroke", () => {
    // The Albatross bug's shape, and every ref while it is being typed.
    const line = "    set: (>B:INSTRUMENT_IE_HU16_CB_NAV_2_Toggle"
    const tokens = tokensOf(...ENTRY, line)

    expect(scopeAt(tokens, line.indexOf("B:"))).toBe("ref.prefix")
    expect(scopeAt(tokens, line.indexOf("INSTRUMENT"))).toBe("ref.target")
  })

  it("makes invisible characters loud", () => {
    const line = "    set: 1 (>L:X)"
    const tokens = tokensOf(...ENTRY, line)

    expect(scopeAt(tokens, line.indexOf(" "))).toBe("invalid.invisible")
    expect(scopeAt(tokens, line.indexOf("L:X"))).toBe("ref.prefix")
  })
})
