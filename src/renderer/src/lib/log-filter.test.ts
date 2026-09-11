import { describe, expect, it } from "vitest"

import type { LogEntry, LogLevel, LogSource } from "@shared/log"

import { countBySource, EMPTY_FILTER, filterLog, type LogFilter } from "./log-filter"

let id = 0
function entry(
  source: LogSource,
  kind: string,
  message: string,
  level: LogLevel = "debug"
): LogEntry {
  id += 1
  return { id, t: 1_700_000_000_000 + id, source, level, kind, message }
}

const filter = (over: Partial<LogFilter> = {}): LogFilter => ({
  ...EMPTY_FILTER,
  sources: new Set(over.sources ?? []),
  ...over,
})

describe("source filter", () => {
  const entries = [
    entry("sim", "input", "A = 1"),
    entry("files", "changed", "64 profiles on disk"),
    entry("remote", "state", "phase idle"),
  ]

  it("shows everything when nothing is ticked", () => {
    // An unticked filter is not a filter — the alternative is a panel that
    // opens empty and reads as broken.
    expect(filterLog(entries, filter()).length).toBe(3)
  })

  it("narrows to the ticked sources", () => {
    const rows = filterLog(entries, filter({ sources: new Set(["sim"]) }))
    expect(rows.map((r) => r.entry.source)).toEqual(["sim"])
  })

  it("allows more than one", () => {
    const rows = filterLog(entries, filter({ sources: new Set(["sim", "remote"]) }))
    expect(rows).toHaveLength(2)
  })
})

describe("level filter", () => {
  const entries = [
    entry("sim", "input", "noise", "debug"),
    entry("app", "console", "something odd", "warn"),
    entry("app", "console", "broken", "error"),
  ]

  it("debug shows everything", () => {
    expect(filterLog(entries, filter({ level: "debug" }))).toHaveLength(3)
  })

  it("warn hides debug and info but keeps error", () => {
    const rows = filterLog(entries, filter({ level: "warn" }))
    expect(rows.map((r) => r.entry.level)).toEqual(["warn", "error"])
  })
})

describe("search", () => {
  const entries = [
    entry("sim", "input", "SWITCH_BATTERY_MASTER = 1"),
    entry("sim", "input", "SWITCH_PITOT_HEAT = 0"),
    entry("sim", "aircraft", "pa24-250"),
  ]

  it("matches the message, case-insensitively", () => {
    expect(filterLog(entries, filter({ search: "battery" }))).toHaveLength(1)
  })

  it("matches the kind too", () => {
    expect(filterLog(entries, filter({ search: "aircraft" }))).toHaveLength(1)
  })

  it("finds nothing rather than everything when it misses", () => {
    expect(filterLog(entries, filter({ search: "zzz" }))).toHaveLength(0)
  })
})

