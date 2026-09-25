/**
 * The painters — colour for one stretch of program text.
 *
 * Two languages meet in a `set:` value, and the corpus (see *Highlighting v2*
 * in docs/sim-vars/18-language-core.md) says how: every literal and
 * prepended setter is RPN, and every JavaScript setter is JavaScript whose
 * string literals are RPN programs — 7,637 of the corpus's 8,700 strings,
 * and not one comparison operand among them. So there are two painters that
 * call each other: `paintRpn` over the language core's tokens, and a small
 * JavaScript lexer whose string and template bodies hand off to `paintRpn`
 * and whose `${…}` holes hand back.
 *
 * Where the painter is inside the text is a stack of frames, and the stack
 * is what a line tokenizer carries to the next line — a template literal or
 * a block comment that did not close is the normal state of a block scalar
 * mid-keystroke, and eight corpus setters keep a template open across lines
 * on purpose.
 *
 * Nothing here decides *whether* a stretch of text is a program; `line.ts`
 * does, from the grammar. Nothing here throws: the core's tokenizer never
 * does, and the lexer below only ever advances.
 */

import {
  INVISIBLE,
  parseRef,
  stackEffectOf,
  tokenize,
  type Token,
} from "../lang/index.ts"
import { parseVar } from "../vars/parse.ts"
import type { Scope } from "./scopes.ts"

export interface Span {
  /** Offset of the first character, in the line handed to the highlighter. */
  start: number
  scope: Scope
}

/** Collects spans, collapsing runs that share a scope. */
export class Spans {
  readonly list: Span[] = []

  push(start: number, scope: Scope): void {
    const last = this.list[this.list.length - 1]
    if (last && last.scope === scope) return
    if (last && last.start === start) {
      last.scope = scope
      return
    }
    this.list.push({ start, scope })
  }
}

/**
 * Where the painter is.
 *
 * - `rpn` — a literal or prepended setter: the whole text is the program.
 * - `js` — JavaScript code, counting braces so a `}` closes an interpolation
 *   hole only when it is not closing something the code opened.
 * - `string` — inside a quoted JavaScript string; the body is RPN.
 * - `template` — inside a template literal; the body is RPN with holes.
 * - `comment` — inside a block comment.
 */
export type Frame =
  | { mode: "rpn" }
  | { mode: "js"; depth: number }
  | { mode: "string"; quote: "'" | '"' }
  | { mode: "template" }
  | { mode: "comment" }

export const RPN: Frame = { mode: "rpn" }
export const JS: Frame = { mode: "js", depth: 0 }

export function framesEqual(a: Frame[], b: Frame[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index++) {
    const x = a[index]!
    const y = b[index]!
    if (x.mode !== y.mode) return false
    if (x.mode === "js" && y.mode === "js" && x.depth !== y.depth) return false
    if (x.mode === "string" && y.mode === "string" && x.quote !== y.quote)
      return false
  }
  return true
}

// ------------------------------------------------------------------- refs

/**
 * One `( … )` reference, coloured from its parsed anatomy.
 *
 * The language core supplies both halves: `tokenize` finds the token's
 * extent — including an unterminated one running to end of line, which is
 * every reference mid-keystroke — and `parseRef` names its parts. A write's
 * name is the target; a read's name is painted as a `get:` line paints it,
 * because that is what it echoes.
 */
export function paintRef(token: Token, base: number, out: Spans): void {
  const node = parseRef(token)
  const text = token.text

  out.push(base, "ref.delimiter")

  const write = node.access === "write"
  let inner = 1
  if (write) {
    const arrow = text.indexOf(">")
    out.push(base + arrow, "ref.write")
    inner = arrow + 1
  }

  // Between the opener and the name sits the written prefix — `A:`, `K:2:`,
  // `L:1:` — however many characters it took. The shared parser measures
  // it, which a first-letter split cannot.
  const name = node.ref.ns === null ? "" : node.ref.name
  const nameAt = name ? text.indexOf(name, inner) : -1
  const nameScope: Scope = write ? "ref.target" : "ref.name"

  if (nameAt > inner) {
    out.push(base + inner, "ref.prefix")
    out.push(base + nameAt, nameScope)
  } else {
    // A bare or unparseable interior is all name.
    out.push(base + inner, nameScope)
  }

  const comma = text.indexOf(",")
  if (comma !== -1) out.push(base + comma, "ref.unit")

  if (!token.unterminated) out.push(base + text.length - 1, "ref.delimiter")
}

/** `A:CIRCUIT CONNECTION ON:1, Bool` — the value of a `get:` or `skp:`. */
export function paintName(text: string, base: number, out: Spans): void {
  const comma = text.indexOf(",")
  const field = comma === -1 ? text : text.slice(0, comma)
  const name = field.trim()
  const nameAt = base + field.indexOf(name)

  const ref = parseVar(name)
  const prefixLength =
    ref.ns === null || !ref.name ? 0 : name.indexOf(ref.name)

  if (prefixLength > 0) {
    out.push(nameAt, "ref.prefix")
    out.push(nameAt + prefixLength, "ref.name")
  } else {
    out.push(nameAt, "ref.name")
  }

  if (comma !== -1) out.push(base + comma, "ref.unit")
}

