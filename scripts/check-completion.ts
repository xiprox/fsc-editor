/**
 * Ranks every name in the corpus with its own file left out — the measure of
 * completion's order. See "Measuring it" in docs/sim-vars/19-completion.md.
 *
 * For each file: the index is folded from every *other* file and the SDK
 * catalogue, with no simulator, by the same shared fold main uses. Then every
 * name the file writes in a completable position — each `get:`, each
 * reference a setter reads or writes, each `skp:` — is completed at its own
 * place, with the file's live facts around it, and the rank of the name the
 * author actually wrote is recorded. Two documents: the whole file around the
 * name (editing), and only what is above it (writing top-down). Two lengths
 * of typing: the namespace alone, and the namespace and three characters.
 *
 * Filtering and ordering use Monaco's own `fuzzyScore`, so a rank here is the
 * position the suggest widget would show — Monaco orders by match score
 * first and by the provider's order only among ties.
 *
 * The baseline is the order completion had before 19-completion: write
 * targets by global write count, then the index in its stored order; the
 * index in its stored order for `get:` and `skp:`; nothing for reads. It is
 * given full counts where the old code counted five samples, so it is a
 * generous baseline.
 *
 * Unlike the other check scripts this defaults to the committed corpus, which
 * exists so a sweep can run on a fresh clone.
 *
 * Usage: npm run check:completion [folder] [--json file] [--every n]
 *   --every n   rank every nth name only, for a quicker run
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"

import { fuzzyScore } from "monaco-editor/esm/vs/base/common/filters.js"

import {
  completeSegments,
  completionIndex,
  documentFacts,
  type CompletionIndex,
  type DocumentFacts,
  type DocumentUse,
  type NameSlot,
  type Offer,
} from "../src/shared/completion/index.ts"
import { documentedParams } from "../src/shared/lang/rules/k-arity.ts"
import {
  corpusRowsOf,
  foldCorpus,
  type CorpusEntryRow,
  type CorpusRefRow,
} from "../src/shared/corpus.ts"
import { includesFromLines } from "../src/shared/profile/entries.ts"
import { entriesFromLines, scanLines } from "../src/shared/profile/index.ts"
import type { SdkVarCatalog } from "../src/shared/sdk-catalog.ts"
import type {
  CorpusPosition,
  ProfileSummary,
  VarEntry,
  VarIndex,
} from "../src/shared/types.ts"
import { parseVar } from "../src/shared/vars/parse.ts"

/* ---- arguments ----------------------------------------------------------- */

const argv = process.argv.slice(2).filter((arg) => arg !== "--")
const option = (name: string): string | undefined => {
  const at = argv.indexOf(name)
  if (at === -1) return undefined
  const value = argv[at + 1]
  argv.splice(at, 2)
  return value
}
const jsonOut = option("--json")
const every = Math.max(1, Number(option("--every") ?? 1))
const root = argv[0] ?? join(import.meta.dirname, "../corpus/profiles")

/* ---- the corpus ---------------------------------------------------------- */

interface File {
  relPath: string
  dir: string
  name: string
  lines: ReturnType<typeof scanLines>
  rows: CorpusEntryRow[]
  refs: CorpusRefRow[]
  summary: ProfileSummary
}

function collect(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collect(path))
    else if (/\.ya?ml$/i.test(entry.name)) found.push(path)
  }
  return found
}

const paths = collect(root)
let nextId = 1
const files: File[] = paths.map((path) => {
  const relPath = relative(root, path).split("\\").join("/")
  const slash = relPath.lastIndexOf("/")
  const lines = scanLines(readFileSync(path, "utf8"))
  const entries = entriesFromLines(lines, relPath)
  const { rows, refs } = corpusRowsOf(relPath, entries, nextId)
  nextId += entries.length

  const gets = entries.map((entry) => entry.name)
  const master = entries.flatMap((entry, at) =>
    entry.block === "master" ? [at] : []
  )

  return {
    relPath,
    dir: slash === -1 ? "" : relPath.slice(0, slash),
    name: slash === -1 ? relPath : relPath.slice(slash + 1),
    lines,
    rows,
    refs,
    summary: { relPath, includes: includesFromLines(lines), gets, master },
  }
})

// The sidebar's order, which the fold follows.
files.sort((a, b) =>
  a.dir !== b.dir ? a.dir.localeCompare(b.dir) : a.name.localeCompare(b.name)
)
const order = new Map(files.map((file, rank) => [file.relPath, rank]))

