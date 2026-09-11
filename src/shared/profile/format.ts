/**
 * Rewrites a profile into canonical form.
 *
 * The editor ships an opinion about how a profile is written, and this is it.
 * There are no options. What the formatter will not do is change what FS
 * Copilot loads — that is the only constraint it answers to, and scripts/
 * check-format.ts holds it to it against a large corpus of real profiles.
 *
 * Only constructs the grammar recognizes are rewritten; anything else is
 * passed through untouched, so a file that arrives in some shape nobody
 * anticipated survives a save.
 */

import { canonicalCasing } from "../units.ts"

import {
  BODY_INDENT,
  CONTINUATION_INDENT,
  ENTRY_INDENT,
  ENTRY_KEY,
  isKeyed,
  type EntryLine,
  type KeyedLine,
  type Line,
  nextContent,
  renderHeading,
  scanLines,
} from "./grammar.ts"
import { expectedIndent, indentFor } from "./indent.ts"

/**
 * FS Copilot reads the profile date with a regex anchored to `#` followed
 * immediately by `Updated:`, so `# Last Updated:` matches nothing and leaves
 * the profile with no date at all.
 */
const LAST_UPDATED = /^([ \t]*#[ \t]*)Last[ \t]+(Updated:)/

export function formatProfile(text: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n"
  const lines = scanLines(text)
  const output: string[] = []

  let blankRun = 0

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    if (line.kind === "blank") {
      blankRun += 1

      // An entry is one mapping: nothing separates `get:` from the `set:` and
      // `skp:` that belong to it. The next line with content on it decides, so
      // a comment between them still keeps its blank line.
      if (nextContent(lines, index)?.kind === "continuation") continue

      // Runs of three or more collapse; single and double blank lines are left
      // alone, since one of them separates a note from an entry's docs.
      if (blankRun < 3) output.push("")
      continue
    }
    blankRun = 0

    output.push(render(line))

    // The body belongs to the key that opened it and moves with it, so it is
    // emitted here rather than being visited by the loop.
    if (isKeyed(line) && line.scalar)
      index = emitScalarBody(lines, index, line, output)
  }

  while (output.length && output[output.length - 1] === "") output.pop()

  return output.join(eol) + eol
}

function render(line: Line): string {
  switch (line.kind) {
    case "heading": {
      const indent = expectedIndent("heading", line.context) ?? 0
      return " ".repeat(indent) + renderHeading(line.level, line.title, indent)
    }

    case "headerMeta":
      return line.text.replace(LAST_UPDATED, "$1$2").trimEnd()

    case "entry":
      return `${" ".repeat(ENTRY_INDENT)}- ${canonicalizeUnits(line)}`

    case "sequenceItem":
      return `${" ".repeat(ENTRY_INDENT)}- ${line.value}`.trimEnd()

    case "continuation":
      return `${" ".repeat(CONTINUATION_INDENT)}${line.rest}`

    case "scalarBody":
      // Reached only when the key that opened the block was passed through
      // unchanged; a body that moves is emitted with its header.
      return line.text

    default:
      // Comments keep their alignment, which is the author's. A block key is
      // already flush left. Anything unrecognized is not ours to move.
      return line.text.trimEnd()
  }
}

/** Where a line's key sits once the line has been rendered. */
function renderedKeyColumn(line: KeyedLine): number {
  switch (line.kind) {
    case "entry":
      return ENTRY_INDENT + "- ".length
    case "continuation":
      return CONTINUATION_INDENT
    default:
      return line.keyColumn
  }
}

/**
 * How far a block scalar's body moves.
 *
 * The body is re-based so its outermost line sits BODY_INDENT in from the key,
 * and every line moves by that same amount. Indentation *relative* to the
 * block is the part that is semantic, and it never changes.
 */
function shiftFor(header: KeyedLine, outermost: number | null): number {
  // An explicit indentation indicator (`|2`) makes the body's columns absolute
  // rather than relative, so moving them would change the value.
  if (outermost === null || header.scalar?.explicitIndent != null) return 0

  // The header itself stayed put, so the body does too.
  if (indentFor(header) === null) return 0

  return renderedKeyColumn(header) + BODY_INDENT - outermost
}

/**
 * The smallest indentation in the body. YAML takes the block's indentation
 * from its first non-empty line, so in a well-formed block this *is* the first
 * line; taking the minimum only makes the shift safe when it is not.
 */
function outermostBodyIndent(lines: Line[], headerIndex: number): number | null {
  let outermost: number | null = null

  for (let index = headerIndex + 1; index < lines.length; index++) {
    const line = lines[index]
    if (line.kind !== "scalarBody") break
    if (line.text.trim() === "") continue

    if (outermost === null || line.indent < outermost) outermost = line.indent
  }

  return outermost
}

/** Emits a block scalar's body and returns the index of the last line used. */
function emitScalarBody(
  lines: Line[],
  headerIndex: number,
  header: KeyedLine,
  output: string[]
): number {
  const delta = shiftFor(header, outermostBodyIndent(lines, headerIndex))
  let index = headerIndex

  while (index + 1 < lines.length && lines[index + 1].kind === "scalarBody") {
    const { text } = lines[index + 1]

    // Never trimmed: trailing whitespace inside a literal block is part of the
    // value, and a whitespace-only line's indentation decides whether it
    // contributes spaces or an empty line.
    if (text.trim() === "" || delta === 0) output.push(text)
    else if (delta > 0) output.push(" ".repeat(delta) + text)
    else output.push(text.slice(-delta))

    index += 1
  }

  return index
}

/**
 * Rewrites a `get:` entry's units to their canonical spelling.
 *
 * This is the one place the formatter touches a value, and it is only ever a
 * change of case: SimConnect matches unit names case-insensitively, so `bool`
 * and `Bool` resolve identically. Spellings that differ by more than case —
 * `ft` for `Feet` — are offered as completions and never rewritten here,
 * because those would change the string the simulator receives.
 *
 * Only the second comma-separated field is considered, matching FS Copilot,
 * which reads `parts[1]` and discards anything after it.
 */
function canonicalizeUnits(line: EntryLine): string {
  const text = line.rest
  if (line.key !== ENTRY_KEY) return text

  const hash = text.indexOf("#")
  const body = hash === -1 ? text : text.slice(0, hash)
  const trailing = hash === -1 ? "" : text.slice(hash)

  const fields = body.split(",")
  if (fields.length < 2) return text

  const units = fields[1].trim()
  const canonical = units && canonicalCasing(units)
  if (!canonical) return text

  fields[1] = fields[1].replace(units, canonical)
  return fields.join(",") + trailing
}
