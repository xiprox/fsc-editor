/**
 * A control's own variable arriving before the control did.
 *
 * `pa24-early-report.ndjson.gz` is 60 seconds of a PA-24: the pitot heat switch
 * flipped eleven times and the battery master twice, both with a known right
 * answer. It exists because of what it did to the ranking before `JITTER_MS`.
 *
 * ## What it caught
 *
 * `L:` values arrive through our WASM module and input events through
 * SimConnect — two transports, two latencies — so the offset between a control
 * and its own variable carries tens of milliseconds of noise. The window has
 * always opened 50 ms early to absorb that. The **sort** had not, and treated
 * any negative offset as proof the change preceded its cause.
 *
 * So `L:Battery1Switch`, the variable this whole ranking was built on, placed
 * **15th of 16** in both battery anchors for reporting 2 ms early. Across the
 * thirteen anchors here the right answer was first four times, and its mean
 * position was fifth.
 *
 * A tolerance that exists in the window and not in the ordering is not a
 * tolerance.
 *
 * ## And what it caught second
 *
 * With that fixed the battery master still placed eighth and tenth, because
 * `L:Battery1Charge` at −1 ms beat `L:Battery1Switch` at −2 ms. The app stamps
 * each value with `Date.now()` as it parses, so one 8 KB message spreads its
 * ~192 values across a couple of milliseconds — ordering on that is ordering by
 * parse order, which is variable-id order. See `SAMPLE_MS`.
 */

import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { JITTER_MS } from "@shared/activity"

import { findingsFor } from "./activity"
import { readCapture } from "./sim/replay"

const events = readCapture(
  join(import.meta.dirname, "sim", "fixtures", "pa24-early-report.ndjson.gz")
)

/** The variable each of these controls really is. */
const ANSWERS: Record<string, string> = {
  SWITCH_PITOT_HEAT_2STATES: "L:PitotHeatSwitch",
  SWITCH_BATTERY_MASTER_2STATES: "L:Battery1Switch",
}

/** Where the right answer placed, one entry per anchor, 1-based. 0 = absent. */
function placings(): number[] {
  return findingsFor(events).map((finding) => {
    const answer = ANSWERS[finding.anchor.name]
    if (!answer) return 0

    return (
      finding.candidates.findIndex((one) =>
        [one.name, ...one.aliases].includes(answer)
      ) + 1
    )
  })
}

describe("a variable that reports before its own control", () => {
  it("holds both controls, flipped repeatedly", () => {
    const controls = findingsFor(events).map((finding) => finding.anchor.name)

    expect(controls.filter((one) => one === "SWITCH_PITOT_HEAT_2STATES").length)
      .toBeGreaterThan(5)
    expect(controls).toContain("SWITCH_BATTERY_MASTER_2STATES")
  })

  /**
   * The case itself: at least one anchor where the answer arrived *before* the
   * input event. Without one the rest of this file proves nothing.
   */
  it("really does report early somewhere", () => {
    const early = findingsFor(events).flatMap((finding) =>
      finding.candidates.filter(
        (one) =>
          one.name === ANSWERS[finding.anchor.name] &&
          one.offset < 0 &&
          one.offset >= -JITTER_MS
      )
    )

    expect(early.length).toBeGreaterThan(0)
  })

  /**
   * Not "first everywhere" — a switch flipped back reports on a later sample
   * and some anchors genuinely hold nothing of it. Top three in every anchor is
   * what the data supports, and it is what the ordering before this could not
   * do: it managed six of thirteen, with two at fifteenth.
   */
  it("puts the right answer in the top three of every anchor", () => {
    const at = placings()

    expect(at.every((one) => one > 0)).toBe(true)
    expect(at.every((one) => one <= 3)).toBe(true)
  })

  it("puts it first in most of them", () => {
    const at = placings()
    const first = at.filter((one) => one === 1).length

    expect(first / at.length).toBeGreaterThan(0.5)
  })

  /**
   * The battery master, where every immediate effect lands in one sample.
   *
   * Second is the honest ceiling here and not a disappointment: `L:Battery1Volts`
   * genuinely moves in the same sample as the switch that caused it, and no
   * signal in this ranking can separate two things the wire delivered together.
   * What it must not do is order them by parse order — that put the switch
   * eighth of thirty-four.
   */
  it("keeps the battery master's switch at the top despite a tied sample", () => {
    const battery = findingsFor(events).filter(
      (finding) => finding.anchor.name === "SWITCH_BATTERY_MASTER_2STATES"
    )

    expect(battery.length).toBeGreaterThan(0)
    for (const finding of battery) {
      const at = finding.candidates.findIndex((one) =>
        [one.name, ...one.aliases].includes("L:Battery1Switch")
      )
      expect(at).toBeGreaterThanOrEqual(0)
      expect(at).toBeLessThan(3)
    }
  })

  /**
   * And the label, which was wrong in the same way for the same reason:
   * a switch reporting 2 ms early was filed as `downstream`, which says the
   * control is a consequence of itself.
   */
  it("calls an early report the control, not a consequence", () => {
    const early = findingsFor(events).flatMap((finding) =>
      finding.candidates.filter(
        (one) => one.name === ANSWERS[finding.anchor.name] && one.offset < 0
      )
    )

    expect(early.length).toBeGreaterThan(0)
    for (const one of early) expect(one.tier).toBe("direct")
  })
})