describe("collapse", () => {
  it("folds the double-fire into one row with a count", () => {
    // The pattern stage 0 found and the live session confirmed: identical
    // (event, value) 18 ms apart.
    const entries = [
      entry("sim", "input", "SWITCH_LIGHT_LANDING_R = 1"),
      entry("sim", "input", "SWITCH_LIGHT_LANDING_R = 1"),
    ]

    const rows = filterLog(entries, filter({ collapse: true }))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.count).toBe(2)
  })

  it("does NOT fold a genuine toggle, because the value is in the message", () => {
    const entries = [
      entry("sim", "input", "SWITCH_LIGHT_LANDING_R = 1"),
      entry("sim", "input", "SWITCH_LIGHT_LANDING_R = 1"),
      entry("sim", "input", "SWITCH_LIGHT_LANDING_R = 0"),
      entry("sim", "input", "SWITCH_LIGHT_LANDING_R = 0"),
    ]

    const rows = filterLog(entries, filter({ collapse: true }))
    expect(rows.map((r) => [r.entry.message, r.count])).toEqual([
      ["SWITCH_LIGHT_LANDING_R = 1", 2],
      ["SWITCH_LIGHT_LANDING_R = 0", 2],
    ])
  })

  /**
   * This used to assert the opposite — 318 rows, "collapse is about repetition,
   * not volume" — and it was right about the identical-collapse rule and wrong
   * about the panel. The rule that catches a snapshot is a different one, and
   * it now runs here too: many *distinct* entries at once is a machine.
   */
  it("folds an aircraft-change snapshot into one row", () => {
    const burst = Array.from({ length: 318 }, (_, i) =>
      entry("sim", "input", `CONTROL_${i} = 0`)
    )

    const rows = filterLog(burst, filter({ collapse: true }))

    expect(rows).toHaveLength(1)
    expect(rows[0]!.burst).toBe(true)
    expect(rows[0]!.count).toBe(318)
  })

  it("does not fold a burst when collapse is off", () => {
    const burst = Array.from({ length: 318 }, (_, i) =>
      entry("sim", "input", `CONTROL_${i} = 0`)
    )

    // The switch is the reader saying "show me everything", and a snapshot is
    // part of everything.
    expect(filterLog(burst, filter({ collapse: false }))).toHaveLength(318)
  })

  /**
   * The interaction the burst rule must never swallow.
   *
   * One control reporting many times is somebody turning a knob — 118 of them
   * in the real capture — and it is the opposite of a snapshot however fast it
   * arrives. Distinctness is the whole discriminator.
   */
  it("keeps one control touched many times, and counts it", () => {
    const turning = Array.from({ length: 60 }, () =>
      entry("sim", "input", "KNOBS_EVENT_NAVINSTR_KNOB = 1")
    )

    const rows = filterLog(turning, filter({ collapse: true }))

    expect(rows).toHaveLength(1)
    expect(rows[0]!.burst).toBeFalsy()
    expect(rows[0]!.count).toBe(60)
  })

  /**
   * The line in a snapshot that is worth reading.
   *
   * Being in a burst is a property of the neighbourhood, not of the entry, so
   * a warning arriving during a snapshot is flagged along with it. Folding it
   * away would hide the one thing in those 2 ms anybody wants.
   */
  it("never folds a warning into a burst", () => {
    const rows = filterLog(
      [
        ...Array.from({ length: 30 }, (_, i) => entry("sim", "input", `A_${i} = 0`)),
        entry("sim", "exception", "exception 31 on sendId 9", "warn"),
        ...Array.from({ length: 30 }, (_, i) => entry("sim", "input", `B_${i} = 0`)),
      ],
      filter({ collapse: true })
    )

    const warning = rows.find((row) => row.entry.level === "warn")
    expect(warning).toBeDefined()
    expect(warning!.burst).toBeFalsy()
  })

  it("splits a burst that something readable interrupts", () => {
    const rows = filterLog(
      [
        ...Array.from({ length: 30 }, (_, i) => entry("sim", "input", `A_${i} = 0`)),
        entry("files", "changed", "12 profiles on disk", "info"),
        ...Array.from({ length: 30 }, (_, i) => entry("sim", "input", `B_${i} = 0`)),
      ],
      filter({ collapse: true })
    )

    // Two bursts and the thing between them, rather than one row that quietly
    // spans a real event.
    expect(rows.map((row) => Boolean(row.burst))).toEqual([true, false, true])
  })

  it("keeps every row when collapse is off", () => {
    const entries = [
      entry("sim", "input", "X = 1"),
      entry("sim", "input", "X = 1"),
    ]

    expect(filterLog(entries, filter({ collapse: false }))).toHaveLength(2)
  })

  it("only folds adjacent runs, not everything alike", () => {
    const entries = [
      entry("sim", "input", "X = 1"),
      entry("sim", "input", "Y = 1"),
      entry("sim", "input", "X = 1"),
    ]

    expect(filterLog(entries, filter({ collapse: true }))).toHaveLength(3)
  })

  it("never merges across a row the filter removed", () => {
    // Turning off `files` must not make the two sim rows adjacent and report a
    // count of 2 for something that happened as two separate events either side
    // of a third.
    const entries = [
      entry("sim", "input", "X = 1"),
      entry("files", "changed", "64 profiles on disk"),
      entry("sim", "input", "X = 1"),
    ]

    const shown = filterLog(entries, filter({ sources: new Set(["sim"]) }))
    // They ARE adjacent once files is hidden, and collapsing them is correct —
    // what must not happen is a count appearing while the separating row is
    // still on screen.
    expect(shown).toHaveLength(1)
    expect(shown[0]?.count).toBe(2)

    const all = filterLog(entries, filter({ collapse: true }))
    expect(all).toHaveLength(3)
    expect(all.every((row) => row.count === 1)).toBe(true)
  })

  it("carries the newest timestamp on a collapsed row", () => {
    const first = entry("sim", "input", "X = 1")
    const second = entry("sim", "input", "X = 1")

    const [row] = filterLog([first, second], filter({ collapse: true }))
    expect(row?.entry.t).toBe(second.t)
  })
})

describe("countBySource", () => {
  it("counts every source, including the ones with none", () => {
    const counts = countBySource([
      entry("sim", "input", "a"),
      entry("sim", "input", "b"),
      entry("app", "console", "c"),
    ])

    // Every source, including the empty ones: the filter chips show a count
    // each, and a missing key would render as `undefined` rather than zero.
    expect(counts).toEqual({ sim: 2, remote: 0, files: 0, app: 1, ui: 0 })
  })
})
