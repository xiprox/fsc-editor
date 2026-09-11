/**
 * Profile-level analysis — level 3, the outermost of the three in
 * 18-language-core. One entry cannot see these: they are all about how the
 * parts of a file relate to each other.
 *
 * ## Why it is a third entry point and not a cleverer entry rule
 *
 * A level-2 rule is handed one entry and must answer from it alone. The
 * questions here — is this name declared twice, does this `include:` resolve
 * — are answered by the set. So a `ProfileRule` takes the whole file's view
 * and anchors each verdict to a line.
 *
 * ## Anchoring by line, not by entry
 *
 * Level 2 names its target `"get" | "set"`, because an entry has exactly two
 * texts. Level 3 cannot: an `include:` item is not an entry and has no
 * `get:`. So a profile diagnostic carries the **line** whose value text its
 * offsets are measured in, and every item in the view carries that line.
 * Entries fit the same model unchanged — `EntryView` already has `line`, and
 * its `get` is that line's value.
 *
 * The first cut of this took `EntryView[]` and anchored by index into it,
 * which could not have expressed a single one of the `include:`, `ignore:`
 * or block-key rules the level-3 catalogue lists. Widened here rather than
 * worked around at the call site; see the core-change audit.
 *
 * ## What the source says about duplicates, which is not what you would guess
 *
 * `Definitions.Load` builds a flat array — `master.Concat(shared)` — with no
 * dictionary and no dedup, and `Coordinator.Load` then does
 * `foreach (var def in definitions) AddLink(def)`. So a name written twice is
 * **not** last-wins: it gets two independent subscriptions. Both send an
 * `Update` under the same name on every change, and both apply their own
 * setter to every incoming one. That is what makes an exact duplicate a
 * defect and a *differing* duplicate a feature — the corpus's 161 differing
 * groups are deliberate fan-outs, one variable driving two switches.
 */

import type { EntryView } from "./entry.ts"
import type { Diagnostic, RuleContext, RuleFamily } from "./rules.ts"

/** A plain list item — an `include:` path, an `ignore:` name. */
export interface ProfileItem {
  /** 1-based line it is written on. */
  line: number
  /** Its value, as FS Copilot's YAML parser hands it over. */
  text: string
}

/** A top-level block key, and whether the grammar knows it. */
export interface ProfileBlock extends ProfileItem {
  known: boolean
}

/**
 * A `key: value` line whose key is none the format defines — `sett:` for
 * `set:`, a stray `name:` at the top level.
 *
 * Gathered separately from `blocks` because the grammar has already decided
 * these are not block keys: a block key carries no value, so `sharde:` and
 * `sharde: x` are different line kinds and only the first is a `ProfileBlock`.
 * Both fail the load identically, which is the rule's problem rather than the
 * view's.
 */
export interface ProfileMapping extends ProfileItem {
  /**
   * Whether it sits inside an entry, which is the only thing that changes
   * about the verdict: the vocabulary to suggest from is `get:`/`set:`/`skp:`
   * there and the five blocks at the top level.
   */
  inEntry: boolean
}

/**
 * One profile, as the level-3 rules need it.
 *
 * `includes` and `ignores` are empty for most files and that is not a
 * finding: both blocks are optional, and a profile that declares neither is
 * the normal case. Nothing here may complain about an absent block. The one
 * absence that *is* a finding is `updated`, and only because FS Copilot
 * makes it one — see `header-updated`.
 */
export interface ProfileView {
  entries: EntryView[]
  includes: ProfileItem[]
  ignores: ProfileItem[]
  /** `pointer:` items — an identifier, or a full `Identifier|query` key. */
  pointers: ProfileItem[]
  /** Top-level block keys in file order — `shared:`, `master:`, a typo. */
  blocks: ProfileBlock[]
  /**
   * Keys the format does not define, wherever they were written. Empty for
   * every profile in the corpus, which is the point of carrying them: the
   * file this catches is one that has already stopped loading.
   */
  mappings: ProfileMapping[]
  /**
   * The `# Updated:` line FS Copilot's own regex finds, or null.
   *
   * A derived fact rather than a list of header lines, because the regex is
   * the whole truth here: it is multiline over the *entire file*, so the
   * line need not be in the comment header, and it is case-sensitive, so
   * `# updated:` is not one. Mirroring it once in the caller keeps every
   * rule from re-deriving it differently.
   */
  updated: ProfileItem | null
}

export interface ProfileDiagnostic extends Diagnostic {
  /**
   * 1-based line whose **value text** the offsets are measured in — the
   * `get:` value for an entry, the path for an `include:` item.
   */
  line: number
}

export interface ProfileRule {
  id: string
  family: RuleFamily
  run(profile: ProfileView, context: RuleContext): ProfileDiagnostic[]
}

/**
 * Runs every profile rule over one file. The registry is a parameter for the
 * same reason `analyze` and `analyzeEntry` take theirs.
 */
export function analyzeProfileView(
  rules: ProfileRule[],
  profile: ProfileView,
  context: RuleContext
): ProfileDiagnostic[] {
  const out: ProfileDiagnostic[] = []
  for (const rule of rules) out.push(...rule.run(profile, context))
  return out
}
