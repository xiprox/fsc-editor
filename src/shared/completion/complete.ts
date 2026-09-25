/**
 * What to offer at a slot, in order — the whole decision, headless.
 *
 * `complete` takes where the caret is, what the file says and what the index
 * knows, and returns offers already ranked. The Monaco adapter maps them onto
 * items and decides nothing. The order is the part that matters and the part
 * that is measured: `npm run check:completion` ranks every name in the
 * committed corpus with its own file left out, and a change here lands with
 * the numbers before and after.
 *
 * Monaco still filters and still orders by match quality; this decides every
 * tie, and a tie is what the list is while only a namespace has been typed.
 */

import { identityOf } from "../corpus.ts"
import {
  corpusEntries,
  corpusFiles,
  evidenceRank,
  profilesAt,
  sharedGetsOf,
} from "../evidence.ts"
import { fileIsFor, profileIsFor } from "../profile/aircraft.ts"
import type {
  CorpusPosition,
  ProfileSummary,
  VarEntry,
  VarIndex,
} from "../types.ts"
import { UNITS, canonicalUnit } from "../units.ts"
import { NAMESPACES } from "../vars/namespaces.ts"
import { parseVar, varColumns } from "../vars/parse.ts"
import type { DocumentFacts, DocumentUse } from "./document.ts"
import { belongsAt, shape, type NamePosition, type Shape } from "./shapes.ts"
import type { CompletionSlot, NameSlot, UnitsSlot } from "./slot.ts"

/** The index, arranged for completion. Built once per index. */
export interface CompletionIndex {
  entries: readonly VarEntry[]
  /** By identity. */
  byName: ReadonlyMap<string, VarEntry>
  profiles: readonly ProfileSummary[]
  aircraft: string | null
}

export function completionIndex(index: VarIndex | null): CompletionIndex {
  const entries = index?.entries ?? []
  return {
    entries,
    byName: new Map(entries.map((entry) => [entry.name, entry])),
    profiles: index?.profiles ?? [],
    aircraft: index?.aircraft ?? null,
  }
}

/** Why an offer is in the list, and what its detail line says. */
export type Evidence =
  | { from: "entry" }
  | { from: "sets-write"; profiles: number }
  | { from: "file"; uses: number }
  | { from: "aircraft"; how: "moved" | "input-event" | "profile" }
  | { from: "corpus"; at: CorpusPosition; profiles: number }
  | { from: "catalog"; category?: string }
  | { from: "sim" }
  | { from: "shared-get"; file: string | null }
  | { from: "similar"; file: string }
  | { from: "similar-setter"; file: string }
  | { from: "sequence"; file: string }
  | { from: "unit"; uses?: number; canonicalOf?: string }

export interface Offer {
  /** What the list shows. */
  label: string
  /** The text that replaces the name. */
  text: string
  /** Replaces the whole reference from its `(` instead — see `Shape`. */
  snippet?: string
  /** The name as a snippet, with a part to choose — see `Shape`. */
  template?: string
  /** A unit inserted after the name, on a `get:` line. */
  units?: string
  kind: "variable" | "event" | "unit"
  evidence: Evidence
  /** The variable, for documentation resolved when the item is focused. */
  entry?: VarEntry
}

export function complete(
  slot: CompletionSlot,
  document: DocumentFacts,
  index: CompletionIndex
): Offer[] {
  const ranked = new Ranked()
  for (const segment of completeSegments(slot, document, index))
    ranked.addAll(segment)
  return ranked.list
}

/**
 * The same answer as `complete`, as ranked segments rather than one list: an
 * offer in a later segment whose text an earlier one has is not offered
 * again.
 *
 * The index-wide segments are shared, cached lists, so a caller that ranks
 * many slots — the sweep — can walk them without copying nineteen thousand
 * offers per slot. The editor wants one list, and asks `complete`.
 */
