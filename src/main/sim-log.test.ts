/**
 * The sim stream's tee into the Log panel. What is worth asserting is the
 * behaviour under load — that a flood becomes a row rather than six thousand,
 * and that folding values never reorders them around an interaction.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { CapturedEvent } from "@shared/sim"

import { clearLog, logBacklog, logDetail } from "./log"
import { flushValueLog, logSimEvent, resetSimLog } from "./sim-log"

beforeEach(() => {
  vi.useFakeTimers()
  clearLog()
  resetSimLog()
})

afterEach(() => {
  vi.useRealTimers()
})

const value = (name: string, v: number): CapturedEvent => ({
  t: Date.now(),
  via: "link",
  kind: "var",
  name,
  value: v,
})

const simvar = (name: string, v: number): CapturedEvent => ({
  t: Date.now(),
  via: "client",
  kind: "simvar",
  name,
  units: "Volts",
  value: v,
})

const input = (name: string): CapturedEvent => ({
  t: Date.now(),
  via: "client",
  kind: "input",
  name,
  hash: "1",
  value: 1,
})

/** Past the window, so anything counted has been reported. */
const settle = () => vi.advanceTimersByTime(300)

describe("values", () => {
  it("folds a re-enumeration flood into a single row", () => {
    // The shape this exists for: an aircraft change makes the module re-report
    // every variable it knows about, inside one frame.
    for (let i = 0; i < 6_150; i++) logSimEvent(value(`L:VAR_${i}`, i))

    expect(logBacklog()).toHaveLength(0)
    settle()

    const rows = logBacklog()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.message).toContain("6150 values from 6150 variables")
  })

  it("counts repeats of one variable as values, not as variables", () => {
    for (let i = 0; i < 10; i++) logSimEvent(value("L:Rpm", i))
    settle()

    expect(logBacklog()[0]?.message).toContain("10 values from 1 variable")
  })

  it("keeps a bounded sample, and says how much it left out", () => {
    // Bounded because a row retains what it keeps for as long as it is in the
    // ring — thousands of value objects per row is the leak this avoids.
    for (let i = 0; i < 500; i++) logSimEvent(value(`L:VAR_${i}`, i))
    settle()

    const detail = logDetail(logBacklog()[0]!.id) as {
      values: number
      variables: number
      sample: unknown[]
      omitted: number
    }

    expect(detail.values).toBe(500)
    expect(detail.sample).toHaveLength(50)
    expect(detail.omitted).toBe(450)
  })

  it("does not claim an omission when everything fitted", () => {
    logSimEvent(value("L:Rpm", 1))
    settle()

    expect(logDetail(logBacklog()[0]!.id)).not.toHaveProperty("omitted")
  })

  it("keeps the two transports in separate rows", () => {
    // `A:` is a whole watch set once a second and `L:` is a delta at 15 Hz.
    // Folding them together would make the `via` on the row a guess.
    logSimEvent(value("L:Rpm", 1))
    logSimEvent(simvar("A:BATTERY VOLTAGE", 24))
    settle()

    const rows = logBacklog()
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.kind).sort()).toEqual(["simvar", "var"])
  })

  it("starts a fresh window after reporting one", () => {
    logSimEvent(value("L:Rpm", 1))
    settle()
    logSimEvent(value("L:Rpm", 2))
    settle()

    expect(logBacklog()).toHaveLength(2)
  })

  it("reports nothing when nothing arrived", () => {
    settle()
    expect(logBacklog()).toHaveLength(0)
  })
})

describe("everything else", () => {
  it("logs one row per event, immediately", () => {
    logSimEvent(input("SWITCH_A"))
    logSimEvent(input("SWITCH_B"))

    // Not deferred: these arrive at a rate a reader can follow, and the panel's
    // own burst collapse is built around seeing them individually.
    expect(logBacklog().map((row) => row.message)).toEqual([
      "SWITCH_A = 1  ·  via client",
      "SWITCH_B = 1  ·  via client",
    ])
  })

  it("keeps the whole event as the row's detail", () => {
    logSimEvent(input("SWITCH_A"))
    expect(logDetail(logBacklog()[0]!.id)).toMatchObject({
      kind: "input",
      name: "SWITCH_A",
    })
  })
})

describe("ordering", () => {
  it("reports pending values before the interaction that follows them", () => {
    /*
     * The reason to look at this panel during a session is causality — the
     * switch, then what moved. Holding a window open across an interaction
     * would file the values that *preceded* the flip underneath it.
     */
    logSimEvent(value("L:Before", 1))
    logSimEvent(input("SWITCH_A"))
    logSimEvent(value("L:After", 1))
    settle()

    expect(logBacklog().map((row) => row.message)).toEqual([
      "1 values from 1 variable  ·  via link",
      "SWITCH_A = 1  ·  via client",
      "1 values from 1 variable  ·  via link",
    ])
  })
})

describe("reset", () => {
  it("drops what was counted but not yet reported", () => {
    logSimEvent(value("L:Rpm", 1))
    resetSimLog()
    settle()

    expect(logBacklog()).toHaveLength(0)
  })

  it("reports on demand without waiting for the window", () => {
    logSimEvent(value("L:Rpm", 1))
    flushValueLog()

    expect(logBacklog()).toHaveLength(1)
  })
})

describe("a session ending", () => {
  it("reports the last values above the line saying it closed", () => {
    // No reset is wired into `teardown` because of this: the `closed` event
    // flushes on its way past, so nothing counted is lost and nothing lands
    // after the session it belonged to.
    logSimEvent(value("L:Rpm", 1))
    logSimEvent({ t: Date.now(), via: "client", kind: "closed", reason: "quit" })

    expect(logBacklog().map((row) => row.kind)).toEqual(["var", "closed"])
  })
})
