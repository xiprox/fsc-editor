/**
 * A capture on a control the simulator does not report, from a real session.
 *
 * `pa24-mark-cabin-vent.ndjson.gz` is 24 seconds of a PA-24 with two captures
 * in it, made while pulling the cabin vent lever — a control MSFS reports no
 * input event for, which is the case the hotkey exists to cover. It is the
 * first fixture that carries its own marks, and that is the point of it: the
 * argument `marks.ts` would supply live is empty here, so the stream has to be
 * enough.
 *
 * ## What it caught
 *
 * The session it came from produced **nothing**. 5,551 of 5,554 variables were
 * rejected as ambient, including the vent lever, which had been found at
 * +1.1 seconds and thrown away at a measured 0.94 changes a second.
 *
 * The buffer was 24 seconds old and the two windows covered 21.8 of them,
 * leaving 2.1 seconds of quiet time to infer every rate from. At that
 * denominator two changes is 0.94/s — and every variable has two, because
 * enumeration reports each one once and there are two walks on connect. The
 * filter did not misjudge the vent lever; it rejected the entire aircraft.
 *
 * See `MIN_QUIET_MS`.
 *
 * ## It predates the inverted window, and that limits what it can prove
 *
 * These two captures were made press-then-act: the key first, the lever after.
 * A capture looks **backwards** now — twelve seconds behind the press, half a
 * second ahead — because that is the gesture people actually make, and because
 * the evidence is then already in the ring when the key goes down. So this
 * fixture holds a gesture the feature no longer expects: the first capture
 * reaches nothing, and the second finds the lever 4.7 seconds behind it, from
 * the *first* pull.
 *
 * It is kept rather than re-recorded because what it caught was never about the
 * window. The denominator collapse is asserted below against the measured rate
 * directly, where no window can move it.
 */

import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  AMBIENT_PER_SECOND,
  MARK_AFTER_MS,
  MARK_BEFORE_MS,
  SNAPSHOT_DISTINCT,
  type Finding,
} from "@shared/activity"
import type { CapturedEvent } from "@shared/sim"

import { anchorsIn, baselinesIn, explainAll, findingsFor } from "./activity"
import { readCapture } from "./sim/replay"

const events = readCapture(
  join(import.meta.dirname, "sim", "fixtures", "pa24-mark-cabin-vent.ndjson.gz")
)

describe("a capture on a control the simulator did not report", () => {
  it("carries its own marks, and anchors both", () => {
    const anchors = anchorsIn(events)

    expect(anchors).toHaveLength(2)
    expect(anchors.every((anchor) => anchor.kind === "mark")).toBe(true)
  })

  /** Behind the press, not ahead of it. */
  it("looks backwards", () => {
    const [first] = anchorsIn(events)

    expect(first!.before).toBe(MARK_BEFORE_MS)
    expect(first!.after).toBe(MARK_AFTER_MS)
    expect(first!.before).toBeGreaterThan(first!.after * 10)
  })

  /**
   * **The regression, asserted where a window cannot move it.**
   *
   * With the collapsed denominator these measured 0.94 changes a second and
   * were discarded as ambient along with the rest of the aircraft.
   */
  it("measures the vent lever as the rarely-moving thing it is", () => {
    const rates = baselinesIn(events, anchorsIn(events))

    for (const name of ["L:CabinVentLeftLever", "L:CabinVents", "L:CabinFrontVents"]) {
      expect(rates.get(name)).toBeLessThan(AMBIENT_PER_SECOND)
    }
  })

  it("does not reject the whole aircraft", () => {
    const { anchors } = explainAll(events)
    const rejected = new Set(
      anchors.flatMap((one) => one.rejected.map((each) => each.name))
    )

    // 5,551 of 5,554, before. The instruments that genuinely never stop moving
    // are a couple of hundred.
    expect(rejected.size).toBeLessThan(500)
    for (const one of anchors) expect(one.candidates.length).toBeGreaterThan(10)
  })

  /** And the lever is offered by the capture whose window reaches it. */
  it("offers the vent lever to the capture that can see it", () => {
    const reaching = findingsFor(events).filter((finding) =>
      finding.candidates.some((one) =>
        [one.name, ...one.aliases].includes("L:CabinVentLeftLever")
      )
    )

    expect(reaching.length).toBeGreaterThan(0)
  })

  /**
   * The table re-report, which is what made the first capture useless.
   *
   * Connecting reseeds the module's comparison array, so the next tick reports
   * every variable once — 5,554 of them, inside a single second. Ranked as
   * movement each one reads as "moved once, next to your anchor, and never
   * otherwise", which is the signature of a perfect answer.
   */
  it("does not rank the enumeration snapshot", () => {
    const { anchors } = explainAll(events)

    // 5,397, before.
    for (const one of anchors) expect(one.candidates.length).toBeLessThan(200)
  })

  /**
   * The aircraft has several names for one lever and they move on the same
   * sample every time. One row, the rest as aliases.
   */
  it("folds lockstep variables into one row", () => {
    const group = findingsFor(events)
      .flatMap((finding) => finding.candidates)
      .find((one) => [one.name, ...one.aliases].includes("L:CabinVents"))

    expect(group).toBeDefined()
    expect([group!.name, ...group!.aliases].sort()).toEqual([
      "L:CabinFrontVents",
      "L:CabinPushPullLevers",
      "L:CabinVentLever1",
      "L:CabinVents",
    ])
  })

  /** Grouping hides rows; it must never lose a name. */
  it("keeps every name exactly once", () => {
    for (const finding of findingsFor(events)) {
      const all = finding.candidates.flatMap((one) => [one.name, ...one.aliases])
      expect(new Set(all).size).toBe(all.length)
    }
  })

  /**
   * And the filter still has to work. The aircraft's own instruments run at
   * tens of changes a second here and are not candidates for anything — a floor
   * that saved the vent lever by disabling the filter would pass the tests
   * above and be worthless.
   */
  it("still rejects what is genuinely always moving", () => {
    const { anchors } = explainAll(events)
    const rejected = anchors.flatMap((one) => one.rejected)

    const airspeed = rejected.find((one) => one.name === "L:AirspeedIndicated")
    expect(airspeed).toBeDefined()
    expect(airspeed!.baseline).toBeGreaterThan(AMBIENT_PER_SECOND)

    const candidates = anchors.flatMap((one) => one.candidates.map((c) => c.name))
    expect(candidates).not.toContain("L:AirspeedIndicated")
  })
})