export function completeSegments(
  slot: CompletionSlot,
  document: DocumentFacts,
  index: CompletionIndex
): readonly (readonly Offer[])[] {
  if (slot.kind === "units") return [unitOffers(slot, index)]

  const scope = scopeOf(document, index)
  switch (slot.position) {
    case "write":
      return writeSegments(slot, document, index, scope)
    case "get":
    case "read":
      return readSegments(slot, document, index, scope)
    case "skp":
      return [skipOffers(slot, document, index)]
  }
}

/* -------------------------------------------------------------------------- */
/* Scope                                                                       */
/* -------------------------------------------------------------------------- */

interface Scope {
  /** The open file, whose saved copy the corpus leaves out. */
  openFile: string | null
  /** Whether the aircraft in the sim says anything about this file. */
  forAircraft: boolean
  /**
   * Whether the open file is the aircraft's own profile — in which case the
   * aircraft's "named by its profile" evidence is the open file's saved copy,
   * and left out with it.
   */
  openIsProfile: boolean
}

function scopeOf(document: DocumentFacts, index: CompletionIndex): Scope {
  const openFile = document.relPath
  const summaries = new Map(index.profiles.map((p) => [p.relPath, p]))
  const resolve = resolver(index.profiles)

  // The open buffer answers for itself: its includes may not be saved yet.
  const includesOf = (relPath: string): readonly string[] =>
    relPath === openFile
      ? document.includes.map(resolve)
      : (summaries.get(relPath)?.includes ?? [])

  const files = index.profiles.map((profile) => profile.relPath)
  if (openFile && !summaries.has(openFile)) files.push(openFile)

  return {
    openFile,
    forAircraft: fileIsFor(openFile, index.aircraft, files, includesOf),
    openIsProfile: profileIsFor(openFile, index.aircraft),
  }
}

