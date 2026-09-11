/**
 * Which variables the editor wants live values for, and where their hints go.
 *
 * Pure and monaco-free on purpose: the value store next door needs a monaco
 * `Emitter`, which drags in browser globals and cannot be imported by a node
 * test. The rules worth asserting are all here — the same split `var-search`
 * and `log-filter` already make.
 */

import { scanLines, splitUnits } from "@shared/profile"
import type { SimVarWatch } from "@shared/sim"

/** One `get:` line: what it asks for, and which line it is on. */
export interface WatchLine {
  /** 1-based, because that is how Monaco counts. */
  line: number
  watch: SimVarWatch
}

/**
 * Every `get:` in a profile, with its line.
 *
 * `scanEntries` already reads entries out of a profile, but it folds them into
 * the corpus shape and drops position — and a hint without a line number has
 * nowhere to go. This walks the same grammar and keeps the index, which *is*
 * the line: `scanLines` emits exactly one entry per line of input.
 *
 * Going through the grammar rather than matching `get:` with a regex is what
 * keeps a `set:` body from contributing watches. A block scalar holding
 * JavaScript can contain anything, including a line that reads like an entry.
 */
export function getLinesIn(text: string): WatchLine[] {
  const found: WatchLine[] = []

  scanLines(text).forEach((line, index) => {
    if (line.kind !== "entry" || line.key !== "get") return

    const { name, units } = splitUnits(line.value)
    if (!name) return

    found.push({ line: index + 1, watch: { name, units } })
  })

  return found
}

/**
 * The watch set for a group of open files, deduplicated.
 *
 * Deduplicated on name *and* units, because those are two different reads: the
 * same variable in degrees and in radians is two entries in the data
 * definition, and collapsing them would leave one of the two hints showing the
 * other's number.
 *
 * Every namespace is carried through. The renderer does not decide what is
 * reachable — main drops what it cannot watch, so `L:` becoming readable in
 * stage 2b is a change there and not here.
 */
export function watchSetFor(texts: string[]): SimVarWatch[] {
  const seen = new Map<string, SimVarWatch>()

  for (const text of texts) {
    for (const { watch } of getLinesIn(text)) {
      seen.set(`${watch.name} :: ${watch.units}`, watch)
    }
  }

  return [...seen.values()]
}
