/**
 * The profile corpus, folded into what the variable index says about each
 * variable.
 *
 * Pure: rows in, facets out. Main fetches the rows from SQLite and the
 * completion sweep (`npm run check:completion`) builds the same rows straight
 * from the files — `corpusRowsOf` is what makes them the same rows — so the
 * index the sweep measures is the index the app ships, rather than a second
 * implementation of it that agrees until it does not.
 */

import { setterRefs } from "./highlight/refs.ts"
import type { RawEntry } from "./profile/entries.ts"
import type {
  Block,
  CorpusFacet,
  CorpusPosition,
  PositionEvidence,
  SetterWrite,
  VarSample,
  WrittenForm,
} from "./types.ts"
import { varColumns } from "./vars/parse.ts"

/** Samples are for showing; nothing counts from them, so a cap costs nothing. */
export const MAX_SAMPLES = 5

/**
 * A variable's identity: namespaced, and without any index.
 *
 * `A:ADF ACTIVE FREQUENCY:1` and `:2` are one variable read twice, not two
 * variables. The corpus stores what the profile wrote, index and all — that is
 * evidence and it stays — but the *list* is a list of variables, and keying it
 * on the written form split 824 of them away from their own documentation.
 * The database already holds the two halves in separate columns, so this
 * costs a concatenation rather than a parse.
 */
export function identityOf(namespace: string, name: string): string {
  return namespace ? `${namespace}:${name}` : name
}

/** One `get:` line, as the fold reads it. */
export interface CorpusEntryRow {
  /** Unique per entry across the corpus — the database's row id. */
  entry_id: number
  /** The name as written. */
  full_name: string
  namespace: string
  /** The bare half, with the namespace split off. */
  var_name: string
  idx: string | null
  units: string
  block: Block
  rel_path: string
  /** Position within its file. */
  ordinal: number
  set_expr: string | null
  skp: string | null
  scalar: number
  comment: string | null
  heading: string | null
}

/** A reference inside a setter, with the `get:` of the entry it sits in. */
export interface CorpusRefRow {
  /** The entry whose setter holds this reference. */
  entry_id: number
  full_name: string
  namespace: string
  var_name: string
  idx: string | null
  access: "read" | "write"
  units: string | null
  rel_path: string
  ordinal: number
  get_namespace: string
  get_name: string
}

/** A reference worth storing, as the scan finds it in one setter. */
export interface CorpusRef {
  name: string
  access: "read" | "write"
  units: string | null
}

/**
 * The references in one setter that are worth storing.
 *
 * Found by the highlighter's walk, so a JavaScript parenthesis is never one.
 * Two kinds are left out. A reference with no namespace names no variable.
 * One whose name holds a parenthesis is two references run together by a
 * missing `)` — the corpus has a handful, and the tokenizer reads the first
 * `(` through to the next `)` — and storing it would complete a name that
 * exists nowhere.
 */
export function corpusRefs(set: string, scalar: boolean): CorpusRef[] {
  return setterRefs(set, scalar).flatMap(({ node }) => {
    const name = node.ref.full.trim()
    if (node.ref.ns === null || !name || /[()\n]/.test(name)) return []
    return [{ name, access: node.access, units: node.unit || null }]
  })
}

/**
 * The rows one file contributes, as the database would hold them.
 *
 * What the sweep folds, so it measures the index the app builds. Entry ids
 * count up from `firstId`; a caller folding several files keeps them unique.
 */
export function corpusRowsOf(
  relPath: string,
  entries: RawEntry[],
  firstId: number
): { rows: CorpusEntryRow[]; refs: CorpusRefRow[] } {
  const rows: CorpusEntryRow[] = []
  const refs: CorpusRefRow[] = []

  entries.forEach((entry, ordinal) => {
    const id = firstId + ordinal
    const get = varColumns(entry.name)

    rows.push({
      entry_id: id,
      full_name: entry.name,
      namespace: get.namespace,
      var_name: get.name,
      idx: get.index,
      units: entry.units,
      block: entry.block,
      rel_path: relPath,
      ordinal,
      set_expr: entry.set ?? null,
      skp: entry.skp ?? null,
      scalar: entry.scalar ? 1 : 0,
      comment: entry.comment ?? null,
      heading: entry.heading ?? null,
    })

    if (!entry.set) return
    for (const found of corpusRefs(entry.set, entry.scalar ?? false)) {
      const ref = varColumns(found.name)
      refs.push({
        entry_id: id,
        full_name: found.name,
        namespace: ref.namespace,
        var_name: ref.name,
        idx: ref.index,
        access: found.access,
        units: found.units,
        rel_path: relPath,
        ordinal,
        get_namespace: get.namespace,
        get_name: get.name,
      })
    }
  })

  return { rows, refs }
}