/** Resolves an `include:` target the way FS Copilot does — see ProfileSummary. */
function resolver(
  profiles: readonly ProfileSummary[]
): (target: string) => string {
  const onDisk = new Map(
    profiles.map((profile) => [profile.relPath.toLowerCase(), profile.relPath])
  )
  return (target) => {
    const wanted = target
      .split("\\")
      .join("/")
      .replace(/^\.?\//, "")
    return onDisk.get(wanted.toLowerCase()) ?? target
  }
}

/* -------------------------------------------------------------------------- */
/* Offers                                                                      */
/* -------------------------------------------------------------------------- */

/** Offers in rank order, the first of any text winning. */
class Ranked {
  readonly list: Offer[] = []
  private readonly seen = new Set<string>()

  add(offer: Offer | null): void {
    if (!offer || this.seen.has(offer.text)) return
    this.seen.add(offer.text)
    this.list.push(offer)
  }

  addAll(offers: readonly Offer[]): void {
    for (const offer of offers) this.add(offer)
  }
}

function kindOf(text: string): Offer["kind"] {
  const ns = parseVar(text).ns
  return ns === "K" || ns === "H" || ns === "W" ? "event" : "variable"
}

function offerOf(
  entry: VarEntry,
  position: NamePosition,
  evidence: Evidence,
  form?: string
): Offer | null {
  const shaped: Shape | null = shape(entry, position, form)
  if (!shaped) return null

  return {
    label: shaped.text,
    text: shaped.text,
    ...(shaped.snippet ? { snippet: shaped.snippet } : {}),
    ...(shaped.template ? { template: shaped.template } : {}),
    ...(shaped.units ? { units: shaped.units } : {}),
    kind: kindOf(shaped.text),
    evidence,
    entry,
  }
}

function identityOfName(name: string): string {
  const columns = varColumns(name)
  return identityOf(columns.namespace, columns.name)
}

/** The index's entry for a name, or a bare one for a name only this file knows. */
function entryFor(index: CompletionIndex, name: string): VarEntry {
  const identity = identityOfName(name)
  return index.byName.get(identity) ?? { name: identity }
}

/**
 * Evidence for a name nothing local says anything about, or null when nothing
 * does at all.
 *
 * The null case is a name whose only evidence was the open file's saved copy
 * — which the corpus leaves out, since the buffer speaks for it. Half-typed
 * names land there as soon as a save is rescanned, and one must never be
 * offered back as a name "known to the sim".
 */
function knownOnly(entry: VarEntry): Evidence | null {
  if (entry.sdk) return { from: "catalog", category: entry.sdk.doc?.category }
  if (entry.sim) return { from: "sim" }
  return null
}

/** This file's uses of names, the one under the caret left out. */
function fileUses(
  document: DocumentFacts,
  slot: NameSlot,
  positions: readonly NamePosition[]
): { form: string; uses: number }[] {
  const counts = new Map<string, number>()

  for (const use of document.uses) {
    if (!positions.includes(use.position)) continue
    if (isUnderCaret(use, slot)) continue
    counts.set(use.form, (counts.get(use.form) ?? 0) + 1)
  }

  return [...counts]
    .map(([form, uses]) => ({ form, uses }))
    .sort((a, b) => b.uses - a.uses || a.form.localeCompare(b.form))
}

function isUnderCaret(use: DocumentUse, slot: NameSlot): boolean {
  return use.line === slot.line && use.column === slot.start
}

/* -------------------------------------------------------------------------- */
/* Write position                                                              */
/* -------------------------------------------------------------------------- */

/**
 * After `(>`.
 *
 * Measured leaving each corpus file out in turn, over 12,676 written
 * references: 69% are what the most similar profile's setter writes for the
 * same `get:`, 73% are written for that `get:` in some other profile, 66% are
 * used elsewhere in the same file. Global write frequency — the old first
 * tier — reaches 0.6% on its own. The sweep puts the right name first 68% of
 * the time with only the namespace typed, where the old order managed 40%.
 */
function writeSegments(
  slot: NameSlot,
  document: DocumentFacts,
  index: CompletionIndex,
  scope: Scope
): readonly (readonly Offer[])[] {
  const ranked = new Ranked()
  const here = document.entryAt(slot.line)
  const pairs = here
    ? (index.byName.get(identityOfName(here.name))?.corpus?.setsWrite ?? [])
    : []

  // 1. What this variable's setter writes in the profiles most like this
  // one: for 69% of the corpus's written names, the most similar profile's
  // setter for the same `get:` writes exactly that name.
  const { alike } = contextOf(document, index, scope, slot)
  for (const file of alike)
    for (const pair of pairs)
      if (pair.files.includes(file))
        ranked.add(
          offerOf(
            entryFor(index, pair.form),
            "write",
            { from: "similar-setter", file },
            pair.form
          )
        )

  // 2. This entry's own variable — for a `B:` setter, 97% of the time.
  if (here)
    ranked.add(
      offerOf(entryFor(index, here.name), "write", { from: "entry" }, here.name)
    )

  // 3. What this variable's setters write in other profiles.
  const paired = pairs
    .map((pair) => ({
      ...pair,
      profiles: scope.openFile
        ? pair.files.filter((file) => file !== scope.openFile).length
        : pair.files.length,
    }))
    .filter((pair) => pair.profiles > 0)
    .sort((a, b) => b.profiles - a.profiles || b.entries - a.entries)
  for (const pair of paired)
    ranked.add(
      offerOf(
        entryFor(index, pair.form),
        "write",
        { from: "sets-write", profiles: pair.profiles },
        pair.form
      )
    )

  // 4. Names used elsewhere in this file — written, or read by a `get:`.
  for (const use of fileUses(document, slot, ["write", "get"]))
    ranked.add(
      offerOf(
        entryFor(index, use.form),
        "write",
        { from: "file", uses: use.uses },
        use.form
      )
    )

  // 5–7. The index, which does not depend on the caret.
  return [ranked.list, ...tailBands(index, "write", scope)]
}

/* -------------------------------------------------------------------------- */
/* Get and read positions                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A `get:` name, or a reference a setter reads.
 *
 * First what the file itself points at: for a `get:`, the names that follow
 * the previous entry in the most similar profile; for a read, the entry's own
 * variable and the file's names. Then the aeroplane — what moved on the
 * aircraft in the sim, what it registered. Then the rest of the file's
 * context, which knows more than the corpus does about which of its thousands
 * of names comes next: measured over the corpus's 26,781 `get:` names, 66%
 * are in the one profile most like their file — nearly all of the 70% that
 * any other profile has — and 90% share a family (`L:A32NX`, `L:XMLVAR`,
 * `A:LIGHT`) with a name above them. Then the rest of the corpus by how many
 * profiles read it, and last what is merely known to exist.
 */
function readSegments(
  slot: NameSlot,
  document: DocumentFacts,
  index: CompletionIndex,
  scope: Scope
): readonly (readonly Offer[])[] {
  const position = slot.position
  const [aircraft, profiled, known] = tailBands(index, position, scope)
  const context = contextOf(document, index, scope, slot)

  const next =
    position === "get"
      ? sequenceOffers(slot, document, index, context)
      : ownReads(slot, document, index)

  // Names the profiles most like this one use, the most alike first.
  const similar = memo(context, `similar ${position}`, () => {
    const ranked = new Ranked()
    for (const [identity, file] of context.similar) {
      const entry = index.byName.get(identity)
      if (entry) ranked.add(offerOf(entry, position, { from: "similar", file }))
    }
    return ranked.list
  })

  // The corpus's names in a family this file already uses, in corpus order.
  const family = memo(context, `family ${position}`, () =>
    profiled!.filter((offer) => context.families.has(familyOfOffer(offer)))
  )

  // Names only this file uses, which nothing on disk has seen yet.
  const unsaved = new Ranked()
  for (const use of fileUses(document, slot, ["get", "read", "write", "skp"])) {
    if (index.byName.has(identityOfName(use.form))) continue
    unsaved.add(
      offerOf(
        entryFor(index, use.form),
        position,
        { from: "file", uses: use.uses },
        use.form
      )
    )
  }

  return [next, aircraft!, similar, family, unsaved.list, profiled!, known!]
}

/**
 * What a setter reads: its own entry's variable, then this file's names.
 *
 * Measured over the corpus's 545 reads inside setters: 516 read the entry's
 * own `get:` variable, spelled as the `get:` spells it — `A:EXTERNAL POWER
 * ON:1`, index and all — and 543 read a name the file uses elsewhere.
 */
function ownReads(
  slot: NameSlot,
  document: DocumentFacts,
  index: CompletionIndex
): Offer[] {
  const ranked = new Ranked()
  const here = document.entryAt(slot.line)
  if (here)
    ranked.add(
      offerOf(entryFor(index, here.name), "read", { from: "entry" }, here.name)
    )

  for (const use of fileUses(document, slot, ["read", "get", "write"]))
    ranked.add(
      offerOf(
        entryFor(index, use.form),
        "read",
        { from: "file", uses: use.uses },
        use.form
      )
    )

  return ranked.list
}

/** How many names past the previous entry the sequence offers. */
const SEQUENCE_AHEAD = 3

/**
 * The names that come next: what follows this file's previous entry in the
 * most similar profile that has it, skipping what this file already says.
 *
 * The sharpest signal the corpus has for a `get:` line. Another profile for
 * the same aircraft lists much the same entries in much the same order, and
 * for 60% of the corpus's `get:` names the author wrote exactly the one that
 * follows the previous entry in the profile most like theirs — 91% of the
 * time that the previous entry is in that profile at all.
 */
function sequenceOffers(
  slot: NameSlot,
  document: DocumentFacts,
  index: CompletionIndex,
  context: Context
): Offer[] {
  let previous: string | null = null
  for (const entry of document.entries)
    if (entry.at.get < slot.line) previous = entry.name
    else break
  if (!previous) return []

  const written = new Set<string>()
  for (const use of document.uses)
    if (use.position === "get" && !isUnderCaret(use, slot))
      written.add(use.form)

  const summaries = new Map(index.profiles.map((p) => [p.relPath, p]))
  for (const file of context.alike) {
    const gets = summaries.get(file)?.gets ?? []
    const at = gets.indexOf(previous)
    if (at === -1) continue

    const ranked = new Ranked()
    for (const name of gets.slice(at + 1)) {
      if (ranked.list.length >= SEQUENCE_AHEAD) break
      if (written.has(name)) continue
      ranked.add(
        offerOf(entryFor(index, name), "get", { from: "sequence", file }, name)
      )
    }
    return ranked.list
  }

  return []
}

/**
 * The family a name belongs to: its namespace and the first word of its name
 * — `L:A32NX`, `L:XMLVAR`, `A:LIGHT`. Vendors name a whole aircraft's
 * variables from one stem, so a family the file already uses is the best
 * guess at the next name's, short of a profile that has it.
 */
export function familyOf(name: string): string {
  const match = /^([A-Za-z]:)(?:\d:)?([^_ :]+)/.exec(name)
  return match
    ? `${match[1]!.toUpperCase()}${match[2]!.toUpperCase()}`
    : name.toUpperCase()
}

/** A context's derived lists, built once per buffer version and index. */
function memo(context: Context, key: string, build: () => Offer[]): Offer[] {
  let found = context.lists.get(key)
  if (!found) {
    found = build()
    context.lists.set(key, found)
  }
  return found
}

const offerFamilies = new WeakMap<Offer, string>()

/** An offer's family, worked out once — the index's offers outlive a keystroke. */
function familyOfOffer(offer: Offer): string {
  let family = offerFamilies.get(offer)
  if (family === undefined) {
    family = familyOf(offer.text)
    offerFamilies.set(offer, family)
  }
  return family
}

interface Context {
  /** Lists derived from this context, by what they are for. */
  lists: Map<string, Offer[]>
  /** The profiles most like this file, the most alike first. */
  alike: string[]
  /** Names in the profiles most like this file, best first, with the profile. */
  similar: Map<string, string>
  /** Families this file uses. */
  families: Set<string>
}

/** How many of the most similar profiles lend their names. */
const SIMILAR_PROFILES = 3

/** Contexts kept per index, by what they were built from. */
const contexts = new WeakMap<CompletionIndex, Map<string, Context>>()

/** How many contexts an index keeps — a few open files' worth. */
const CONTEXTS_KEPT = 8

/**
 * What the file says about the names around it: which profiles it resembles,
 * and which families it draws from.
 *
 * Built from every use but the one under the caret, which is half typed and
 * says nothing but what has been typed — and keyed by those uses, so typing
 * inside a name, which changes the buffer at every keystroke, reuses one
 * context rather than rebuilding it at each.
 *
 * Similarity is the share of names two files have in common (Jaccard), over
 * every name each uses in any position. The open file's saved copy is not a
 * profile like it; it is it.
 */
function contextOf(
  document: DocumentFacts,
  index: CompletionIndex,
  scope: Scope,
  slot: NameSlot
): Context {
  const uses = document.uses.filter((use) => !isUnderCaret(use, slot))
  const key = `${scope.openFile ?? ""}\n${uses.map((use) => use.form).join("\n")}`

  let kept = contexts.get(index)
  if (!kept) {
    kept = new Map()
    contexts.set(index, kept)
  }
  const held = kept.get(key)
  if (held) return held

  const mine = new Set<string>()
  const families = new Set<string>()
  for (const use of uses) {
    mine.add(use.identity)
    families.add(familyOf(use.form))
  }

  const alike: { file: string; names: Set<string>; score: number }[] = []
  if (mine.size)
    for (const [file, names] of profileNames(index)) {
      if (file === scope.openFile) continue
      let shared = 0
      for (const name of mine) if (names.has(name)) shared++
      if (!shared) continue
      alike.push({
        file,
        names,
        score: shared / (mine.size + names.size - shared),
      })
    }
  alike.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))

  const weight = new Map<string, { score: number; file: string }>()
  for (const { file, names, score } of alike.slice(0, SIMILAR_PROFILES))
    for (const name of names) {
      const known = weight.get(name)
      if (known) known.score += score
      else weight.set(name, { score, file })
    }

  const similar = new Map(
    [...weight]
      .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]))
      .map(([name, { file }]) => [name, file])
  )

  const context: Context = {
    lists: new Map(),
    alike: alike.slice(0, SIMILAR_PROFILES).map(({ file }) => file),
    similar,
    families,
  }

  if (kept.size >= CONTEXTS_KEPT) kept.delete(kept.keys().next().value!)
  kept.set(key, context)
  return context
}

