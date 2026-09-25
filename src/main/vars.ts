import fs from "node:fs/promises"

import {
  corpusRefs,
  foldCorpus as foldRows,
  identityOf,
  type CorpusEntryRow,
  type CorpusRefRow,
} from "@shared/corpus"
import { corpusEntries } from "@shared/evidence"
import {
  entriesFromLines,
  includesFromLines,
  profileKey,
  scanLines,
  type RawEntry,
} from "@shared/profile"
import type {
  ProfileFile,
  ProfileSummary,
  VarEntry,
  VarIndex,
} from "@shared/types"
import type { SdkVarCatalog } from "@shared/sdk-catalog"
import { varColumns } from "@shared/vars"

import catalogJson from "./catalog/sdk-var-catalog.json" with { type: "json" }

import { database, type Database } from "./db"
import { compareProfiles, listFiles } from "./files"
import { resolveInside } from "./paths"

/**
 * Every variable the SDK documents or Asobo's own templates use.
 *
 * Imported rather than read, so it is part of the bundle and cannot go missing
 * from an installation. See `src/shared/sdk-catalog.ts` on why this ships in
 * the binary instead of accumulating in the database like the other sources.
 */
const CATALOG = catalogJson as unknown as SdkVarCatalog

/**
 * The completion dictionary, built from every profile in the workspace.
 *
 * The shipped profile pack is a large, hand-written corpus — a better source of
 * both variable names and working `set:` expressions than anything we could
 * author, and it needs no connection to the simulator.
 *
 * It is read line by line rather than through a YAML parser, because the
 * comments are the best documentation these profiles have: see
 * `shared/profile/entries.ts`, which does that reading.
 *
 * What lives here is what happens to the result. It is stored rather than held
 * in memory, so a profile that has not changed since the last launch is never
 * read again, and so that the same variables can later carry evidence from the
 * simulator and from addon files alongside their evidence from the corpus.
 */
export async function scanVars(
  root: string,
  aircraft: string | null,
  inputEvents: string[] | null = null
): Promise<VarIndex> {
  const started = Date.now()
  const db = database()
  const files = await listFiles(root)
  const workspaceId = ensureWorkspace(db, root)
  const stored = storedFiles(db, workspaceId)

  // Anything whose size and mtime both match what was read last time is taken
  // to be the same file. That is the same evidence `watch.ts` already trusts to
  // decide a save was our own.
  const stale = files.filter((file) => {
    const previous = stored.get(file.relPath)
    return (
      !previous ||
      previous.mtimeMs !== file.mtimeMs ||
      previous.size !== file.size
    )
  })

  // Read outside the transaction: the filesystem is async and SQLite is not, so
  // every await happens before any write begins.
  const parsed = await Promise.all(stale.map((file) => readEntries(root, file)))

  const present = new Set(files.map((file) => file.relPath))
  const removed = [...stored.keys()].filter((relPath) => !present.has(relPath))

  db.exec("BEGIN")
  try {
    for (const relPath of removed) forgetFile(db, workspaceId, relPath)

    for (const { file, entries, includes, failed } of parsed) {
      // A file that could not be read keeps whatever was last known about it,
      // rather than being emptied on the strength of one bad moment — profiles
      // are edited by other programs while this one is looking at them.
      if (failed) continue
      applyFileEntries(db, workspaceId, file, entries, includes)
    }

    db.exec("COMMIT")
  } catch (error) {
    db.exec("ROLLBACK")
    throw error
  }

  // After the commit, and unconditionally: a scan that removed a file changed
  // the corpus as surely as one that added entries, and `stale` being empty
  // still leaves `removed` to have done something.
  invalidateVarIndex()

  return {
    entries: projectIndex(db, workspaceId, aircraft, inputEvents),
    scannedFiles: files.length,
    elapsedMs: Date.now() - started,
    aircraft,
    inputEvents,
    profiles: profileSummaries(db, workspaceId),
  }
}

