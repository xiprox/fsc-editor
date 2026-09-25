/**
 * Questions about a variable's corpus evidence, asked one way everywhere.
 *
 * The facet is explicit about position — how a name is used on `get:` lines,
 * read and written inside setters, named by `skp:` — so a question that does
 * not care where ("how many profiles use this at all?") is a union, and the
 * union is written once here rather than at each place that shows one.
 */

import type {
  CorpusFacet,
  CorpusPosition,
  PositionEvidence,
  ProfileSummary,
  VarEntry,
} from "./types.ts"

/** A profile's `shared:` gets, first occurrences only — what a `skp:` can name. */
export function sharedGetsOf(summary: ProfileSummary): string[] {
  const master = new Set(summary.master)
  const out: string[] = []
  summary.gets.forEach((name, at) => {
    if (!master.has(at) && !out.includes(name)) out.push(name)
  })
  return out
}

/**
 * How much is known about a variable, lowest being most.
 *
 * One definition for every list that ranks variables — the Variables panel's
 * search and completion's `get:` and read positions — because two of them had
 * drifted: the panel's band ignored an aircraft's own input events, which the
 * index's sort counted as that aircraft's strongest evidence.
 *
 * The order is a claim about usefulness, in the aircraft in front of you:
 *
 *   0. it moves in this aircraft — the only direct evidence there is, since
 *      the sim will not say which variables belong to an aeroplane
 *   1. this aircraft registered it as an input event, or its own profile
 *      names it — statements of intent rather than observations
 *   2. some profile names it
 *   3. it exists, and that is all anybody knows
 *
 * `aircraftApplies` is false when the question is about a file for a
 * different aircraft: the aircraft in the sim then says nothing about it.
 *
 * **Applied after match quality, never before it.** A poor name match must
 * not float to the top because it happens to be moving; the query is what
 * the user said, and this only breaks ties among things that answered it
 * equally well.
 */
export function evidenceRank(
  entry: VarEntry,
  aircraftApplies = true,
  /** The aircraft's profile is the file being edited, which speaks for itself. */
  profileIsOpen = false
): number {
  const aircraft = aircraftApplies ? entry.aircraft : undefined
  if (aircraft?.changes) return 0
  if (aircraft?.inputEvent || (aircraft?.inProfile && !profileIsOpen)) return 1
  if (entry.corpus) return 2
  return 3
}

export const POSITIONS: readonly CorpusPosition[] = [
  "get",
  "read",
  "write",
  "skp",
]

/** One position's evidence, or undefined when the corpus never uses it there. */
export function evidenceAt(
  facet: CorpusFacet | undefined,
  position: CorpusPosition
): PositionEvidence | undefined {
  return facet?.[position]
}

/** Every profile that names the variable anywhere, in corpus order. */
export function corpusFiles(facet: CorpusFacet | undefined): string[] {
  if (!facet) return []

  const seen = new Set<string>()
  for (const position of POSITIONS)
    for (const file of facet[position]?.files ?? []) seen.add(file)

  return [...seen]
}

/** Entries that name it, counted once per position they name it in. */
export function corpusEntries(facet: CorpusFacet | undefined): number {
  if (!facet) return 0

  let total = 0
  for (const position of POSITIONS) total += facet[position]?.entries ?? 0
  return total
}

/**
 * Profiles that use it in one position, leaving one file out.
 *
 * The left-out file is the one open in the editor: its live buffer speaks for
 * it, and counting its saved copy as well would let a name deleted from the
 * buffer go on ranking on the strength of what is still on disk. Exact,
 * because `files` is never capped.
 */
export function profilesAt(
  facet: CorpusFacet | undefined,
  position: CorpusPosition,
  without?: string | null
): number {
  const files = facet?.[position]?.files
  if (!files) return 0
  if (!without) return files.length
  return files.includes(without) ? files.length - 1 : files.length
}