const profileNamesCache = new WeakMap<
  CompletionIndex,
  Map<string, Set<string>>
>()

/** Every profile's names, in any position, from the index's own file lists. */
function profileNames(index: CompletionIndex): Map<string, Set<string>> {
  let byFile = profileNamesCache.get(index)
  if (byFile) return byFile

  byFile = new Map()
  for (const entry of index.entries)
    for (const file of corpusFiles(entry.corpus)) {
      let names = byFile.get(file)
      if (!names) {
        names = new Set()
        byFile.set(file, names)
      }
      names.add(entry.name)
    }

  profileNamesCache.set(index, byFile)
  return byFile
}

/* -------------------------------------------------------------------------- */
/* The index's part, cached                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The index-wide offers for a position, which depend on neither the caret nor
 * the file's text — only on the index, the open file (left out of the
 * corpus) and whether the aircraft in the sim applies. Built once per
 * combination; a keystroke costs the few offers in front of them.
 */
const cached = new WeakMap<CompletionIndex, Map<string, Offer[][]>>()

/**
 * The index's offers in bands, strongest evidence first — see the builders
 * for what each position's bands are. Callers put the file's own offers
 * between them.
 */
function tailBands(
  index: CompletionIndex,
  position: NamePosition,
  scope: Scope
): Offer[][] {
  const key = `${position}|${scope.openFile ?? ""}|${scope.forAircraft}|${scope.openIsProfile}`
  let byScope = cached.get(index)
  if (!byScope) {
    byScope = new Map()
    cached.set(index, byScope)
  }

  let bands = byScope.get(key)
  if (!bands) {
    bands =
      position === "write"
        ? writeTail(index, scope)
        : readTail(index, position, scope)
    byScope.set(key, bands)
  }

  return bands
}