describe("a busy second is not a snapshot", () => {
  /** `count` variables all reporting in one sample, then one real interaction. */
  function burst(count: number): CapturedEvent[] {
    const events: CapturedEvent[] = []

    // Some history, so there is a buffer to measure a baseline against.
    for (let t = 0; t < 40_000; t += 1_000) {
      events.push({ t, via: "link", kind: "var", name: "L:Idle", value: t })
    }

    // Inside the anchor's window, which opens 50 ms before it and runs 600 ms
    // after: a burst landing before the window would be excluded by proximity
    // and prove nothing about the snapshot rule.
    for (let n = 0; n < count; n += 1) {
      events.push({ t: 50_140, via: "link", kind: "var", name: `L:Bulk${n}`, value: 1 })
    }

    events.push({
      t: 50_100,
      via: "client",
      kind: "input",
      name: "SWITCH_SOMETHING",
      hash: "0",
      value: 1,
    })

    return events.sort((a, b) => a.t - b.t)
  }

  /**
   * Counted by name rather than by row: every variable in a synthetic burst
   * changes on the same single sample, so they are perfect lockstep twins and
   * `grouped` folds them into one candidate carrying the rest as aliases. That
   * is the grouping rule working, not the snapshot rule firing — what matters
   * here is that none of them was thrown away.
   */
  const named = (finding: Finding): number =>
    finding.candidates.reduce((n, one) => n + 1 + one.aliases.length, 0)

  it("ranks a burst of two hundred", () => {
    const [finding] = findingsFor(burst(200))

    expect(named(finding!)).toBeGreaterThan(100)
  })

  it("drops a burst of the whole table", () => {
    const [finding] = findingsFor(burst(5_000))

    expect(finding!.candidates).toHaveLength(0)
  })

  /**
   * The small aircraft, which a flat threshold gets wrong in the dangerous
   * direction. A light single enumerates a few hundred `L:` variables, so its
   * entire table is smaller than any constant chosen to survive an airliner's
   * ordinary traffic — and its snapshot would sail straight through.
   */
  it("catches a snapshot smaller than the flat fallback", () => {
    const [finding] = findingsFor(burst(600), [], { enumerated: 600 })

    expect(600).toBeLessThan(SNAPSHOT_DISTINCT)
    expect(finding!.candidates).toHaveLength(0)
  })

  /**
   * And the airliner, which it gets wrong in the other direction. Fifteen
   * hundred variables moving inside one second is nothing like anything
   * measured, but it is the case a fixed threshold of a thousand would have
   * thrown away entirely.
   */
  it("keeps a busy second on an aircraft with a large table", () => {
    const [finding] = findingsFor(burst(1_500), [], { enumerated: 20_000 })

    expect(1_500).toBeGreaterThan(SNAPSHOT_DISTINCT)
    expect(named(finding!)).toBeGreaterThan(1_000)
  })
})
