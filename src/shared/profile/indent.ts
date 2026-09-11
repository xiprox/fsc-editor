/**
 * Where things go.
 *
 * There is one answer to "what column does this construct belong at", and both
 * the formatter and the editor's Enter key read it from here. They used to be
 * separate opinions — the formatter placed a continuation key at column 4,
 * while Enter emitted Monaco's `IndentAction.Indent`, which means "one tab
 * stop" and lands on 4 only because `tabSize` happens to be 2. Any change to
 * one could silently desync the other, which is most of where the patching
 * went.
 *
 * `indentAfter` is defined by calling `expectedIndent` with the construct it
 * predicts, so the two cannot disagree by construction rather than by test.
 */

import {
  advance,
  BODY_INDENT,
  CONTINUATION_INDENT,
  ENTRY_INDENT,
  isEntryBlock,
  type Line,
  type LineKind,
  type ScanState,
} from "./grammar.ts"

/**
 * The column the formatter puts a construct at, or null for "leave it where
 * the author put it".
 *
 * Null is not a gap. Comments carry authorship in their alignment, block
 * scalar bodies carry meaning in theirs, and a line the grammar does not
 * recognize is not ours to move.
 */
export function expectedIndent(
  kind: LineKind,
  context: ScanState
): number | null {
  switch (kind) {
    case "blockKey":
      return 0

    case "entry":
    case "sequenceItem":
      return ENTRY_INDENT

    case "continuation":
      return CONTINUATION_INDENT

    case "heading":
      // Headings sit at the same column as the entries they label: two inside
      // a block, flush left in the header area.
      return context.block === null ? 0 : ENTRY_INDENT

    default:
      return null
  }
}

/** The column a line already sitting in a file should be at. */
export function indentFor(line: Line): number | null {
  return expectedIndent(line.kind, line.context)
}

/**
 * The construct a new line typed after this one most likely opens.
 *
 * A prediction, not a rule — you are free to type something else and the
 * formatter will place it correctly on save. It only decides where the caret
 * starts.
 */
export function predictedKind(
  line: Line,
  context: ScanState
): LineKind | null {
  // A line that opens a block scalar is answered by the body, not the table.
  if (context.scalarKeyColumn !== null) return null

  const item = isEntryBlock(context.block) ? "entry" : "sequenceItem"

  switch (line.kind) {
    // A block's first item, or the first item under a heading.
    case "blockKey":
    case "heading":
      return context.block === null ? null : item

    // Enter continues the entry you are in the middle of writing. An entry is
    // one mapping and its keys are contiguous, so what follows `- get: X` is
    // its `set:` and what follows a `set:` is its `skp:` — landing under the
    // key rather than under the dash.
    //
    // Starting the *next* entry is what a blank line is for, and after one
    // `entryOpen` is false and this returns the sibling instead.
    case "entry":
    case "continuation":
      return context.entryOpen ? "continuation" : item

    case "sequenceItem":
      return item

    default:
      return null
  }
}

/** How a new line typed after this one begins. */
export interface Opening {
  /** Column the line starts at. */
  indent: number
  /** Text placed at that column ahead of the caret, continuing a comment. */
  prefix: string
}

/**
 * How the line after this one opens, or null to leave Monaco's default alone.
 *
 * `indentAfter` is this without the prefix, and both are still routed through
 * `expectedIndent` so the caret can never land somewhere the formatter would
 * move it away from.
 */
export function openAfter(line: Line): Opening | null {
  const context = advance(line, line.context)
  const at = (indent: number | null, prefix = ""): Opening | null =>
    indent === null ? null : { indent, prefix }

  if (line.kind === "scalarBody") {
    // A `set:` block holds one expression. Once its brackets balance there is
    // nothing further the field can contain, so Enter leaves the block and
    // lands back under the key that opened it.
    if (context.scalarOpened && context.scalarDepth <= 0)
      return at(context.scalarKeyColumn ?? line.keyColumn)

    // Otherwise the indentation is the value: continue in the column already
    // being written in, or open the body if the line is blank.
    return at(
      line.text.trim() === "" ? line.keyColumn + BODY_INDENT : line.indent
    )
  }

  // The line just opened a block scalar.
  if (context.scalarKeyColumn !== null)
    return at(context.scalarKeyColumn + BODY_INDENT)

  // A comment continues as a comment, at the column the author chose. Not a
  // heading or a divider, which are structure: what follows one is content.
  if (
    line.kind === "prose" ||
    line.kind === "headerMeta" ||
    line.kind === "parked"
  )
    return at(line.indent, "# ")

  return at(expectedIndent(predictedKind(line, context) ?? "blank", context))
}

export function indentAfter(line: Line): number | null {
  return openAfter(line)?.indent ?? null
}
