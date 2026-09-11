/**
 * The Log buffer. The parts worth asserting are the ones that only misbehave
 * under load — batching, the ring's bound, and details that cannot cross IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { LOG_BUFFER_MAX, LOG_FLUSH_MS, type LogEntry } from "@shared/log"

import {
  captureConsole,
  clearLog,
  log,
  logBacklog,
  logDetail,
  onLogBatch,
} from "./log"

let batches: LogEntry[][]

beforeEach(() => {
  vi.useFakeTimers()
  clearLog()
  batches = []
  onLogBatch((entries) => batches.push(entries))
})

afterEach(() => {
  vi.useRealTimers()
})

const flush = () => vi.advanceTimersByTime(LOG_FLUSH_MS + 1)

describe("log", () => {
  it("records an entry with an id and a timestamp", () => {
    log("sim", "info", "state", "live")

    const [entry] = logBacklog()
    expect(entry).toMatchObject({ source: "sim", level: "info", kind: "state", message: "live" })
    expect(entry?.id).toBeGreaterThan(0)
    expect(entry?.t).toBeGreaterThan(0)
  })

  it("gives every entry a distinct, increasing id", () => {
    log("app", "info", "a", "1")
    log("app", "info", "b", "2")
    log("app", "info", "c", "3")

    const ids = logBacklog().map((entry) => entry.id)
    expect(new Set(ids).size).toBe(3)
    expect(ids).toEqual([...ids].sort((a, b) => a - b))
  })
})

describe("batching", () => {
  it("coalesces a burst into one batch", () => {
    // The shape that matters: the capture holds 318 distinct events inside
    // 2 ms. One IPC message each would be 318 messages and 318 renders.
    for (let i = 0; i < 318; i++) log("sim", "debug", "input", `CONTROL_${i} = 0`)

    expect(batches).toHaveLength(0)
    flush()

    expect(batches).toHaveLength(1)
    expect(batches[0]).toHaveLength(318)
  })

  it("does not emit an empty batch when nothing was logged", () => {
    flush()
    expect(batches).toHaveLength(0)
  })

  it("starts a fresh batch after a flush", () => {
    log("app", "info", "a", "1")
    flush()
    log("app", "info", "b", "2")
    flush()

    expect(batches.map((batch) => batch.length)).toEqual([1, 1])
    expect(batches[1]?.[0]?.message).toBe("2")
  })

  it("sends each entry exactly once", () => {
    for (let i = 0; i < 50; i++) log("app", "debug", "x", String(i))
    flush()

    const sent = batches.flat().map((entry) => entry.id)
    expect(new Set(sent).size).toBe(50)
  })
})

describe("the ring", () => {
  it("keeps the newest and drops the oldest past the bound", () => {
    for (let i = 0; i < LOG_BUFFER_MAX + 100; i++) {
      log("app", "debug", "x", `entry ${i}`)
    }

    const buffer = logBacklog()
    expect(buffer).toHaveLength(LOG_BUFFER_MAX)
    expect(buffer.at(-1)?.message).toBe(`entry ${LOG_BUFFER_MAX + 99}`)
    expect(buffer[0]?.message).toBe("entry 100")
  })

  it("empties on clear", () => {
    log("app", "info", "x", "y")
    clearLog()
    expect(logBacklog()).toEqual([])
  })

  it("drops pending entries on clear rather than flushing them after", () => {
    log("app", "info", "x", "y")
    clearLog()
    flush()
    expect(batches).toHaveLength(0)
  })
})

describe("detail", () => {
  const first = () => logBacklog()[0]?.id ?? -1

  it("survives a plain object intact", () => {
    log("sim", "debug", "input", "X = 1", { name: "X", value: 1 })
    expect(logDetail(first())).toEqual({ name: "X", value: 1 })
  })

  it("does not travel with the entry", () => {
    // The whole point of the change: an entry crossing the bridge carries a
    // flag, not the object. At ~1,000 sim events a second, serializing one per
    // row to show at most one of them was the most expensive thing here.
    log("sim", "debug", "input", "X = 1", { name: "X", value: 1 })

    const entry = logBacklog()[0]
    expect(entry?.hasDetail).toBe(true)
    expect(entry).not.toHaveProperty("detail")
  })

  it("does not throw on a bigint, and keeps it readable", () => {
    // Input event hashes are bigint on the SimConnect side, and structured
    // clone throws on them rather than degrading — so this would take out the
    // caller inside webContents.send rather than losing a log row.
    expect(() =>
      log("sim", "debug", "input", "X", { hash: 18446744073709551615n })
    ).not.toThrow()

    expect(logDetail(first())).toEqual({ hash: "18446744073709551615n" })
  })

  it("does not throw on a bigint until the detail is asked for", () => {
    // Deferring the round-trip must not defer a *crash* into the click. The
    // flattening still happens, it just happens in `logDetail`.
    log("sim", "debug", "input", "X", { hash: 1n })
    expect(() => logDetail(first())).not.toThrow()
  })

  it("degrades a circular object to a string instead of throwing", () => {
    const circular: Record<string, unknown> = { name: "loop" }
    circular.self = circular

    expect(() => log("app", "warn", "x", "y", circular)).not.toThrow()
    expect(typeof logDetail(first())).toBe("string")
  })

  it("reports no detail when none was given", () => {
    log("app", "info", "x", "y")
    expect(logBacklog()[0]?.hasDetail).toBeUndefined()
    expect(logDetail(first())).toBeUndefined()
  })

  it("returns nothing for a row that has fallen out of the ring", () => {
    log("app", "info", "x", "y", { kept: false })
    const evicted = first()

    for (let i = 0; i < LOG_BUFFER_MAX; i++) log("app", "debug", "x", String(i))

    expect(logDetail(evicted)).toBeUndefined()
  })
})

describe("captureConsole", () => {
  it("forwards warnings to the panel and still to the terminal", () => {
    const original = console.warn
    const seen: unknown[][] = []
    console.warn = (...args: unknown[]) => seen.push(args)

    captureConsole()
    console.warn("sim: exception 3 on sendId 12")

    expect(seen).toHaveLength(1)

    const entry = logBacklog().at(-1)
    expect(entry).toMatchObject({
      source: "app",
      level: "warn",
      kind: "console",
      message: "sim: exception 3 on sendId 12",
    })

    console.warn = original
  })
})
