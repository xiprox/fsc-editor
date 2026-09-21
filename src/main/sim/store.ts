/**
 * Sim evidence, written to the database.
 *
 * Two facts, kept apart because they are not the same kind of claim:
 *
 * **`sim_variable` — this name exists in the simulator.** Global to the install,
 * not per aircraft: enumeration returns the same ~6,150 names whichever aircraft
 * is loaded. This is what completions have wanted since stage 1, which could
 * only ever offer what somebody had already written into a profile.
 *
 * **`sim_observation` — this variable moved while *that* aircraft was loaded.**
 * Per aircraft, and the only signal there is: the sim will not say which
 * variables belong to an aircraft, and nothing is added or removed on a swap. A
 * variable that never moves cannot be the one a switch moved, so observation is
 * closer to the question than a declaration would have been anyway.
 *
 * Everything is batched. The enumeration arrives as ~6,150 names inside a second
 * and values arrive at 15 Hz, so a write per event would put the database in the
 * middle of the hot path for no reason — nothing downstream reads this within a
 * session.
 */

import type { CaptureMode } from "@shared/activity"
import type { SimEvent } from "@shared/sim"

import { database } from "../db"
import { invalidateVarIndex, variableId } from "../vars"

/**
 * How long changes accumulate before being written.
 *
 * Generous on purpose. Nothing reads this table during a session — it feeds
 * completions on a later launch — so the only thing latency costs is how much
 * is lost if the app is killed, and a few seconds of "this variable moved" is
 * not evidence worth protecting with fsync pressure.
 */
const FLUSH_MS = 5_000

interface Pending {
  /** Names from the enumeration, not yet inserted. */
  names: Set<string>
  /** `name` -> times it changed, for the aircraft below. */
  changes: Map<string, number>
  /** `name` -> times it was *worked*, which is not the same question. */
  firings: Map<string, number>
  aircraft: string | null
}

let pending: Pending = {
  names: new Set(),
  changes: new Map(),
  firings: new Map(),
  aircraft: null,
}

/**
 * The gap that separates a press from a tick.
 *
 * Measured on the A220, 2026-09-04, over one 43.2-second window with somebody
 * working the overhead: the 21 ticking events arrived 174–179 times each,
 * spanning the whole window with a **maximum gap of 0.3 s**, while the ten
 * events that were actually pressed arrived 1–10 times in bursts of 1.2 s or
 * less with silence either side. No overlap, and this sits eight times above
 * the ticker period rather than splitting the difference.
 *
 * The residual risk is a simulator stall longer than this landing inside a
 * ticker's stream and reading as a press. That is why the diagnostic asks for
 * several firings rather than one, and why nothing here concludes anything on
 * its own.
 */
const BURST_GAP_MS = 2_000
let timer: ReturnType<typeof setTimeout> | undefined

/**
 * Told when a flush writes names nothing had recorded before.
 *
 * The variable index is assembled from this table among others, and the
 * enumeration arrives in one burst a second after the module connects — long
 * after the panel asked. Without a signal the list simply stays wrong until
 * something unrelated causes a rescan.
 *
 * Names only, deliberately. Changes arrive every five seconds for as long as
 * the simulator runs, and a listener woken by those would be woken 720 times an
 * hour to be handed a list it already has.
 *
 * **New** names only, equally deliberately, and enforced by counting rows
 * either side of the insert rather than by trusting the word "names" — see the
 * flush. A re-enumeration re-sends the whole table, so "some names arrived" is
 * true several times per aircraft change and means nothing on all but the
 * first.
 */
const enumerated = new Set<() => void>()

export function onSimEnumeration(listener: () => void): () => void {
  enumerated.add(listener)
  return () => enumerated.delete(listener)
}

/**
 * When observation time was last banked, so the next flush knows how much to
 * add. Null between sessions, which is what stops a closed app being counted.
 */
let watchedFrom: number | null = null

/**
 * The most one flush may claim, however long ago the last one was.
 *
 * A flush happens on a timer that only runs while events are arriving, so a
 * quiet stretch, a suspended laptop or a session that ended without a
 * disconnect all leave a gap that is not observation. Capping at twice the
 * interval keeps the error bounded and small in the only direction that
 * matters: an under-counted denominator makes every rate look *higher*, which
 * rejects candidates, so it is capped rather than trusted.
 */