/**
 * The index, without re-reading the disk.
 *
 * `scanVars` conflated two things: refreshing what is known from the profiles,
 * which is a write and costs a directory walk, and assembling the answer, which
 * is a read over evidence that four different things can change. Now that the
 * simulator's enumeration and the loaded aircraft feed the same list, the read
 * has to be available on its own — an aircraft swap changes the strongest facet
 * in the index without a single file having moved.
 */
export function varIndex(
  root: string,
  aircraft: string | null,
  inputEvents: string[] | null = null
): VarIndex {
  const started = Date.now()
  const db = database()
  const workspaceId = ensureWorkspace(db, root)

  const scanned = db
    .prepare(`SELECT COUNT(*) AS n FROM profile_file WHERE workspace_id = ?`)
    .get(workspaceId) as { n: number }

  return {
    entries: projectIndex(db, workspaceId, aircraft, inputEvents),
    scannedFiles: scanned.n,
    elapsedMs: Date.now() - started,
    aircraft,
    inputEvents,
    profiles: profileSummaries(db, workspaceId),
  }
}

interface ParsedFile {
  file: ProfileFile
  entries: RawEntry[]
  /** `include:` targets as written. */
  includes: string[]
  failed: boolean
}

async function readEntries(
  root: string,
  file: ProfileFile
): Promise<ParsedFile> {
  try {
    const text = await fs.readFile(resolveInside(root, file.relPath), "utf8")
    const lines = scanLines(text)
    return {
      file,
      entries: entriesFromLines(lines, file.relPath),
      includes: includesFromLines(lines),
      failed: false,
    }
  } catch {
    return { file, entries: [], includes: [], failed: true }
  }
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

export function ensureWorkspace(db: Database, root: string): number {
  db.prepare("INSERT OR IGNORE INTO workspace (root) VALUES (?)").run(root)

  const row = db
    .prepare("SELECT id FROM workspace WHERE root = ?")
    .get(root) as { id: number } | undefined

  if (!row) throw new Error(`workspace row missing for ${root}`)
  return row.id
}

interface StoredFile {
  mtimeMs: number
  size: number
}

function storedFiles(
  db: Database,
  workspaceId: number
): Map<string, StoredFile> {
  const rows = db
    .prepare(
      "SELECT rel_path, mtime_ms, size FROM profile_file WHERE workspace_id = ?"
    )
    .all(workspaceId) as { rel_path: string; mtime_ms: number; size: number }[]

  return new Map(
    rows.map((row) => [row.rel_path, { mtimeMs: row.mtime_ms, size: row.size }])
  )
}

export function forgetFile(
  db: Database,
  workspaceId: number,
  relPath: string
): void {
  for (const table of [
    "corpus_entry",
    "corpus_ref",
    "profile_include",
    "profile_file",
  ])
    db.prepare(
      `DELETE FROM ${table} WHERE workspace_id = ? AND rel_path = ?`
    ).run(workspaceId, relPath)
}

/**
 * Replaces everything known about one profile.
 *
 * Delete then insert, rather than reconciling: an entry has no identity of its
 * own beyond its position in a file, so there is nothing to match old rows
 * against, and a profile is small enough that rewriting it costs nothing.
 */
export function applyFileEntries(
  db: Database,
  workspaceId: number,
  file: ProfileFile,
  entries: RawEntry[],
  includes: string[] = []
): void {
  forgetFile(db, workspaceId, file.relPath)

  db.prepare(
    `INSERT INTO profile_file
       (workspace_id, rel_path, dir, name, mtime_ms, size)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(workspaceId, file.relPath, file.dir, file.name, file.mtimeMs, file.size)

  const insert = db.prepare(
    `INSERT INTO corpus_entry
       (workspace_id, variable_id, rel_path, ordinal,
        block, units, units_explicit, set_expr, skp, scalar, comment, heading)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )

  const insertRef = db.prepare(
    `INSERT INTO corpus_ref
       (workspace_id, rel_path, ordinal, variable_id, access, units)
     VALUES (?, ?, ?, ?, ?, ?)`
  )

  entries.forEach((entry, ordinal) => {
    insert.run(
      workspaceId,
      variableId(db, entry.name),
      file.relPath,
      ordinal,
      entry.block,
      entry.units,
      entry.unitsExplicit ? 1 : 0,
      entry.set ?? null,
      entry.skp ?? null,
      entry.scalar ? 1 : 0,
      entry.comment ?? null,
      entry.heading ?? null
    )

    if (entry.set)
      for (const found of corpusRefs(entry.set, entry.scalar ?? false))
        insertRef.run(
          workspaceId,
          file.relPath,
          ordinal,
          variableId(db, found.name),
          found.access,
          found.units
        )
  })

  const insertInclude = db.prepare(
    `INSERT INTO profile_include (workspace_id, rel_path, target) VALUES (?, ?, ?)`
  )
  for (const target of includes)
    insertInclude.run(workspaceId, file.relPath, target)
}

/** Variable ids, cached for the life of the process — names never change. */
const variableIds = new Map<string, number>()

export function variableId(db: Database, fullName: string): number {
  const cached = variableIds.get(fullName)
  if (cached !== undefined) return cached

  const { namespace, name, index } = parseVarName(fullName)

  db.prepare(
    `INSERT OR IGNORE INTO variable (full_name, namespace, name, idx)
     VALUES (?, ?, ?, ?)`
  ).run(fullName, namespace, name, index)

  const row = db
    .prepare("SELECT id FROM variable WHERE full_name = ?")
    .get(fullName) as { id: number } | undefined

  if (!row) throw new Error(`variable row missing for ${fullName}`)

  variableIds.set(fullName, row.id)
  return row.id
}

/** Only for tests, which open a fresh database per case. */
export function resetVariableCache(): void {
  variableIds.clear()
}

/**
 * Splits `A:CIRCUIT CONNECTION ON:3` into its namespace, name and index.
 *
 * Stored alongside the name it came from rather than instead of it: everything
 * downstream still addresses a variable by the string an author would write,
 * and the parts exist so that one day "which circuits does anything use" can be
 * a query rather than a scan of forty separate names.
 *
 * A thin adapter over the shared parser, which is the authority — the regexes
 * that used to live here stripped an "index" off `L:A32NX_AUTOTHRUST_TLA:1`,
 * merging two of the sim's variables into one row that existed nowhere.
 * Migration 5 re-derives the cached columns of rows written under those
 * regexes; keep the two in step.
 */
export function parseVarName(fullName: string): {
  namespace: string
  name: string
  index: string | null
} {
  return varColumns(fullName)
}

/* -------------------------------------------------------------------------- */
/* Projection                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The stored corpus, the simulator's evidence and the shipped catalogue, folded
 * into one list.
 *
 * **One row per variable, whatever knows about it.** The corpus is one source
 * among several here rather than the definition of existence it used to be —
 * this no longer starts `FROM corpus_entry`, and a name nobody has ever written
 * into a profile is as real as one twelve profiles use.
 *
 * Merged in JS on the identity above rather than by SQL join, because one of
 * the four sources is a file rather than a table and a `Map` is the only place
 * all four can meet. Nothing is lost by it: ranking happens in the renderer, so
 * nothing downstream wanted to `ORDER BY` this anyway.
 *
 * `aircraft` is the SimObject key currently loaded, or null. It decides the
 * per-aircraft facet, which is the strongest evidence in the index and the only
 * part of it that goes stale on its own.
 *
 * ## Why the aircraft-independent part is kept
 *
 * Measured on a real database — 25,916 corpus entries, 5,053 enumerated names,
 * 19,318 variables out — this took **131 ms**, and **15.6 ms of that was the
 * two aircraft folds**. The other 88% is the corpus, the enumeration and the
 * shipped catalogue, and none of the three has any idea which aeroplane is
 * loaded.
 *
 * That mattered because of who asks. An aircraft change rebuilds this, and so
 * does every re-enumeration behind it, so the one event that most needs the app
 * to stay responsive was recomputing an identical 115 ms several times over —
 * synchronously, on the thread that owns the window's message loop.
 *
 * So the 88% is built once and kept, and a swap pays only for its own 16 ms.
 */
export function projectIndex(
  db: Database,
  workspaceId: number,
  aircraft: string | null,
  inputEvents: string[] | null = null
): VarEntry[] {
  const { order, byName } = baseIndex(db, workspaceId)

  const entries = [...order]
  /** Names the aircraft folds knew about and the base did not. See below. */
  const added = new Map<string, VarEntry>()
  /** Positions already copied out of the base, so each is copied once. */
  const copied = new Set<number>()

  /*
   * Copy-on-write over the cached base.
   *
   * The folds mutate what `at` hands them, and the base outlives this call — so
   * an entry that is about to gain an `aircraft` facet is replaced by a copy of
   * itself first. Everything the aircraft has nothing to say about is shared,
   * which is nearly all of it: both callers hand the result straight to
   * `structuredClone` on its way to the renderer, so nothing downstream can
   * write to what is shared.
   */
  const at = (name: string): VarEntry => {
    const index = byName.get(name)

    if (index === undefined) {
      // Not reachable today — every observed or profiled name is also an
      // enumerated or corpus name, so the base has it. Handled anyway, because
      // "cannot happen" is a poor reason for an index to lose a variable.
      const found = added.get(name)
      if (found) return found

      const created: VarEntry = { name }
      added.set(name, created)
      entries.push(created)
      return created
    }

    if (!copied.has(index)) {
      entries[index] = { ...entries[index]! }
      copied.add(index)
    }

    return entries[index]!
  }

  foldObservations(db, aircraft, at)
  foldAircraftProfile(db, workspaceId, aircraft, at)
  foldInputEvents(aircraft, inputEvents, at)

  /*
   * Whenever an aeroplane is loaded, not only when a name was appended.
   *
   * That shortcut held while the comparison read nothing an aircraft fold
   * could write. It no longer does: `aircraftStrength` leads the sort, so a
   * fold that only *marks* existing entries reorders the list without adding
   * to it — which is the ordinary case for an aircraft whose input events are
   * already known names. The 19,000 comparisons buy a different order now
   * rather than the one already held.
   */
  if (added.size || aircraft) entries.sort(byCorpusThenName)

  return entries
}

/**
 * Named by the aeroplane in front of you, or named by its own profile.
 *
 * The leading sort term, and deliberately **not** `changes`. Movement is
 * aircraft evidence too, but there are 97,907 observation rows in a working
 * database and most of them are an `L:` that twitched once; promoting all of
 * them would bury the corpus-heavy names people actually type under everything
 * the aeroplane has ever done. These two are statements of intent instead —
 * somebody bound it, or the aircraft registered it as a control — and there
 * are hundreds of them rather than tens of thousands.
 */
function aircraftStrength(entry: VarEntry): number {
  return entry.aircraft?.inProfile || entry.aircraft?.inputEvent ? 1 : 0
}

/*
 * This aircraft's own first, then corpus-heavy, then what has moved here, then
 * alphabetical.
 *
 * The panel re-ranks against the query, so this is only what it starts from —
 * but `completions.ts` takes this order as given and turns the position into
 * `sortText`, which is why it is worth being deliberate about. Most of the
 * list has no count at all, so the tiebreak is the one thing always true.
 *
 * The aircraft term leads because when an aeroplane is loaded, a name it
 * actually has beats a name the SDK's templates merely document — in the
 * panel and at the completion popup alike, which is why this is one comparator
 * rather than a re-rank inside one panel.
 */
function byCorpusThenName(a: VarEntry, b: VarEntry): number {
  return (
    aircraftStrength(b) - aircraftStrength(a) ||
    corpusEntries(b.corpus) - corpusEntries(a.corpus) ||
    (b.aircraft?.changes ?? 0) - (a.aircraft?.changes ?? 0) ||
    a.name.localeCompare(b.name)
  )
}

/** Everything in the index that does not depend on which aircraft is loaded. */
interface BaseIndex {
  /**
   * The database it was read from.
   *
   * Held so that opening a different one cannot be served a base built from
   * the last, which `workspaceId` alone would allow: ids are per file, and the
   * first workspace in every database is 1. Production opens one database and
   * keeps it, so this is for the case that proves it — a test suite opening a
   * fresh `:memory:` database per case.
   */
  db: Database
  workspaceId: number
  /**
   * Sorted by `byCorpusThenName`, with no aircraft loaded.
   *
   * The base carries no aircraft facets, so this is that comparator's answer
   * with its leading term uniformly zero — correct for an unloaded read and
   * re-sorted by `projectIndex` for any other.
   */
  order: VarEntry[]
  /** Where each name sits in `order`. */
  byName: Map<string, number>
}

let base: BaseIndex | null = null

/**
 * Throws away the kept base, so the next read rebuilds it.
 *
 * Called for the two writes that can change what is in it: a corpus scan, and a
 * flush that records a name the simulator had not reported before. Observations
 * are deliberately not among them — they are per aircraft, so they are folded
 * on every read and were never in here.
 *
 * What this does *not* invalidate on is a flush that re-reports names already
 * known. That is the common case by far — a re-enumeration sends the same
 * ~6,150 names — and the only thing it can change is the `lastSeen` on a
 * `SimFacet`, which is provenance for a name's existence rather than anything
 * the app reads. The kept base carries those stamps as of the walk that built
 * it, and a reader wanting the current one should ask the table.
 */
export function invalidateVarIndex(): void {
  base = null
}

/**
 * The kept part, rebuilt on demand.
 *
 * One workspace at a time. Switching between two would rebuild on each change,
 * which is correct and slow, and is not a thing anybody does mid-session — the
 * folder is chosen at setup and stays chosen.
 */
function baseIndex(db: Database, workspaceId: number): BaseIndex {
  if (base && base.db === db && base.workspaceId === workspaceId) return base

  const entries = new Map<string, VarEntry>()

  const at = (name: string): VarEntry => {
    const found = entries.get(name)
    if (found) return found

    const created: VarEntry = { name }
    entries.set(name, created)
    return created
  }

  foldCorpus(db, workspaceId, at)
  foldSim(db, at)
  foldCatalog(at)

  const order = [...entries.values()].sort(byCorpusThenName)
  const byName = new Map(order.map((entry, index) => [entry.name, index]))

  base = { db, workspaceId, order, byName }
  return base
}

function foldCorpus(
  db: Database,
  workspaceId: number,
  at: (name: string) => VarEntry
): void {
  const rows = db
    .prepare(
      `SELECT e.id AS entry_id, v.full_name, v.namespace, v.name AS var_name,
              v.idx, e.units, e.block, e.rel_path, e.ordinal,
              e.set_expr, e.skp, e.scalar, e.comment, e.heading
         FROM corpus_entry e
         JOIN variable v ON v.id = e.variable_id
        WHERE e.workspace_id = ?
        ORDER BY e.rel_path, e.ordinal`
    )
    .all(workspaceId) as unknown as CorpusEntryRow[]

  const refs = db
    .prepare(
      `SELECT e.id AS entry_id, v.full_name, v.namespace, v.name AS var_name,
              v.idx, r.access, r.units, r.rel_path, r.ordinal,
              g.namespace AS get_namespace, g.name AS get_name
         FROM corpus_ref r
         JOIN variable v     ON v.id = r.variable_id
         JOIN corpus_entry e ON e.workspace_id = r.workspace_id
                            AND e.rel_path     = r.rel_path
                            AND e.ordinal      = r.ordinal
         JOIN variable g     ON g.id = e.variable_id
        WHERE r.workspace_id = ?
        ORDER BY r.rel_path, r.ordinal`
    )
    .all(workspaceId) as unknown as CorpusRefRow[]

  const facets = foldRows(rows, refs, fileOrder(db, workspaceId))
  for (const [name, facet] of facets) at(name).corpus = facet
}

/**
 * Each profile's place in the order the corpus is folded in: the sidebar's,
 * top-level files before module folders, case-insensitive.
 *
 * Ranked once per fold. `compareProfiles` is a pair of `localeCompare` calls,
 * and sorting forty thousand rows with it cost more than the query that
 * fetched them.
 */
function fileOrder(db: Database, workspaceId: number): Map<string, number> {
  const files = db
    .prepare(
      `SELECT rel_path, dir, name FROM profile_file WHERE workspace_id = ?`
    )
    .all(workspaceId) as unknown as {
    rel_path: string
    dir: string
    name: string
  }[]

  files.sort(compareProfiles)
  return new Map(files.map((file, rank) => [file.rel_path, rank]))
}

/**
 * One summary per profile on disk: its includes, resolved, and its `shared:`
 * gets.
 *
 * Read fresh each time rather than kept with the base. It is tens of rows,
 * and it answers a different question from the fold — what a file brings to
 * the files around it, not what is known about a variable.
 *
 * An include resolves the way FS Copilot resolves one: from the Definitions
 * folder, not from the including file, and case-insensitively because the
 * filesystem underneath is. A target no file matches is kept as written, so a
 * summary still says what the profile asked for.
 */
export function profileSummaries(
  db: Database,
  workspaceId: number
): ProfileSummary[] {
  const files = db
    .prepare(
      `SELECT rel_path, dir, name FROM profile_file WHERE workspace_id = ?`
    )
    .all(workspaceId) as unknown as {
    rel_path: string
    dir: string
    name: string
  }[]

  files.sort(compareProfiles)

  const onDisk = new Map(
    files.map((file) => [file.rel_path.toLowerCase(), file.rel_path])
  )

  const includes = new Map<string, string[]>()
  const includeRows = db
    .prepare(
      `SELECT rel_path, target FROM profile_include
        WHERE workspace_id = ? ORDER BY rowid`
    )
    .all(workspaceId) as unknown as { rel_path: string; target: string }[]

  for (const row of includeRows) {
    const wanted = row.target
      .split("\\")
      .join("/")
      .replace(/^\.?\//, "")
    const list = includes.get(row.rel_path) ?? []
    list.push(onDisk.get(wanted.toLowerCase()) ?? row.target)
    includes.set(row.rel_path, list)
  }

  const gets = new Map<string, { gets: string[]; master: number[] }>()
  const getRows = db
    .prepare(
      `SELECT e.rel_path, e.block, v.full_name
         FROM corpus_entry e
         JOIN variable v ON v.id = e.variable_id
        WHERE e.workspace_id = ?
        ORDER BY e.rel_path, e.ordinal`
    )
    .all(workspaceId) as unknown as {
    rel_path: string
    block: string
    full_name: string
  }[]

  for (const row of getRows) {
    let file = gets.get(row.rel_path)
    if (!file) {
      file = { gets: [], master: [] }
      gets.set(row.rel_path, file)
    }
    if (row.block === "master") file.master.push(file.gets.length)
    file.gets.push(row.full_name)
  }

  return files.map((file) => ({
    relPath: file.rel_path,
    includes: includes.get(file.rel_path) ?? [],
    ...(gets.get(file.rel_path) ?? { gets: [], master: [] }),
  }))
}

/** Names the simulator has enumerated or reported a value for, ever. */
function foldSim(db: Database, at: (name: string) => VarEntry): void {
  const rows = db
    .prepare(
      `SELECT v.namespace, v.name AS var_name, s.first_seen, s.last_seen
         FROM sim_variable s
         JOIN variable v ON v.id = s.variable_id`
    )
    .all() as unknown as {
    namespace: string
    var_name: string
    first_seen: number
    last_seen: number
  }[]

  for (const row of rows) {
    at(identityOf(row.namespace, row.var_name)).sim = {
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
    }
  }
}

/**
 * How often each variable moved while this aircraft was loaded.
 *
 * Never throws. This table is regenerable evidence, and a database that cannot
 * be read is not a reason to have no variable list — which is not theoretical:
 * a corrupt `sim_observation` made every read of it fail while every other
 * table in the same file stayed perfectly good.
 */
function foldObservations(
  db: Database,
  aircraft: string | null,
  at: (name: string) => VarEntry
): void {
  if (!aircraft) return

  try {
    const rows = db
      .prepare(
        `SELECT v.namespace, v.name AS var_name, o.changes, o.firings
           FROM sim_observation o
           JOIN variable v ON v.id = o.variable_id
          WHERE o.aircraft = ?`
      )
      .all(aircraft) as unknown as {
      namespace: string
      var_name: string
      changes: number
      firings: number
    }[]

    for (const row of rows) {
      // A row with firings and no changes is the interesting one — a control
      // somebody worked whose value never moved — so "nothing to say" is now
      // both counters being zero rather than `changes` alone.
      if (!row.changes && !row.firings) continue

      const entry = at(identityOf(row.namespace, row.var_name))
      entry.aircraft = {
        ...entry.aircraft,
        key: aircraft,
        changes: row.changes,
        firings: row.firings,
      }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`variable index: observations not read — ${reason}`)
  }
}

/**
 * Which variables the loaded aircraft's own profile names.
 *
 * The corpus half of "this aircraft"; `foldObservations` is the sim half, and
 * the filter is the union — a switch you have already bound and a switch you
 * have moved are both about the aeroplane in front of you.
 *
 * Its own pass, and its own query, rather than a branch inside `foldCorpus`.
 * The rows were already there and reusing them was tempting, but this is
 * aircraft evidence: it belongs next to the other aircraft evidence, it wants
 * to be read and changed as one thing, and it is scoped to something that
 * changes on its own while the corpus does not.
 */
function foldAircraftProfile(
  db: Database,
  workspaceId: number,
  aircraft: string | null,
  at: (name: string) => VarEntry
): void {
  if (!aircraft) return

  const key = aircraft.toLowerCase()

  // Sixty-odd rows, filtered in JS because the profile-to-aircraft rule is a
  // string transform rather than anything SQL can express. See `profileKey`.
  const files = (
    db
      .prepare(`SELECT rel_path FROM profile_file WHERE workspace_id = ?`)
      .all(workspaceId) as unknown as { rel_path: string }[]
  )
    .map((row) => row.rel_path)
    .filter((relPath) => profileKey(relPath) === key)

  if (!files.length) return

  const rows = db
    .prepare(
      `SELECT DISTINCT v.namespace, v.name AS var_name
         FROM corpus_entry e
         JOIN variable v ON v.id = e.variable_id
        WHERE e.workspace_id = ?
          AND e.rel_path IN (${files.map(() => "?").join(",")})`
    )
    .all(workspaceId, ...files) as unknown as {
    namespace: string
    var_name: string
  }[]

  for (const row of rows) {
    const entry = at(identityOf(row.namespace, row.var_name))
    entry.aircraft = { ...entry.aircraft, key: aircraft, inProfile: true }
  }
}

/**
 * The `B:` input events this aeroplane registers.
 *
 * The one live source the index used to throw away. `EnumerateInputEvents`
 * answers per aircraft, with names, needing no module — and the result rode
 * `VarIndex.inputEvents` to the renderer, where a single diagnostic read it and
 * the variable list never did. So the panel showed the SDK's generic template
 * names while the aeroplane's own sat one field away, unlistable and
 * uncompletable.
 *
 * In memory rather than in the database, unlike every other fold here. These
 * names are not evidence *accumulated* about an installation: they are what one
 * aeroplane says about itself right now, they are replaced wholesale on a swap,
 * and banking them would make an index of every aircraft ever loaded. What does
 * belong in the database is that one of them **fired**, which `store.ts`
 * records as an observation like any other movement.
 */
function foldInputEvents(
  aircraft: string | null,
  inputEvents: string[] | null,
  at: (name: string) => VarEntry
): void {
  // Null is "nothing loaded", which is not the same as an aeroplane that
  // registers none — and an aircraft facet needs a key to be about.
  if (!aircraft || !inputEvents) return

  for (const name of inputEvents) {
    const entry = at(`B:${name}`)
    entry.aircraft = { ...entry.aircraft, key: aircraft, inputEvent: true }
  }
}

/** The shipped catalogue — the only source that is the same on every machine. */
function foldCatalog(at: (name: string) => VarEntry): void {
  for (const { name, ...rest } of CATALOG.vars) at(name).sdk = rest
}
