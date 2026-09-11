/**
 * Resolves every entry in every profile it can find, and reports what could not
 * be run.
 *
 * The unit tests cover the four branches with fixtures; this covers the corpus,
 * which is where the surprises are. Every entry anybody wrote is a case the
 * resolver must not throw on, and the ones it legitimately refuses — an
 * expression that produces a number rather than code — are worth seeing as a
 * list, because each is a profile line that silently does nothing in FS Copilot
 * today.
 *
 * It is a maintainer script rather than a test for the same reason
 * `check:format` is: the corpus lives outside the repository, and a test that
 * needs somebody else's folder is a test that fails on a fresh clone.
 *
 * Usage: npm run check:setters [path to a Definitions folder]
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, relative } from "node:path"

// The only script that reaches into main. It is what makes this a sweep of the
// code that actually runs rather than of a second copy of it.
import { setterKind, type SetterKind } from "../src/main/sim/setter.ts"
// Resolution, the unquoting it needs, and the one property worth asserting —
// that none of it throws — live beside the corpus tests. What is left here is
// the folder walk and the refusal list, which is a finding for a human rather
// than a pass condition. See docs/pipeline/03-checks.md.
import { checkSetters, VALUES } from "./checks/setters.ts"

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

const counts: Record<SetterKind, number> = {
  implicit: 0,
  javascript: 0,
  prepended: 0,
  literal: 0,
}

const refused: { file: string; name: string; set: string; reason: string }[] =
  []
let entries = 0

let threw = 0

for (const file of files) {
  const rel = relative(roots[0], file)
  const text = readFileSync(file, "utf8")

  // The counts and the refusal list are built from the same resolution the
  // check performs. Resolving a JavaScript setter evaluates it, so a second
  // walk is not free — and two walks eventually become two answers.
  const problems = checkSetters(rel, text, {
    onEntry: (entry, attempts) => {
      entries += 1
      counts[setterKind(entry)] += 1

      if (attempts.some((result) => result.ok)) return

      const [first] = attempts
      refused.push({
        file: entry.file,
        name: entry.name,
        set: entry.set ?? "",
        reason: first.ok ? "" : first.reason,
      })
    },
  })

  for (const problem of problems) {
    console.error(`THREW  ${rel}:${problem.line}  ${problem.message}`)
    threw += 1
  }
}

const kinds = Object.entries(counts)
  .map(([kind, count]) => `${count} ${kind}`)
  .join(", ")

console.log(`${files.length} files, ${entries} entries — ${kinds}`)
console.log(
  `each tried with value ${VALUES.join(", ")}; reported only if all failed`
)

if (refused.length) {
  console.log("")
  console.log(`${refused.length} could not be resolved:`)
  for (const one of refused) {
    console.log(`  ${one.file}  ${one.name}`)
    console.log(`    set:    ${one.set}`)
    console.log(`    reason: ${one.reason}`)
  }
}

// A refusal is a finding about a profile, not a defect in the resolver, so this
// exits 0 with a list. Throwing is the failure worth an exit code, and that
// would have come out of the loop above.
console.log("")
console.log(
  `${refused.length} refused, ${threw} threw` +
    (refused.length || threw ? "" : " — all resolved")
)

if (threw) process.exit(1)