const MAX_CLAIM_MS = FLUSH_MS * 2

/**
 * Takes one event. Everything is queued; nothing touches the database here.
 *
 * Unknown kinds are ignored rather than switched over exhaustively — this is one
 * consumer of a stream that carries plenty it has no opinion about.
 */
/**
 * The last value seen for each subscribed input event.
 *
 * Per session and per aircraft, so it is cleared with everything else: hashes
 * are reassigned on a swap, and a value carried across one would report the
 * new aeroplane's first reading as a movement.
 */
let lastInput = new Map<string, number | string>()

/**
 * When each input event last arrived, for telling a press from a tick.
 *
 * Same lifetime as `lastInput` and cleared beside it: the gap that matters is
 * within one aircraft's subscription, and a value carried across a swap would
 * make the first arrival on the new aeroplane look like a deliberate press.
 */
let lastArrival = new Map<string, number>()

export function observe(event: SimEvent): void {
  if (event.kind === "aircraft") {
    // Flush first: what has accumulated belongs to the *previous* aircraft, and
    // attributing it to the new one would be a lie in the one column that makes
    // this table worth having.
    flushSimEvidence()
    pending.aircraft = event.key
    lastInput = new Map()
    lastArrival = new Map()
    return
  }

  if (event.kind === "vars") {
    for (const name of event.names) pending.names.add(name)
    schedule()
    return
  }

  if (event.kind === "var") {
    pending.changes.set(event.name, (pending.changes.get(event.name) ?? 0) + 1)
    schedule()
    return
  }

  /*
   * An input event firing is the same evidence a moving `L:` is: this control
   * is on this aeroplane, and somebody touched it. Activity has always seen
   * this stream and the index never did — which left `B:`, the one namespace
   * with human-readable names, as the only one with no per-aircraft movement
   * evidence at all.
   *
   * Unbiased, unlike `simvar`: `enumerated()` subscribes to **every** name the
   * enumeration returned, so the denominator is the whole table rather than
   * whatever happened to be watched. That is why this kind is recorded and
   * SimConnect's `A:` values are not.
   *
   * Prefixed on the way in. The wire carries the bare input-event name, and
   * `variableId` keys on the written form.
   */
  if (event.kind === "input") {
    /*
     * Only when the value actually differs.
     *
     * Probed on the A220, 2026-09-03: `subscribeInputEvent` is not a
     * change notification for every event. `AIRLINER_ALT_FLAP_TOGGLE`
     * reported 16 times in four seconds — a steady 4 Hz — with the value 0
     * throughout and nobody touching the aeroplane, while four other
     * subscribed events said nothing at all. Counting arrivals would have
     * made a ticking event the most-moved control on every aircraft, which
     * is precisely the failure 06-variables-panel already records for `L:`:
     * two clock-like variables were 88% of all change records.
     *
     * `L:` needs no such guard because the module only sends what moved.
     * This transport is the sim's, and it does not make that promise.
     */
    const name = `B:${event.name}`

    /*
     * Counted before the value dedup below, which is the whole point.
     *
     * A momentary control fires with the value 0 every time it is pressed, so
     * the dedup discards every press after the first and "pressed ten times,
     * never moved" becomes indistinguishable from "arrived once, never again".
     * Those are exactly the two cases `b-value-constant` has to separate: one
     * is a control whose value cannot be read, the other is a control nobody
     * has touched yet, and both read 0 forever.
     *
     * A gap wide enough to be a press rather than a tick is what counts. The
     * first arrival is a baseline and counts as neither — the same treatment
     * `changes` gives it, and for the same reason: an event that exists is not
     * an event somebody worked.
     */
    const now = Date.now()
    const since = lastArrival.get(name)
    lastArrival.set(name, now)

    if (since !== undefined && now - since > BURST_GAP_MS) {
      pending.firings.set(name, (pending.firings.get(name) ?? 0) + 1)
      pending.names.add(name)
      schedule()
    }

    if (lastInput.get(name) === event.value) return

    const first = !lastInput.has(name)
    lastInput.set(name, event.value)

    // The first value is the baseline, not a movement. Recorded as existence
    // only — which `changes` would also do, at the cost of crediting every
    // aeroplane's whole panel with one move it never made.
    pending.names.add(name)
    if (!first) {
      pending.changes.set(name, (pending.changes.get(name) ?? 0) + 1)
    }
    schedule()
  }
}

