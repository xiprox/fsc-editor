import { beforeEach, describe, expect, it } from "vitest"

import type { RawEntry } from "@shared/profile"
import type { ProfileFile } from "@shared/types"

import { openDatabase, type Database } from "./db"
import {
  applyFileEntries,
  ensureWorkspace,
  forgetFile,
  parseVarName,
  invalidateVarIndex,
  projectIndex,
  resetVariableCache,
} from "./vars"

/**
 * The storage half of the dictionary, driven directly.
 *
 * Nothing here touches a filesystem: `applyFileEntries` takes the entries a
 * profile parsed to, so the question these tests ask — does an incremental
 * rescan produce what a full scan would have — is asked without writing files
 * and waiting for mtimes to differ.
 */

const ROOT = "C:\\Definitions"

function file(relPath: string, mtimeMs = 1): ProfileFile {
  const slash = relPath.lastIndexOf("/")
  return {
    relPath,
    name: slash === -1 ? relPath : relPath.slice(slash + 1),
    dir: slash === -1 ? "" : relPath.slice(0, slash),
    size: 100,
    mtimeMs,
  }
}

function entry(partial: Partial<RawEntry> & { name: string }): RawEntry {
  return {
    units: "Number",
    // Defaulted, matching the 73% of real `get:` lines that write no unit.
    unitsExplicit: false,
    block: "shared",
    file: "unused.yaml",
    // Positions decide nothing about indexing; a real scan fills these in.
    at: { get: 1, end: 1 },
    ...partial,
  }
}

describe("parseVarName", () => {
  it("splits namespace, name and index", () => {
    expect(parseVarName("A:CIRCUIT CONNECTION ON:3")).toEqual({
      namespace: "A",
      name: "CIRCUIT CONNECTION ON",
      index: "3",
    })
  })

  it("leaves an unindexed name alone", () => {
    expect(parseVarName("L:AdfOnOffKnob")).toEqual({
      namespace: "L",
      name: "AdfOnOffKnob",
      index: null,
    })
  })

  it("keeps index 0, which is a real index", () => {
    expect(parseVarName("A:CAMERA VIEW TYPE AND INDEX:0").index).toBe("0")
  })

  it("accepts a name with no namespace at all", () => {
    expect(parseVarName("PLAIN NAME")).toEqual({
      namespace: "",
      name: "PLAIN NAME",
      index: null,
    })
  })

  it("does not mistake a trailing word for an index", () => {
    expect(parseVarName("L:FOO:BAR")).toEqual({
      namespace: "L",
      name: "FOO:BAR",
      index: null,
    })
  })
})

