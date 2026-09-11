/**
 * The line grammar of an FS Copilot profile — the single description of the
 * format that every feature reads from. See docs/profile-format.md.
 *
 * A profile is never parsed into a YAML document: the comments carry the
 * documentation, and commented-out entries are a real authoring mechanism, so
 * a round trip through any serializer would destroy the file's meaning. What
 * stands in for the AST is this — one classifier that decides what a line is,
 * plus a small state carrying the little context a line cannot supply for
 * itself.
 *
 * Everything downstream folds over `scanLines` and switches on `kind`: the
 * formatter, the outline, the variable scanner, auto-indent, completions,
 * highlighting. Nothing outside this file writes a regex for the format. That
 * is the whole point — the same construct used to be described independently
 * in six places, and the copies drifted apart faster than the bugs could be
 * patched.
 *
 * Reading is lenient, writing is strict: a line this does not recognize comes
 * back as `unknown` and is passed through untouched rather than rejected.
 */

/** Indentation of the `- ` that opens an entry. */
export const ENTRY_INDENT = 2

/** Indentation of `set:` and `skp:` under their entry. */
export const CONTINUATION_INDENT = 4

/** How far a block scalar's body sits in from its key. */
export const BODY_INDENT = 2

export const HEADING_WIDTH = 78

/**
 * The top-level keys FS Copilot understands. Reading accepts any key here —
 * `known` records whether it is one of these — but this list is what the
 * schema, the completions and the highlighter are all generated from.
 */
export const BLOCKS = ["shared", "master", "include", "ignore", "pointer"] as const
export type BlockName = (typeof BLOCKS)[number]

/** Blocks whose sequence items are entries rather than plain strings. */
export const ENTRY_BLOCKS = ["shared", "master"] as const
export type EntryBlock = (typeof ENTRY_BLOCKS)[number]

export function isEntryBlock(name: string | null): name is EntryBlock {
  return name !== null && (ENTRY_BLOCKS as readonly string[]).includes(name)
}

/** The key that opens an entry, and the keys that continue one. */
export const ENTRY_KEY = "get"
export const CONTINUATION_KEYS = ["set", "skp"] as const
export type ContinuationKey = (typeof CONTINUATION_KEYS)[number]

const SECTION_RULE = "═"
const SUBSECTION_RULE = "─"

// ── The grammar itself ──────────────────────────────────────────────────────
// One regex per construct. These are the only ones in the codebase.

/** A comment, capturing indentation and the body after `#` and one space. */
const COMMENT = /^([ \t]*)#[ \t]?(.*)$/

/**
 * Rule run, a space, a title, and an optional closing run. Box-drawing rules
 * need two characters, ASCII rules three — `# -- note` is prose, and the
 * existing profiles already write `# ── TITLE ──` with two.
 */
const HEADING =
  /^(?:(?<section>═{2,}|={3,})|(?<subsection>─{2,}|-{3,}))[ \t]+(?<title>\S.*?)[ \t]*(?:[═=─-]{2,})?$/

/** A comment made only of rule characters: a visual divider, not a heading. */
const DIVIDER = /^[═=─-]{2,}$/

/** `# Author: xip` in the header block. */
const HEADER_META = /^([A-Za-z][\w ]*):[ \t]*(.*)$/

/**
 * A comment that is really a parked entry rather than prose. Moving a variable
 * between `shared` and `master` by commenting one copy out is a documented
 * authoring idiom, so these must not be mistaken for documentation of whatever
 * entry follows them.
 */
const PARKED = new RegExp(
  `^-[ \\t]|^-?[ \\t]*(?:${[ENTRY_KEY, ...CONTINUATION_KEYS, ...BLOCKS].join("|")})[ \\t]*:`
)

/**
 * A parked key that opened a block scalar — `#   set: >`. The lines under
 * it, indented past the key, are the scalar's body: code someone left in
 * place, exactly as the key is, and not prose about whatever follows.
 */