function schedule(): void {
  if (timer) return
  timer = setTimeout(flushSimEvidence, FLUSH_MS)
}

/**
 * Writes what has accumulated, in one transaction.
 *
 * Never throws. This is bookkeeping on a background timer, and a database that
 * cannot be written is not a reason to take down a session that is otherwise
 * working — the evidence is regenerated every time the simulator runs.
 */
export function flushSimEvidence(): void {
  clearTimeout(timer)
  timer = undefined

  const { names, changes, firings, aircraft } = pending
  const now = Date.now()

  /*
   * Banked before the early return, not after it.
   *
   * Observation time is not evidence *about* a change, it is the denominator
   * every change is measured against, and the two do not arrive together. An
   * aircraft sitting cold and dark produces almost no changes and is still
   * being watched — and it is the case somebody is most likely to be hunting a
   * switch in. Returning early on "nothing moved" banked nothing, so a quiet
   * aircraft accumulated a denominator of zero and could never have a rate.
   */
  // Floored at zero as well as capped. An `aircraft` event flushes before it
  // records, so a flush can land on the same millisecond the clock started —
  // or, if a caller starts it from a stamp rather than now, before it.
  const claim =
    watchedFrom === null ? 0 : Math.max(0, Math.min(now - watchedFrom, MAX_CLAIM_MS))
  if (watchedFrom !== null) watchedFrom = now

  if (!names.size && !changes.size && !firings.size && !(aircraft && claim > 0)) {
    return
  }

  pending = {
    names: new Set(),
    changes: new Map(),
    firings: new Map(),
    aircraft,
  }

  try {
    const db = database()

    const seen = db.prepare(
      `INSERT INTO sim_variable (variable_id, first_seen, last_seen)
       VALUES (?, ?, ?)
       ON CONFLICT (variable_id) DO UPDATE SET last_seen = excluded.last_seen`
    )

    const moved = db.prepare(
      `INSERT INTO sim_observation (variable_id, aircraft, changes, firings, first_seen, last_seen)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (variable_id, aircraft) DO UPDATE SET
         changes   = changes + excluded.changes,
         firings   = firings + excluded.firings,
         last_seen = excluded.last_seen`
    )

    const watched = db.prepare(
      `INSERT INTO sim_aircraft (aircraft, observed_ms, first_seen, last_seen)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (aircraft) DO UPDATE SET
         observed_ms = observed_ms + excluded.observed_ms,
         last_seen   = excluded.last_seen`
    )

    const total = db.prepare("SELECT COUNT(*) AS n FROM sim_variable")
    const count = (): number => (total.get() as unknown as { n: number }).n

    db.exec("BEGIN")
    try {
      /*
       * Counted, because "we flushed some names" and "we learned a name" are
       * not the same question, and this used to answer the first while
       * promising the second.
       *
       * The difference shows up on an aircraft change. Re-enumeration re-sends
       * the *whole* table — the same ~6,150 names, four or five times over as
       * the settle loop walks it again — and every one of those flushes woke
       * the listeners, each of which rebuilt a 19,000-row index synchronously
       * to arrive at precisely the list it already had.
       *
       * `INSERT … ON CONFLICT DO UPDATE` cannot be asked: it reports a change
       * for the update as readily as for the insert. The row count can.
       */
      const before = count()

      for (const name of names) seen.run(variableId(db, name), now, now)

      // A change is also evidence the variable exists, which matters for the
      // ones that moved before the enumeration finished arriving.
      if (aircraft && claim > 0) watched.run(aircraft, claim, now, now)

      if (aircraft) {
        /*
         * One row per name that did either, so a control that fired without
         * moving still gets a row. Iterating `changes` alone was enough while
         * the two were the same question; for `B:` they are not, and the
         * firings-only names are precisely the ones worth recording.
         */
        for (const name of new Set([...changes.keys(), ...firings.keys()])) {
          const id = variableId(db, name)
          seen.run(id, now, now)
          moved.run(
            id,
            aircraft,
            changes.get(name) ?? 0,
            firings.get(name) ?? 0,
            now,
            now
          )
        }
      }

      const learned = count() > before

      db.exec("COMMIT")

      // After the commit, never before it: a name that rolled back is not a
      // name the simulator has.
      if (learned) {
        // The index keeps everything that does not depend on the aircraft, and
        // the set of names is part of it. Dropped before the listeners run, so
        // the rebuild they trigger reads the table that just grew.
        invalidateVarIndex()
        for (const listener of enumerated) listener()
      }
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`sim evidence: not written — ${reason}`)
  }
}

