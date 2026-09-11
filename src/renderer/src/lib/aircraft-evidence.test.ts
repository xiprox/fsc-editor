/**
 * Aircraft evidence reaches only the loaded aircraft's own profile.
 *
 * The reported case: the rules judged every open file against whatever was
 * loaded in the simulator, so a profile for one aircraft lit up with "no input
 * event called …" while another sat on the ramp.
 */

import { afterEach, describe, expect, it } from "vitest"

import type { VarIndex } from "@shared/types"

import { aircraftEvidence } from "./aircraft-evidence"
import { analyzeProfile } from "./profile-diagnostics"
import { setVarIndexStore } from "./var-index-store"
import { setWatchResolution } from "./watch-resolution"

const index = (
  aircraft: string | null,
  inputEvents: string[] | null
): VarIndex => ({ entries: [], scannedFiles: 0, elapsedMs: 0, aircraft, inputEvents })

afterEach(() => {
  setVarIndexStore(null)
  setWatchResolution(null)
})

describe("aircraftEvidence", () => {
  it("gives the loaded aircraft's own profile that aircraft's evidence", () => {
    setVarIndexStore(index("pa24-250", ["PARKBRAKE"]))
    setWatchResolution([{ name: "L:Foo:1", resolved: false }])

    const evidence = aircraftEvidence("pa24-250.yaml")

    expect(evidence.hasInputEvent?.("PARKBRAKE")).toBe(true)
    expect(evidence.hasInputEvent?.("SAFETY_ELT_1")).toBe(false)
    expect(evidence.refResolved?.("L:Foo:1")).toBe(false)
  })

  it("gives another aircraft's profile nothing, so its rules stay silent", () => {
    setVarIndexStore(index("a220", ["AIRLINER_FCU_CHRONO_2"]))
    setWatchResolution([{ name: "L:Foo:1", resolved: false }])

    expect(aircraftEvidence("bksq-aircraft-baronpropress.yaml")).toEqual({})
  })

  it("gives an included module nothing, whatever it is called", () => {
    // Shared by any number of aircraft; the loaded one's answer is not theirs.
    setVarIndexStore(index("pa24-250", ["PARKBRAKE"]))
    expect(aircraftEvidence("modules/pa24-250.yaml")).toEqual({})
  })

  it("gives nothing with no aircraft or no file", () => {
    setVarIndexStore(index(null, null))
    expect(aircraftEvidence("pa24-250.yaml")).toEqual({})

    setVarIndexStore(index("pa24-250", ["PARKBRAKE"]))
    expect(aircraftEvidence(null)).toEqual({})
  })

  it("keeps get-preset-unknown to the aircraft it is about, end to end", () => {
    setVarIndexStore(index("pa24-250", ["PARKBRAKE"]))

    const profile = [
      "# Updated: 2026-08-29",
      "",
      "shared:",
      "  - get: B:NOTHING_LIKE_IT",
      "",
    ].join("\n")
    const rules = (relPath: string): string[] =>
      analyzeProfile(profile, aircraftEvidence(relPath)).map(
        (diagnostic) => diagnostic.ruleId
      )

    expect(rules("pa24-250.yaml")).toContain("get-preset-unknown")
    expect(rules("a220.yaml")).not.toContain("get-preset-unknown")
  })
})