/**
 * One position's evidence while it is being counted.
 *
 * No sets. Rows are folded in file order and, within a file, in entry order,
 * so every row of one entry is adjacent, and so is every row of one file.
 * Asking whether an entry or a file was already counted is asking whether it
 * was the last one counted — which is what a setter naming a variable twice,
 * and a file using it in forty entries, both come down to.
 */
interface Tally {
  entries: number
  files: string[]
  /** The last entry counted, so a setter naming a variable twice counts once. */
  last: number
}

interface Bucket {
  positions: Partial<Record<CorpusPosition, Tally>>
  shared: number
  master: number
  /** Spellings, keyed by position and form, to the entries that wrote them. */
  written: Map<string, { form: string; at: CorpusPosition; tally: Tally }>
  /** Target form -> what this variable's setters wrote it in. */
  setsWrite: Map<string, Tally>
  samples: VarSample[]
  sampleKeys: Set<string>
  /** Unit -> occurrences, so the commonest reading can be listed first. */
  units: Map<string, number>
  indices: Set<string>
  doc?: string
}

type Located = { entry_id: number; rel_path: string; ordinal: number }

/**
 * Every variable the corpus names, with what it says about each.
 *
 * `order` ranks each file in the order the corpus is folded in — the
 * sidebar's — which decides every list's order and which comment documents a
 * variable. Rows may arrive in any order within that: each file's rows are
 * put in entry order here, and the files in `order`'s.
 */
export function foldCorpus(
  rows: CorpusEntryRow[],
  refs: CorpusRefRow[],
  order: Map<string, number>
): Map<string, CorpusFacet> {
  const buckets = new Map<string, Bucket>()

  const bucketOf = (name: string): Bucket => {
    let bucket = buckets.get(name)
    if (!bucket) {
      bucket = {
        positions: {},
        shared: 0,
        master: 0,
        written: new Map(),
        setsWrite: new Map(),
        samples: [],
        sampleKeys: new Set(),
        units: new Map(),
        indices: new Set(),
      }
      buckets.set(name, bucket)
    }
    return bucket
  }

  /* ---- `get:` lines, and the `skp:` values beside them ------------------ */

  for (const row of inFileOrder(rows, order)) {
    const bucket = bucketOf(identityOf(row.namespace, row.var_name))

    count(bucket, "get", row)
    spelled(bucket, "get", row.full_name, row)
    if (row.block === "shared") bucket.shared += 1
    else bucket.master += 1

    if (row.units)
      bucket.units.set(row.units, (bucket.units.get(row.units) ?? 0) + 1)
    if (row.idx) bucket.indices.add(row.idx)
    if (!bucket.doc && row.comment) bucket.doc = row.comment

    // One sample per distinct set/skp combination, so the suggestions show
    // genuinely different ways of writing the variable rather than repeats.
    if (bucket.sampleKeys.size < MAX_SAMPLES) {
      const sampleKey = `${row.set_expr ?? ""}|${row.skp ?? ""}`
      if (!bucket.sampleKeys.has(sampleKey)) {
        bucket.sampleKeys.add(sampleKey)

        const sample: VarSample = { file: row.rel_path, block: row.block }
        if (row.set_expr) sample.set = row.set_expr
        if (row.scalar) sample.scalar = true
        if (row.skp) sample.skp = row.skp
        if (row.comment) sample.comment = row.comment
        if (row.heading) sample.heading = row.heading

        bucket.samples.push(sample)
      }
    }

    /*
     * A `skp:` names another variable, by the exact text FS Copilot matches
     * against a `get:`. Two kinds name none: a value with no namespace —
     * `skp: true`, which 16 corpus entries write — and one with a comma,
     * which FS Copilot never splits, so `A:FOO, Bool` matches nothing.
     */
    const skipped = row.skp?.trim()
    if (skipped && !skipped.includes(",")) {
      const columns = varColumns(skipped)
      if (columns.namespace) {
        const target = bucketOf(identityOf(columns.namespace, columns.name))
        count(target, "skp", row)
        spelled(target, "skp", skipped, row)
      }
    }
  }

  /* ---- references inside setters ---------------------------------------- */

  for (const row of inFileOrder(refs, order)) {
    const bucket = bucketOf(identityOf(row.namespace, row.var_name))

    count(bucket, row.access, row)
    spelled(bucket, row.access, row.full_name, row)
    if (row.idx) bucket.indices.add(row.idx)
    if (row.units)
      bucket.units.set(row.units, (bucket.units.get(row.units) ?? 0) + 1)

    // The pairing only a stored reference can give: what the setters of
    // this entry's `get:` variable write.
    if (row.access === "write") {
      const owner = bucketOf(identityOf(row.get_namespace, row.get_name))
      let pair = owner.setsWrite.get(row.full_name)
      if (!pair) {
        pair = tally()
        owner.setsWrite.set(row.full_name, pair)
      }
      note(pair, row)
    }
  }

  const facets = new Map<string, CorpusFacet>()
  for (const [name, bucket] of buckets) facets.set(name, facetOf(name, bucket))
  return facets
}

