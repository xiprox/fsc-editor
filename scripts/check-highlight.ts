/**
 * Runs the highlighter over every profile it can find, and reports what it
 * painted.
 *
 * The unit tests cover one line per row of the taxonomy in *Highlighting v2*
 * (docs/sim-vars/18-language-core.md); this covers the corpus, which is
 * where the surprises are. Three properties, per line:
 *
 *   1. Totality — `highlightLine` never throws. Half-typed code is the
 *      normal input of a token provider, and a corpus of other people's
 *      files is the closest thing to it that can be run in bulk.
 *   2. Vocabulary — every emitted scope is in `SCOPES`. A scope the theme
 *      does not know paints in the default foreground, silently.
 *   3. Shape — spans start at column 0 and strictly increase, which is what
 *      Monaco requires of a token list.
 *
 * And one per file: the frame stack is empty at end of file. A template or
 * comment left open past the last line is a painter that lost its place.
 *
 * What is reported rather than asserted is the scope histogram, and the
 * most frequent `rpn.word` texts — every word the operator table does not
 * know, which is either a corpus mistake (the sweep's list of those is in
 * `lang:sweep`) or a painter that mis-read something.
 *
 * It is a maintainer script rather than a test for the same reason
 * `check:format` is: the corpus lives outside the repository, and a test that
 * needs somebody else's folder is a test that fails on a fresh clone.
 *
 * Usage: npm run check:highlight [path to a Definitions folder]
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, relative } from "node:path"

import { isScope, type Scope } from "../src/shared/highlight/index.ts"
// Totality, vocabulary, span shape and the frame stack live beside the corpus
// tests, so that `npm test` and this script cannot form two opinions about a
// well-formed token list. What is left here is the folder walk and the two
// reports. See docs/pipeline/03-checks.md.
import { checkHighlight } from "./checks/highlight.ts"

const DEFAULT_ROOTS = [
  process.env.FSCE_WORKSPACE,
  join(homedir(), "Documents/Definitions"),
  join(homedir(), "dev/fsc/src/Definitions"),
].filter((path): path is string => !!path)

const roots = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_ROOTS.filter((path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    }).slice(0, 1)

function collect(dir: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collect(path))
    else if (/\.ya?ml$/i.test(entry.name)) found.push(path)
  }

  return found
}

const files = roots.flatMap((root) =>
  collect(root).map((file) => ({ root, file }))
)
if (!files.length) {
  console.error("No profiles found. Pass a Definitions folder as an argument.")
  process.exit(1)
}

interface Failure {
  file: string
  line: number
  reason: string
}

const failures: Failure[] = []
const histogram = new Map<Scope, number>()
const words = new Map<string, { count: number; example: string }>()
let lines = 0

for (const { root, file } of files) {
  const rel = relative(root, file)
  const text = readFileSync(file, "utf8")

  // The histogram is built from the same spans the check walks, handed over
  // as they are produced. Two walks would eventually become two opinions
  // about what a well-formed span list is, which is the thing this is for.
  const problems = checkHighlight(text, (line, spans) => {
    lines += 1

    spans.forEach((span, position) => {
      if (!isScope(span.scope)) return

      histogram.set(span.scope, (histogram.get(span.scope) ?? 0) + 1)
      if (span.scope !== "rpn.word") return

      const end = spans[position + 1]?.start ?? line.length
      const word = line.slice(span.start, end).trim()
      const seen = words.get(word) ?? { count: 0, example: line.trim() }
      seen.count++
      words.set(word, seen)
    })
  })

  for (const problem of problems)
    failures.push({ file: rel, line: problem.line, reason: problem.message })
}

console.log(`${files.length} files, ${lines} lines\n`)

console.log("Scopes:")
for (const [scope, count] of [...histogram].sort((a, b) => b[1] - a[1]))
  console.log(`  ${String(count).padStart(7)}  ${scope || '""'}`)

console.log("\nWords the operator table does not know (top 25):")
for (const [word, { count, example }] of [...words]
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 25))
  console.log(
    `  ${String(count).padStart(5)}  ${word.padEnd(28)}  ${example.slice(0, 70)}`
  )

if (failures.length) {
  console.log(`\n${failures.length} failure(s):`)
  for (const failure of failures.slice(0, 40))
    console.log(`  ${failure.file}:${failure.line}  ${failure.reason}`)
  process.exit(1)
}

console.log("\nOK")
