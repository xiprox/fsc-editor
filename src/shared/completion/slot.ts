/**
 * Where a name is being completed, if anywhere.
 *
 * Two grammars answer it, as before, but the second is no longer a regex. The
 * line's structure — which key it holds, whether the caret is in its value,
 * before or after the comma — is `cursor.ts`'s permissive line grammar. Inside
 * a setter the question is whether the caret is in a reference, and that is
 * the highlighter's walk: it tells RPN from JavaScript, string and template
 * bodies from code and holes from both, across a block scalar's lines. The
 * regex this replaces found `(>` and nothing else, so a read got no names;
 * asking the tokenizer directly instead would have offered variable names
 * after `Math.abs(`.
 *
 * Offsets are 0-based within the caret's line.
 */

import { refsInCode, setterFrames } from "../highlight/refs.ts"
import { slotAt as lineSlotAt } from "../profile/cursor.ts"
import { expressionAt, offsetIn, positionIn } from "../profile/expression.ts"
import type { Line } from "../profile/grammar.ts"
import type { NamePosition } from "./shapes.ts"

/** A variable name being typed. */
export interface NameSlot {
  kind: "name"
  position: NamePosition
  /** 1-based line. */
  line: number
  /** Where the name starts. */
  start: number
  caret: number
  /**
   * Where the name being replaced ends. On a `get:` line, the end of the
   * value: a name brings its unit, so accepting one replaces both.
   */
  end: number
  /** What has been typed: the line from `start` to the caret. */
  typed: string
  /** A reference's `(`, and the text from it to the name — `(>`, `( >`. */
  cover?: { start: number; text: string }
  /** Whether the reference already has its `)`. */
  closed?: boolean
}

/** A unit being typed, after the comma of a `get:` or a reference. */
export interface UnitsSlot {
  kind: "units"
  line: number
  start: number
  caret: number
  end: number
  typed: string
  /** The name the unit is for. */
  of: string
}

export type CompletionSlot = NameSlot | UnitsSlot

/** A trailing ` # comment`, which belongs to the author, not to the value. */
const INLINE_COMMENT = /\s#/

/** Where a reference's name starts, past its `(`, an optional `>` and spaces. */
const REF_OPENER = /^\(\s*>?\s*/

/** The end of a line's value: before a trailing comment, or the line's end. */
function valueEnd(text: string, caret: number): number {
  const comment = INLINE_COMMENT.exec(text)
  return Math.max(comment ? comment.index : text.length, caret)
}

/**
 * The slot at a caret, or null when no name or unit is being typed there.
 *
 * `caret` is the 0-based offset in the line. A setter value with the caret
 * outside every reference returns null: what completes there — whole-setter
 * templates, the JavaScript service — is not a name.
 */
export function completionSlot(
  lines: Line[],
  lineNumber: number,
  caret: number
): CompletionSlot | null {
  const line = lines[lineNumber - 1]
  if (!line) return null

  const text = line.text
  const slot = lineSlotAt(text.slice(0, caret), line.context)
  if (!slot) return null

  switch (slot.kind) {
    case "variable":
      return {
        kind: "name",
        position: "get",
        line: lineNumber,
        start: slot.prefix.length,
        caret,
        end: valueEnd(text, caret),
        typed: slot.typed,
      }

    case "skipTarget":
      return {
        kind: "name",
        position: "skp",
        line: lineNumber,
        start: slot.prefix.length,
        caret,
        end: valueEnd(text, caret),
        typed: slot.typed,
      }

    case "units": {
      const name = slot.prefix.replace(/^\s*-?\s*get\s*:\s*/, "")
      return {
        kind: "units",
        line: lineNumber,
        start: slot.prefix.length,
        caret,
        end: valueEnd(text, caret),
        typed: slot.typed,
        of: name.slice(0, name.lastIndexOf(",")).trim(),
      }
    }

    case "setValue":
    case "expression":
      return referenceSlot(lines, lineNumber, caret)

    default:
      return null
  }
}

/** The reference the caret is in, found by the walk the highlighter makes. */
function referenceSlot(
  lines: Line[],
  lineNumber: number,
  caret: number
): CompletionSlot | null {
  const expression = expressionAt(lines, lineNumber)
  if (!expression) return null

  const offset = offsetIn(expression, lineNumber, caret + 1)
  if (offset === null) return null

  const code = expression.text
  const found = refsInCode(code, setterFrames(code, expression.block)).find(
    (ref) =>
      ref.start < offset &&
      (offset < ref.end ||
        (offset === ref.end && Boolean(ref.node.token.unterminated)))
  )
  if (!found) return null

  const token = code.slice(found.start, found.end)
  const opener = REF_OPENER.exec(token)?.[0].length ?? 1
  const nameStart = found.start + opener
  if (offset < nameStart) return null

  const closed = !found.node.token.unterminated

  // Back onto the page. A reference never spans lines — the walk reports
  // them a line at a time — so every offset here lands on the caret's line.
  const column = (at: number) => positionIn(expression, at).column - 1

  // Past a comma the caret is in the unit: `(A:FUEL TOTAL QUANTITY, gall|`.
  const comma = code.indexOf(",", nameStart)
  if (comma !== -1 && comma < offset) {
    const unitStart = comma + 1
    const unitEnd = closed
      ? found.end - 1
      : offset + (/^[^\s,()]*/.exec(code.slice(offset))?.[0].length ?? 0)
    return {
      kind: "units",
      line: lineNumber,
      start: column(unitStart),
      caret,
      end: Math.max(column(unitEnd), caret),
      typed: code.slice(unitStart, offset),
      of: code.slice(nameStart, comma).trim(),
    }
  }

  const typed = code.slice(nameStart, offset)
  const interior = token.slice(opener)
  const nameEnd =
    closed && !interior.slice(0, -1).includes("(")
      ? nameStart + endOfName(interior)
      : offset + (/^[^\s,()]*/.exec(code.slice(offset))?.[0].length ?? 0)

  return {
    kind: "name",
    position: found.node.access,
    line: lineNumber,
    start: column(nameStart),
    caret,
    end: Math.max(column(nameEnd), caret),
    typed,
    cover: { start: column(found.start), text: token.slice(0, opener) },
    closed,
  }
}

/** A closed reference's name ends at its comma or its `)`. */
function endOfName(interior: string): number {
  const comma = interior.indexOf(",")
  const close = interior.lastIndexOf(")")
  const end = comma === -1 ? close : Math.min(comma, close)
  return end === -1 ? interior.length : end
}
