/**
 * The ring, and the two things a ring gets wrong.
 *
 * It drops the oldest records to make room, and it decodes what it stored
 * through a table it built as it went. Both are silent when broken — a wrapped
 * ring read from the wrong end returns plausible events in the wrong order, and
 * a stale interning table returns the wrong variable's name attached to a real
 * value. Neither throws, and neither looks wrong in a log.
 */

import { beforeEach, describe, expect, it } from "vitest"

import type { CapturedEvent } from "@shared/sim"

import { buffered, observeActivity, resetActivity, slice } from "./activity-buffer"
import { findingsFor } from "./activity"

beforeEach(resetActivity)

const change = (t: number, name: string, value: number): CapturedEvent => ({
  t,
  via: "link",
  kind: "var",
  name,
  value,
})

const input = (t: number, name: string): CapturedEvent => ({
  t,
  via: "client",
  kind: "input",
  name,
  hash: "0",
  value: 1,
})

describe("what it keeps", () => {
  it("returns changes oldest first", () => {
    observeActivity(change(3, "L:C", 3))
    observeActivity(change(1, "L:A", 1))
    observeActivity(change(2, "L:B", 2))

    expect(slice().map((event) => event.t)).toEqual([1, 2, 3])
  })

  it("keeps anchors and changes in one stream", () => {
    observeActivity(change(1, "L:A", 1))
    observeActivity(input(2, "SWITCH"))
    observeActivity(change(3, "L:B", 1))

    expect(slice().map((event) => event.kind)).toEqual(["var", "input", "var"])
  })

  it("narrows to a window", () => {
    for (let t = 0; t < 100; t += 10) observeActivity(change(t, "L:A", t))

    expect(slice(30, 60).map((event) => event.t)).toEqual([30, 40, 50, 60])
  })

  it("ignores everything that is not a change or an interaction", () => {
    observeActivity({ t: 1, via: "link", kind: "vars", from: 0, names: ["L:A"] })
    observeActivity({ t: 2, via: "client", kind: "closed", reason: "quit" })

    expect(slice()).toEqual([])
    expect(buffered().changes).toBe(0)
  })

  /** `A:` and `L:` are told apart by the only thing the packed record keeps. */
  it("rebuilds each namespace as the right kind of event", () => {
    observeActivity(change(1, "L:Knob", 1))
    observeActivity({
      t: 2,
      via: "client",
      kind: "simvar",
      name: "A:BATTERY VOLTAGE",
      units: "Volts",
      value: 24,
    })

    expect(slice().map((event) => event.kind)).toEqual(["var", "simvar"])
  })
})

describe("when it wraps", () => {
  /**
   * The capacity is two minutes at 1,500 changes a second, so filling it in a
   * test means writing 180,000 records. Worth it: a ring that is only ever
   * tested below capacity is a ring whose wrap has never run.
   */
  const CAPACITY = 120 * 1_500

  it("drops the oldest and keeps order across the seam", () => {
    for (let n = 0; n < CAPACITY + 1_000; n += 1) {
      observeActivity(change(n, "L:A", n))
    }

    const events = slice()
    expect(events).toHaveLength(CAPACITY)

    // The first thousand are gone, and what remains still runs forwards.
    expect(events[0]!.t).toBe(1_000)
    expect(events.at(-1)!.t).toBe(CAPACITY + 999)

    for (let n = 1; n < events.length; n += 1) {
      expect(events[n]!.t).toBeGreaterThan(events[n - 1]!.t)
    }
  })

  it("still decodes names correctly after wrapping", () => {
    for (let n = 0; n < CAPACITY + 500; n += 1) {
      observeActivity(change(n, n % 2 === 0 ? "L:Even" : "L:Odd", n))
    }

    const events = slice(CAPACITY, CAPACITY + 3)
    for (const event of events) {
      expect(event.kind).toBe("var")
      if (event.kind !== "var") continue
      expect(event.name).toBe(event.t % 2 === 0 ? "L:Even" : "L:Odd")
    }
  })
})

describe("reset", () => {
  it("forgets the interning table with the records", () => {
    observeActivity(change(1, "L:First", 1))
    resetActivity()
    observeActivity(change(2, "L:Second", 2))

    const [event] = slice()
    expect(event?.kind).toBe("var")
    // Ids are positions in an array that reset rebuilt. Keeping the old table
    // would decode this record as `L:First` — a real value under the wrong
    // name, which reads as the simulator lying.
    if (event?.kind === "var") expect(event.name).toBe("L:Second")
  })
})

describe("the buffer feeds the ranking", () => {
  it("produces a finding from what it held", () => {
    // The shape the real thing has: an interaction, the variable it moved, and
    // a heartbeat that moves regardless and must not be offered.
    for (let t = 0; t < 60_000; t += 100) {
      observeActivity(change(t, "L:Heartbeat", t))
    }

    observeActivity(input(30_000, "SWITCH_BATTERY_MASTER_2STATES"))
    observeActivity(change(30_040, "L:Battery1Switch", 1))

    const findings = findingsFor(slice())

    expect(findings).toHaveLength(1)
    expect(findings[0]!.candidates[0]!.name).toBe("L:Battery1Switch")
    expect(findings[0]!.candidates.map((c) => c.name)).not.toContain("L:Heartbeat")
  })
})