describe("the stored corpus", () => {
  let db: Database
  let workspace: number

  beforeEach(() => {
    resetVariableCache()
    db = openDatabase(":memory:")
    workspace = ensureWorkspace(db, ROOT)
  })

  /**
   * The corpus half of the index, which is what this block is about.
   *
   * `projectIndex` now returns the union of every source, and one of them is a
   * catalogue of 3,235 names compiled into the binary — so an assertion on the
   * whole list would be an assertion about the SDK. Filtering to entries with a
   * corpus facet keeps these tests about what they were always about: what the
   * profiles on disk fold into.
   */
  const projected = () =>
    projectIndex(db, workspace, null).filter((entry) => entry.corpus)

  it("folds every occurrence into one entry, whatever units it was read in", () => {
    // This used to produce *two* entries — one per units value — because units
    // were part of a variable's identity. They are a fact about how it gets
    // read instead, so `L:FOO` is one variable that two profiles disagree about
    // the units of, which is what it always was.
    applyFileEntries(db, workspace, file("a.yaml"), [
      entry({ name: "L:FOO", comment: "the foo" }),
      entry({ name: "L:FOO", block: "master" }),
      entry({ name: "L:FOO", units: "Bool" }),
    ])

    const index = projected()
    expect(index).toHaveLength(1)

    expect(index[0]!.corpus).toMatchObject({
      count: 3,
      sharedCount: 2,
      masterCount: 1,
      fileCount: 1,
      doc: "the foo",
      // Commonest first: two of the three read it as Number.
      units: ["Number", "Bool"],
    })
  })

  it("keeps the indices a variable is written with", () => {
    applyFileEntries(db, workspace, file("a.yaml"), [
      entry({ name: "A:ADF ACTIVE FREQUENCY:2" }),
      entry({ name: "A:ADF ACTIVE FREQUENCY:1" }),
    ])

    // One variable, read at two engines — not two variables. Keying identity on
    // the written form split 824 names away from their own documentation.
    const index = projected()
    expect(index).toHaveLength(1)
    expect(index[0]!.name).toBe("A:ADF ACTIVE FREQUENCY")
    expect(index[0]!.corpus?.indices).toEqual(["1", "2"])
  })

  it("marks what the loaded aircraft's own profile names", () => {
    applyFileEntries(db, workspace, file("pa24-250.yaml"), [
      entry({ name: "L:MINE" }),
    ])
    applyFileEntries(db, workspace, file("other.yaml"), [
      entry({ name: "L:THEIRS" }),
    ])

    const index = projectIndex(db, workspace, "pa24-250").filter(
      (e) => e.corpus
    )
    const mine = index.find((e) => e.name === "L:MINE")
    const theirs = index.find((e) => e.name === "L:THEIRS")

    expect(mine?.aircraft).toMatchObject({ key: "pa24-250", inProfile: true })
    expect(theirs?.aircraft).toBeUndefined()
  })

  // FS Copilot loads the aircraft's key and nothing else, so a suffixed file is
  // not a variant of that aircraft's profile — it is a file the sim ignores.
  it("does not read a -default profile as the aircraft's profile", () => {
    applyFileEntries(
      db,
      workspace,
      file("bksq-aircraft-baronpro-default.yaml"),
      [entry({ name: "L:MINE" })]
    )

    const index = projectIndex(db, workspace, "bksq-aircraft-baronpro")
    expect(index.find((e) => e.name === "L:MINE")?.aircraft).toBeUndefined()
  })

  it("does not read a module named after the aircraft as its profile", () => {
    applyFileEntries(db, workspace, file("modules/pa24-250.yaml"), [
      entry({ name: "L:MINE" }),
    ])

    const index = projectIndex(db, workspace, "pa24-250")
    expect(index.find((e) => e.name === "L:MINE")?.aircraft).toBeUndefined()
  })

  it("counts distinct profiles, not occurrences", () => {
    applyFileEntries(db, workspace, file("a.yaml"), [
      entry({ name: "L:FOO" }),
      entry({ name: "L:FOO" }),
    ])
    applyFileEntries(db, workspace, file("b.yaml"), [entry({ name: "L:FOO" })])

    expect(projected()[0]!.corpus).toMatchObject({
      count: 3,
      fileCount: 2,
    })
  })

  it("keeps one sample per distinct set expression", () => {
    applyFileEntries(db, workspace, file("a.yaml"), [
      entry({ name: "L:FOO", set: "value" }),
      entry({ name: "L:FOO", set: "value" }),
      entry({ name: "L:FOO", set: "1 - value" }),
    ])

    const samples = projected()[0]!.corpus!.samples
    expect(samples.map((s) => s.set)).toEqual(["value", "1 - value"])
  })

  it("sorts by use, then by name", () => {
    applyFileEntries(db, workspace, file("a.yaml"), [
      entry({ name: "L:RARE" }),
      entry({ name: "L:COMMON" }),
      entry({ name: "L:COMMON" }),
      entry({ name: "L:ALSO_RARE" }),
    ])

    expect(projected().map((e) => e.name)).toEqual([
      "L:COMMON",
      "L:ALSO_RARE",
      "L:RARE",
    ])
  })

  it("folds in file order rather than insertion order", () => {
    // Written b first, then a. The fold has to read them the other way round,
    // or an incremental rescan of one profile would silently reorder the
    // samples and documentation of every variable it mentions.
    applyFileEntries(db, workspace, file("b.yaml"), [
      entry({ name: "L:FOO", comment: "from b", set: "b" }),
    ])
    applyFileEntries(db, workspace, file("a.yaml"), [
      entry({ name: "L:FOO", comment: "from a", set: "a" }),
    ])

    const [entry0] = projected()
    expect(entry0!.corpus?.doc).toBe("from a")
    expect(entry0!.corpus?.files).toEqual(["a.yaml", "b.yaml"])
  })

  it("orders profiles case-insensitively, as the sidebar does", () => {
    // SQLite's default collation is byte order, which puts every uppercase
    // letter before every lowercase one. localeCompare does not, so ordering
    // this fold in SQL silently credited the wrong profile and picked the wrong
    // comment for any variable used by both a PMDG and a bksq profile.
    applyFileEntries(db, workspace, file("PMDG 737-600.yaml"), [
      entry({ name: "L:FOO", comment: "from PMDG" }),
    ])
    applyFileEntries(db, workspace, file("bksq-aircraft-baronpro.yaml"), [
      entry({ name: "L:FOO", comment: "from bksq" }),
    ])

    const [entry0] = projected()
    expect(entry0!.corpus?.doc).toBe("from bksq")
    expect(entry0!.corpus?.files).toEqual([
      "bksq-aircraft-baronpro.yaml",
      "PMDG 737-600.yaml",
    ])
  })

  it("puts top-level profiles before module folders", () => {
    applyFileEntries(db, workspace, file("modules/fuel.yaml"), [
      entry({ name: "L:FOO", comment: "from the module" }),
    ])
    applyFileEntries(db, workspace, file("zzz.yaml"), [
      entry({ name: "L:FOO", comment: "from the profile" }),
    ])

    expect(projected()[0]!.corpus?.doc).toBe("from the profile")
  })

  it("replaces a profile rather than adding to it", () => {
    applyFileEntries(db, workspace, file("a.yaml"), [
      entry({ name: "L:GONE" }),
      entry({ name: "L:STAYS" }),
    ])
    applyFileEntries(db, workspace, file("a.yaml", 2), [
      entry({ name: "L:STAYS" }),
    ])

    expect(projected().map((e) => e.name)).toEqual(["L:STAYS"])
  })

  it("forgets a deleted profile entirely", () => {
    applyFileEntries(db, workspace, file("a.yaml"), [entry({ name: "L:FOO" })])
    applyFileEntries(db, workspace, file("b.yaml"), [entry({ name: "L:BAR" })])

    forgetFile(db, workspace, "a.yaml")

    expect(projected().map((e) => e.name)).toEqual(["L:BAR"])
  })

  it("gives the same result whether one profile changed or all were read", () => {
    // This is the whole point of storing anything: a rescan that re-reads one
    // file has to be indistinguishable from a rescan that re-read everything.
    const a = [entry({ name: "L:FOO", set: "a" }), entry({ name: "L:SHARED" })]
    const b = [entry({ name: "L:BAR" }), entry({ name: "L:SHARED" })]
    const bChanged = [entry({ name: "L:BAR", set: "new" })]

    applyFileEntries(db, workspace, file("a.yaml"), a)
    applyFileEntries(db, workspace, file("b.yaml"), b)
    applyFileEntries(db, workspace, file("b.yaml", 2), bChanged)
    const incremental = projected()

    const fresh = openDatabase(":memory:")
    resetVariableCache()
    const freshWorkspace = ensureWorkspace(fresh, ROOT)
    applyFileEntries(fresh, freshWorkspace, file("a.yaml"), a)
    applyFileEntries(fresh, freshWorkspace, file("b.yaml", 2), bChanged)

    expect(incremental).toEqual(
      projectIndex(fresh, freshWorkspace, null).filter((e) => e.corpus)
    )
  })

  it("keeps two workspaces apart", () => {
    const other = ensureWorkspace(db, "C:\\Elsewhere")

    applyFileEntries(db, workspace, file("a.yaml"), [entry({ name: "L:MINE" })])
    applyFileEntries(db, other, file("a.yaml"), [entry({ name: "L:THEIRS" })])

    expect(projected().map((e) => e.name)).toEqual(["L:MINE"])
    expect(
      projectIndex(db, other, null)
        .filter((e) => e.corpus)
        .map((e) => e.name)
    ).toEqual(["L:THEIRS"])
  })
})