// -------------------------------------------------------------------- RPN

/** `if{`, `els{`, `}` — the calculator's whole notion of control flow. */
const FLOW = new Set(["if{", "els{", "}"])

/** `s0`–`s49` store-keep, `sp0`–`sp49` store-pop, `l0`–`l49` load. */
const REGISTER = /^(s|sp|l)([0-9]|[1-4][0-9])$/i

function wordScope(word: string): Scope {
  if (FLOW.has(word.toLowerCase())) return "rpn.flow"
  if (REGISTER.test(word)) return "rpn.register"
  if (stackEffectOf(word)) return "rpn.operator"
  // Unknown to the operator table. Diagnostics own the verdict on whether
  // that is a mistake; here it is a word, painted as one.
  return "rpn.word"
}

/**
 * One stretch of RPN, painted from the language core's tokens.
 *
 * Every token gets its scope and the gap after it goes back to plain, so a
 * span never runs past the token it names.
 */
export function paintRpn(text: string, base: number, out: Spans): void {
  for (const token of tokenize(text)) {
    const at = base + token.start

    switch (token.kind) {
      case "ref":
        paintRef(token, at, out)
        break
      case "number":
        out.push(at, "rpn.number")
        break
      case "string":
        out.push(at, "rpn.string")
        break
      case "invisible":
        out.push(at, "invalid.invisible")
        break
      // A `${…}` inside a *quoted* string is not an interpolation — the
      // template painter splits real holes off before the RPN sees them —
      // so it is text the calculator will read as a word.
      case "hole":
        out.push(at, "rpn.word")
        break
      case "word":
        out.push(at, wordScope(token.text))
        break
    }

    out.push(base + token.end, "")
  }
}

// ------------------------------------------------------------- JavaScript

const JS_KEYWORDS = new Set([
  "break",
  "case",
  "const",
  "default",
  "else",
  "false",
  "function",
  "if",
  "let",
  "new",
  "null",
  "return",
  "switch",
  "true",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
])

/** The only identifiers FS Copilot puts in scope for a `set:` expression. */
const INJECTED = new Set(["value", "current"])

const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/iy
const IDENTIFIER = /[A-Za-z_$][\w$]*/y
const DELIMITER = /[()[\]]/y
const OPERATOR = /[=<>!?:+\-*/%&|^~,;.]/y

function matchAt(pattern: RegExp, text: string, at: number): string | null {
  pattern.lastIndex = at
  return pattern.exec(text)?.[0] ?? null
}

/** The index of the quote that closes a string body starting at `from`. */
function closeOfString(text: string, from: number, quote: string): number {
  for (let at = from; at < text.length; at++) {
    if (text[at] === "\\") {
      at += 1
      continue
    }
    if (text[at] === quote) return at
  }
  return -1
}

type TemplateStop =
  | { kind: "close"; at: number }
  | { kind: "hole"; at: number }
  | { kind: "end"; at: number }

/** Where a template body ends on this line: its backtick, a hole, or EOL. */
function stopOfTemplate(text: string, from: number): TemplateStop {
  for (let at = from; at < text.length; at++) {
    const char = text[at]
    if (char === "\\") {
      at += 1
      continue
    }
    if (char === "`") return { kind: "close", at }
    if (char === "$" && text[at + 1] === "{") return { kind: "hole", at }
  }
  return { kind: "end", at: text.length }
}

/**
 * One step of the JavaScript lexer: reports what starts at `at` and returns
 * where to continue. Pushes a frame when a string, template or block
 * comment opens; pops one when a `}` closes the interpolation hole the
 * template above it opened.
 */
