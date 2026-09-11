/**
 * Turning a firehose into something readable.
 *
 * The panel's value is entirely in what it *hides*. One captured session held
 * 771 events including two bursts of 318 distinct ones inside two milliseconds,
 * and every input event arrives twice. Rendered raw, the interesting line is
 * always four hundred rows above the fold.
 *
 * Kept apart from the component because this is the part with rules worth
 * asserting, and because a filter that is wrong is much easier to see in a test
 * than in a scrolling list.
 */

import { BURST_DISTINCT, inBurstAt } from "@shared/activity"
import type { LogEntry, LogLevel, LogSource } from "@shared/log"

export interface LogFilter {
  /** Empty means every source — an unticked filter is not a filter. */
  sources: Set<LogSource>
  /** Minimum level to show. `debug` shows everything. */
  level: LogLevel
  /** Matched against kind and message, case-insensitively. */
  search: string
  /** Collapse runs of identical adjacent rows into one with a count. */
  collapse: boolean
}

/** A row as rendered: an entry, plus how many others it stands for. */
export interface LogRow {
  entry: LogEntry
  /** 1 unless other entries were collapsed into this one. */
  count: number
  /**
   * The collapsed entries were *distinct*, not identical — a machine burst.
   *
   * The two collapses mean opposite things to a reader and must not render the
   * same. `×318` on an identical run says "this happened 318 times"; on a burst
   * it would say that about 318 different events, which is a lie. A burst row
   * says how many things happened at once instead.
   */
  burst?: boolean
  /** Milliseconds the burst spanned. Only set when `burst`. */
  spanMs?: number
}

const RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

export const LOG_SOURCES: LogSource[] = ["sim", "remote", "files", "app", "ui"]
export const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"]

export const EMPTY_FILTER: LogFilter = {
  sources: new Set(),
  level: "debug",
  search: "",
  collapse: true,
}

function matches(entry: LogEntry, filter: LogFilter): boolean {
  if (filter.sources.size && !filter.sources.has(entry.source)) return false
  if (RANK[entry.level] < RANK[filter.level]) return false

  if (filter.search) {
    const needle = filter.search.toLowerCase()
    const hay = `${entry.kind} ${entry.message}`.toLowerCase()
    if (!hay.includes(needle)) return false
  }

  return true
}

/**
 * Bursts, folded with stage 4's rule rather than a second one of our own.
 *
 * `collapse` folds adjacent *identical* rows, which is right for the
 * double-fire and useless for a burst: an aircraft change sends a snapshot of
 * every input event — 318 of them inside 2 ms, all distinct — so nothing folds
 * and the feed becomes a wall. Correct, and unreadable.
 *
 * The rule that catches it is "many *distinct* entries inside a few
 * milliseconds is a machine, never a person", and Activity needs exactly the
 * same rule to decide what to anchor on. `inBurstAt` in `@shared/activity` is
 * that rule, taking accessors so it can be asked about `LogEntry` rows here and
 * about input events there without either side owning the other's shape.
 *
 * Only ever folds *adjacent* rows, like the identical collapse and for the same
 * reason: a burst interrupted by something worth reading is two bursts.
 */
function burstKey(entry: LogEntry): string {
  // What makes a burst is many distinct *things*, so the key is the thing.
  // Level and source are deliberately out of it — a snapshot arriving as one
  // source at one level is still a snapshot.
  return `${entry.kind} :: ${entry.message}`
}

/**
 * Two entries are "the same row" when a reader would learn nothing from seeing
 * both.
 *
 * Note that the *value* is part of the message, so a switch going 0 → 1 → 0
 * does not collapse. That is the point: the double-fire collapses because both
 * halves say `= 1`, while a genuine toggle does not, and neither does a knob
 * being turned through a sequence of values.
 */
function same(a: LogEntry, b: LogEntry): boolean {
  return (
    a.source === b.source &&
    a.level === b.level &&
    a.kind === b.kind &&
    a.message === b.message
  )
}

/**
 * Applies the filter, newest last.
 *
 * Collapse runs *after* filtering rather than before, so hiding a source cannot
 * make two rows adjacent that were not — otherwise turning off `files` would
 * silently merge sim events either side of it and report a count that never
 * happened.
 */
export function filterLog(entries: LogEntry[], filter: LogFilter): LogRow[] {
  const visible = entries.filter((entry) => matches(entry, filter))
  const rows: LogRow[] = []

  // Asked once per entry against the *filtered* list, so a burst is judged on
  // what the reader can actually see.
  const bursting = visible.map((entry, index) =>
    filter.collapse &&
    // Never a problem. A warning landing in the middle of a snapshot is the
    // one line in it worth reading, and the neighbourhood test cannot tell
    // that on its own — it only knows that a lot of distinct things happened
    // at once, which was also true of the warning.
    RANK[entry.level] < RANK.warn &&
      inBurstAt(
        visible.length,
        (i) => visible[i]!.t,
        (i) => burstKey(visible[i]!),
        index
      )
  )

  for (let index = 0; index < visible.length; index += 1) {
    const entry = visible[index]!

    /*
     * A run of bursting entries from one source, folded to a single row.
     *
     * Both qualifiers were learned by getting it wrong. Being in a burst is a
     * property of the *neighbourhood*, so an unrelated line arriving during a
     * snapshot is flagged along with it — and folding on the flag alone put a
     * file-watcher message inside an aircraft-change row, where nobody would
     * ever find it. Requiring the same source keeps a burst attributable to
     * whatever produced it.
     *
     * And a run has to be long to be a burst at all. Otherwise the same
     * neighbourhood effect turns a single ordinary entry into a row reading
     * "1 events at once", which is both wrong and absurd.
     */
    if (bursting[index]) {
      let end = index
      while (
        end + 1 < visible.length &&
        bursting[end + 1] &&
        visible[end + 1]!.source === entry.source
      ) {
        end += 1
      }

      const run = end - index + 1
      if (run >= BURST_DISTINCT) {
        rows.push({
          // The *first* entry wins a burst row, unlike an identical run: a
          // snapshot is one moment, and its timestamp is when it started.
          entry,
          count: run,
          burst: true,
          spanMs: visible[end]!.t - entry.t,
        })
        index = end
        continue
      }
    }

    const last = rows.at(-1)
    if (filter.collapse && last && !last.burst && same(last.entry, entry)) {
      // The newest entry wins the row, so its timestamp is the most recent
      // occurrence rather than the first — which is what a live feed implies.
      last.entry = entry
      last.count += 1
      continue
    }

    rows.push({ entry, count: 1 })
  }

  return rows
}

/** How many of each source are present, for the filter chips' counts. */
export function countBySource(entries: LogEntry[]): Record<LogSource, number> {
  const counts = {
    sim: 0,
    remote: 0,
    files: 0,
    app: 0,
    ui: 0,
  }

  for (const entry of entries) counts[entry.source] += 1
  return counts
}
