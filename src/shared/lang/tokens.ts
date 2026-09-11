/**
 * The tokenizer — layer 1 of the language core (docs/sim-vars/18-language-core).
 *
 * RPN is whitespace-separated words with three island constructs: a
 * parenthesised variable reference `(A:NAME, unit)`, a single-quoted string,
 * and — because most corpus setters are JS template literals producing RPN —
 * a `${…}` hole standing for one value computed elsewhere.
 *
 * Two properties are contractual, because editors call this on half-typed
 * code at every keystroke:
 *
 * - **Never throws.** Anything unterminated becomes a token with
 *   `unterminated: true`, running to the end of the input.
 * - **Every token carries its span.** Analysis alone would not need offsets;
 *   highlighting, hover and fixes do, and retrofitting them is a rewrite.
 *
 * Invisible characters are tokens too. These files are pasted from forums,
 * and a non-breaking space or a smart quote breaks RPN while looking exactly
 * like the code that works — a rule can only say so if the tokenizer refuses
 * to smooth it over.
 */

export type TokenKind =
  /** A parenthesised reference, `(` through `)` — inner text uninterpreted here. */
  | "ref"
  /** A single-quoted string, quotes included. */
  | "string"
  /** A `${…}` hole from a JS template literal: one opaque value. */
  | "hole"
  /** A numeric literal, sign included where attached. */
  | "number"
  /** Any other whitespace-delimited run: operators, registers, keywords. */
  | "word"
  /** NBSP, zero-width characters, smart quotes — invisible or look-alike. */
  | "invisible"

export interface Token {
  kind: TokenKind
  /** Offset of the first character, in the text given to `tokenize`. */
  start: number
  /** Offset one past the last character. */
  end: number
  /** The raw slice, exactly as written. */
  text: string
  /** The island construct never closed; the token runs to end of input. */
  unterminated?: boolean
}

/**
 * The characters that pass for invisible or that masquerade as syntax:
 * NBSP, zero-width space/joiners, BOM, and curly quotes. Exported so the
 * highlighter marks them with the same definition the rule uses.
 */
export const INVISIBLE = /[ ​-‍﻿‘’“”]/

const WHITESPACE = /\s/

/**
 * A number the way RPN writes them: optional sign, digits with an optional
 * decimal part, optional exponent. Matched against the *whole* word, so
 * `40kias` and `-` stay words.
 */
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let at = 0

  const push = (kind: TokenKind, start: number, unterminated?: boolean): void => {
    tokens.push({
      kind,
      start,
      end: at,
      text: text.slice(start, at),
      ...(unterminated ? { unterminated } : {}),
    })
  }

  while (at < text.length) {
    const char = text[at]!

    // Before the whitespace test, which would otherwise swallow it:
    // JavaScript's \s matches NBSP and the BOM, the very characters this
    // token kind exists to expose.
    if (INVISIBLE.test(char)) {
      const start = at
      at += 1
      push("invisible", start)
      continue
    }

    if (WHITESPACE.test(char)) {
      at += 1
      continue
    }

    if (char === "(") {
      // To the matching close. References do not nest — nothing legal puts a
      // paren inside one — so the first `)` ends it, and a missing one is an
      // unterminated token rather than a cascade of misreads.
      const start = at
      const close = text.indexOf(")", at + 1)
      at = close === -1 ? text.length : close + 1
      push("ref", start, close === -1 ? true : undefined)
      continue
    }

    if (char === "'") {
      const start = at
      const close = text.indexOf("'", at + 1)
      at = close === -1 ? text.length : close + 1
      push("string", start, close === -1 ? true : undefined)
      continue
    }

    if (char === "$" && text[at + 1] === "{") {
      /*
       * A hole is JavaScript, and JavaScript may contain braces of its own —
       * `${on ? {a:1}.a : 0}` — so depth is tracked rather than the first `}`
       * taken. Braces inside JS *strings* would still fool this; accepted, on
       * the corpus evidence that setter expressions stay simple.
       */
      const start = at
      let depth = 0
      while (at < text.length) {
        const c = text[at]!
        if (c === "{") depth += 1
        else if (c === "}" && (depth -= 1) === 0) {
          at += 1
          break
        }
        at += 1
      }
      push("hole", start, depth > 0 ? true : undefined)
      continue
    }

    // A word: everything to the next whitespace or island start. `if{` keeps
    // its brace — RPN spells the operator that way — but a `)` never starts
    // a word, so a stray one surfaces as its own (unknown) word.
    const start = at
    while (at < text.length) {
      const c = text[at]!
      if (WHITESPACE.test(c) || c === "(" || c === "'" || INVISIBLE.test(c)) break
      if (c === "$" && text[at + 1] === "{") break
      at += 1
    }
    push(NUMBER.test(text.slice(start, at)) ? "number" : "word", start)
  }

  return tokens
}
