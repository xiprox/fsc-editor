/**
 * What every structured diagnostic must be true of, whichever rule wrote it.
 *
 * Run through `analyzeProfile` rather than rule by rule, so a rule converted
 * later is held to these the moment a line in the fixture trips it — and so
 * the parts are checked as the editor receives them, after placing.
 */

import { describe, expect, it } from "vitest"

import { analyzeProfile } from "../analysis.ts"
import type { RuleContext } from "./rules.ts"

const PROFILE = `# Updated: 2026-09-19
sharde:
  - get: L:ONE

master:
  - get: A:BRAKE LEFT POSITION, Position
    set: K:AXIS_LEFT_BRAKE_SET

shared:
  - get: Z:AUDIO_Knob_Selector_1
  - get: L:TWO
    set: 2 16272 (>K:KOHLSMAN_SET)
  - get: L:THREE
    set: 1 (>B:ELECTRICAL_Battery_1)
  - get: ELT ACTIVATED, Bool
`

const CONTEXT: RuleContext = {
  keyEventParams: (event) =>
    event === "KOHLSMAN_SET" ? "[0]: Value to set [1]: Altimeter index" : null,
  hasInputEvent: (name) => name === "ELECTRICAL_Battery_1",
  refResolved: (name) => (name === "Z:AUDIO_Knob_Selector_1" ? false : null),
}

const structured = analyzeProfile(PROFILE, CONTEXT).filter(
  (diagnostic) => diagnostic.verdict
)

describe("structured diagnostics", () => {
  it("reaches the editor with its parts intact", () => {
    expect(structured.map((diagnostic) => diagnostic.ruleId).sort()).toEqual([
      "b-write-bare",
      "block-unknown",
      "dead-set",
      "get-no-prefix",
      "k-arity",
      "ref-unresolved",
      "stack-balance",
    ])
  })

  it("never calls something an error it is not certain of", () => {
    for (const diagnostic of structured)
      if (diagnostic.severity === "error")
        expect(diagnostic.confidence, diagnostic.ruleId).toBe("certain")
  })

  it("keeps the verdict to a row's width", () => {
    // The Issues row is one line and shows the verdict alone.
    for (const diagnostic of structured)
      expect(diagnostic.verdict!.length, diagnostic.ruleId).toBeLessThanOrEqual(
        80
      )
  })

  it("writes plain text where plain text is what renders", () => {
    // A marker and an Issues row render no markdown: a backtick there is a
    // backtick on screen.
    for (const diagnostic of structured)
      for (const part of [
        diagnostic.verdict,
        diagnostic.consequence,
        diagnostic.remedy,
      ])
        expect(part ?? "", diagnostic.ruleId).not.toContain("`")
  })

  it("says on what basis, and why — unless the text is its own reason", () => {
    for (const diagnostic of structured) {
      expect(diagnostic.basis, diagnostic.ruleId).toBeTruthy()
      if (diagnostic.basis !== "grammar")
        expect(diagnostic.why?.length, diagnostic.ruleId).toBeGreaterThan(0)
    }
  })

  it("leaves no rule still writing its message by hand", () => {
    // Every rule is converted; this is what keeps a new one from arriving
    // in the old shape.
    const all = analyzeProfile(PROFILE, CONTEXT)
    expect(all.filter((diagnostic) => !diagnostic.verdict)).toEqual([])
  })
})