// Includes resolve from the root, case-insensitively, as FS Copilot does.
const onDisk = new Map(files.map((f) => [f.relPath.toLowerCase(), f.relPath]))
for (const file of files)
  file.summary.includes = file.summary.includes.map(
    (target) => onDisk.get(target.split("\\").join("/").toLowerCase()) ?? target
  )

const catalog = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../src/main/catalog/sdk-var-catalog.json"),
    "utf8"
  )
) as SdkVarCatalog

/** The index as the app would build it without `held`, and without a sim. */
function indexWithout(held: File): VarIndex {
  const rows: CorpusEntryRow[] = []
  const refs: CorpusRefRow[] = []
  for (const file of files) {
    if (file === held) continue
    rows.push(...file.rows)
    refs.push(...file.refs)
  }

  const entries = new Map<string, VarEntry>()
  for (const [name, corpus] of foldCorpus(rows, refs, order))
    entries.set(name, { name, corpus })
  for (const { name, ...rest } of catalog.vars) {
    const entry = entries.get(name) ?? { name }
    entry.sdk = rest
    entries.set(name, entry)
  }

  return {
    entries: [...entries.values()],
    scannedFiles: files.length - 1,
    elapsedMs: 0,
    aircraft: null,
    inputEvents: null,
    profiles: files.filter((f) => f !== held).map((f) => f.summary),
  }
}

/* ---- Monaco's ordering --------------------------------------------------- */

const OPTIONS = { firstMatchCanBeWeak: false, boostFullMatch: true }

/** Whether every character of `needle` is in `haystack`, in order — a cheap
 * test that rules out most non-matches before the real scorer runs. */
function subsequence(needle: string, haystack: string): boolean {
  let at = 0
  for (let i = 0; i < haystack.length && at < needle.length; i++)
    if (haystack[i] === needle[at]) at++
  return at === needle.length
}

function score(typed: string, text: string): number | null {
  const typedLow = typed.toLowerCase()
  const textLow = text.toLowerCase()
  if (!subsequence(typedLow, textLow)) return null
  const result = fuzzyScore(typed, typedLow, 0, text, textLow, 0, OPTIONS)
  return result ? result[0]! : null
}

interface Scored {
  text: string
  score: number
}

/**
 * A shared segment's offers that match `typed`, best first — sorted the way
 * Monaco sorts, by score and then by the provider's order. Cached per
 * segment and typed text, since most slots in a file type the same few
 * namespaces.
 */
const sortedCache = new WeakMap<
  readonly Offer[],
  Map<string, { list: Scored[]; at: Map<string, number> }>
>()

function sortedMatches(segment: readonly Offer[], typed: string) {
  let byTyped = sortedCache.get(segment)
  if (!byTyped) {
    byTyped = new Map()
    sortedCache.set(segment, byTyped)
  }

  let found = byTyped.get(typed)
  if (!found) {
    const list: Scored[] = []
    const seen = new Set<string>()
    for (const offer of segment) {
      if (seen.has(offer.text)) continue
      seen.add(offer.text)
      const s = score(typed, offer.text)
      if (s !== null) list.push({ text: offer.text, score: s })
    }
    // Stable: equal scores keep the provider's order.
    list.sort((a, b) => b.score - a.score)
    found = { list, at: new Map(list.map((item, i) => [item.text, i])) }
    byTyped.set(typed, found)
  }
  return found
}

/** Items in a best-first list scoring at least (or above) `score`. */
function countAtLeast(
  list: Scored[],
  score: number,
  strictly: boolean
): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const s = list[mid]!.score
    if (strictly ? s > score : s >= score) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Where `target` lands in the widget, 1-based, or null when it is not shown.
 *
 * Monaco's order is score first, then the provider's order — so on a tie an
 * offer from an earlier segment beats a later one, and an offer a later
 * segment repeats is shown once, where it first appeared. Per-slot segments
 * are scored directly; shared ones are counted from their cached, sorted
 * matches with a binary search, since most of a namespace ties.
 */
