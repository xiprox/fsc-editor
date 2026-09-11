/**
 * Checks that the grammar agrees with itself.
 *
 * Where check-format asks "is a save safe" — a question about other people's
 * profiles — this asks "is our own opinion coherent". The corpus is used only
 * as input material to drive the formatter through a lot of real shapes; the
 * assertions are all about what comes *out*, which is a file written in our
 * format, and none of them care what went in.
 *
 * Three properties, per file:
 *
 *   1. Placement — every line of formatted output sits at the column
 *      `expectedIndent` names for it. If the formatter and the grammar ever
 *      disagree about where something goes, this is what says so.
 *   2. Stability — classifying formatted output yields the same kinds as
 *      classifying it again after a second format. A construct that changes
 *      identity when it is rewritten is a construct the formatter is mangling.
 *   3. Containment — a block scalar's body never escapes past its own key
 *      column, which would silently end the block and change the document's
 *      shape.
 *
 * A fourth is enforced by construction rather than tested: `indentAfter` is
 * implemented by calling `expectedIndent` with the construct it predicts, so
 * the Enter key and the formatter cannot name different columns. What is
 * reported here is only how often the prediction was *right* — a quality
 * signal for the prediction table, not a pass condition.
 *
 * Usage: npm run check:grammar [path to a Definitions folder]
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  formatProfile,
  indentAfter,
  type Line,
  scanLines,
} from "../src/shared/profile/index.ts"
// Placement, containment, stability and coupling live beside the corpus tests,
// so that `npm test` and this script cannot form two opinions about where a
// line goes. What is left here is the folder walk, the report, and the
// prediction score — which is a description of a corpus rather than a pass
// condition. See docs/pipeline/03-checks.md.
import { checkGrammar } from "./checks/grammar.ts"

const DEFAULT_ROOTS = [
  process.env.FSCE_WORKSPACE,
  join(homedir(), "dev/fscopilot/bin/FSCopilot/Definitions"),
  join(homedir(), "dev/fscopilot/profiles"),
].filter((path): path is string => !!path)

const roots = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_ROOTS.filter((path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    })

function collect(dir: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collect(path))
    else if (/\.ya?ml$/i.test(entry.name)) found.push(path)
  }

  return found
}

const files = roots.flatMap(collect)
if (!files.length) {
  console.error("No profiles found. Pass a Definitions folder as an argument.")
  process.exit(1)
}

interface Failure {
  file: string
  line: number
  message: string
}

const failures: Failure[] = []
let predicted = 0
let correct = 0

/**
 * How often Enter's column matches the next line of an *installed* profile.
 *
 * Read this as a description of the corpus, not a score. The editor's model is
 * that Enter continues the entry you are writing and a blank line starts the
 * next one, so a file that writes bare `- get:` lines with no grouping
 * disagrees with it on almost every line — correctly. The number moves when
 * the prediction table changes, which makes it useful for seeing *what* moved;
 * it is not a target and nothing fails on it.
 *
 * Only adjacent lines count: after a blank, Enter's answer was never on screen.
 */
function scorePlacement(lines: Line[], missesByKind: Map<string, number>): void {
  for (const [index, line] of lines.entries()) {
    const next = lines[index + 1]
    if (!next || next.kind === "blank" || next.text.trim() === "") continue

    const offered = indentAfter(line)
    if (offered === null) continue

    predicted += 1
    if (offered === next.indent) {
      correct += 1
      continue
    }

    const key = `${line.kind} → ${next.kind}`
    missesByKind.set(key, (missesByKind.get(key) ?? 0) + 1)
  }
}

const missesByKind = new Map<string, number>()

for (const file of files) {
  const text = readFileSync(file, "utf8")

  for (const problem of checkGrammar(text))
    failures.push({ file, line: problem.line, message: problem.message })

  scorePlacement(scanLines(formatProfile(text)), missesByKind)
}

for (const failure of failures.slice(0, 40))
  console.error(
    `${failure.file || "(prediction)"}:${failure.line}  ${failure.message}`
  )

const ranked = [...missesByKind].sort((a, b) => b[1] - a[1]).slice(0, 6)
for (const [transition, count] of ranked)
  console.log(`  miss  ${String(count).padStart(6)}  ${transition}`)

const rate = predicted ? Math.round((correct / predicted) * 100) : 0
const summary =
  `${files.length} profiles, ${failures.length} failures` +
  `, Enter's column matched the installed layout ${rate}% of the time` +
  ` (${correct}/${predicted}, informational)`

if (failures.length) {
  if (failures.length > 40) console.error(`… and ${failures.length - 40} more`)
  console.error(`\n${summary}`)
  process.exit(1)
}

console.log(summary)