/** Drops anything queued. For a disconnect, and for tests. */
export function resetSimEvidence(): void {
  clearTimeout(timer)
  timer = undefined
  pending = {
    names: new Set(),
    changes: new Map(),
    firings: new Map(),
    aircraft: null,
  }
  lastInput = new Map()
  lastArrival = new Map()
  watchedFrom = null
}

/**
 * Starts the observation clock. Called when a session begins.
 *
 * Separate from the first flush because the first flush would otherwise claim
 * nothing, and separate from `observe` because a stream that goes quiet must
 * not silently restart it.
 */
export function startWatching(at = Date.now()): void {
  watchedFrom = at
}

/**
 * What every variable's rate has been, across every session with this aircraft.
 *
 * The point of keeping it: **every signal the ranking uses is computed from the
 * last two minutes in memory, so it forgets everything when the app closes.**
 * That makes the first mark of a session the worst answer of the session, and
 * the first mark is the one people make — you start the app in order to go and
 * find a switch. With history, a heartbeat is known to be a heartbeat before it
 * has had time to prove it again.
 *
 * Empty until `sim_aircraft` has time in it, which is the honest behaviour: a
 * count with no denominator is not a rate, and guessing one was the bug this
 * table exists to fix.
 */
export function observedRates(aircraft: string | null): Map<string, number> {
  const rates = new Map<string, number>()
  if (!aircraft) return rates

  try {
    const db = database()

    const watched = db
      .prepare(`SELECT observed_ms FROM sim_aircraft WHERE aircraft = ?`)
      .get(aircraft) as { observed_ms: number } | undefined

    const seconds = (watched?.observed_ms ?? 0) / 1_000
    if (seconds < MIN_OBSERVED_SECONDS) return rates

    const rows = db
      .prepare(
        // `full_name`, not `name`: the ranking keys on `L:Foo` throughout, and
        // `variable.name` is the bare half with the namespace split off. Keyed
        // on the wrong one this map silently matches nothing.
        `SELECT v.full_name AS name, o.changes AS changes
         FROM sim_observation o
         JOIN variable v ON v.id = o.variable_id
         WHERE o.aircraft = ?`
      )
      .all(aircraft) as { name: string; changes: number }[]

    for (const row of rows) rates.set(row.name, row.changes / seconds)
  } catch (error) {
    // A history nobody can read is a history nobody had. The live measurement
    // still works, which is what the app did before this existed.
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`sim history: not read — ${reason}`)
  }

  return rates
}

/**
 * Records that these variables moved near this control, once.
 *
 * Written straight through rather than batched with the rest: an interaction is
 * a few times a minute at the very most, where changes are a thousand a second,
 * so the reason the rest of this file batches does not apply. Batching it would
 * also mean holding an anchor's conclusions in memory until a timer that exists
 * for a different purpose happens to fire.
 *
 * Never throws, for the same reason nothing else here does.
 */
export function recordCoincidence(
  aircraft: string | null,
  control: string,
  names: readonly string[]
): void {
  if (!aircraft || !names.length) return

  try {
    const db = database()
    const now = Date.now()

    const seen = db.prepare(
      `INSERT INTO sim_coincidence
         (variable_id, aircraft, control, anchors, first_seen, last_seen)
       VALUES (?, ?, ?, 1, ?, ?)
       ON CONFLICT (variable_id, aircraft, control) DO UPDATE SET
         anchors   = anchors + 1,
         last_seen = excluded.last_seen`
    )

    db.exec("BEGIN")
    try {
      for (const name of names) seen.run(variableId(db, name), aircraft, control, now, now)
      db.exec("COMMIT")
    } catch (error) {
      db.exec("ROLLBACK")
      throw error
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`sim coincidence: not written — ${reason}`)
  }
}

/**
 * Which controls each variable has coincided with, across every session.
 *
 * Names rather than counts, because the ranking has to *union* this with what
 * the current session has seen and two counts cannot be unioned — a variable
 * that answered to the beacon last week and the beacon again today has
 * coincided with one control, not two.
 */
