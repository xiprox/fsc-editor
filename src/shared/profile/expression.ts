/**
 * The JavaScript inside a `set:`.
 *
 * FS Copilot evaluates some `set:` values with Jint, and the editor can offer
 * real completions inside them — but only if it knows exactly which text is
 * the expression, where it starts, and what `value` and `current` will hold.
 * All three are grammar questions, so they are answered here rather than in
 * the renderer, and the JavaScript service is handed the result.
 */

import {
  type ContinuationLine,
  type EntryLine,
  isJavaScript,
  type Line,
  plainValue,
  scanLines,
  valueSlice,
} from "./grammar.ts"
import { splitUnits } from "./entries.ts"

export interface Expression {
  /**
   * The value FS Copilot evaluates: block indentation removed, and YAML's own
   * quoting gone with it. Never the raw span — a quoted value read with its
   * quotes on is a string whose contents happen to look like code, which is
   * exactly what the JavaScript service used to be handed.
   */
  text: string
  /** 1-based line the text starts on. */
  startLine: number
  /**
   * 1-based column on `startLine` where `text[0]` sits — inside the quote
   * rather than on it, so mapping an offset back to the page stays plain
   * arithmetic and no caller has to know the quoting was there.
   */
  startColumn: number
  /** Columns removed from the front of every line after the first. */
  strippedIndent: number
  /** True for a block scalar body, false for a value written on one line. */
  block: boolean
  /** Whether FS Copilot hands this to the JavaScript engine at all. */
  javascript: boolean
  /** Units declared on the entry's `get:`, which type `value` and `current`. */
  units: string
}

/** The entry a line belongs to, for the units on its `get:`. */
function unitsAbove(lines: Line[], lineNumber: number): string {
  for (let index = lineNumber - 1; index >= 0; index--) {
    const line = lines[index]
    if (line.kind === "blockKey") break
    if (line.kind === "entry") return splitUnits(plainValue(line.value)).units
  }

  return ""
}

/** The key line that opened the block scalar a body line sits in. */
function scalarHeader(lines: Line[], lineNumber: number): number | null {
  for (let index = lineNumber - 1; index >= 0; index--)
    if (lines[index].kind !== "scalarBody") return index

  return null
}

/**
 * Whether a key line is the one that holds an expression.
 *
 * Named positively, because the guard used to be "not `get:`" — which is a
 * different question, and let `skp:` through. A `skp:` value is a variable
 * name, not code, and an expression claiming it is not a harmless extra: the
 * hover walks its territories in order and stops at the first one that says
 * yes, so a claim here is a hover the name never gets.
 */
function holdsExpression(line: Line): line is ContinuationLine | EntryLine {
  if (line.kind !== "continuation" && line.kind !== "entry") return false
  return line.key === "set"
}

/**
 * The expression around a line, or null if there is not one there.
 *
 * Works from a body line or from the `set:` line itself. A trailing `# comment`
 * on a one-line value is dropped, because YAML does — and dropping it from the
 * end keeps every offset before it unchanged.
 */
export function expressionAt(
  lines: Line[],
  lineNumber: number
): Expression | null {
  const line = lines[lineNumber - 1]
  if (!line) return null

  if (line.kind === "scalarBody") {
    const header = scalarHeader(lines, lineNumber)
    if (header === null) return null
    if (!holdsExpression(lines[header])) return null

    const body: Line[] = []
    for (let index = header + 1; index < lines.length; index++) {
      if (lines[index].kind !== "scalarBody") break
      body.push(lines[index])
    }
    if (!body.length) return null

    // The block's own indentation is not part of the value.
    const indents = body
      .filter((entry) => entry.text.trim() !== "")
      .map((entry) => entry.indent)
    const stripped = indents.length ? Math.min(...indents) : 0

    const text = body.map((entry) => entry.text.slice(stripped)).join("\n")

    return {
      text,
      startLine: body[0].number,
      startColumn: stripped + 1,
      strippedIndent: stripped,
      block: true,
      javascript: isJavaScript(text),
      units: unitsAbove(lines, header + 1),
    }
  }

  // A value written on the same line as its key.
  if (!holdsExpression(line) || line.scalar) return null
  if (!line.value) return null

  const at = line.text.indexOf(line.value, line.keyColumn)
  if (at === -1) return null

  // The quoting is YAML's, not FS Copilot's: it never sees the quotes, so
  // neither does anything here. `valueSlice` also says where the value starts,
  // which is all `startColumn` has ever meant — so every offset downstream
  // goes on working with no caller adding anything back.
  const value = valueSlice(line.value)
  if (!value) return null

  return {
    text: value.value,
    startLine: line.number,
    startColumn: at + 1 + value.at,
    strippedIndent: 0,
    block: false,
    javascript: isJavaScript(value.value),
    units: unitsAbove(lines, line.number),
  }
}

/**
 * Offset of a caret within an expression's text, or null when it falls outside
 * — past a trailing comment, or left of a block body's own indentation.
 */
export function offsetIn(
  expression: Expression,
  lineNumber: number,
  column: number
): number | null {
  if (lineNumber < expression.startLine) return null

  const lines = expression.text.split("\n")
  const row = lineNumber - expression.startLine
  if (row >= lines.length) return null

  const start =
    row === 0 ? expression.startColumn : expression.strippedIndent + 1
  const offsetInRow = column - start
  if (offsetInRow < 0 || offsetInRow > lines[row].length) return null

  let offset = 0
  for (let index = 0; index < row; index++) offset += lines[index].length + 1

  return offset + offsetInRow
}

/**
 * The document position of an offset in the expression — `offsetIn` run
 * backwards, for turning an analysis span into a range the editor can
 * highlight. Mirrors its row math exactly; the two are tested against each
 * other, since a drift between them is a hover on the wrong characters.
 */
export function positionIn(
  expression: Expression,
  offset: number
): { lineNumber: number; column: number } {
  const lines = expression.text.split("\n")

  let remaining = offset
  for (let row = 0; row < lines.length; row++) {
    const start =
      row === 0 ? expression.startColumn : expression.strippedIndent + 1

    if (remaining <= lines[row]!.length || row === lines.length - 1)
      return { lineNumber: expression.startLine + row, column: start + remaining }

    remaining -= lines[row]!.length + 1
  }

  return { lineNumber: expression.startLine, column: expression.startColumn }
}

/** A name FS Copilot puts in scope for a `set:` expression. */
export interface InjectedGlobal {
  name: string
  /** JavaScript type, narrowed by the units on the entry's `get:`. */
  type: "number" | "string" | "boolean"
  doc: string
}

function injectedType(units: string): "number" | "string" | "boolean" {
  const normalized = units.trim().toLowerCase()
  if (normalized === "bool" || normalized === "boolean") return "boolean"
  if (normalized === "string") return "string"

  // Everything else on the wire is one of the numeric CLR types, and events
  // carry no units at all.
  return "number"
}

/**
 * `value` and `current`, typed and documented.
 *
 * The single description of what the engine puts in scope. The JavaScript
 * service renders these into the preamble it analyses, so completions, hover
 * and signature help all read from here.
 */
export function injectedGlobals(units: string): InjectedGlobal[] {
  const type = injectedType(units)

  return [
    {
      name: "value",
      type,
      doc: "The value received from the other pilot, to be applied here.",
    },
    {
      name: "current",
      type,
      doc:
        "The value this machine's simulator last reported for the `get:` " +
        "variable.",
    },
  ]
}

/** Convenience for callers holding text rather than a scan. */
export function expressionIn(
  text: string,
  lineNumber: number
): Expression | null {
  return expressionAt(scanLines(text), lineNumber)
}