function stepJs(
  text: string,
  at: number,
  base: number,
  stack: Frame[],
  to: CodeListener
): number {
  const char = text[at]!
  const top = stack[stack.length - 1] as Extract<Frame, { mode: "js" }>

  // Invisible characters get the loudest scope there is — the whole point
  // is that nothing else shows them.
  if (INVISIBLE.test(char)) {
    to.mark(base + at, "invalid.invisible")
    return at + 1
  }

  if (text.startsWith("//", at)) {
    to.mark(base + at, "js.comment")
    return text.length
  }

  if (text.startsWith("/*", at)) {
    to.mark(base + at, "js.comment")
    stack.push({ mode: "comment" })
    return at + 2
  }

  if (char === "'" || char === '"') {
    to.mark(base + at, "js.quote")
    stack.push({ mode: "string", quote: char })
    return at + 1
  }

  if (char === "`") {
    to.mark(base + at, "js.quote")
    stack.push({ mode: "template" })
    return at + 1
  }

  if (char === "(") {
    // A reference sitting in bare JavaScript is not JavaScript, but people
    // write them, and a namespace or the `>` says which is meant.
    // JavaScript's own parens — `Math.round(value)`, a grouped ternary —
    // stay JavaScript, lexed below.
    const [token] = tokenize(text.slice(at))
    if (token && token.kind === "ref") {
      const node = parseRef(token)
      if (node.access === "write" || node.ref.ns !== null) {
        to.ref(token, base + at)
        return at + token.end
      }
    }
  }

  if (char === "{") {
    to.mark(base + at, "js.delimiter")
    stack[stack.length - 1] = { mode: "js", depth: top.depth + 1 }
    return at + 1
  }

  if (char === "}") {
    const below = stack[stack.length - 2]
    if (top.depth === 0 && below?.mode === "template") {
      to.mark(base + at, "js.hole")
      stack.pop()
      return at + 1
    }
    to.mark(base + at, "js.delimiter")
    stack[stack.length - 1] = { mode: "js", depth: Math.max(0, top.depth - 1) }
    return at + 1
  }

  const number = matchAt(NUMBER, text, at)
  if (number) {
    to.mark(base + at, "js.number")
    return at + number.length
  }

  const identifier = matchAt(IDENTIFIER, text, at)
  if (identifier) {
    to.mark(
      base + at,
      INJECTED.has(identifier)
        ? "js.injected"
        : JS_KEYWORDS.has(identifier)
          ? "js.keyword"
          : "js.identifier"
    )
    return at + identifier.length
  }

  if (matchAt(DELIMITER, text, at)) {
    to.mark(base + at, "js.delimiter")
    return at + 1
  }

  if (matchAt(OPERATOR, text, at)) {
    to.mark(base + at, "js.operator")
    return at + 1
  }

  to.mark(base + at, "")
  return at + 1
}

// ------------------------------------------------------------------- walk

/**
 * What the walk reports as it goes.
 *
 * The walk is the authority on where RPN is inside a setter — which stretches
 * are the calculator's and which are JavaScript's — and painting is only one
 * of the things that needs to know. The corpus scan asks which references a
 * setter names, and completion asks which one the caret is in. Both listen to
 * this walk rather than keeping a model of their own, so neither can disagree
 * with what the editor paints. `collectRefs` did keep its own, and read every
 * JavaScript parenthesis in the corpus as a reference: 1,346 of them.
 */
export interface CodeListener {
  /** A stretch of RPN: a whole literal setter, or a string or template body. */
  rpn(text: string, base: number): void
  /** A reference written straight into JavaScript — `(>K:FOO)` outside quotes. */
  ref(token: Token, base: number): void
  /** A JavaScript token, a delimiter, or the plain text between them. */
  mark(start: number, scope: Scope): void
}

/**
 * Walks one line of program text starting in the given frames, and returns
 * the frames the next line starts in.
 *
 * The RPN frame is total — a literal or prepended setter is RPN to the end
 * of its line, and there is no next line. Every other frame can end on the
 * line or run off it.
 */
export function walkCode(
  text: string,
  base: number,
  frames: Frame[],
  to: CodeListener
): Frame[] {
  const stack = frames.length ? [...frames] : [JS]
  let at = 0

  while (at < text.length) {
    const top = stack[stack.length - 1]!

    switch (top.mode) {
      case "rpn":
        to.rpn(text.slice(at), base + at)
        at = text.length
        break

      case "js":
        at = stepJs(text, at, base, stack, to)
        break

      case "string": {
        const close = closeOfString(text, at, top.quote)
        const end = close === -1 ? text.length : close
        to.rpn(text.slice(at, end), base + at)
        if (close === -1) {
          at = text.length
        } else {
          to.mark(base + close, "js.quote")
          stack.pop()
          at = close + 1
        }
        break
      }

      case "template": {
        const stop = stopOfTemplate(text, at)
        to.rpn(text.slice(at, stop.at), base + at)
        if (stop.kind === "close") {
          to.mark(base + stop.at, "js.quote")
          stack.pop()
          at = stop.at + 1
        } else if (stop.kind === "hole") {
          to.mark(base + stop.at, "js.hole")
          stack.push({ mode: "js", depth: 0 })
          at = stop.at + 2
        } else {
          at = text.length
        }
        break
      }

      case "comment": {
        const close = text.indexOf("*/", at)
        to.mark(base + at, "js.comment")
        if (close === -1) {
          at = text.length
        } else {
          stack.pop()
          at = close + 2
        }
        break
      }
    }
  }

  return stack
}

// ------------------------------------------------------------------ entry

/**
 * Paints one line of program text starting in the given frames, and returns
 * the frames the next line starts in — the walk, with the painter listening.
 */
export function paintCode(
  text: string,
  base: number,
  frames: Frame[],
  out: Spans
): Frame[] {
  return walkCode(text, base, frames, {
    rpn: (stretch, at) => paintRpn(stretch, at, out),
    ref: (token, at) => paintRef(token, at, out),
    mark: (start, scope) => out.push(start, scope),
  })
}