describe("schema migration 2", () => {
  it("records whether a unit was written or inferred", () => {
    resetVariableCache()
    const db = openDatabase(":memory:")
    const workspace = ensureWorkspace(db, ROOT)

    applyFileEntries(db, workspace, file("a.yaml"), [
      entry({ name: "L:Explicit", units: "Percent", unitsExplicit: true }),
      entry({ name: "L:Defaulted", units: "Number", unitsExplicit: false }),
    ])

    const rows = db
      .prepare(
        `SELECT v.full_name, e.units, e.units_explicit
           FROM corpus_entry e JOIN variable v ON v.id = e.variable_id
          ORDER BY v.full_name`
      )
      .all() as { full_name: string; units: string; units_explicit: number }[]

    expect(rows).toEqual([
      { full_name: "L:Defaulted", units: "Number", units_explicit: 0 },
      { full_name: "L:Explicit", units: "Percent", units_explicit: 1 },
    ])
  })

  it("creates the sim evidence tables, keyed as the findings require", () => {
    const db = openDatabase(":memory:")

    // sim_variable is per variable and nothing else: enumeration returns the
    // same names whichever aircraft is loaded, so an aircraft column here would
    // be a lie repeated thousands of times.
    const simVariable = db.prepare("PRAGMA table_info(sim_variable)").all() as {
      name: string
    }[]
    expect(simVariable.map((c) => c.name)).toEqual([
      "variable_id",
      "first_seen",
      "last_seen",
      "units",
      "units_confirmed",
    ])

    // Observation is the half that *is* per aircraft — it is what "in sim"
    // means, since only movement reveals which variables the aircraft uses.
    const observation = db
      .prepare("PRAGMA table_info(sim_observation)")
      .all() as {
      name: string
      pk: number
    }[]
    expect(observation.filter((c) => c.pk > 0).map((c) => c.name)).toEqual([
      "variable_id",
      "aircraft",
    ])
  })

  it("leaves units unconfirmed until the sim says otherwise", () => {
    const db = openDatabase(":memory:")
    db.exec(
      "INSERT INTO variable (full_name, namespace, name) VALUES ('L:X','L','X')"
    )
    db.exec(
      `INSERT INTO sim_variable (variable_id, first_seen, last_seen)
       VALUES ((SELECT id FROM variable WHERE full_name = 'L:X'), 1, 1)`
    )

    const row = db
      .prepare("SELECT units, units_confirmed FROM sim_variable")
      .get() as { units: string | null; units_confirmed: number }

    // Three states, and this is the third: not that it has no unit, but that
    // nobody has been able to look. A variable sitting at zero reads the same
    // in every unit.
    expect(row).toEqual({ units: null, units_confirmed: 0 })
  })
})

