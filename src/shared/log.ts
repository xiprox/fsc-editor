/**
 * The Log panel's contract — a live, under-the-hood view of what this app is
 * doing, shared by main, preload and the renderer.
 *
 * **This is a view, not a system of record.** Captures on disk remain
 * authoritative for what the simulator did; the database remains authoritative
 * for what is known about a variable. A `LogEntry` is a display envelope that
 * happens to carry the real thing in `detail`. Nothing should ever read this
 * buffer to answer a question about what actually happened — it is bounded, it
 * drops its oldest, and it exists to be looked at.
 *
 * That distinction is the whole reason Log and Activity are separate panels
 * rather than two tabs of one: Activity shows what the simulator's events
 * *mean*, derived and ranked. Log shows what arrived.
 */

/**
 * Which part of the system produced an entry.
 *
 * `app` is the main process, `ui` the renderer. They are separated because the
 * panel exists to show where something went wrong, and "which side of the IPC
 * bridge" is the first question worth answering.
 *
 * The simulator is one source whether an event arrived through SimConnect or
 * through our module — that difference is `SimVia` on the event itself, not a
 * source, because it says how something was carried rather than where it came
 * from.
 */
export type LogSource = "sim" | "remote" | "files" | "app" | "ui"

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogEntry {
  /**
   * Monotonic within a session. The React key, and what lets the renderer tell
   * "I already have this batch" from "I missed one" without comparing contents.
   */
  id: number
  /** `Date.now()` when the entry was made. */
  t: number
  source: LogSource
  level: LogLevel
  /**
   * A short, stable, greppable label — usually the event kind. Rendered as its
   * own column, so it wants to be a word or two, not a sentence.
   */
  kind: string
  /** One line, for the row. Everything else goes in the detail. */
  message: string
  /**
   * Whether there is an underlying object to show when this row is expanded.
   *
   * The object itself stays in main and is fetched by id — see `logDetail`.
   * It used to travel with the entry, which meant every producer paid to
   * serialize a detail for a row nobody had clicked on: a `JSON` round-trip to
   * make it clone-safe, then the clone itself across the bridge. At the `L:`
   * stream's measured ~1,000 events a second that is a million serializations
   * an hour to show at most one of them, because the panel expands one row at
   * a time.
   *
   * A flag rather than the object, then, and the cost moves to the click.
   */
  hasDetail?: boolean
}

/**
 * How many entries main keeps.
 *
 * A bound rather than a tuning knob. The stage 2 capture contains bursts of 318
 * distinct events inside 2 ms, so "how many events could arrive" is not a
 * question with a comfortable answer — this is simply the point past which the
 * oldest stop being interesting.
 */
export const LOG_BUFFER_MAX = 5_000

/**
 * How long main waits before flushing pending entries to the renderer.
 *
 * Batching is not an optimization here, it is the difference between working
 * and not: one IPC message per event during a 318-event burst would put 318
 * messages through the bridge in two milliseconds and land 318 React renders on
 * the other side. Coalescing costs a barely perceptible delay on a panel nobody
 * reads in real time anyway.
 */
export const LOG_FLUSH_MS = 60

/** Pushed to the renderer. Always a batch, even when it holds one entry. */
export type LogBatch = { entries: LogEntry[] }
