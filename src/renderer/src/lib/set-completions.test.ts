/**
 * The write-position decisions, headless — which is the reason they live
 * apart from the Monaco rendering.
 */

import { describe, expect, it } from "vitest"

import type { VarEntry } from "@shared/types"

import { kEventSnippet, parameterLabel, writeOffer } from "./set-completions"

function entry(
  name: string,
  doc?: Partial<NonNullable<VarEntry["sdk"]>["doc"]>
): VarEntry {
  return {
    name,
    ...(doc
      ? { sdk: { from: ["docs"], doc: { description: "", ...doc } } }
      : {}),
  }
}

describe("writeOffer", () => {
  it("offers the whole calling shape for a two-parameter key event", () => {
    const offer = writeOffer(
      entry("K:KOHLSMAN_SET", {
        parameters: "[0]: Value to set [1]: Altimeter index",
      })
    )!

    // The founding requirement: the `:2` cannot be missed.
    expect(offer.insert).toBe("K:2:KOHLSMAN_SET")
    expect(offer.snippet).toBe(
      "${1:Altimeter index} ${2:Value to set} (>K:2:KOHLSMAN_SET"
    )
    expect(offer.note).toContain("[0] pushed last")
  })

  it("offers a one-parameter event plainly", () => {
    const offer = writeOffer(
      entry("K:TOGGLE_ICS", { parameters: "[0]: unused" })
    )!
    expect(offer.insert).toBe("K:TOGGLE_ICS")
    expect(offer.snippet).toBeUndefined()
  })

  it("offers an undocumented event plainly — absence of evidence", () => {
    expect(writeOffer(entry("K:SOME_VENDOR_EVENT"))!.insert).toBe(
      "K:SOME_VENDOR_EVENT"
    )
  })

  it("withholds a non-settable A: variable", () => {
    // Completing it would sell a line that silently does nothing.
    expect(
      writeOffer(entry("A:PLANE ALTITUDE", { settable: false }))
    ).toBeNull()
    expect(
      writeOffer(entry("A:LIGHT LANDING", { settable: true }))
    ).not.toBeNull()
    expect(writeOffer(entry("A:SOME UNDOCUMENTED VAR"))).not.toBeNull()
  })

  it("turns a bare B: preset into its _Set operation when the aircraft has one", () => {
    const knows = (name: string) => name === "B:ENGINE1_Throttle_Set"

    const offer = writeOffer(entry("B:ENGINE1_Throttle"), knows)!
    expect(offer.insert).toBe("B:ENGINE1_Throttle_Set")

    // Already an operation: offered as written.
    expect(writeOffer(entry("B:PARKBRAKE_Toggle"), knows)!.insert).toBe(
      "B:PARKBRAKE_Toggle"
    )
  })

  it("leaves a B: preset bare when no _Set was enumerated", () => {
    // Appending blind completed a name the sim does not answer to — the
    // Aerosoft CRJ's action presets are written bare and work.
    const offer = writeOffer(entry("B:FCP_HDG_KEY_Push"), () => false)!
    expect(offer.insert).toBe("B:FCP_HDG_KEY_Push")
    expect(offer.note).toContain("bare write")

    // No index to ask: the name as written, never a guess.
    expect(writeOffer(entry("B:FCP_HDG_KEY_Push"))!.insert).toBe(
      "B:FCP_HDG_KEY_Push"
    )
  })

  it("withholds environment variables except SIMULATION RATE", () => {
    expect(writeOffer(entry("E:ZULU TIME"))).toBeNull()
    expect(writeOffer(entry("E:SIMULATION RATE"))).not.toBeNull()
  })

  it("withholds the namespaces with no write position", () => {
    for (const name of ["M:X", "G:X", "W:X", "R:X", "X:X", "F:KeyEvent"]) {
      expect(writeOffer(entry(name))).toBeNull()
    }
  })
})

describe("parameterLabel", () => {
  it("extracts and trims the documented clause", () => {
    const parameters =
      "[0]: Integer mach value / 100 (eg: 100 as value results as mach 1) [1]: Index of the engine to target (1 - 4)"

    expect(parameterLabel(parameters, 1)).toBe("Index of the engine to target")
    expect(parameterLabel(parameters, 0)).toBe("Integer mach value / 100")
  })

  it("falls back to a slot name when the docs are shapeless", () => {
    expect(parameterLabel("takes things", 0)).toBe("p0")
  })
})

describe("kEventSnippet", () => {
  it("orders operands reversed, [0] tabbed last", () => {
    expect(
      kEventSnippet("FUELSYSTEM_PUMP_SET", "[0]: Pump Index [1]: Status")
    ).toBe("${1:Status} ${2:Pump Index} (>K:2:FUELSYSTEM_PUMP_SET")
  })

  it("escapes snippet metacharacters in labels", () => {
    expect(kEventSnippet("E", "[0]: costs $5 [1]: b")).toContain("\\$5")
  })
})