interface Scored {
  offer: Offer
  score: number[]
}

function inOrder(scored: Scored[]): Offer[] {
  return scored
    .sort((a, b) => {
      for (let at = 0; at < a.score.length; at++) {
        const difference = a.score[at]! - b.score[at]!
        if (difference) return difference
      }
      return a.offer.text.localeCompare(b.offer.text)
    })
    .map((item) => item.offer)
}

/** Tiers 4–6 of the write position. */
function writeTail(index: CompletionIndex, scope: Scope): Offer[][] {
  const strong: Scored[] = []
  const weak: Scored[] = []

  for (const entry of index.entries) {
    const aircraft = scope.forAircraft ? entry.aircraft : undefined
    const written = profilesAt(entry.corpus, "write", scope.openFile)

    if (aircraft?.changes) {
      // 4. The aircraft in the sim's own: what moved there.
      const offer = offerOf(entry, "write", { from: "aircraft", how: "moved" })
      if (offer) strong.push({ offer, score: [0, -aircraft.changes] })
      continue
    }

    if (written > 0) {
      // 5. Written anywhere in the corpus.
      const offer = offerOf(entry, "write", {
        from: "corpus",
        at: "write",
        profiles: written,
      })
      if (offer)
        strong.push({
          offer,
          score: [1, -written, -(entry.corpus?.write?.entries ?? 0)],
        })
      continue
    }

    // 6. Known to exist, and writable — read by profiles first, then by how
    // hard the SDK's own templates lean on it.
    const read = corpusFiles(entry.corpus).filter(
      (file) => file !== scope.openFile
    ).length
    const evidence: Evidence | null =
      read > 0
        ? { from: "corpus", at: "get", profiles: read }
        : knownOnly(entry)
    if (!evidence) continue

    const offer = offerOf(entry, "write", evidence)
    if (offer) weak.push({ offer, score: [-read, -(entry.sdk?.uses ?? 0)] })
  }

  return [inOrder(strong), inOrder(weak)]
}