/**
 * The index keeps everything that does not depend on the aircraft — 88% of the
 * cost of building it, measured. What has to be true for that to be safe is
 * that a kept entry never carries one aircraft's evidence into another's read.
 */
describe("the kept base", () => {
  let db: Database
  let workspace: number

  beforeEach(() => {
    resetVariableCache()
    invalidateVarIndex()
    db = openDatabase(":memory:")
    workspace = ensureWorkspace(db, ROOT)

    applyFileEntries(db, workspace, file("pa24-250.yaml"), [
      entry({ name: "L:MINE" }),
    ])
    applyFileEntries(db, workspace, file("c172.yaml"), [
      entry({ name: "L:THEIRS" }),
    ])
  })

  const facets = (aircraft: string | null) =>
    Object.fromEntries(
      projectIndex(db, workspace, aircraft).map((e) => [e.name, e.aircraft])
    )

  it("does not carry one aircraft's facet into the next read", () => {
    // The copy-on-write's whole job. Read one aeroplane, then another, and the
    // first one's evidence must not still be sitting on a shared entry.
    expect(facets("pa24-250")["L:MINE"]).toMatchObject({ inProfile: true })

    const second = facets("c172")
    expect(second["L:MINE"]).toBeUndefined()
    expect(second["L:THEIRS"]).toMatchObject({ key: "c172", inProfile: true })
  })

  it("leaves no facet behind when nothing is loaded", () => {
    facets("pa24-250")
    expect(facets(null)["L:MINE"]).toBeUndefined()
  })

  /*
   * The enumeration used to ride `VarIndex.inputEvents` past this list to a
   * single diagnostic, so the panel offered the SDK's generic template names
   * while the aeroplane's own were never listable.
   */
  it("lists the aircraft's input events, prefixed and faceted", () => {
    const index = projectIndex(db, workspace, "synaptic-a220", [
      "AIRLINER_FCU_CHRONO_2",
    ])
    const entry = index.find((e) => e.name === "B:AIRLINER_FCU_CHRONO_2")

    expect(entry?.aircraft).toMatchObject({
      key: "synaptic-a220",
      inputEvent: true,
    })
  })

  it("keeps an enumerated name out of the list when no aircraft is loaded", () => {
    // Null is "nothing loaded", not "an aeroplane that registers none".
    const names = projectIndex(db, workspace, null, ["AIRLINER_FCU_CHRONO_2"])
      .map((e) => e.name)

    expect(names).not.toContain("B:AIRLINER_FCU_CHRONO_2")
  })

  it("puts what this aircraft has ahead of what the corpus writes most", () => {
    /*
     * The order the panel and `completions.ts` both start from. With an
     * aeroplane loaded, a name it registers beats a name twelve profiles use.
     */
    applyFileEntries(db, workspace, file("popular.yaml"), [
      entry({ name: "L:WIDELY_USED" }),
    ])
    invalidateVarIndex()

    const names = projectIndex(db, workspace, "pa24-250", ["SOME_SWITCH"]).map(
      (e) => e.name
    )

    expect(names.indexOf("B:SOME_SWITCH")).toBeLessThan(
      names.indexOf("L:WIDELY_USED")
    )
  })

  it("re-sorts for an aircraft that appended no new name", () => {
    /*
     * The invariant the aircraft term breaks: a fold that only *marks* entries
     * reorders the list without adding to it, so the appended-only shortcut
     * would have served the base's order.
     */
    applyFileEntries(db, workspace, file("popular.yaml"), [
      entry({ name: "L:AAA_WIDELY_USED" }),
    ])
    invalidateVarIndex()

    // "L:MINE" is in pa24-250's own profile and adds nothing new to the index.
    const names = projectIndex(db, workspace, "pa24-250").map((e) => e.name)

    expect(names.indexOf("L:MINE")).toBeLessThan(
      names.indexOf("L:AAA_WIDELY_USED")
    )
  })

  it("does not bank the enumeration, so a swap cannot leave it behind", () => {
    projectIndex(db, workspace, "synaptic-a220", ["AIRLINER_FCU_CHRONO_2"])
    const after = projectIndex(db, workspace, "c172", []).map((e) => e.name)

    expect(after).not.toContain("B:AIRLINER_FCU_CHRONO_2")
  })

  it("gives the same answer on a cached read as on a cold one", () => {
    const cold = projectIndex(db, workspace, "pa24-250")
    invalidateVarIndex()
    const rebuilt = projectIndex(db, workspace, "pa24-250")

    expect(rebuilt).toEqual(cold)
  })

  it("sees a profile added after the base was built", () => {
    // `applyFileEntries` is the write half of a scan; `scanVars` invalidates
    // around it. Doing it by hand here proves the invalidation is what makes
    // the new entry visible, rather than luck.
    projectIndex(db, workspace, null)

    applyFileEntries(db, workspace, file("late.yaml"), [
      entry({ name: "L:LATE" }),
    ])
    invalidateVarIndex()

    const names = projectIndex(db, workspace, null).map((e) => e.name)
    expect(names).toContain("L:LATE")
  })

  it("keeps two databases apart without being told", () => {
    // Ids are per file, and the first workspace in every database is 1.
    projectIndex(db, workspace, null)

    const other = openDatabase(":memory:")
    const otherWorkspace = ensureWorkspace(other, ROOT)
    resetVariableCache()
    applyFileEntries(other, otherWorkspace, file("only-here.yaml"), [
      entry({ name: "L:ELSEWHERE" }),
    ])

    const names = projectIndex(other, otherWorkspace, null).map((e) => e.name)
    expect(names).toContain("L:ELSEWHERE")
    expect(names).not.toContain("L:MINE")
  })
})