function rankOf(
  segments: readonly (readonly Offer[])[],
  typed: string,
  target: string,
  isShared: (segment: readonly Offer[]) => boolean
): number | null {
  const own: { text: string; score: number; segment: number; at: number }[] = []
  const shown = new Set<string>()
  let hit: { score: number; segment: number; at: number } | null = null

  segments.forEach((segment, segmentIndex) => {
    if (isShared(segment)) {
      const { list, at } = sortedMatches(segment, typed)
      const found = at.get(target)
      if (!hit && found !== undefined && !shown.has(target))
        hit = { score: list[found]!.score, segment: segmentIndex, at: found }
      return
    }

    segment.forEach((offer, position) => {
      if (shown.has(offer.text)) return
      shown.add(offer.text)
      const s = score(typed, offer.text)
      if (s === null) return
      own.push({
        text: offer.text,
        score: s,
        segment: segmentIndex,
        at: position,
      })
      if (!hit && offer.text === target)
        hit = { score: s, segment: segmentIndex, at: position }
    })
  })

  if (!hit) return null
  const h: { score: number; segment: number; at: number } = hit
  const beats = (s: number, segment: number, at: number) =>
    s > h.score ||
    (s === h.score &&
      (segment < h.segment || (segment === h.segment && at < h.at)))

  let rank = 1
  for (const item of own)
    if (item.text !== target && beats(item.score, item.segment, item.at)) rank++

  segments.forEach((segment, segmentIndex) => {
    if (!isShared(segment)) return
    const { list, at } = sortedMatches(segment, typed)

    const ahead =
      segmentIndex === h.segment
        ? h.at
        : countAtLeast(list, h.score, segmentIndex > h.segment)
    rank += ahead

    // An offer shown from an earlier, per-slot segment is not shown again.
    for (const text of shown) {
      const i = at.get(text)
      if (i !== undefined && i < ahead) rank--
    }
  })

  return rank
}

/* ---- the baseline --------------------------------------------------------- */

/**
 * The order before 19-completion, reproduced over the same index: write
 * targets by global count, then every entry in the stored order through the
 * old write rules; the stored order alone for `get:` and `skp:`.
 */
function legacySegments(
  index: CompletionIndex,
  position: CorpusPosition
): (readonly Offer[])[] {
  const stored = [...index.entries].sort(
    (a, b) =>
      (b.corpus?.get?.entries ?? 0) - (a.corpus?.get?.entries ?? 0) ||
      a.name.localeCompare(b.name)
  )
  const plain = (text: string): Offer => ({
    label: text,
    text,
    kind: "variable",
    evidence: { from: "sim" },
  })

  if (position === "read") return []
  if (position !== "write") return [stored.map((entry) => plain(entry.name))]

  const counts = new Map<string, number>()
  for (const entry of index.entries) {
    const write = entry.corpus?.write
    if (!write) continue
    const spellings = entry.corpus?.written?.filter(
      (w) => w.at === "write"
    ) ?? [{ form: entry.name, entries: write.entries }]
    for (const w of spellings)
      counts.set(w.form, (counts.get(w.form) ?? 0) + w.entries)
  }
  const targets = [...counts].sort((a, b) => b[1] - a[1]).map(([t]) => plain(t))

  const known = new Set(index.entries.map((entry) => entry.name))
  const rest: Offer[] = []
  for (const entry of stored) {
    const ref = parseVar(entry.name)
    let text: string | null = entry.name
    if (ref.ns === "A" && entry.sdk?.doc?.settable === false) text = null
    else if (ref.ns === "K") {
      const p = entry.sdk?.doc?.parameters
      const count = p ? documentedParams(p) : 0
      if (p && count >= 2) text = `K:${count}:${ref.name}`
    } else if (
      ref.ns === "B" &&
      ref.op === null &&
      known.has(`${entry.name}_Set`)
    )
      text = `${entry.name}_Set`
    else if (ref.ns === "E" && ref.name.toUpperCase() !== "SIMULATION RATE")
      text = null
    else if (ref.ns !== null && !"ALZHIOBK".includes(ref.ns)) text = null
    if (text) rest.push(plain(text))
  }

  return [targets, rest]
}

/* ---- the sweep ------------------------------------------------------------ */

type Variant = "file" | "above"
type Typing = "namespace" | "plus3"

interface Tally {
  n: number
  top1: number
  top5: number
  rr: number
  missed: number
}

const tallies = new Map<string, Tally>()
function record(key: string, rank: number | null): void {
  const t = tallies.get(key) ?? { n: 0, top1: 0, top5: 0, rr: 0, missed: 0 }
  t.n++
  if (rank === null) t.missed++
  else {
    if (rank === 1) t.top1++
    if (rank <= 5) t.top5++
    t.rr += 1 / rank
  }
  tallies.set(key, t)
}

const timings: Record<string, number[]> = {}

/** The file as far as a name: what is above it, for writing top-down. */
function above(document: DocumentFacts, use: DocumentUse): DocumentFacts {
  const earlier = (line: number, column: number) =>
    line < use.line || (line === use.line && column < use.column)
  return {
    ...document,
    uses: document.uses.filter((u) => earlier(u.line, u.column)),
    entries: document.entries.filter((e) => e.at.get <= use.line),
  }
}