/**
 * Rows in the order the corpus is folded in, so every list comes out the same
 * way however the files were inserted.
 *
 * Rows usually arrive grouped by file and in entry order within each — the
 * database's `corpus_entry_position` index makes that free — so the files are
 * reordered as groups, a walk rather than a sort of forty thousand rows. A
 * file's rows that arrive out of entry order are put back in it.
 */
function inFileOrder<T extends Located>(
  rows: T[],
  order: Map<string, number>
): T[] {
  const groups = new Map<string, T[]>()

  for (const row of rows) {
    const group = groups.get(row.rel_path)
    if (group) group.push(row)
    else groups.set(row.rel_path, [row])
  }

  const out: T[] = []
  const files = [...groups.keys()].sort(
    (a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity)
  )

  for (const file of files) {
    const group = groups.get(file)!
    let sorted = true
    for (let at = 1; at < group.length; at++)
      if (group[at]!.ordinal < group[at - 1]!.ordinal) {
        sorted = false
        break
      }
    if (!sorted) group.sort((a, b) => a.ordinal - b.ordinal)
    for (const row of group) out.push(row)
  }

  return out
}

function tally(): Tally {
  return { entries: 0, files: [], last: -1 }
}

function note(counted: Tally, row: Located): void {
  if (counted.last === row.entry_id) return
  counted.last = row.entry_id
  counted.entries += 1
  if (counted.files[counted.files.length - 1] !== row.rel_path)
    counted.files.push(row.rel_path)
}

function count(bucket: Bucket, position: CorpusPosition, row: Located): void {
  const counted = (bucket.positions[position] ??= tally())
  note(counted, row)
}

function spelled(
  bucket: Bucket,
  position: CorpusPosition,
  form: string,
  row: Located
): void {
  const key = `${position} ${form}`
  let spelling = bucket.written.get(key)
  if (!spelling) {
    spelling = { form, at: position, tally: tally() }
    bucket.written.set(key, spelling)
  }
  note(spelling.tally, row)
}

function evidenceOf(counted: Tally): PositionEvidence {
  return { entries: counted.entries, files: counted.files }
}

function facetOf(name: string, bucket: Bucket): CorpusFacet {
  const facet: CorpusFacet = {
    samples: bucket.samples,
    units: [...bucket.units]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([unit]) => unit),
    indices: [...bucket.indices].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    ),
  }

  const { get, read, write, skp } = bucket.positions
  if (get)
    facet.get = {
      ...evidenceOf(get),
      shared: bucket.shared,
      master: bucket.master,
    }
  if (read) facet.read = evidenceOf(read)
  if (write) facet.write = evidenceOf(write)
  if (skp) facet.skp = evidenceOf(skp)
  if (bucket.doc) facet.doc = bucket.doc

  // Only when some use spells it otherwise — a sixth of the payload was lists
  // saying `L:FOO` is written `L:FOO`.
  const spellings = [...bucket.written.values()]
  if (spellings.some((spelling) => spelling.form !== name)) {
    const written: WrittenForm[] = spellings
      .map(({ form, at, tally: counted }) => ({
        form,
        at,
        entries: counted.entries,
      }))
      .sort((a, b) => b.entries - a.entries || a.form.localeCompare(b.form))
    facet.written = written
  }

  if (bucket.setsWrite.size) {
    const pairs: SetterWrite[] = [...bucket.setsWrite].map(([form, pair]) => ({
      form,
      entries: pair.entries,
      files: pair.files,
    }))
    pairs.sort(
      (a, b) =>
        b.files.length - a.files.length ||
        b.entries - a.entries ||
        a.form.localeCompare(b.form)
    )
    facet.setsWrite = pairs
  }

  return facet
}
