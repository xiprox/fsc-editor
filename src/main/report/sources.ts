/**
 * Where a debug report's contents come from.
 *
 * Nothing here records anything. Every source in the app already holds what it
 * knows — the log ring, the change ring, the kept captures, the database — and
 * this asks each of them once, at the moment somebody clicks. That is the
 * property worth protecting: a report is a *snapshot*, so there is no second
 * recording path to keep in step with the first, and no collection running in
 * the background whose only purpose is a button that may never be pressed.
 *
 * The format each of these produces is written down in docs/debug-report.md,
 * which is the contract — this file is one implementation of it and the doc
 * outlives it.
 *
 * ## Why every collector is allowed to fail
 *
 * A read-only disk, a locked database, the simulator disconnecting between one
 * collector and the next. Each of those removes one file from a package that is
 * still worth sending, and the alternative — one throw ending the collection —
 * loses the ten files that were fine along with the one that was not. Failures
 * are named in `errors.txt` rather than swallowed, because a report silently
 * missing exactly the subsystem that broke is the worst outcome available.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { app, screen } from "electron"

import { activityDebug } from "../activity-debug"
import { BUFFER_SECONDS, buffered, slice } from "../activity-buffer"
import { captures } from "../activity-history"
import { database } from "../db"
import * as files from "../files"
import { logSnapshot } from "../log"
import { allMarks } from "../marks"
import { linkInstallState } from "../sim/install"
import * as sim from "../sim/session"
import { pendingSimEvidence } from "../sim/store"
import { currentWorkspace } from "../workspace"

import { scrub } from "./redact"

/**
 * One file in the report.
 *
 * `records` is the line count for the line-oriented ones, and is what lets a
 * reader tell a collector that produced nothing from one that never ran without
 * opening the file.
 */
export interface Collected {
  name: string
  text: string
  records?: number
}

export interface Source {
  name: string
  collect(): Collected | Promise<Collected>
}

/** Two spaces, matching everything else this app writes as JSON. */
function json(name: string, value: unknown): Collected {
  return { name, text: `${JSON.stringify(value, null, 2)}\n` }
}

/** One object per line, no header record — the shape a capture already has. */
function ndjson(name: string, rows: unknown[]): Collected {
  return {
    name,
    text:
      rows.map((row) => JSON.stringify(row)).join("\n") +
      (rows.length ? "\n" : ""),
    records: rows.length,
  }
}

/**
 * The machine and the build, and nothing about the person at it.
 *
 * `dev` is the field that matters when a report reads strangely. A session run
 * against a replayed capture rather than a simulator produces events, findings
 * and rankings that look entirely ordinary, and the only thing that says so is
 * an environment variable nobody would think to ask about.
 */
function environment(): Collected {
  const displays = screen.getAllDisplays().map((display) => ({
    width: display.size.width,
    height: display.size.height,
    scaleFactor: display.scaleFactor,
    internal: display.internal,
  }))

  return json("environment.json", {
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    v8: process.versions.v8,
    os: {
      version: os.version(),
      release: os.release(),
      arch: process.arch,
      cpus: os.cpus().length,
    },
    locale: app.getLocale(),
    memory: { total: os.totalmem(), free: os.freemem() },
    displays,
    uptime: {
      process: Math.round(process.uptime() * 1000),
      system: Math.round(os.uptime() * 1000),
    },
    dev: {
      packaged: app.isPackaged,
      replay: process.env.FSCE_SIM_REPLAY ?? null,
      replaySpeed: process.env.FSCE_SIM_REPLAY_SPEED ?? null,
      relay: process.env.FSCE_RELAY_URL ?? null,
      workspace: process.env.FSCE_WORKSPACE ?? null,
    },
  })
}

/**
 * What the footer chip was showing, plus the two facts it summarizes away.
 *
 * The chip can only ever say one thing at a time, and "offline" covers both a
 * simulator that is closed and a module that never answered. The install state
 * beside it is what separates them.
 */
async function simState(): Promise<Collected> {
  const install = await linkInstallState()

  return json("sim-state.json", {
    state: sim.simState(),
    shipped: install.shipped,
    community: install.folders.map((folder) => ({
      path: folder.path,
      source: folder.source,
      sim: folder.sim,
      installed: folder.installed,
    })),
  })
}

/**
 * The log ring, oldest first, with each row's detail inlined.
 *
 * `scrub` runs here rather than at the end because what it removes cannot be
 * removed from text: a Remote Connect `file` row carries the whole of a peer's
 * profile, and the only honest thing to send is its length.
 */
function logRing(): Collected {
  const rows = logSnapshot().map(({ entry, detail }) => ({
    ...entry,
    detail: detail === undefined ? undefined : scrub(detail),
  }))

  return ndjson("log.ndjson", rows)
}

/**
 * The last two minutes of the simulator, as it was recorded.
 *
 * The floor of the report. Whatever happened to the capture on disk — never
 * started, evicted, rolled a moment ago — this is present whenever the sim is
 * connected, and it is what the findings beside it were computed *from*, so the
 * two can be checked against each other rather than taken on trust.
 */
