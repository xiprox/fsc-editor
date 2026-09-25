/**
 * How a variable is called at a position, headless — moved here with the
 * functions from the renderer's set-completions.ts.
 */

import { describe, expect, it } from "vitest"

import type { VarEntry } from "../types.ts"
import { belongsAt, kEventSnippet, parameterLabel, shape } from "./shapes.ts"

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

describe("shape, in write position", () => {
  it("offers the whole calling shape for a two-parameter key event", () => {
    const offered = shape(
      entry("K:KOHLSMAN_SET", {
        parameters: "[0]: Value to set [1]: Altimeter index",
      }),
      "write"
    )!

    // The founding requirement: the `:2` cannot be missed.
    expect(offered.text).toBe("K:2:KOHLSMAN_SET")
    expect(offered.snippet).toBe(
      "${1:Altimeter index} ${2:Value to set} (>K:2:KOHLSMAN_SET"
    )
  })

  it("offers a one-parameter event plainly", () => {
    const offered = shape(
      entry("K:TOGGLE_ICS", { parameters: "[0]: unused" }),
      "write"
    )!
    expect(offered.text).toBe("K:TOGGLE_ICS")
    expect(offered.snippet).toBeUndefined()
  })

  it("offers an undocumented event plainly — absence of evidence", () => {
    expect(shape(entry("K:SOME_VENDOR_EVENT"), "write")!.text).toBe(
      "K:SOME_VENDOR_EVENT"
    )
  })

  it("withholds a non-settable A: variable", () => {
    // Completing it would sell a line that silently does nothing.
    expect(
      shape(entry("A:PLANE ALTITUDE", { settable: false }), "write")
    ).toBeNull()
    expect(
      shape(entry("A:LIGHT LANDING", { settable: true }), "write")
    ).not.toBeNull()
    expect(shape(entry("A:SOME UNDOCUMENTED VAR"), "write")).not.toBeNull()
  })

  it("offers a B: name as written — the aircraft decides what a suffix does", () => {
    expect(shape(entry("B:FCP_HDG_KEY_Push"), "write")!.text).toBe(
      "B:FCP_HDG_KEY_Push"
    )
  })

  it("withholds environment variables except SIMULATION RATE", () => {
    expect(shape(entry("E:ZULU TIME"), "write")).toBeNull()
    expect(shape(entry("E:SIMULATION RATE"), "write")).not.toBeNull()
  })

  it("withholds the namespaces nothing outside the sim may write", () => {
    // The descriptor table's answer, which ns-access gives too. A W: sound
    // event is written — that is how it is fired.
    for (const name of ["M:X", "G:X", "R:X", "X:X", "F:KeyEvent", "C:X"])
      expect(shape(entry(name), "write")).toBeNull()
    expect(shape(entry("W:X"), "write")).not.toBeNull()
  })

  it("takes the corpus's commonest spelling in the position", () => {
    const kohlsman: VarEntry = {
      name: "K:KOHLSMAN_SET",
      corpus: {
        written: [
          { form: "K:2:KOHLSMAN_SET", at: "write", entries: 16 },
          { form: "K:KOHLSMAN_SET", at: "write", entries: 4 },
        ],
        samples: [],
        units: [],
        indices: [],
      },
    }
    expect(shape(kohlsman, "write")!.text).toBe("K:2:KOHLSMAN_SET")
  })
})

describe("shape, on a get: line", () => {
  it("never carries a key event's arity, which would name another event", () => {
    const kohlsman: VarEntry = {
      name: "K:KOHLSMAN_SET",
      corpus: {
        written: [{ form: "K:2:KOHLSMAN_SET", at: "write", entries: 16 }],
        samples: [],
        units: [],
        indices: [],
      },
    }
    expect(shape(kohlsman, "get")).toEqual({ text: "K:KOHLSMAN_SET" })
  })

  it("brings the commonest unit, and none for an event", () => {
    const landing: VarEntry = {
      name: "A:LIGHT LANDING",
      corpus: { samples: [], units: ["Bool"], indices: [] },
    }
    expect(shape(landing, "get")).toEqual({
      text: "A:LIGHT LANDING",
      units: "Bool",
    })
    expect(shape(entry("H:A320_Neo_CDU_1_BTN_1"), "get")).toEqual({
      text: "H:A320_Neo_CDU_1_BTN_1",
    })
  })
})

describe("an instance index", () => {
  it("is a placeholder on a documented, indexed name no profile has used", () => {
    expect(
      shape(entry("A:GENERAL ENG RPM", { index: "Engine index" }), "read")
    ).toEqual({
      text: "A:GENERAL ENG RPM:1",
      template: "A:GENERAL ENG RPM:${1:1}",
    })
  })

  it("is left to the corpus where profiles have spelled the name", () => {
    const beacon: VarEntry = {
      name: "A:LIGHT BEACON",
      sdk: { from: ["docs"], doc: { description: "", index: "Light index" } },
      corpus: { samples: [], units: [], indices: [] },
    }
    expect(shape(beacon, "read")).toEqual({ text: "A:LIGHT BEACON" })
  })
})

describe("belongsAt", () => {
  it("keeps fired events out of read position", () => {
    for (const name of ["K:GEAR_TOGGLE", "H:SOME_EVENT", "W:SOUND"])
      expect(belongsAt(name, "read")).toBe(false)
    expect(belongsAt("A:GEAR HANDLE POSITION", "read")).toBe(true)
  })

  it("never offers a name with no namespace", () => {
    expect(belongsAt("BARE_NAME", "get")).toBe(false)
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
