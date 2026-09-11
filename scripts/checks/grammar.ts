/**
 * The four properties `check:grammar` asserts, without the folder walk.
 *
 * Where `check:format` asks "is a save safe" — a question about other people's
 * profiles — this asks "is our own opinion coherent". The input is only there
 * to drive the formatter through a lot of real shapes; every assertion is about
 * what comes *out*, which is a file written in our format, and none of them
 * care what went in.
 *
 *   1. Placement    — every line of formatted output sits at the column
 *                     `expectedIndent` names for it.
 *   2. Containment  — a block scalar's body never escapes past its own key
 *                     column, which would silently end the block.
 *   3. Stability    — classifying formatted output yields the same kinds after
 *                     a second format. A construct that changes identity when
 *                     rewritten is one the formatter is mangling.
 *   4. Coupling     — whatever construct Enter predicts, the column it offers
 *                     is the column the formatter would use for it. Guaranteed
 *                     by construction; asserted so a refactor cannot quietly
 *                     undo it.
 *
 * What is *not* here is `scorePlacement` — how often Enter's prediction matched
 * the next line. That is a description of a corpus rather than a pass
 * condition, and it stays in the script with the other reports.
 *
 * See docs/pipeline/03-checks.md.
 */

import {
  advance,
  expectedIndent,
  formatProfile,
  indentAfter,
  indentFor,
  type Line,
  predictedKind,
  scanLines,
} from "../../src/shared/profile/index.ts"
import type { Problem } from "./corpus.ts"

export function checkGrammar(original: string): Problem[] {
  const problems: Problem[] = []

  const formatted = formatProfile(original)
  const lines = scanLines(formatted)
  const again = scanLines(formatProfile(formatted))

  placement(lines, problems)
  containment(lines, problems)
  stability(lines, again, problems)
  coupling(lines, problems)

  return problems
}

function placement(lines: Line[], problems: Problem[]): void {
  for (const line of lines) {
    const want = indentFor(line)
    if (want === null || want === line.indent) continue

    problems.push({
      line: line.number,
      message: `${line.kind} at column ${line.indent}, expected ${want}`,
    })
  }
}

function containment(lines: Line[], problems: Problem[]): void {
  for (const line of lines) {
    if (line.kind !== "scalarBody" || line.text.trim() === "") continue
    if (line.indent > line.keyColumn) continue

    problems.push({
      line: line.number,
      message: `block scalar body at column ${line.indent} escapes its key at ${line.keyColumn}`,
    })
  }
}

function stability(lines: Line[], again: Line[], problems: Problem[]): void {
  if (lines.length !== again.length) {
    problems.push({
      line: 0,
      message: `line count changed on reformat: ${lines.length} then ${again.length}`,
    })
    return
  }

  for (const [index, line] of lines.entries()) {
    const other = again[index]
    if (line.kind === other.kind) continue

    problems.push({
      line: line.number,
      message: `kind changed on reformat: ${line.kind} became ${other.kind}`,
    })
  }
}

function coupling(lines: Line[], problems: Problem[]): void {
  for (const line of lines) {
    const context = advance(line, line.context)
    const guess = predictedKind(line, context)
    if (guess === null || line.kind === "scalarBody") continue

    const offered = indentAfter(line)
    const canonical = expectedIndent(guess, context)
    if (offered === canonical) continue

    problems.push({
      line: line.number,
      message: `Enter offers ${offered} for ${guess}, formatter uses ${canonical}`,
    })
  }
}