function activityRing(): Collected {
  return ndjson("activity-ring.ndjson", slice())
}

/**
 * The kept captures and every mark.
 *
 * Marks carry whether each one produced an anchor of its own, which
 * `activity.json` also says — repeated here because this is the file somebody
 * opens when the complaint is "I pressed the key and nothing happened", and
 * making them cross-reference two files to answer it is a poor trade for a
 * dozen bytes.
 */
function findings(): Collected {
  return json("findings.json", {
    captures: captures(),
    marks: allMarks(),
    buffer: { ...buffered(), seconds: BUFFER_SECONDS },
  })
}

/** One row count, or null when the table is not there to be counted. */
function count(sql: string, ...params: (string | number)[]): number | null {
  try {
    const row = database()
      .prepare(sql)
      .get(...params) as { n: number } | undefined
    return row?.n ?? 0
  } catch {
    return null
  }
}

/**
 * Aggregates from the variable database, and never the database itself.
 *
 * `vars.db` carries the corpus, which is built by reading the user's own
 * profile files — shipping the file would ship their work. Counts say
 * everything a reader needs about whether the corpus was populated, and the
 * per-aircraft rows below are the part that makes a ranking complaint readable:
 * a variable the panel refused to offer has a rate and a coincidence count, and
 * those are the two numbers that refused it.
 */
function variables(aircraft: string | null): Collected {
  const db = database()

  const schema = (() => {
    try {
      const row = db
        .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
        .get() as { value: string } | undefined
      return row ? Number(row.value) : null
    } catch {
      return null
    }
  })()

  const observations = aircraft
    ? (db
        .prepare(
          `SELECT v.full_name AS name, o.changes, o.first_seen, o.last_seen
             FROM sim_observation o
             JOIN variable v ON v.id = o.variable_id
            WHERE o.aircraft = ?
            ORDER BY o.changes DESC`
        )
        .all(aircraft) as unknown[])
    : []

  const coincidences = aircraft
    ? (db
        .prepare(
          `SELECT v.full_name AS name, c.control, c.anchors
             FROM sim_coincidence c
             JOIN variable v ON v.id = c.variable_id
            WHERE c.aircraft = ?
            ORDER BY c.anchors DESC`
        )
        .all(aircraft) as unknown[])
    : []

  return json("variables.json", {
    schema,
    counts: {
      workspace: count("SELECT COUNT(*) AS n FROM workspace"),
      variable: count("SELECT COUNT(*) AS n FROM variable"),
      profileFile: count("SELECT COUNT(*) AS n FROM profile_file"),
      corpusEntry: count("SELECT COUNT(*) AS n FROM corpus_entry"),
      simVariable: count("SELECT COUNT(*) AS n FROM sim_variable"),
      simObservation: count("SELECT COUNT(*) AS n FROM sim_observation"),
      simAircraft: count("SELECT COUNT(*) AS n FROM sim_aircraft"),
      simCoincidence: count("SELECT COUNT(*) AS n FROM sim_coincidence"),
    },
    /** Not yet written — a flush is pending — so counts above are behind. */
    pending: pendingSimEvidence(),
    aircraft,
    observed: aircraft
      ? (db
          .prepare("SELECT observed_ms FROM sim_aircraft WHERE aircraft = ?")
          .get(aircraft) ?? null)
      : null,
    observations,
    coincidences,
  })
}

/**
 * The shape of the workspace with none of its location.
 *
 * Profile names stay. They are addon names — `A2A PA-24 Comanche`, `FBW A32NX`
 * — and a report that hid them would be a report about an anonymous folder of
 * anonymous files, which is not a report about anything. The root they sit in
 * is the part that names a person, and redaction takes that.
 */
async function workspace(): Promise<Collected> {
  const current = currentWorkspace()
  const found = await files.listFiles(current.root)

  return json("workspace.json", {
    source: current.source,
    hasInstall: current.installRoot !== null,
    profiles: found.length,
    files: found.map((file) => ({ relPath: file.relPath, size: file.size })),
  })
}

/**
 * `settings.json` as stored.
 *
 * Whole rather than field by field, so that it keeps being whole: it holds one
 * key today, and the version of this that listed the keys it knew about is the
 * version that quietly stops reporting the next one.
 */
function settings(): Collected {
  const file = path.join(app.getPath("userData"), "settings.json")

  // A workspace that was never chosen has no settings file, and that is a fact
  // about the report rather than a failure to collect one.
  return {
    name: "settings.json",
    text: fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "{}\n",
  }
}

/** Every source, in the order the files are written. */
export function sources(aircraft: string | null): Source[] {
  return [
    { name: "environment", collect: environment },
    { name: "sim-state", collect: simState },
    { name: "log", collect: logRing },
    {
      name: "activity",
      collect: () => json("activity.json", activityDebug(aircraft)),
    },
    { name: "activity-ring", collect: activityRing },
    { name: "findings", collect: findings },
    { name: "variables", collect: () => variables(aircraft) },
    { name: "workspace", collect: workspace },
    { name: "settings", collect: settings },
  ]
}
