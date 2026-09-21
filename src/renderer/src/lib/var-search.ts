import type { VarEntry } from "@shared/types"
import { parseVar } from "@shared/vars"

/**
 * Finding a variable by typing roughly what you remember of its name.
 *
 * The tools this replaces match the query as a literal substring, so
 * `battery switch` finds nothing in `XMLVAR_BATTERYSTBY_SWITCHSTATE` and one
 * stray space breaks a query that was about to work. Three rules fix almost all
 * of that:
 *
 *   - separators are noise. `_`, `-`, spaces and camelCase boundaries all mean
 *     the same thing, so the query and the name are compared as word lists
 *   - word order is not meaningful. `switch battery` is the same question as
 *     `battery switch`
 *   - a word may be part of a longer one. `battery` matches `BATTERYSTBY`,
 *     which no dictionary could have split
 *
 * What separates a good match from a merely possible one is left to the score,
 * not to the filter: it is better to show `L:BATTERY_MASTER` first than to
 * decide `BATTERYSTBY` was not what anyone meant.
 *
 * **Quotes turn all of that off, for the part inside them.** `"NAV_LIGHT"` is
 * those characters, in that order, anywhere in the name — separators included,
 * case ignored. The loose rules are for a name half remembered; a quote is for
 * the one somebody already knows, where `NAV LIGHT` and `NavLight` matching is
 * noise. See `parseQuery`.
 */

/** How well an entry matched, lower being better. Used only for ordering. */
const TIER = {
  exact: 0,
  prefix: 1,
  wordPrefix: 2,
  wordPart: 3,
  subsequence: 4,
  none: 5,
} as const

interface IndexedVar {
  entry: VarEntry
  /** How strong the evidence for this variable is. See `evidenceRank`. */
  evidence: number
  /** Lowercased, separators removed. `L:AdfOnOff` -> `ladfonoff`. */
  compact: string
  /** The whole name lowercased, separators kept — what a quote matches. */
  lower: string
  /** `lower` without its `x:` prefix. `L:Foo_Bar` -> `foo_bar`. */
  bare: string
  /** Lowercased words, split on separators and camelCase boundaries. */
  words: string[]
  /** The `A` of `A:CIRCUIT CONNECTION ON:3`, lowercased. Empty when absent. */
  namespace: string
}

export interface VarSearchIndex {
  items: IndexedVar[]
  /** Namespaces present, most used first — the filter row is built from these. */
  namespaces: string[]
}

export interface VarSearchResult {
  entry: VarEntry
  tier: number
  /** Which evidence band it fell in — see `evidenceRank`. */
  evidence: number
}

/**
 * How much is known about a variable, lowest being most.
 *
 * The list is no longer a corpus: it carries every name the simulator has
 * enumerated and every name the SDK documents, so most of it is variables
 * nobody in this workspace has ever written. Without a band to sort them into,
 * a search for `battery` buries the four bindings somebody already made under a
 * hundred names that merely contain the word.
 *
 * The order is a claim about usefulness, in the aircraft in front of you:
 *
 *   0. it moves in this aircraft — the only direct evidence there is, since the
 *      sim will not say which variables belong to an aeroplane
 *   1. this aircraft's own profile names it
 *   2. some profile names it
 *   3. it exists, and that is all anybody knows
 *
 * **Applied after match quality, never before it.** A poor name match must not
 * float to the top because it happens to be moving; the query is what the user
 * said, and this only breaks ties among things that answered it equally well.
 */
export function evidenceRank(entry: VarEntry): number {
  if (entry.aircraft?.changes) return 0
  if (entry.aircraft?.inProfile) return 1
  if (entry.corpus) return 2
  return 3
}

/** Inserts a break where a lowercase run meets an uppercase one. */
function splitWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

function compactOf(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

export function buildSearchIndex(entries: VarEntry[]): VarSearchIndex {
  const counts = new Map<string, number>()

  const items = entries.map((entry) => {
    // The semantic family, not the written letter — so `L:1:` files under the
    // `z` chip it belongs to rather than a lowercase-`l` lie. Lowercased
    // because the chip renders uppercase via CSS and a typed `z:batt` query
    // lowercases before comparing.
    const ns = parseVar(entry.name).ns
    const namespace = ns === null ? "" : ns.toLowerCase()

    if (namespace) counts.set(namespace, (counts.get(namespace) ?? 0) + 1)

    return {
      entry,
      // Computed once here rather than per comparison: the sort runs over
      // thousands of matches and this walks three optional facets.
      evidence: evidenceRank(entry),
      compact: compactOf(entry.name),
      lower: entry.name.toLowerCase(),
      bare: entry.name.toLowerCase().replace(/^[a-z]:/, ""),
      words: splitWords(entry.name),
      namespace,
    }
  })

  const namespaces = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([namespace]) => namespace)

  return { items, namespaces }
}

export interface ParsedQuery {
  /** A namespace typed as a prefix — `L:batt` filters rather than searching. */
  namespace: string | null
  /** The loose words, from everything outside quotes. */
  terms: string[]
  compact: string
  /** The quoted parts, lowercased, each matched literally. */
  literals: string[]
}

/**
 * A quoted run, or an unclosed one to the end of the text: `"ligh` is already
 * a literal while it is being typed, rather than loose until the closing quote
 * arrives and then suddenly strict.
 */
const QUOTED = /"([^"]*)"?/g

