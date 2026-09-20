/**
 * The corpus tests — the assertions the sweeps make, run over committed files.
 *
 * `check:format`, `check:grammar`, `check:highlight` and `check:setters` were
 * written as exploratory tools: bulk input in, report out, a human reads it.
 * Their *assertions* were never script-specific, though, and those are the part
 * worth having on every change. So the assertions live in `scripts/checks/` and
 * this runs them over `corpus/`, while the scripts keep their names, their
 * folder argument and their reports.
 *
 * Each test collects every problem across every file and asserts the whole list
 * is empty, rather than failing per file. One failure should print everything
 * that is wrong, not the first thing.
 *
 * See docs/pipeline/03-checks.md.
 */

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { corpusFiles, GOLDEN, type Problem } from "./corpus.ts"
import { checkFormat } from "./format.ts"
import { checkGrammar } from "./grammar.ts"
import { checkHighlight } from "./highlight.ts"
import { checkSetters } from "./setters.ts"

const files = corpusFiles()

/** `path:line  message`, sorted by the walk, so a diff of failures is readable. */
function report(path: string, problems: Problem[]): string[] {
  return problems.map(
    (problem) => `${path}:${problem.line}  ${problem.message}`
  )
}

/**
 * What a case that walks the whole corpus is allowed to take.
 *
 * A hundred and thirty-odd real profiles parsed, formatted and compared is
 * seconds of honest work, and vitest's five-second default is a budget for a
 * test that computes something — it was never chosen for this. The setters
 * case below has carried its own number since it was written; the rest of
 * the walks were getting away with the default only because the machines
 * running them were fast. A CI runner is not.
 */
const SLOW = 30_000

describe("corpus", { timeout: SLOW }, () => {
  it("has profiles in it", () => {
    // Guards against the silent version of every test below passing: an empty
    // corpus makes all of them vacuous.
    expect(files.length).toBeGreaterThan(50)
  })

  it("keeps both line endings, because the formatter branches on them", () => {
    const crlf = files.filter((file) => file.text.includes("\r\n"))
    const lf = files.filter((file) => !file.text.includes("\r\n"))

    expect(crlf.length).toBeGreaterThan(0)
    expect(lf.length).toBeGreaterThan(0)
  })

  it("survives a format with its meaning intact, twice", () => {
    const failures: string[] = []
    let unparseable = 0

    for (const file of files) {
      const result = checkFormat(file.text)
      if (result.unparseable) unparseable += 1
      failures.push(...report(file.path, result.problems))
    }

    // A corpus that quietly became unparseable would make the check above look
    // like it passes, so the count is asserted rather than printed.
    expect(unparseable).toBeLessThan(files.length / 2)
    expect(failures).toEqual([])
  })

  it("agrees with its own grammar about every column", () => {
    const failures = files.flatMap((file) =>
      report(file.path, checkGrammar(file.text))
    )

    expect(failures).toEqual([])
  })

  it("paints every line without losing its place", () => {
    const failures = files.flatMap((file) =>
      report(file.path, checkHighlight(file.text))
    )

    expect(failures).toEqual([])
  })

  // One value rather than the script's four. Resolving a JavaScript setter
  // evaluates it, and doing that four times over every entry in the corpus
  // costs twelve seconds to re-prove the same property. The script still tries
  // all four, because deciding whether an entry is *refused* needs them.
  it("resolves every setter without throwing", () => {
    const failures = files.flatMap((file) =>
      report(file.path, checkSetters(file.path, file.text, { values: [0] }))
    )

    expect(failures).toEqual([])
  })
})

describe("corpus golden output", { timeout: SLOW }, () => {
  it("matches what the formatter produces now", () => {
    const missing: string[] = []
    const differing: string[] = []

    for (const file of files) {
      const golden = join(GOLDEN, file.path)

      if (!existsSync(golden)) {
        missing.push(file.path)
        continue
      }

      // Compared as text rather than as bytes: `formatProfile` returns a
      // string, and what is being checked is that the string is the same one.
      // The bytes on disk are the business of .gitattributes.
      if (readFileSync(golden).toString("utf8") !== checkFormat(file.text).formatted)
        differing.push(file.path)
    }

    expect(
      missing,
      "profiles with no formatted output committed — run npm run corpus:golden"
    ).toEqual([])

    expect(
      differing,
      "the formatter's output changed. If that was intended, run npm run corpus:golden and commit the diff"
    ).toEqual([])
  })
})
