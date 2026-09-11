/**
 * Six different controls, and the variable each one actually moved.
 *
 * `pa24-many-controls.ndjson.gz` is 115 seconds of a PA-24 in which the beacon
 * switch, the starter, the fuel indicator, the glovebox, the ADF inner knob and
 * the heading bug were all worked — 148 input events, 243,858 changes. Variety
 * is the whole point: promiscuity is a claim about a variable turning up under
 * *different* controls, and a fixture with one control in it cannot test it. An
 * earlier 55-second slice with five controls was thrown away for exactly that
 * reason — it held one toggle switch, so the toggle's click sound answered to
 * one control and looked as specific as the switch itself.
 *
 * ## What it locks in
 *
 * Before promiscuity was a sort term, the top of these lists was the same small
 * cast whatever you touched: `L:CockpitSwitchSnd`, `L:SmallToggleSwitchSnd`,
 * `L:Eyelids4`, `L:Blinking4Offset`, `L:SteamAmount`, `L:p42_cp_motion_pause`.
 * Click sounds, an eyelid blink, a camera-motion accumulator. None is ambient —
 * they move only when you touch something, so no rate threshold sees them.
 */

import { join } from "node:path"

import { describe, expect, it } from "vitest"

import type { Candidate } from "@shared/activity"

import { explainAll, findingsFor } from "./activity"
import { readCapture } from "./sim/replay"

const events = readCapture(
  join(import.meta.dirname, "sim", "fixtures", "pa24-many-controls.ndjson.gz")
)

const findings = findingsFor(events)

/** Every control in the fixture, and the variable it really is. */
const ANSWERS: [string, string][] = [
  ["SWITCH_LIGHT_BEACON_2STATES", "L:BeaconLightSwitch"],
  ["PUSHBUTTON_STARTER_2STATES", "L:Eng1_StarterSwitch"],
  ["SWITCH_FUEL_INDICATOR_2STATES", "L:FuelIndicatorSwitch"],
  ["ASHTRAY2_GLOVEBOX", "L:GloveboxAnim"],
  ["RADIO_EVENT_KNOB_ADFINNER", "L:ADFFreqInnerKnob"],
  ["KNOB_DEFAULT_TOTO", "L:AutopilotHeadingBug"],
]

describe("six controls, six answers", () => {
  it("holds all six", () => {
    const controls = new Set(findings.map((finding) => finding.anchor.name))
    expect([...controls].sort()).toEqual(ANSWERS.map(([name]) => name).sort())
  })

  /**
   * Per control, the answer tops at least one of its windows.
   *
   * "At least one" rather than "all", and the weaker claim is the honest one: a
   * control touched twice makes two anchors and its variable moves in one of
   * them, because flipping a switch back reports on a later 66 ms sample that
   * can fall outside the window. Turning the ADF knob seven times produces
   * anchors in which nothing of the knob's own changed at all. An anchor with
   * no right answer in it cannot rank the right answer first, and asserting
   * otherwise would be asserting something about the simulator's sample rate.
   */
  it.each(ANSWERS)("ranks %s's own variable first somewhere", (control, answer) => {
    const placings = findings
      .filter((finding) => finding.anchor.name === control)
      .map((finding) => finding.candidates.findIndex((one) => one.name === answer))
      .filter((at) => at >= 0)

    expect(placings.length).toBeGreaterThan(0)
    expect(placings).toContain(0)
  })

  /** And what leads is overwhelmingly something specific to one control. */
  it("leads with a control-specific variable in most windows", () => {
    const leaders = findings
      .map((finding) => finding.candidates[0])
      .filter((one): one is Candidate => one !== undefined)

    const specific = leaders.filter((one) => one.promiscuity <= 2).length
    expect(specific / leaders.length).toBeGreaterThan(0.8)
  })
})

/**
 * The improvement, measured against the ordering this replaced.
 *
 * A threshold-free regression: rather than asserting a number that drifts, it
 * re-sorts each window by the *old* rules — proximity, then baseline, then name
 * — and counts how often each ordering leads with a variable that answers to
 * one control. Promiscuity has to win, on this fixture, by construction of the
 * sort. If a later change makes that untrue, this fails and says by how much.
 */
describe("against the ordering it replaced", () => {
  const leadsSpecifically = (pick: (candidates: Candidate[]) => Candidate | undefined) =>
    findings.filter((finding) => (pick(finding.candidates)?.promiscuity ?? 9) === 1).length

  it("leads with a specific variable more often than proximity alone did", () => {
    const now = leadsSpecifically((candidates) => candidates[0])

    const before = leadsSpecifically(
      (candidates) =>
        [...candidates].sort(
          (a, b) =>
            Number(a.offset < 0) - Number(b.offset < 0) ||
            Math.abs(a.offset) - Math.abs(b.offset) ||
            a.baseline - b.baseline ||
            a.name.localeCompare(b.name)
        )[0]
    )

    expect(now).toBeGreaterThan(before)
  })
})

describe("the companions this demotes", () => {
  const { companions } = explainAll(events)

  /**
   * The measurement itself. These answer to most of the controls in the
   * fixture, and nothing a control genuinely owns does.
   */
  it("finds the blinks, sounds and accumulators under most controls", () => {
    const most = companions.filter((one) => one.controls >= 4).map((one) => one.name)

    expect(most).toContain("L:p42_cp_interactive_render")
    expect(most).toContain("L:Eyelids4")
    expect(most).toContain("L:CockpitSwitchSnd")
  })

  /** The converse, which is the assumption the sort rests on. */
  it("keeps every correct answer at one control", () => {
    const by = new Map(companions.map((one) => [one.name, one]))

    for (const [, answer] of ANSWERS) {
      expect(by.get(answer)?.controls).toBe(1)
    }
  })
})
