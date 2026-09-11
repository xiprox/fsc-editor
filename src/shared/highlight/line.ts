/**
 * One line of a profile, highlighted.
 *
 * The line grammar is not described here — `classifyLine` already knows
 * what every line is, and this only says what colour each part of an
 * already-classified line gets. The one thing it adds to the grammar's
 * state is the painter's frame stack, because a template literal that ran
 * off the end of a block scalar line is still open on the next one.
 *
 * Which painter a `set:` value gets is the kind FS Copilot would assign it
 * (`setKind`, decided on the *unquoted* text — 91% of the corpus's
 * JavaScript setters sit inside YAML double quotes). Block scalar bodies
 * are JavaScript: 601 of the corpus's 601, and a line tokenizer could not
 * know otherwise on the first body line anyway.
 */

import {
  advance,
  classifyLine,
  CONTINUATION_KEYS,
  ENTRY_KEY,
  initialState,
  setKind,
  type KeyedLine,
  type Line,
  type ScanState,
} from "../profile/grammar.ts"
import {
  framesEqual,
  JS,
  paintCode,
  paintName,
  RPN,
  Spans,
  type Frame,
  type Span,
} from "./paint.ts"

export interface HighlightState {
  scan: ScanState
  /** Where the painter is, carried across the lines of a block scalar. */
  frames: Frame[]
}

export function initialHighlightState(): HighlightState {
  return { scan: initialState(), frames: [] }
}

/**
 * Whether two states would highlight every following line the same way —
 * what Monaco asks before deciding how far a change re-tokenizes.
 */
export function statesEqual(a: HighlightState, b: HighlightState): boolean {
  const x = a.scan
  const y = b.scan
  return (
    x.inHeader === y.inHeader &&
    x.block === y.block &&
    x.section === y.section &&
    x.subsection === y.subsection &&
    x.scalarKeyColumn === y.scalarKeyColumn &&
    x.parkedScalarColumn === y.parkedScalarColumn &&
    framesEqual(a.frames, b.frames)
  )
}

/** A trailing ` # comment` on a plain scalar, or after a quoted one. */
const INLINE_COMMENT = /\s#/

/** The index of the quote closing a YAML scalar opened at 0, or -1. */
function closeOfYamlQuote(raw: string, quote: string): number {
  for (let at = 1; at < raw.length; at++) {
    const char = raw[at]
    if (char === quote) {
      // `''` is how a single-quoted scalar writes one quote; a double-quoted
      // one escapes with a backslash.
      if (quote === "'" && raw[at + 1] === "'") {
        at += 1
        continue
      }
      return at
    }
    if (quote === '"' && char === "\\") at += 1
  }
  return -1
}

/**
 * A scalar value as the painters want it: its YAML quotes, if any, painted
 * as delimiters, the text inside them handed to `paint`, and the trailing
 * comment painted as one. The inner text is the raw buffer, escapes and all —
 * the corpus carries none, and offsets that are the file's own never lie.
 */
function paintScalar(
  raw: string,
  base: number,
  out: Spans,
  paint: (text: string, at: number) => void
): void {
  const quote = raw[0]

  if (quote === "'" || quote === '"') {
    out.push(base, "yaml.delimiter")

    const close = closeOfYamlQuote(raw, quote)
    const end = close === -1 ? raw.length : close
    paint(raw.slice(1, end), base + 1)

    if (close === -1) return
    out.push(base + close, "yaml.delimiter")

    const comment = INLINE_COMMENT.exec(raw.slice(close + 1))
    if (comment) out.push(base + close + 1 + comment.index, "comment")
    else out.push(base + close + 1, "")
    return
  }

  const comment = INLINE_COMMENT.exec(raw)
  paint(comment ? raw.slice(0, comment.index) : raw, base)
  if (comment) out.push(base + comment.index, "comment")
}

/** A `set:` value on its own line: the kind decides the painter. */
function paintSetter(raw: string, base: number, out: Spans): void {
  paintScalar(raw, base, out, (text, at) => {
    const frame = setKind(text) === "javascript" ? JS : RPN
    paintCode(text, at, [frame], out)
  })
}

/** A `get:` or `skp:` value: a variable name, with units. */
function paintVariable(raw: string, base: number, out: Spans): void {
  paintScalar(raw, base, out, (text, at) => paintName(text, at, out))
}

/** `|`, `>`, with chomping or indentation indicators, then maybe a comment. */
function paintScalarHeader(raw: string, base: number, out: Spans): void {
  out.push(base, "yaml.delimiter")
  const comment = INLINE_COMMENT.exec(raw)
  if (comment) out.push(base + comment.index, "comment")
}

function paintKeyed(line: KeyedLine, out: Spans): Frame[] {
  out.push(0, "")
  if (line.kind === "entry") out.push(line.indent, "yaml.delimiter")

  out.push(line.keyColumn, "yaml.key")

  const colon = line.text.indexOf(":", line.keyColumn)
  out.push(colon, "yaml.delimiter")

  if (!line.value) return []
  const at = line.text.indexOf(line.value, colon + 1)

  if (line.scalar) {
    paintScalarHeader(line.value, at, out)
    return [JS]
  }

  const key = line.key
  if (key === ENTRY_KEY || key === CONTINUATION_KEYS[1])
    paintVariable(line.value, at, out)
  else if (key === CONTINUATION_KEYS[0]) paintSetter(line.value, at, out)
  else out.push(at, "")

  return []
}

function paintLine(line: Line, frames: Frame[], out: Spans): Frame[] {
  switch (line.kind) {
    case "blank":
    case "unknown":
      return []

    case "heading":
      out.push(0, line.level === 1 ? "comment.section" : "comment.subsection")
      return []

    // A divider is decoration and a parked entry is code someone left behind.
    // Neither reads as prose.
    case "divider":
    case "prose":
      out.push(0, "comment")
      return []

    case "parked":
      out.push(0, "comment.code")
      return []

    case "headerMeta": {
      const key = line.text.indexOf(line.key)
      out.push(0, "comment")
      out.push(key, "comment.meta")
      out.push(key + line.key.length, "comment")
      return []
    }

    case "blockKey":
      out.push(0, "")
      // An unrecognized top-level key is the one thing the schema rejects
      // outright, so it does not get the authoritative treatment.
      out.push(line.indent, line.known ? "yaml.block" : "")
      out.push(line.indent + line.name.length, "yaml.delimiter")
      return []

    case "scalarBody":
      out.push(0, "")
      return paintCode(line.text.slice(line.indent), line.indent, frames, out)

    case "sequenceItem":
      out.push(0, "")
      out.push(line.indent, "yaml.delimiter")
      out.push(line.keyColumn, "yaml.path")
      return []

    case "entry":
    case "continuation":
    case "mapping":
      return paintKeyed(line, out)
  }
}

export interface Highlighted {
  spans: Span[]
  state: HighlightState
}

export function highlightLine(
  text: string,
  state: HighlightState
): Highlighted {
  const line = classifyLine(text, 0, state.scan)

  const out = new Spans()
  const frames = paintLine(line, state.frames, out)
  if (!out.list.length) out.push(0, "")

  return {
    spans: out.list,
    state: { scan: advance(line, state.scan), frames },
  }
}