/**
 * The evidence bands of the `get:` and read positions: the aircraft's own,
 * the profiles', and the merely known.
 */
function readTail(
  index: CompletionIndex,
  position: NamePosition,
  scope: Scope
): Offer[][] {
  const aircraft: Scored[] = []
  const profiled: Scored[] = []
  const weak: Scored[] = []

  for (const entry of index.entries) {
    const band = evidenceRank(entry, scope.forAircraft, scope.openIsProfile)
    const read = profilesAt(entry.corpus, position, scope.openFile)
    const any = corpusFiles(entry.corpus).filter(
      (file) => file !== scope.openFile
    ).length

    const evidence: Evidence | null =
      band === 0
        ? { from: "aircraft", how: "moved" }
        : band === 1
          ? {
              from: "aircraft",
              how: entry.aircraft?.inputEvent ? "input-event" : "profile",
            }
          : band === 2 && any > 0
            ? {
                from: "corpus",
                at: read > 0 ? position : dominantPosition(entry),
                profiles: read > 0 ? read : any,
              }
            : knownOnly(entry)
    if (!evidence) continue

    const offer = offerOf(entry, position, evidence)
    if (!offer) continue

    const score = [
      band,
      -read,
      -any,
      -corpusEntries(entry.corpus),
      -(entry.sdk?.uses ?? 0),
    ]
    ;(band < 2 ? aircraft : band === 2 && any > 0 ? profiled : weak).push({
      offer,
      score,
    })
  }

  return [inOrder(aircraft), inOrder(profiled), inOrder(weak)]
}

