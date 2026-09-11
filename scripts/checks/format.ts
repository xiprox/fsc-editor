/**
 * The two properties `check:format` asserts, without the folder walk.
 *
 * The formatter rewrites files people distribute to each other, so the bar is
 * that a save can never alter what FS Copilot loads:
 *
 *   1. Semantic identity — parsing before and after yields the same document.
 *      A real YAML parser is used as an oracle only; the formatter itself never
 *      parses.
 *   2. Idempotence — formatting twice equals formatting once.
 *
 * Extracted so that one implementation serves two inputs: `npm test` runs it
 * over the committed corpus, `npm run check:format <folder>` runs it over a
 * real Definitions folder. Neither is a second opinion about what the rule is.
 * See docs/pipeline/03-checks.md.
 *
 * `yaml` is a devDependency and this file is why it stays out of `src/` — the
 * oracle has no business being reachable from anything the app bundles.
 */

import { parse } from "yaml"

import { formatProfile } from "../../src/shared/profile/index.ts"
import { sameEntries } from "../entry-compare.ts"
import type { Problem } from "./corpus.ts"

export interface FormatResult {
  problems: Problem[]
  /**
   * The file was already invalid YAML going in. Not a failure — formatting is
   * not expected to fix it — but worth counting, because a corpus that quietly
   * became unparseable would otherwise look like a corpus that passes.
   */
  unparseable: boolean
  /** What the formatter produced, for the golden comparison. */
  formatted: string
}

export function checkFormat(original: string): FormatResult {
  const problems: Problem[] = []
  const formatted = formatProfile(original)

  if (formatProfile(formatted) !== formatted)
    problems.push({ line: 0, message: "not idempotent" })

  let before: unknown
  try {
    before = parse(original)
  } catch {
    return { problems, unparseable: true, formatted }
  }

  let after: unknown
  try {
    after = parse(formatted)
  } catch (error) {
    problems.push({
      line: 0,
      message: `formatting broke the YAML: ${error instanceof Error ? error.message : String(error)}`,
    })
    return { problems, unparseable: false, formatted }
  }

  if (!sameEntries(before, after))
    problems.push({ line: 0, message: "formatting changed what the profile means" })

  return { problems, unparseable: false, formatted }
}