/**
 * A query's namespace prefix and the rest of it: `L:batt` -> `l`, `batt`.
 *
 * The one reading of a prefix, shared by the search and by the Variables
 * panel, which shows the prefix as a pill and lights the matching chip. Only an
 * unquoted letter and colon at the very start: `"L:NAV"` is a literal.
 *
 * Only the namespaces in `known` — the index's, which are the panel's chips.
 * A typed prefix and a chip are then the same set, one for one: `W:` is a real
 * namespace in the dialect, but with nothing in the index under it there is no
 * chip, so it is text like any other rather than a filter that finds nothing.
 */
export function splitPrefix(
  raw: string,
  known: readonly string[]
): { namespace: string | null; rest: string } {
  const namespaced = /^([A-Za-z]):(.*)$/s.exec(raw.trimStart())
  const namespace = namespaced?.[1].toLowerCase()

  return namespace && known.includes(namespace)
    ? { namespace, rest: namespaced![2] }
    : { namespace: null, rest: raw }
}

export function parseQuery(raw: string, known: readonly string[]): ParsedQuery {
  const split = splitPrefix(raw.trim(), known)
  const namespace = split.namespace
  const text = split.rest

  const literals = [...text.matchAll(QUOTED)]
    .map((match) => match[1].toLowerCase())
    .filter(Boolean)
  const loose = text.replace(QUOTED, " ")

  return {
    namespace,
    terms: splitWords(loose),
    compact: compactOf(loose),
    literals,
  }
}

/** Whether every character of `needle` appears in `haystack`, in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  if (!needle) return true

  let at = 0
  for (const character of haystack) {
    if (character === needle[at] && ++at === needle.length) return true
  }

  return false
}

/**
 * How well one word matched, or null when it did not match at all.
 *
 * A word may match any word of the name, so the tier is the best available:
 * matching one word exactly and another only partially is still a better result
 * than matching both partially.
 */
function scoreTerm(term: string, item: IndexedVar): number | null {
  let best: number = TIER.none

  for (const word of item.words) {
    if (word === term) return TIER.exact
    if (word.startsWith(term)) best = Math.min(best, TIER.wordPrefix)
    else if (word.includes(term)) best = Math.min(best, TIER.wordPart)
  }

  if (best !== TIER.none) return best
  return isSubsequence(term, item.compact) ? TIER.subsequence : null
}

function scoreItem(item: IndexedVar, query: ParsedQuery): number {
  if (query.namespace !== null && item.namespace !== query.namespace)
    return TIER.none

  // Quoted parts are a condition, not a score: each one is in the name or the
  // entry is out. The whole name, prefix included, so `"L:NAV"` works too.
  for (const literal of query.literals) {
    if (!item.lower.includes(literal)) return TIER.none
  }

  // Only quotes: rank by how much of the name the quote accounts for.
  if (!query.terms.length && query.literals.length) {
    const [first] = query.literals
    if (item.bare === first || item.lower === first) return TIER.exact
    if (item.bare.startsWith(first) || item.lower.startsWith(first))
      return TIER.prefix
    return TIER.wordPart
  }

  // A namespace on its own — `L:` — is a filter with nothing left to match.
  if (!query.terms.length) return TIER.exact

  if (item.compact === query.compact) return TIER.exact
  if (item.compact.startsWith(query.compact)) return TIER.prefix

  // Every word has to land somewhere, and the entry is only as good as its
  // worst one: a query is a conjunction, so a single vague word makes the whole
  // match vague.
  let worst: number = TIER.exact
  for (const term of query.terms) {
    const tier = scoreTerm(term, item)
    if (tier === null) return TIER.none
    worst = Math.max(worst, tier)
  }

  return worst
}

/**
 * Ranked matches, best first.
 *
 * Four tiebreaks under the match tier, in descending order of how much they
 * claim. Evidence first — see `evidenceRank` — then how many profiles use it,
 * which is a signal no other tool has, because the corpus is a record of what
 * people actually bind. `sdk.uses` catches the tail: for the thousands of names
 * with no local usage at all, how hard Asobo's own templates lean on a variable
 * is the only thing left that is not the alphabet.
 */
export function searchVars(
  index: VarSearchIndex,
  query: string,
  limit: number,
  /**
   * An extra condition, applied before the limit rather than after it.
   *
   * Filtering the returned page would silently shrink it — "this aircraft only"
   * over a two-hundred-row cap would show however few of the top two hundred
   * happened to qualify, which is a different list from the top two hundred
   * that qualify.
   */
  keep?: (entry: VarEntry) => boolean
): VarSearchResult[] {
  const parsed = parseQuery(query, index.namespaces)
  const matches: VarSearchResult[] = []

  for (const item of index.items) {
    if (keep && !keep(item.entry)) continue

    const tier = scoreItem(item, parsed)
    if (tier !== TIER.none)
      matches.push({ entry: item.entry, tier, evidence: item.evidence })
  }

  matches.sort(
    (a, b) =>
      a.tier - b.tier ||
      a.evidence - b.evidence ||
      (b.entry.corpus?.fileCount ?? 0) - (a.entry.corpus?.fileCount ?? 0) ||
      (b.entry.corpus?.count ?? 0) - (a.entry.corpus?.count ?? 0) ||
      (b.entry.sdk?.uses ?? 0) - (a.entry.sdk?.uses ?? 0) ||
      a.entry.name.localeCompare(b.entry.name)
  )

  return matches.slice(0, limit)
}
