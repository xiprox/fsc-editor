/**
 * The instrument, not the ranking.
 *
 * These cover the two claims the debug work makes and nothing else: a capture
 * that carries its own marks reproduces the session it came from, and a
 * variable that was rejected can say why it was rejected. Both exist because
 * the PA-24 sessions this was built for produce answers that look empty, and
 * an empty answer with no working shown is indistinguishable from a bug.
 */

import { describe, expect, it } from "vitest"

import { AMBIENT_PER_SECOND } from "@shared/activity"
import type { CapturedEvent } from "@shared/sim"

import { anchorsIn, explainAll, findingsFor } from "./activity"
import { clearAnchors, observeActivity, resetActivity, slice } from "./activity-buffer"

/** The three event shapes this needs, including the new one. */
function stream(
  parts: ({ at: number } & (
    | { input: string }
    | { changed: string; value: number }
    | { mark: true }
  ))[]
): CapturedEvent[] {
  return parts.map((part) => {
    if ("input" in part)
      return {
        t: part.at,
        via: "client",
        kind: "input",
        name: part.input,
        hash: "0",
        value: 1,
      }
    if ("mark" in part) return { t: part.at, via: "app", kind: "mark" }
    return { t: part.at, via: "link", kind: "var", name: part.changed, value: part.value }
  })
}

describe("marks in the stream", () => {
  /**
   * The whole reason a mark is captured. Replaying a session must give the
   * panel that session had, and the argument `marks.ts` would have supplied is
   * empty when the events come off disk a week later.
   */
  it("anchors a mark that arrived as an event, with nothing passed in", () => {
    const events = stream([
      { at: 10_000, changed: "L:Mystery", value: 1 },
      { at: 9_800, mark: true },
    ])

    const anchors = anchorsIn(events)

    expect(anchors).toHaveLength(1)
    expect(anchors[0]!.kind).toBe("mark")
    expect(anchors[0]!.t).toBe(9_800)
  })

  /**
   * Live, a mark is in `marks.ts` *and* would be in a capture read back. The
   * same instant twice would anchor twice and rank the same window twice.
   */
  it("does not anchor the same instant twice", () => {
    const events = stream([
      { at: 10_000, changed: "L:Mystery", value: 1 },
      { at: 9_800, mark: true },
    ])

    expect(anchorsIn(events, [{ t: 9_800 }])).toHaveLength(1)
  })
})

describe("the working, shown", () => {
  /**
   * A rejected variable is the interesting half when the answer is wrong. It
   * has to arrive with the rate that rejected it, or "why is this missing"
   * stays unanswerable from the file.
   */
  it("names what was rejected, and at what rate", () => {
    const parts: Parameters<typeof stream>[0] = []

    // A heartbeat, well over the threshold, moving throughout.
    for (let t = 0; t < 60_000; t += 100) {
      parts.push({ at: t, changed: "L:Heartbeat", value: t })
    }

    parts.push({ at: 30_000, input: "SWITCH_BATTERY_MASTER_2STATES" })
    parts.push({ at: 30_040, changed: "L:Battery1Switch", value: 1 })

    const { anchors } = explainAll(stream(parts))

    expect(anchors).toHaveLength(1)
    expect(anchors[0]!.candidates.map((one) => one.name)).toEqual(["L:Battery1Switch"])

    const rejected = anchors[0]!.rejected
    expect(rejected.map((one) => one.name)).toEqual(["L:Heartbeat"])
    expect(rejected[0]!.reason).toBe("ambient")
    expect(rejected[0]!.baseline).toBeGreaterThan(AMBIENT_PER_SECOND)
  })

  /**
   * A click sound that moves for every control is not ambient by rate — it only
   * moves when you touch something, so no rate threshold sees it — and it
   * outranks the real answer whenever it lands in an earlier sample. Counting
   * the *different controls* a variable answers to is what says so.
   */
  it("counts how many different controls a variable answered to", () => {
    const { companions } = explainAll(
      stream([
        { at: 10_000, input: "SWITCH_A" },
        { at: 10_040, changed: "L:CockpitSwitchSnd", value: 1 },
        { at: 10_040, changed: "L:SwitchA", value: 1 },

        { at: 40_000, input: "SWITCH_B" },
        { at: 40_040, changed: "L:CockpitSwitchSnd", value: 0 },
        { at: 40_040, changed: "L:SwitchB", value: 1 },
      ])
    )

    expect(companions[0]).toEqual({
      name: "L:CockpitSwitchSnd",
      controls: 2,
      under: ["SWITCH_A", "SWITCH_B"],
    })
    expect(companions.filter((one) => one.controls === 1)).toHaveLength(2)
  })

  /**
   * The repeat case, which is what makes it *controls* rather than anchors.
   * One control touched three times is three anchors and the variable it moves
   * is in all three windows — counting anchors would call the answer
   * promiscuous and bury it under everything that moved once.
   */
  it("does not count repeats of one control as variety", () => {
    const { companions } = explainAll(
      stream([
        { at: 10_000, input: "SWITCH_BEACON" },
        { at: 10_040, changed: "L:BeaconLightSwitch", value: 1 },
        { at: 30_000, input: "SWITCH_BEACON" },
        { at: 30_040, changed: "L:BeaconLightSwitch", value: 0 },
        { at: 50_000, input: "SWITCH_BEACON" },
        { at: 50_040, changed: "L:BeaconLightSwitch", value: 1 },
      ])
    )

    expect(companions).toEqual([
      { name: "L:BeaconLightSwitch", controls: 1, under: ["SWITCH_BEACON"] },
    ])
  })

  /**
   * And the ordering it buys. The sound is earlier in both windows and still
   * has to lose, because it answers to two controls and each switch answers to
   * one. This is the case that put click sounds at the top of three consecutive
   * anchors in a real session.
   */
  it("ranks the specific variable above the earlier promiscuous one", () => {
    const findings = findingsFor(
      stream([
        { at: 10_000, input: "SWITCH_A" },
        { at: 10_020, changed: "L:CockpitSwitchSnd", value: 1 },
        { at: 10_060, changed: "L:SwitchA", value: 1 },

        { at: 40_000, input: "SWITCH_B" },
        { at: 40_020, changed: "L:CockpitSwitchSnd", value: 0 },
        { at: 40_060, changed: "L:SwitchB", value: 1 },
      ])
    )

    expect(findings[0]!.candidates.map((one) => one.name)).toEqual([
      "L:SwitchA",
      "L:CockpitSwitchSnd",
    ])
    expect(findings[1]!.candidates.map((one) => one.name)).toEqual([
      "L:SwitchB",
      "L:CockpitSwitchSnd",
    ])
  })
})