export function observedCoincidences(
  aircraft: string | null
): Map<string, Set<string>> {
  const seen = new Map<string, Set<string>>()
  if (!aircraft) return seen

  try {
    const rows = database()
      .prepare(
        `SELECT v.full_name AS name, c.control AS control
         FROM sim_coincidence c
         JOIN variable v ON v.id = c.variable_id
         WHERE c.aircraft = ?`
      )
      .all(aircraft) as { name: string; control: string }[]

    for (const row of rows) {
      const controls = seen.get(row.name) ?? new Set<string>()
      controls.add(row.control)
      seen.set(row.name, controls)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`sim coincidence: not read — ${reason}`)
  }

  return seen
}

/**
 * Below this, history is not worth having an opinion from.
 *
 * The same argument as `MIN_QUIET_MS` and the same failure it guards against:
 * a rate over a few seconds of observation is an integer over a small number,
 * not a measurement. Half a minute of a session is enough for a heartbeat to
 * separate itself from a switch by three orders of magnitude.
 */
const MIN_OBSERVED_SECONDS = 30

/** What is waiting to be written. Tests, and the Log panel's counters. */
export function pendingSimEvidence(): {
  names: number
  changes: number
  aircraft: string | null
} {
  return {
    names: pending.names.size,
    changes: pending.changes.size,
    aircraft: pending.aircraft,
  }
}

const CAPTURE_MODES: readonly CaptureMode[] = ["off", "once", "always"]

/**
 * The auto-capture mode last chosen with this aircraft loaded, or null.
 *
 * Null for an aircraft nobody has chosen for, and for a value this build does
 * not know — a newer version's mode read by an older one falls back to the
 * default rather than reaching the panel as a fourth state.
 */
export function storedCaptureMode(aircraft: string | null): CaptureMode | null {
  if (!aircraft) return null

  try {
    const row = database()
      .prepare(`SELECT capture_mode FROM sim_aircraft WHERE aircraft = ?`)
      .get(aircraft) as { capture_mode: string | null } | undefined

    const mode = row?.capture_mode
    return CAPTURE_MODES.includes(mode as CaptureMode)
      ? (mode as CaptureMode)
      : null
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`capture mode: not read — ${reason}`)
    return null
  }
}

/**
 * Remembers a chosen mode against this aircraft.
 *
 * Inserts the row when the aircraft has none yet. `observed_ms` stays zero,
 * which `observedRates` already reads as "no history", so a mode chosen in the
 * first seconds of an aircraft's first session does not invent a rate.
 */
export function storeCaptureMode(
  aircraft: string | null,
  mode: CaptureMode
): void {
  if (!aircraft) return

  try {
    const now = Date.now()
    database()
      .prepare(
        `INSERT INTO sim_aircraft (aircraft, observed_ms, first_seen, last_seen, capture_mode)
         VALUES (?, 0, ?, ?, ?)
         ON CONFLICT (aircraft) DO UPDATE SET capture_mode = excluded.capture_mode`
      )
      .run(aircraft, now, now, mode)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`capture mode: not written — ${reason}`)
  }
}

/** The input events ignored with this aircraft loaded. Empty without one. */
export function storedIgnoredControls(aircraft: string | null): Set<string> {
  const controls = new Set<string>()
  if (!aircraft) return controls

  try {
    const rows = database()
      .prepare(`SELECT control FROM sim_ignored_control WHERE aircraft = ?`)
      .all(aircraft) as { control: string }[]

    for (const row of rows) controls.add(row.control)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`ignored controls: not read — ${reason}`)
  }

  return controls
}

/** Ignores an input event for this aircraft, or stops ignoring it. */
export function storeIgnoredControl(
  aircraft: string | null,
  control: string,
  ignored: boolean
): void {
  if (!aircraft) return

  try {
    const db = database()

    if (ignored) {
      db.prepare(
        `INSERT INTO sim_ignored_control (aircraft, control, since)
         VALUES (?, ?, ?)
         ON CONFLICT (aircraft, control) DO NOTHING`
      ).run(aircraft, control, Date.now())
    } else {
      db.prepare(
        `DELETE FROM sim_ignored_control WHERE aircraft = ? AND control = ?`
      ).run(aircraft, control)
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`ignored controls: not written — ${reason}`)
  }
}