/** Where the corpus uses a variable most, for a detail line. */
function dominantPosition(entry: VarEntry): CorpusPosition {
  const corpus = entry.corpus
  const order: CorpusPosition[] = ["get", "write", "read", "skp"]
  let best: CorpusPosition = "get"
  let most = -1
  for (const position of order) {
    const files = corpus?.[position]?.files.length ?? 0
    if (files > most) {
      best = position
      most = files
    }
  }
  return best
}

/* -------------------------------------------------------------------------- */
/* skp                                                                         */
/* -------------------------------------------------------------------------- */

/**
 * The name a `skp:` holds.
 *
 * FS Copilot matches it exactly against the `get:` of a `shared:` entry
 * anywhere in the flattened tree, so those are the only names that can work.
 * And the corpus nearly always names one: of its 235 `skp:` values in
 * `shared:` entries that are not `skp: true`, 228 name the entry's own
 * `get:` and 4 another entry in the same file. The design said to leave the
 * entry's own name out; the sweep measured that as exactly backwards. A
 * `skp:` in a `master:` entry does nothing, so nothing is offered there.
 */
function skipOffers(
  slot: NameSlot,
  document: DocumentFacts,
  index: CompletionIndex
): Offer[] {
  const here = document.entryAt(slot.line)
  if (!here || here.block !== "shared") return []

  const ranked = new Ranked()

  // The entry's own variable, which is what 228 of 235 name.
  ranked.add(skipOffer(here.name, index, { from: "entry" }))

  // Then this file's other shared gets, nearest the caret first.
  const local = document.entries
    .filter((entry) => entry.block === "shared")
    .sort(
      (a, b) => Math.abs(a.at.get - slot.line) - Math.abs(b.at.get - slot.line)
    )
  for (const entry of local)
    ranked.add(skipOffer(entry.name, index, { from: "shared-get", file: null }))

  // Then the rest of every tree this file is loaded in.
  for (const [file, gets] of treeGets(document, index))
    for (const name of gets)
      ranked.add(skipOffer(name, index, { from: "shared-get", file }))

  return ranked.list
}

function skipOffer(
  name: string,
  index: CompletionIndex,
  evidence: Evidence
): Offer | null {
  // A `get:` still being typed — `K:` and nothing after it — names nothing.
  if (!belongsAt(name, "skp")) return null
  return {
    label: name,
    text: name,
    kind: kindOf(name),
    evidence,
    entry: entryFor(index, name),
  }
}

/**
 * The `shared:` gets of every other file loaded alongside this one: what its
 * includes reach, and what reaches it — a module's `skp:` resolves in the
 * trees of the profiles that include it.
 */
