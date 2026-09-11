/**
 * Entry-level analysis — level 2 of the three in 18-language-core.
 *
 * `analyze()` judges one expression. Some facts are only visible one level
 * out: FS Copilot decides what a `set:` even *is* from the block its entry
 * sits in, and a `master:` setter never runs as RPN at all. A rule that
 * cannot see the entry cannot say so.
 *
 * Additive by design — a new entry point beside `analyze()`, sharing the
 * Rule/Diagnostic/fix shapes rather than forking them, which is what the
 * core-change audit in 18-language-core asks of every new level.
 *
 * ## What an entry rule sees
 *
 * `EntryView` is deliberately not `RawEntry`: the language core must not
 * learn the file format, and everything below the `get:`/`set:` pair —
 * headings, comments, which file it came from — decides nothing here. The
 * setter's *kind* is not on the view either; it arrives through
 * `RuleContext.setterKind`, the channel that already carries it, and a
 * context without one mutes the rules that need it.
 *
 * ## Offsets
 *
 * A diagnostic's `start`/`end` are offsets into one of the entry's two
 * texts, named by `target`. The caller owns the mapping back to document
 * positions, because only it knows where the lines are — `analysis.ts`
 * maps `set` offsets through the same `Expression` the RPN rules use, so a
 * squiggle from either level lands on the same characters.
 */

import type { Diagnostic, RuleContext, RuleFamily } from "./rules.ts"

/** Which of the entry's texts a diagnostic's offsets are measured in. */
export type EntryTarget = "get" | "set"

export interface EntryDiagnostic extends Diagnostic {
  target: EntryTarget
}

/**
 * One entry, as the rules need it.
 *
 * Structurally a subset of `RawEntry`, kept as its own type so `lang/` goes
 * on depending only on `vars/`.
 */
export interface EntryView {
  /**
   * 1-based line of the `get:`.
   *
   * Not for positioning — the caller owns that — but for the level-3 rules,
   * whose whole job is to say "this one is also declared over there" and
   * which need a line number to put in the sentence.
   */
  line: number
  /**
   * The whole `get:` value as written — `NAME[, units]`, unquoted and with
   * any trailing comment gone. `name` and `units` are this text already
   * split the way FS Copilot splits it; the raw form is here because a
   * `target: "get"` diagnostic measures its offsets in it.
   */
  get: string
  /** The `get:` name as written, namespace prefix and index included. */
  name: string
  /** Units as FS Copilot resolves them — written, else its default. */
  units: string
  /** The profile wrote the unit rather than it being inferred from silence. */
  unitsExplicit: boolean
  /** The block decides authority *and* how the setter runs. */
  block: "shared" | "master"
  /**
   * The `set:` value as FS Copilot's YAML parser hands it over — unquoted,
   * with offsets measured from its first character. Absent for an implicit
   * setter, which is 60% of the corpus and never wrong in the ways these
   * rules look for.
   */
  set?: string
  /** `skp:`'s value: the *name of another variable*, not a number. */
  skp?: string
}

export interface EntryRule {
  id: string
  family: RuleFamily
  run(entry: EntryView, context: RuleContext): EntryDiagnostic[]
}

/**
 * Runs every entry rule over one entry.
 *
 * The registry is a parameter for the same reason `analyze`'s is: a test, a
 * feature flag or a future per-profile configuration decides what runs.
 */
export function analyzeEntry(
  rules: EntryRule[],
  entry: EntryView,
  context: RuleContext
): EntryDiagnostic[] {
  const out: EntryDiagnostic[] = []
  for (const rule of rules) out.push(...rule.run(entry, context))
  return out
}
