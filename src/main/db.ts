/**
 * The variable database.
 *
 * One SQLite file, opened once, shared by everything that knows about
 * variables. It exists because four different things will write into the same
 * dataset with different lifetimes — the profile corpus, the simulator, the
 * recorder and the addon file scanner — and a JSON blob means rewriting the
 * world on every flush.
 *
 * `node:sqlite` rather than `better-sqlite3`: it ships with Node, so there is
 * no native module to rebuild against Electron's ABI. Verified on Electron 43
 * (Node 24.18.1, SQLite 3.53.1).
 *
 * Evidence lives in a table per source rather than one table with a `source`
 * column and a lot of nullable payload. A variable is not *from* the corpus —
 * it *has evidence* from the corpus, and will separately have evidence from the
 * sim and from file analysis, each with a different shape. Only the corpus
 * tables exist so far; the others arrive with their stages, as migrations.
 */

import { DatabaseSync } from "node:sqlite"

import { varColumns } from "@shared/vars"

export type Database = DatabaseSync

interface Migration {
  version: number
  up(db: Database): void
}

/**
 * Append only, never edit. A migration that has run somewhere is history.
 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    up(db) {
      db.exec(`
        -- The folder profiles are read from. Corpus evidence is scoped to one,
        -- because two workspaces are two different sets of profiles; evidence
        -- from the simulator will not be, because an aircraft is an aircraft
        -- whichever folder is open.
        CREATE TABLE workspace (
          id   INTEGER PRIMARY KEY,
          root TEXT    NOT NULL UNIQUE
        );

        -- Identity only. Units are not part of it: the same variable appears as
        -- Number in one profile and Bool in another, and that is a fact about
        -- the usages, recorded on each of them.
        CREATE TABLE variable (
          id        INTEGER PRIMARY KEY,
          full_name TEXT    NOT NULL UNIQUE,
          namespace TEXT    NOT NULL,
          name      TEXT    NOT NULL,
          idx       TEXT
        );

        -- What was on disk when a profile was last read, so an unchanged file
        -- is never read twice. dir and name are kept alongside rel_path because
        -- they are the sort order the corpus is folded in.
        CREATE TABLE profile_file (
          workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
          rel_path     TEXT    NOT NULL,
          dir          TEXT    NOT NULL,
          name         TEXT    NOT NULL,
          mtime_ms     REAL    NOT NULL,
          size         INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, rel_path)
        );

        -- One row per occurrence of a variable in a profile. ordinal is its
        -- position within its file, so the fold order does not depend on the
        -- order rows happened to be inserted in.
        CREATE TABLE corpus_entry (
          id           INTEGER PRIMARY KEY,
          workspace_id INTEGER NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
          variable_id  INTEGER NOT NULL REFERENCES variable(id),
          rel_path     TEXT    NOT NULL,
          ordinal      INTEGER NOT NULL,
          block        TEXT    NOT NULL,
          units        TEXT    NOT NULL,
          set_expr     TEXT,
          skp          TEXT,
          scalar       INTEGER NOT NULL DEFAULT 0,
          comment      TEXT,
          heading      TEXT
        );

        CREATE INDEX corpus_entry_lookup
          ON corpus_entry (workspace_id, variable_id, units);
        CREATE INDEX corpus_entry_file
          ON corpus_entry (workspace_id, rel_path);
      `)
    },
  },
  {
    version: 2,
    up(db) {
      db.exec(`
        -- Whether the profile *wrote* a unit or simply left it out.
        --
        -- Worth a column because the two are indistinguishable once resolved,
        -- and they are very different evidence: 73% of L: get-lines carry no
        -- unit at all, so the "Number" on 18,000 corpus rows is mostly the
        -- absence of a decision rather than a decision. Ranking a defaulted
        -- unit as though somebody chose it is how a suggestion ends up
        -- confidently wrong.
        ALTER TABLE corpus_entry ADD COLUMN units_explicit INTEGER NOT NULL DEFAULT 0;

        -- Force a full rescan: existing rows predate the column and would all
        -- claim "defaulted", including the ones that were not. The scan is
        -- incremental against mtimes, so clearing what it remembers is what
        -- makes it read the corpus again. ~340ms, once.
        DELETE FROM profile_file;
        DELETE FROM corpus_entry;

        -- Evidence: the simulator.
        --
        -- Deliberately not scoped to a workspace, and deliberately not to an
        -- aircraft either. Enumeration returns the same ~6,150 names whichever
        -- aircraft is loaded — the table is global to the install — so an
        -- aircraft column here would be a lie repeated 6,150 times.
        CREATE TABLE sim_variable (
          variable_id INTEGER PRIMARY KEY REFERENCES variable(id),
          first_seen  REAL NOT NULL,
          last_seen   REAL NOT NULL,

          -- The native unit as the sim reports it, found by reading the
          -- variable against candidate units until one matches the unconverted
          -- read. NULL with units_confirmed = 1 means it genuinely has none.
          units           TEXT,
          -- Three states, not two: 0 = never determined (a variable sitting at
          -- zero reads the same in every unit, so it cannot be), 1 = the sim
          -- told us, and the units column says what.
          units_confirmed INTEGER NOT NULL DEFAULT 0
        );

        -- Evidence: observed to move, which *is* per aircraft. This is what
        -- in-sim means, since the sim will not say which variables belong to
        -- the loaded aircraft and only movement reveals it.
        CREATE TABLE sim_observation (
          variable_id INTEGER NOT NULL REFERENCES variable(id),
          aircraft    TEXT    NOT NULL,
          changes     INTEGER NOT NULL DEFAULT 0,
          first_seen  REAL    NOT NULL,
          last_seen   REAL    NOT NULL,
          PRIMARY KEY (variable_id, aircraft)
        );

        CREATE INDEX sim_observation_aircraft ON sim_observation (aircraft);
      `)
    },
  },
  {
    version: 3,
    up(db) {
      db.exec(`
        -- The denominator sim_observation never had.
        --
        -- That table counts how often a variable moved, which is half a rate;
        -- the other half is how long anybody was watching. It was assumed to be
        -- derivable from first_seen and last_seen and it is not — those are
        -- stamped with the wall clock at flush time, so their difference spans
        -- every hour the app was closed. A variable that moved a thousand times
        -- across a week read as 0.0017 changes a second.
        --
        -- Per aircraft rather than per variable because every variable is
        -- watched at once: the module reports the whole table, so observation
        -- time is a property of the session, and storing it 6,000 times would be
        -- the same number 6,000 times.
        --
        -- Nothing backfills. Rows accumulate from the next session, and a rate
        -- is simply unavailable for an aircraft until it has some.
        CREATE TABLE sim_aircraft (
          aircraft    TEXT    PRIMARY KEY,
          -- Milliseconds the simulator was connected with this aircraft loaded,
          -- summed across sessions. Advanced at each flush by the time since
          -- the last one, capped, so a gap cannot be counted as observation.
          observed_ms INTEGER NOT NULL DEFAULT 0,
          first_seen  REAL    NOT NULL,
          last_seen   REAL    NOT NULL
        );
      `)
    },
  },
  {
    version: 4,
    up(db) {
      db.exec(`
        -- This variable moved near that control. **Not** that it was caused by
        -- it, and the name is chosen to keep that straight: a high count here
        -- is evidence a variable is *not* the answer. A cockpit click sound
        -- coincides with every switch in the aircraft, which is exactly why it
        -- must never be offered as one.
        --
        -- Counted by distinct control, which is the whole trick. Flipping the
        -- beacon four times is four anchors with the same variable in all four
        -- windows; counting anchors would demote the answer as promiscuous.
        --
        -- Why it is worth persisting at all: promiscuity is computed from the
        -- last two minutes in memory, so it is **inert on a marking session** —
        -- every mark shares one name, so every candidate scores one and the
        -- strongest signal there is does nothing. A mark is what you use to
        -- find a control the simulator does not report, which makes that the
        -- case the ranking most needs help with and the one it cannot help
        -- itself. Only history reaches it.
        CREATE TABLE sim_coincidence (
          variable_id INTEGER NOT NULL REFERENCES variable(id),
          aircraft    TEXT    NOT NULL,
          -- The input event's name. Marks are never recorded: they all share a
          -- name, so they would collapse into one control that everything has
          -- coincided with, and demote every answer they ever found.
          control     TEXT    NOT NULL,
          anchors     INTEGER NOT NULL DEFAULT 0,
          first_seen  REAL    NOT NULL,
          last_seen   REAL    NOT NULL,
          PRIMARY KEY (variable_id, aircraft, control)
        );

        CREATE INDEX sim_coincidence_aircraft ON sim_coincidence (aircraft);
      `)
    },
  },
  {
    version: 5,
    up(db) {
      /*
       * Re-derive the cached parse in namespace/name/idx from full_name.
       *
       * The columns were written by two regexes that treated any trailing
       * `:digits` as an instance index and any single letter as a namespace.
       * The shared parser knows better — an index is an `A:` concept, `L:1:`
       * is `Z:` by another spelling, `K:2:` carries an arity, not a name —
       * and rows inserted under it would fold differently from rows cached
       * under the old split. `full_name` is the identity and never changes;
       * only the derived columns move.
       *
       * In JS rather than SQL because the parser is the authority and writing
       * it a second time in SQL is the drift this whole layer exists to end.
       * A later parser change means a later migration doing this again — on a
       * fresh database this runs over zero rows and costs nothing.
       */
      const rows = db
        .prepare("SELECT id, full_name FROM variable")
        .all() as { id: number; full_name: string }[]

      const update = db.prepare(
        "UPDATE variable SET namespace = ?, name = ?, idx = ? WHERE id = ?"
      )

      for (const row of rows) {
        const { namespace, name, index } = varColumns(row.full_name)
        update.run(namespace, name, index, row.id)
      }
    },
  },
  {
    version: 6,
    up(db) {
      db.exec(`
        -- How many times a control was *worked*, as against how many times its
        -- value moved.
        --
        -- For every namespace but one those are the same number, and this stays
        -- zero. \`B:\` splits them: an input event reports a firing when somebody
        -- presses it, and a momentary control fires with the value 0 every time
        -- — so ten presses of \`AIRLINER_FCU_ALT_PUSH\` are ten firings and zero
        -- changes, while ten flips of \`AIRLINER_OVH_LTS_BEACON\` are ten of
        -- each.
        --
        -- That difference is the only way to tell a control whose value cannot
        -- be read from one nobody has touched yet. Both read 0 forever; only
        -- one has been asked. Measured on the A220, 2026-09-04 — see the entry
        -- in docs/sim-vars/build/v1-log.md.
        ALTER TABLE sim_observation ADD COLUMN firings INTEGER NOT NULL DEFAULT 0;
      `)
    },
  },
  {
    version: 7,
    up(db) {
      db.exec(`
        -- Radar's auto-capture mode, as last chosen with this aircraft loaded:
        -- 'off', 'once' or 'always'. Null until somebody chooses, which reads
        -- as 'once'.
        --
        -- Per aircraft because noise is. A PA-24 reports an input event only
        -- when a hand moves, so 'always' fills the list with exactly the
        -- controls you worked. The A220 reports AIRLINER_ALT_FLAP_TOGGLE at
        -- 4 Hz with nobody touching it, and 'always' there is a new row
        -- about once a second.
        ALTER TABLE sim_aircraft ADD COLUMN capture_mode TEXT;
      `)
    },
  },
]