function treeGets(
  document: DocumentFacts,
  index: CompletionIndex
): [string, readonly string[]][] {
  const openFile = document.relPath
  const summaries = new Map(index.profiles.map((p) => [p.relPath, p]))
  const resolve = resolver(index.profiles)
  const includesOf = (relPath: string): string[] =>
    relPath === openFile
      ? document.includes.map(resolve)
      : [...(summaries.get(relPath)?.includes ?? [])]

  // Every root whose tree holds this file: itself, and anything including it.
  const roots = new Set<string>(openFile ? [openFile] : [])
  let grew = true
  while (grew) {
    grew = false
    for (const profile of index.profiles)
      if (
        !roots.has(profile.relPath) &&
        includesOf(profile.relPath).some((target) => roots.has(target))
      ) {
        roots.add(profile.relPath)
        grew = true
      }
  }

  const reached = new Set<string>()
  const queue = [...roots]
  while (queue.length) {
    const file = queue.shift()!
    if (reached.has(file)) continue
    reached.add(file)
    queue.push(...includesOf(file))
  }
  if (openFile) reached.delete(openFile)

  return [...reached]
    .map((file): [string, readonly string[]] => [
      file,
      sharedGetsOf(
        summaries.get(file) ?? {
          relPath: file,
          includes: [],
          gets: [],
          master: [],
        }
      ),
    ])
    .filter(([, gets]) => gets.length > 0)
}

/* -------------------------------------------------------------------------- */
/* Units                                                                       */
/* -------------------------------------------------------------------------- */

const unitFrequency = new WeakMap<CompletionIndex, Map<string, number>>()

/**
 * After the comma of a `get:`: this variable's own units first — how profiles
 * read it, then what the SDK documents — then every unit by how much the
 * corpus uses it. SimConnect matches units case-insensitively, so the list
 * keeps a profile consistent rather than making it work.
 */
function unitOffers(slot: UnitsSlot, index: CompletionIndex): Offer[] {
  const ns = parseVar(slot.of).ns
  if (ns !== null && NAMESPACES[ns].units === "none") return []

  // Counted under canonical spellings: the corpus writes `gallons` where the
  // list says `Gallons`, and one unit counted under two names is two
  // half-counts.
  let frequency = unitFrequency.get(index)
  if (!frequency) {
    frequency = new Map()
    for (const entry of index.entries)
      for (const written of entry.corpus?.units ?? []) {
        const unit = canonicalUnit(written)
        if (unit)
          frequency.set(
            unit,
            (frequency.get(unit) ?? 0) + corpusEntries(entry.corpus)
          )
      }
    unitFrequency.set(index, frequency)
  }

  // This variable's own units, as canonical names. A spelling that names no
  // unit is left out: it is a typo in some profile, or — once the open file's
  // saved copy is rescanned — the half-typed unit under the caret, which unit
  // lists, unlike names, cannot leave out by file.
  const entry = index.byName.get(identityOfName(slot.of))
  const own = [
    ...(entry?.corpus?.units ?? []),
    ...(entry?.sdk?.doc?.units ? [entry.sdk.doc.units] : []),
  ].flatMap((written) => canonicalUnit(written) ?? [])

  const typed = slot.typed.trim()
  const canonical = typed ? canonicalUnit(typed) : null
  const ranked = new Ranked()

  const unitOffer = (unit: string): Offer => ({
    label: unit,
    text: unit,
    kind: "unit",
    evidence: {
      from: "unit",
      uses: frequency.get(unit),
      ...(canonical === unit && typed !== unit ? { canonicalOf: typed } : {}),
    },
  })

  if (canonical) ranked.add(unitOffer(canonical))
  for (const unit of own) ranked.add(unitOffer(unit))

  const rest =
    ns !== null && NAMESPACES[ns].units === "raw"
      ? ["Number"]
      : [...UNITS].sort(
          (a, b) => (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0)
        )
  for (const unit of rest) ranked.add(unitOffer(unit))

  return ranked.list
}