const PARKED_SCALAR = new RegExp(
  `^(-[ \\t]+)?(?:${[ENTRY_KEY, ...CONTINUATION_KEYS].join("|")})[ \\t]*:[ \\t]*[|>][-+]?\\d*[ \\t]*(?:#.*)?$`
)

/** A top-level `key:` opening a block. A trailing comment is allowed. */
const BLOCK_KEY = /^([A-Za-z_][\w-]*):[ \t]*(?:#.*)?$/

/** A sequence item. The space after the dash is required — `-x` is a scalar. */
const SEQUENCE = /^([ \t]*)-([ \t]+)?(.*)$/

/**
 * `key: value` or a bare `key:`. The space after the colon is required when
 * there is a value, because YAML reads `set:x` as the plain scalar "set:x".
 */
const KEY_VALUE = /^([\w$@.-]+)[ \t]*:(?:[ \t]+(.*))?$/

/** A block scalar indicator, with optional chomping and indentation digits. */
const SCALAR = /^([|>])([-+]?\d*|\d*[-+]?)[ \t]*(?:#.*)?$/

export type HeadingLevel = 1 | 2

export interface ScalarHeader {
  indicator: "|" | ">"
  chomp: "" | "-" | "+"
  /**
   * An explicit indentation indicator (`|2`). It makes the body's columns
   * absolute, so a body carrying one can never be re-indented.
   */
  explicitIndent: number | null
}

/**
 * The context a line sits in — the part of its meaning that is not on the line.
 * Always the state *before* the line it is attached to.
 */
export interface ScanState {
  /** The comment block before the first line of YAML. */
  inHeader: boolean
  /** Innermost top-level block, or null before the first one. */
  block: string | null
  section: string | null
  subsection: string | null
  /** Column of the key that opened the block scalar we are inside, if any. */
  scalarKeyColumn: number | null
  /**
   * Whether an entry is still open above — `- get:` with its `set:` and `skp:`
   * not yet finished.
   *
   * A blank line ends it. That is the whole convention: entries are written as
   * contiguous groups, so a gap means the author moved on, and after one the
   * editor should offer to start an entry rather than continue the last.
   */
  entryOpen: boolean
  /** Net bracket depth inside the current block scalar body. */
  scalarDepth: number
  /** Whether the current block scalar body has opened a bracket at all. */
  scalarOpened: boolean
  /**
   * Column, within the comment body, of a parked key that opened a block
   * scalar — while the commented-out lines under it are still its body. The
   * same rule as `scalarKeyColumn`, one `#` to the right: a comment indented
   * past the column is body, and anything else ends it.
   */
  parkedScalarColumn: number | null
}

export function initialState(): ScanState {
  return {
    inHeader: true,
    block: null,
    section: null,
    subsection: null,
    scalarKeyColumn: null,
    entryOpen: false,
    scalarDepth: 0,
    scalarOpened: false,
    parkedScalarColumn: null,
  }
}

/** Top-level blocks the document already declares. */
export function blocksIn(lines: Line[]): Set<string> {
  const names = new Set<string>()
  for (const line of lines) if (line.kind === "blockKey") names.add(line.name)

  return names
}

interface Base {
  /** 1-based line number. */
  number: number
  /** The raw line, exactly as it appears. */
  text: string
  /** Columns of leading whitespace. */
  indent: number
  /**
   * Column the line's key starts at. Equal to `indent` except after a `- `,
   * where the dash and its space push the key right. This, not `indent`, is
   * what a block scalar body has to sit inside of.
   */
  keyColumn: number
  context: ScanState
}

export interface BlankLine extends Base {
  kind: "blank"
}
export interface HeadingLine extends Base {
  kind: "heading"
  level: HeadingLevel
  title: string
}
export interface DividerLine extends Base {
  kind: "divider"
}
export interface HeaderMetaLine extends Base {
  kind: "headerMeta"
  key: string
  value: string
}
export interface ParkedLine extends Base {
  kind: "parked"
  body: string
  /** Columns of whitespace between the `# ` and the body. */
  bodyIndent: number
}
export interface ProseLine extends Base {
  kind: "prose"
  body: string
}
export interface BlockKeyLine extends Base {
  kind: "blockKey"
  name: string
  known: boolean
}
export interface EntryLine extends Base {
  kind: "entry"
  key: string
  value: string
  /** Raw text from the key to end of line, for lossless re-emission. */
  rest: string
  scalar: ScalarHeader | null
}
export interface ContinuationLine extends Base {
  kind: "continuation"
  key: ContinuationKey
  value: string
  rest: string
  scalar: ScalarHeader | null
}
export interface SequenceItemLine extends Base {
  kind: "sequenceItem"
  value: string
}
/** An indented `key: value` that is not a recognized continuation. */
export interface MappingLine extends Base {
  kind: "mapping"
  key: string
  value: string
  rest: string
  scalar: ScalarHeader | null
}
export interface ScalarBodyLine extends Base {
  kind: "scalarBody"
  keyColumn: number
}
export interface UnknownLine extends Base {
  kind: "unknown"
}

export type Line =
  | BlankLine
  | HeadingLine
  | DividerLine
  | HeaderMetaLine
  | ParkedLine
  | ProseLine
  | BlockKeyLine
  | EntryLine
  | ContinuationLine
  | SequenceItemLine
  | MappingLine
  | ScalarBodyLine
  | UnknownLine

export type LineKind = Line["kind"]

/** Lines that carry a `key: value`, whatever their position. */
export type KeyedLine = EntryLine | ContinuationLine | MappingLine

export function isKeyed(line: Line): line is KeyedLine {
  return (
    line.kind === "entry" ||
    line.kind === "continuation" ||
    line.kind === "mapping"
  )
}

export function indentOf(text: string): number {
  return text.length - text.trimStart().length
}

/**
 * How FS Copilot applies a `set:` value.
 *
 * - `javascript` — evaluated by Jint, with `value` and `current` in scope. The
 *   result of the expression is the complete string to execute.
 * - `prepended` — the incoming value is put in front, so `(>K:EVENT)` is sent
 *   as `<value> (>K:EVENT)`.
 * - `literal` — sent exactly as written.
 */
export type SetKind = "javascript" | "prepended" | "literal"

/**
 * The trigger is exact, from `Definition.Set` in FS Copilot:
 *
 *     if (_set.IndexOfAny(['\'', '`', '?', '{', '}']) >= 0)
 *
 * Note what is *not* in it. A double quote never triggers evaluation — YAML
 * strips its own quoting long before FS Copilot sees the value — and `?` does,
 * for ternaries. Anything written down as "quotes or braces" is wrong in both
 * directions.
 */
const JAVASCRIPT_TRIGGER = /['`?{}]/

export function setKind(value: string): SetKind {
  if (JAVASCRIPT_TRIGGER.test(value)) return "javascript"
  return value.trimStart().startsWith("(") ? "prepended" : "literal"
}

/** Whether a `set:` value is handed to the JavaScript engine. */
export function isJavaScript(value: string): boolean {
  return setKind(value) === "javascript"
}

/**
 * `A:`, `L:`, `K:`, `H:`, `B:` — the namespace a variable name opens with.
 * FS Copilot defaults an unprefixed name to a simvar.
 */
const VARIABLE_PREFIX = /^[A-Za-z]:/

/** Splits a variable name into its namespace prefix and the rest. */
export function splitPrefix(name: string): { prefix: string; rest: string } {
  const match = VARIABLE_PREFIX.exec(name)

  return match
    ? { prefix: match[0], rest: name.slice(match[0].length) }
    : { prefix: "", rest: name }
}

/**
 * The value of a plain scalar, with any trailing comment removed.
 *
 * YAML strips ` # comment` from a plain scalar but keeps it inside a quoted
 * one — which matters here, because `set:` expressions routinely contain a
 * literal `#`.
 */
export function plainValue(raw: string): string {
  const trimmed = raw.trim()
  const quote = trimmed[0]

  if (quote === "'" || quote === '"') {
    const end = trimmed.indexOf(quote, 1)
    return end === -1 ? trimmed : trimmed.slice(0, end + 1)
  }

  return trimmed.replace(/\s+#.*$/, "").trim()
}

/**
 * The escapes a double-quoted YAML scalar can carry, in full.
 *
 * Not one of them appears in the corpus — a `set:` expression is quoted to get
 * a backtick past the parser, not to spell a tab — so this is written out once,
 * completely, rather than reduced to the two anybody has actually typed and
 * then quietly wrong the first time somebody types a third.
 */
const DOUBLE_ESCAPES: Record<string, string> = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1b",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\x85",
  _: "\xa0",
  L: "\u2028",
  P: "\u2029",
}

/** `\xXX`, `\uXXXX`, `\UXXXXXXXX` — the three widths YAML spells a codepoint in. */
const HEX_ESCAPES: Record<string, number> = { x: 2, u: 4, U: 8 }

const HEX = /^[0-9a-fA-F]+$/

/** The body of a double-quoted scalar, with its escapes resolved. */
function unescape(body: string): string {
  let out = ""

  for (let at = 0; at < body.length; at++) {
    const char = body[at]
    if (char !== "\\") {
      out += char
      continue
    }

    const code = body[++at]
    // A backslash at the very end is somebody mid-keystroke, not an escape.
    if (code === undefined) return out + "\\"

    const width = HEX_ESCAPES[code]
    if (width) {
      const digits = body.slice(at + 1, at + 1 + width)
      if (digits.length === width && HEX.test(digits)) {
        out += String.fromCodePoint(Number.parseInt(digits, 16))
        at += width
        continue
      }
    }

    // An unknown escape keeps the character it escaped. YAML calls that an
    // error; refusing to read the rest of a line over it would be worse.
    out += DOUBLE_ESCAPES[code] ?? code
  }

  return out
}

/**
 * The *value* of a scalar: what a YAML parser hands FS Copilot.
 *
 * `plainValue` answers a different question — how much of the line the scalar
 * occupies — and for a quoted one it answers with the quotes attached. That is
 * right for measuring a span and wrong for anything that then *runs* the text:
 * **6,030 of the corpus's one-line `set:` values are double-quoted**, 5,559 of
 * them because the expression opens with a backtick, which cannot open a plain
 * scalar. Evaluating one of those with its quotes still on it produces the
 * source text instead of the calculator code it was written to produce.
 *
 * Only `set:` is ever quoted across the 65 installed profiles — not one `get:`
 * or `skp:` line is — but the question is about scalars, not about which key
 * they hang off.
 */
export function scalarValue(raw: string): string {
  const trimmed = raw.trim()
  const quote = trimmed[0]
  if (quote !== "'" && quote !== '"') return plainValue(trimmed)

  let body = ""

  for (let at = 1; at < trimmed.length; at++) {
    const char = trimmed[at]

    if (char === quote) {
      // `''` is how a single-quoted scalar writes one quote. A double-quoted
      // one escapes with a backslash, so a bare `"` always ends it.
      if (quote === "'" && trimmed[at + 1] === "'") {
        body += "'"
        at++
        continue
      }

      return quote === '"' ? unescape(body) : body
    }

    // Carried as a pair rather than resolved here: `\"` must not be mistaken
    // for the closing quote by the check above.
    if (quote === '"' && char === "\\" && at + 1 < trimmed.length) {
      body += char + trimmed[++at]
      continue
    }

    body += char
  }

  // Unterminated, which is a line being typed. Everything after the opening
  // quote is the best reading of it, and keeps a preview working meanwhile.
  return quote === '"' ? unescape(body) : body
}

/**
 * The third member of the pair above: *where* the value sits inside the span.
 *
 * `plainValue` measures and `scalarValue` reads; anything that both runs the
 * text and then points at a position in it needs the offset between the two.
 * Without it every caller invents its own, which is how the hover and the
 * completions came to be handed a `set:` value with its quotes still on —
 * a string literal where the JavaScript was supposed to be.
 *
 * `at` is a column shift and nothing more, so it only exists when the value
 * really is a verbatim slice of the span. It is not whenever YAML had work to
 * do — `\n` in a double-quoted scalar, `''` in a single-quoted one — because
 * then one character of value is not one character of line and no constant
 * maps between them. That returns `null`: the caller should say nothing
 * rather than underline the wrong characters. Not one of the corpus's 6,039
 * quoted `set:` values is in that position.
 */
export function valueSlice(raw: string): { value: string; at: number } | null {
  const lead = raw.length - raw.trimStart().length
  const span = plainValue(raw)
  const quote = span[0]

  // A plain scalar is its own value, trailing comment already dropped.
  if (quote !== "'" && quote !== '"') return { value: span, at: lead }

  // Not a cleanly closed pair — half-typed, or trailing content. Read it raw
  // rather than guess, which is what keeps refs resolving while the quote is
  // still open; the setter kind may be wrong for those few keystrokes.
  if (span.length < 2 || span[span.length - 1] !== quote)
    return { value: span, at: lead }

  const inner = span.slice(1, -1)

  // Asked of the parser rather than pattern-matched: `scalarValue` is what
  // decides what the quoting meant, so it is what can say whether it meant
  // anything at all.
  //
  // Of `raw` and not of `span`, which matters for exactly one case and would
  // be silently wrong without it: `plainValue` ends a quoted span at the
  // first matching quote, so it reads `'it''s'` as `'it'`. Comparing against
  // the span would then find `it` on both sides and agree. `scalarValue` is
  // given the whole line, reads `''` as the one quote it is, and disagrees.
  if (scalarValue(raw) !== inner) return null

  return { value: inner, at: lead + 1 }
}

function parseScalar(value: string): ScalarHeader | null {
  const match = SCALAR.exec(value)
  if (!match) {
    return null
  }

  const digits = /\d+/.exec(match[2])?.[0]
  return {
    indicator: match[1] as "|" | ">",
    chomp: (/[-+]/.exec(match[2])?.[0] ?? "") as "" | "-" | "+",
    explicitIndent: digits ? Number(digits) : null,
  }
}

/** Recognizes a heading comment. Returns null for prose, dividers and entries. */
export function parseHeading(text: string): {
  level: HeadingLevel
  title: string
} | null {
  const comment = COMMENT.exec(text)
  if (!comment) {
    return null
  }

  const match = HEADING.exec(comment[2].trim())
  if (!match?.groups) {
    return null
  }

  const title = match.groups.title.trim()
  if (!title) {
    return null
  }

  return { level: match.groups.section ? 1 : 2, title }
}

/**
 * The heading line without its indentation, padded so that the indentation
 * plus the line comes to HEADING_WIDTH. Headings sit at the same column as the
 * entries they label.
 *
 * Section titles are upper-cased — the one place the formatter rewrites a title
 * — so the two levels stay distinguishable at a glance even in an editor that
 * knows nothing about this format.
 */
export function renderHeading(
  level: HeadingLevel,
  title: string,
  indentWidth = 0
): string {
  const rule = level === 1 ? SECTION_RULE : SUBSECTION_RULE
  const lead = rule.repeat(level === 1 ? 3 : 2)
  const head = `# ${lead} ${level === 1 ? title.toUpperCase() : title} `

  return (
    head + rule.repeat(Math.max(2, HEADING_WIDTH - indentWidth - head.length))
  )
}

/** Decides what a single line is, given the state before it. */
export function classifyLine(
  raw: string,
  number: number,
  context: ScanState
): Line {
  /*
   * A UTF-8 BOM belongs to the file, not to its first line.
   *
   * FS Copilot never sees one: `Definitions.cs` reads with
   * `File.ReadAllText`, which strips it. Ours used to, and the cost was
   * silent and total — `﻿shared:` fails `BLOCK_KEY`, falls through to
   * `KEY_VALUE`, and line 1 becomes a `mapping` at indent 1. `context.block`
   * then stays null for the **whole file**, so every entry in it is
   * attributed to no block and no entry-level or profile-level rule runs.
   * Two modules in the corpus are like this, and nothing noticed for as long
   * as the editor has existed.
   *
   * Classified on the stripped text, but `text` keeps the raw line: a column
   * on line 1 has to go on meaning what Monaco means by it, and the three
   * bytes are still there in the document.
   */
  const text = number === 1 ? raw.replace(/^﻿/, "") : raw

  const indent = indentOf(text)
  const base = { number, text: raw, indent, keyColumn: indent, context }

  // Inside a block scalar the body's shape is the value, so nothing in it is
  // read as structure. A blank line stays part of the body: whether it ends
  // the block is decided by the next line that has content on it.
  if (context.scalarKeyColumn !== null) {
    if (text.trim() === "" || indent > context.scalarKeyColumn)
      return { ...base, kind: "scalarBody", keyColumn: context.scalarKeyColumn }
  }

  if (text.trim() === "") {
    return { ...base, kind: "blank" }
  }

  const comment = COMMENT.exec(text)
  if (comment) {
    const body = comment[2].trim()

    const heading = parseHeading(text)
    if (heading) {
      return { ...base, kind: "heading", ...heading }
    }

    if (DIVIDER.test(body)) {
      return { ...base, kind: "divider" }
    }

    const bodyIndent = comment[2].length - comment[2].trimStart().length

    // Inside a parked block scalar, the body's shape is the value, as it is
    // in a live one: an empty comment line stays body, and so does anything
    // indented past the key. A comment at the key's column or left of it is
    // the next thing, and is read as one.
    if (
      context.parkedScalarColumn !== null &&
      (body === "" || bodyIndent > context.parkedScalarColumn)
    ) {
      return { ...base, kind: "parked", body, bodyIndent }
    }

    if (PARKED.test(body)) {
      return { ...base, kind: "parked", body, bodyIndent }
    }

    if (context.inHeader) {
      const meta = HEADER_META.exec(body)
      if (meta)
        return {
          ...base,
          kind: "headerMeta",
          key: meta[1].trim(),
          value: meta[2].trim(),
        }
    }

    return { ...base, kind: "prose", body }
  }

  if (indent === 0) {
    const block = BLOCK_KEY.exec(text)
    if (block)
      return {
        ...base,
        kind: "blockKey",
        name: block[1],
        known: (BLOCKS as readonly string[]).includes(block[1]),
      }
  }

  const sequence = SEQUENCE.exec(text)
  // `-x` is a plain scalar in YAML, not a sequence item; the space is required.
  if (sequence && (sequence[2] !== undefined || sequence[3] === "")) {
    const keyColumn = indent + 1 + (sequence[2]?.length ?? 0)
    const rest = sequence[3].trimEnd()
    const pair = KEY_VALUE.exec(rest)

    if (pair) {
      const value = (pair[2] ?? "").trim()
      return {
        ...base,
        kind: "entry",
        keyColumn,
        key: pair[1],
        value,
        rest,
        scalar: parseScalar(value),
      }
    }

    return { ...base, kind: "sequenceItem", keyColumn, value: rest }
  }

  const rest = text.trim()
  const pair = KEY_VALUE.exec(rest)
  if (pair) {
    const value = (pair[2] ?? "").trim()
    const scalar = parseScalar(value)
    const key = pair[1]

    if (indent > 0 && (CONTINUATION_KEYS as readonly string[]).includes(key))
      return {
        ...base,
        kind: "continuation",
        key: key as ContinuationKey,
        value,
        rest,
        scalar,
      }

    return { ...base, kind: "mapping", key, value, rest, scalar }
  }

  return { ...base, kind: "unknown" }
}

/**
 * Net bracket movement on one line, ignoring anything inside quotes.
 *
 * A `set:` block scalar holds one JavaScript expression, so tracking whether
 * its brackets have balanced is how the editor knows the expression is
 * finished and there is nothing more the field can hold.
 */
function bracketDelta(text: string): { delta: number; opened: boolean } {
  let delta = 0
  let opened = false
  let quote = ""

  for (let at = 0; at < text.length; at++) {
    const char = text[at]

    if (quote) {
      if (char === "\\") at += 1
      else if (char === quote) quote = ""
      continue
    }

    if (char === "'" || char === '"' || char === "`") {
      quote = char
      continue
    }
    if (char === "/" && text[at + 1] === "/") break

    if (char === "(" || char === "[" || char === "{") {
      delta += 1
      opened = true
    } else if (char === ")" || char === "]" || char === "}") delta -= 1
  }

  return { delta, opened }
}

/** The state a line leaves behind for the next one. */
export function advance(line: Line, state: ScanState): ScanState {
  // A body line does not end the body, but it does move the brackets.
  if (line.kind === "scalarBody") {
    const { delta, opened } = bracketDelta(line.text)

    return {
      ...state,
      scalarDepth: state.scalarDepth + delta,
      scalarOpened: state.scalarOpened || opened,
    }
  }

  const next: ScanState = {
    ...state,
    scalarKeyColumn: isKeyed(line) && line.scalar ? line.keyColumn : null,
    scalarDepth: 0,
    scalarOpened: false,
    parkedScalarColumn: null,
  }

  switch (line.kind) {
    // A gap concludes the entry above it; a comment does not, since one can
    // sit between an entry's own keys.
    case "blank":
      return { ...next, entryOpen: false }

    case "divider":
    case "headerMeta":
    case "prose":
      return next

    case "parked": {
      // A body line keeps the parked scalar open; a parked key with a block
      // indicator opens one, its column measured past any dash; any other
      // parked line closes it.
      const open = state.parkedScalarColumn
      if (open !== null && (line.body === "" || line.bodyIndent > open))
        return { ...next, parkedScalarColumn: open }

      const opened = PARKED_SCALAR.exec(line.body)
      if (!opened) return next
      return {
        ...next,
        parkedScalarColumn: line.bodyIndent + (opened[1]?.length ?? 0),
      }
    }

    case "heading":
      return {
        ...next,
        entryOpen: false,
        ...(line.level === 1
          ? { section: line.title, subsection: null }
          : { subsection: line.title }),
      }

    case "blockKey":
      return {
        ...next,
        inHeader: false,
        entryOpen: false,
        block: line.name,
        section: null,
        subsection: null,
      }

    case "entry":
      return { ...next, inHeader: false, entryOpen: true }

    case "continuation":
      return { ...next, inHeader: false }

    default:
      // Any other content line ends the header for the rest of the document.
      return { ...next, inHeader: false, entryOpen: false }
  }
}

/** Classifies every line of a profile in one pass. */
export function scanLines(text: string): Line[] {
  const lines = text.split(/\r?\n/)
  const scanned: Line[] = []

  let state = initialState()
  for (const [index, raw] of lines.entries()) {
    const line = classifyLine(raw, index + 1, state)
    scanned.push(line)
    state = advance(line, state)
  }

  return scanned
}

/** The next line with anything on it, or null at end of file. */
export function nextContent(lines: Line[], from: number): Line | null {
  for (let index = from + 1; index < lines.length; index++) {
    if (lines[index].text.trim() !== "") {
      return lines[index]
    }
  }

  return null
}