describe("clearing entries", () => {
  /**
   * Clearing a list must not re-rank what comes after it. The values stay, so
   * a variable that has been moving all session still reads as one that moves.
   */
  it("drops the anchors and keeps the values", () => {
    resetActivity()

    for (let t = 0; t < 60_000; t += 100) {
      observeActivity({ t, via: "link", kind: "var", name: "L:Heartbeat", value: t })
    }
    observeActivity({
      t: 30_000,
      via: "client",
      kind: "input",
      name: "SWITCH_BATTERY_MASTER_2STATES",
      hash: "0",
      value: 1,
    })

    expect(slice().some((event) => event.kind === "input")).toBe(true)

    clearAnchors()

    const left = slice()
    expect(left.some((event) => event.kind === "input")).toBe(false)
    expect(left.filter((event) => event.kind === "var")).toHaveLength(600)

    resetActivity()
  })
})

/**
 * What previous sessions knew.
 *
 * Every other signal here is measured over the last two minutes in memory, so
 * it starts from nothing each time the app opens — which makes the first mark
 * of a session the worst answer of the session, and the first mark is the one
 * people make. History is the only fix for that class.
 */
describe("history from earlier sessions", () => {
  const events = stream([
    { at: 0, changed: "L:Heartbeat", value: 1 },
    { at: 10_000, input: "SWITCH_A" },
    { at: 10_040, changed: "L:Heartbeat", value: 2 },
    { at: 10_040, changed: "L:SwitchA", value: 1 },
  ])

  /**
   * A two-minute buffer can fail to show that a variable churns — it may not
   * have churned yet. Here the heartbeat reports twice and looks as quiet as
   * the switch, which is exactly how a click sound gets promoted on a young
   * buffer.
   */
  it("without it, a heartbeat that has not churned yet is a candidate", () => {
    const [finding] = findingsFor(events)

    expect(finding!.candidates.map((one) => one.name)).toContain("L:Heartbeat")
  })

  it("with it, the same heartbeat is already known to be one", () => {
    const [finding] = findingsFor(events, [], {
      history: new Map([["L:Heartbeat", 12]]),
    })

    const names = finding!.candidates.map((one) => one.name)
    expect(names).not.toContain("L:Heartbeat")
    expect(names).toContain("L:SwitchA")
  })

  /**
   * The higher of the two readings wins, and the direction matters: history
   * cannot invent churn that never happened, but a short buffer can miss churn
   * that did. Being wrong this way costs a candidate; the other way costs the
   * answer.
   */
  it("does not let a quiet history rescue something churning now", () => {
    const busy: Parameters<typeof stream>[0] = []
    for (let t = 0; t < 60_000; t += 100) {
      busy.push({ at: t, changed: "L:Heartbeat", value: t })
    }
    busy.push({ at: 30_000, input: "SWITCH_A" })
    busy.push({ at: 30_040, changed: "L:SwitchA", value: 1 })

    const [finding] = findingsFor(stream(busy), [], {
      history: new Map([["L:Heartbeat", 0]]),
    })

    expect(finding!.candidates.map((one) => one.name)).toEqual(["L:SwitchA"])
  })
})