const started = Date.now()
let ranked = 0

/** Segments already returned once: the index's cached lists. */
const repeated = new WeakSet<readonly Offer[]>()
const isShared = (segment: readonly Offer[]) => repeated.has(segment)

for (const held of files) {
  const index = completionIndex(indexWithout(held))
  const document = documentFacts(held.lines, held.relPath)
  const legacy = new Map<CorpusPosition, (readonly Offer[])[]>()
  // The first request per position after a new index builds its caches; the
  // editor pays that once per index, not per keystroke.
  const warmed = new Set<string>()

  document.uses.forEach((use, useIndex) => {
    if (useIndex % every !== 0) return

    const target = use.form
    const colon = target.indexOf(":")
    if (colon === -1) return

    const typings: Record<Typing, string> = {
      namespace: target.slice(0, colon + 1),
      plus3: target.slice(0, colon + 4),
    }
    const ns = parseVar(target).ns ?? "?"

    for (const variant of ["file", "above"] as Variant[]) {
      const facts = variant === "file" ? document : above(document, use)

      for (const typing of ["namespace", "plus3"] as Typing[]) {
        const typed = typings[typing]
        const slot: NameSlot = {
          kind: "name",
          position: use.position,
          line: use.line,
          start: use.column,
          caret: use.column + typed.length,
          end: use.column + target.length,
          typed,
        }

        const t0 = performance.now()
        const segments = completeSegments(slot, facts, index)
        const elapsed = performance.now() - t0
        const first = !warmed.has(use.position)
        warmed.add(use.position)
        ;(timings[first ? `${use.position} (first)` : use.position] ??=
          []).push(elapsed)

        const key = `${use.position}|${variant}|${typing}`
        const rank = rankOf(segments, typed, target, isShared)
        record(`new|${key}`, rank)
        record(`new|${key}|${ns}`, rank)
        for (const segment of segments) repeated.add(segment)

        let old = legacy.get(use.position)
        if (!old) {
          old = legacySegments(index, use.position)
          for (const segment of old) repeated.add(segment)
          legacy.set(use.position, old)
        }
        const oldRank = rankOf(old, typed, target, isShared)
        record(`old|${key}`, oldRank)
        record(`old|${key}|${ns}`, oldRank)
        ranked++
      }
    }
  })
}

/* ---- report --------------------------------------------------------------- */

const row = (t: Tally | undefined) =>
  t
    ? `${String(t.n).padStart(6)}  ${((100 * t.top1) / t.n).toFixed(1).padStart(5)}%  ${((100 * t.top5) / t.n).toFixed(1).padStart(5)}%  ${(t.rr / t.n).toFixed(3)}`
    : "     —"

console.log(
  `\n${files.length} files, ${ranked} completions ranked in ${((Date.now() - started) / 1000).toFixed(1)}s` +
    (every > 1 ? ` (every ${every}th name)` : "")
)
console.log(
  "\n  position  document  typed        new: n    top1   top5   MRR    old: n    top1   top5   MRR"
)
for (const position of ["write", "get", "read", "skp"])
  for (const variant of ["file", "above"])
    for (const typing of ["namespace", "plus3"]) {
      const key = `${position}|${variant}|${typing}`
      console.log(
        `  ${position.padEnd(8)}  ${variant.padEnd(8)}  ${typing.padEnd(9)}  ${row(tallies.get(`new|${key}`))}   ${row(tallies.get(`old|${key}`))}`
      )
    }

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? 0
}
console.log("\n  complete(): p50 / p95 / max, ms")
for (const [position, values] of Object.entries(timings))
  console.log(
    `  ${position.padEnd(8)}  ${percentile(values, 0.5).toFixed(2)} / ${percentile(values, 0.95).toFixed(2)} / ${Math.max(...values).toFixed(1)}`
  )

if (jsonOut) {
  writeFileSync(
    jsonOut,
    JSON.stringify(
      {
        files: files.length,
        ranked,
        every,
        tallies: Object.fromEntries(tallies),
        timings: Object.fromEntries(
          Object.entries(timings).map(([k, v]) => [
            k,
            {
              p50: percentile(v, 0.5),
              p95: percentile(v, 0.95),
              max: Math.max(...v),
            },
          ])
        ),
      },
      null,
      2
    )
  )
  console.log(`\n  written to ${jsonOut}`)
}
