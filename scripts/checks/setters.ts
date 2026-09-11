/**
 * The one property `check:setters` asserts, without the folder walk.
 *
 * Every entry anybody wrote is a case the resolver must not throw on. That is
 * a weaker claim than the other checks make, and deliberately so: an entry the
 * resolver *refuses* is not a failure — an expression that produces a number
 * rather than code is a profile line that silently does nothing in FS Copilot
 * today, and the list of those is a finding for a human, not a red build.
 *
 * So the refusal list stays in the script, and what is asserted here is that
 * scanning and resolving a real profile never blows up. See
 * docs/pipeline/03-checks.md.
 */

import {
  type RawEntry,
  scalarValue,
  scanEntries,
} from "../../src/shared/profile/index.ts"
import { resolveSetter, setterKind } from "../../src/main/sim/setter.ts"
import type { Problem } from "./corpus.ts"

/**
 * The values every entry is tried with.
 *
 * A setter is allowed to have no branch for a given input — the FlyByWire baro
 * entries answer only between 745 and 1100, the iFly switches only for 0 and
 * 20 — so a single value would report selective entries as broken. These four
 * are the corpus's own idiom: 0 and 1 for booleans and toggles, 5 and 20 for
 * the guard and detent positions the CRJ and iFly profiles switch on.
 */
export const VALUES = [0, 1, 5, 20]

/**
 * `values` is a parameter because the two callers want different things from
 * it. The script is deciding whether an entry is *refused*, which it can only
 * do by trying every value; the test is only asking whether resolution throws,
 * and a throw does not wait for the second value. Running all four in the test
 * costs twelve seconds — more than the rest of the suite put together — to
 * re-prove the same property four times.
 */
export interface SetterOptions {
  values?: number[]
  /**
   * Every entry, with what each value resolved to.
   *
   * The script builds its kind counts and its refusal list from this rather
   * than walking the corpus a second time — resolving a JavaScript setter
   * evaluates it, so a second walk is not free, and two walks eventually
   * become two opinions.
   */
  onEntry?: (entry: RawEntry, attempts: ReturnType<typeof resolveSetter>[]) => void
}

export function checkSetters(
  path: string,
  text: string,
  { values = VALUES, onEntry }: SetterOptions = {}
): Problem[] {
  const problems: Problem[] = []

  let raws
  try {
    raws = [...scanEntries(path, text)]
  } catch (error) {
    return [{ line: 0, message: `scanEntries threw: ${error}` }]
  }

  for (const raw of raws) {
    // `scanEntries` keeps a `set:` value exactly as written, quotes included,
    // because the variable index inserts that text back into a file as a
    // completion. FS Copilot is handed the YAML-parsed value instead, so
    // resolving what it resolves means unquoting first. One-line values only:
    // a block scalar carries no quoting to remove, and `#` inside it is
    // JavaScript rather than a YAML comment.
    const entry =
      raw.set && !raw.scalar ? { ...raw, set: scalarValue(raw.set) } : raw

    try {
      setterKind(entry)
      const attempts = values.map((value) =>
        resolveSetter(entry, { value, current: 0 })
      )
      onEntry?.(entry, attempts)
    } catch (error) {
      problems.push({
        line: raw.at.set ?? raw.at.get,
        message: `resolving ${raw.name} threw: ${error}`,
      })
    }
  }

  return problems
}
