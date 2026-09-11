/**
 * Rewrites `corpus/formatted/` — the formatter's output for every profile in
 * the corpus, committed.
 *
 * A property test over 69 real files fails with "a400m.yaml: not idempotent",
 * and then somebody opens a two-thousand-line file they did not write and
 * bisects it by hand. For a property that is an acceptable price. For
 * corpus-wide *behaviour change* it is not — so the formatter's output is
 * committed beside its input, and a change to the formatter shows up as a diff
 * of real output, in the file it happened in, on the line it happened on.
 *
 * Prettier keeps its own corpus this way, for the same reason. The cost is a
 * large diff whenever the formatter legitimately changes, and that diff is the
 * thing you would want to read anyway.
 *
 * Run this when a formatter change is intended; commit the result as part of
 * the same change. `corpus.test.ts` is what fails when you forget.
 *
 * Usage: npm run corpus:golden
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { corpusFiles, GOLDEN } from "./checks/corpus.ts"
import { checkFormat } from "./checks/format.ts"

// Removed wholesale rather than overwritten in place, so that a profile which
// left the corpus does not leave its formatted output behind to be compared
// against nothing.
rmSync(GOLDEN, { recursive: true, force: true })

let written = 0
let changed = 0

for (const file of corpusFiles()) {
  const target = join(GOLDEN, file.path)
  mkdirSync(dirname(target), { recursive: true })

  const { formatted } = checkFormat(file.text)
  if (formatted !== file.text) changed += 1

  writeFileSync(target, formatted)
  written += 1
}

console.log(`${written} written to corpus/formatted`)
console.log(`${changed} of them differ from the profile as it is on disk`)
console.log(`\nReview the diff. It is the whole point of the exercise.`)