const SCHEMA_VERSION_KEY = "schema_version"

/**
 * Opens a database and brings it up to date.
 *
 * Takes a path rather than reaching for Electron's `userData`, so that a test
 * can pass `:memory:` and the module stays free of anything that only exists
 * inside a running app.
 */
export function openDatabase(file: string): Database {
  const db = new DatabaseSync(file)

  // WAL so a long read cannot block the write that follows it. Foreign keys are
  // off by default in SQLite and the cascade from `workspace` depends on them.
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA foreign_keys = ON")

  migrate(db)
  return db
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  const row = db
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get(SCHEMA_VERSION_KEY) as { value: string } | undefined

  const current = row ? Number(row.value) : 0

  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue

    // Each migration is its own transaction: a failure half way through leaves
    // the database on the last version that actually applied, rather than on a
    // version number describing a schema it does not have.
    db.exec("BEGIN")
    try {
      migration.up(db)
      db.prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      ).run(SCHEMA_VERSION_KEY, String(migration.version))
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  }
}

let instance: Database | null = null

/** Opens the database this process will use. Called once, at startup. */
export function initDatabase(file: string): Database {
  instance?.close()
  instance = openDatabase(file)
  return instance
}

export function database(): Database {
  if (!instance) throw new Error("database used before initDatabase()")
  return instance
}

export function closeDatabase(): void {
  instance?.close()
  instance = null
}
