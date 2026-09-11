/**
 * The parser, against every shape the corpus and the SDK actually produce.
 *
 * These cases are the reason the file exists: each one is a shape some
 * call-site regex got wrong before the parser replaced it. When a new shape
 * turns up in the wild, it lands here first.
 */

import { describe, expect, it } from "vitest"

import { parseVar, varColumns, varIdentity } from "./parse.ts"

describe("parseVar", () => {
  it("splits an A: name from its instance index", () => {
    expect(parseVar("A:CIRCUIT CONNECTION ON:3")).toEqual({
      ns: "A",
      full: "A:CIRCUIT CONNECTION ON:3",
      name: "CIRCUIT CONNECTION ON",
      index: 3,
    })
  })

  it("keeps index 0, which is a real index", () => {
    const ref = parseVar("A:CAMERA VIEW TYPE AND INDEX:0")
    expect(ref.ns === "A" && ref.index).toBe(0)
  })

  it("does not strip an index from an L: name, where there is no such thing", () => {
    // The FBW A32NX registers `L:A32NX_AUTOTHRUST_TLA:1` and `:2` as two
    // complete names in the sim's table. The old parse folded them into one
    // variable that exists nowhere, and its live value was blank forever.
    expect(parseVar("L:A32NX_AUTOTHRUST_TLA:1")).toEqual({
      ns: "L",
      full: "L:A32NX_AUTOTHRUST_TLA:1",
      name: "A32NX_AUTOTHRUST_TLA:1",
    })
  })

  it("reads L:1: as the per-simobject table under its other spelling", () => {
    expect(parseVar("L:1:MyVar")).toEqual({
      ns: "Z",
      full: "L:1:MyVar",
      name: "MyVar",
      written: "L:1:",
    })
  })

  it("reads Z: as the same table under its own name", () => {
    expect(parseVar("Z:AUDIO_Knob_Selector_1")).toEqual({
      ns: "Z",
      full: "Z:AUDIO_Knob_Selector_1",
      name: "AUDIO_Knob_Selector_1",
      written: "Z:",
    })
  })

  it("keeps L:2: an ordinary L: name — only the literal 1 marks the scope", () => {
    const ref = parseVar("L:2:NotAScope")
    expect(ref.ns).toBe("L")
    expect(ref.name).toBe("2:NotAScope")
  })

  it("splits a K: arity from the event", () => {
    expect(parseVar("K:2:KOHLSMAN_SET")).toEqual({
      ns: "K",
      full: "K:2:KOHLSMAN_SET",
      name: "KOHLSMAN_SET",
      params: 2,
    })
    const plain = parseVar("K:TOGGLE_ICS")
    expect(plain.ns === "K" && plain.params).toBe(1)
  })

  it("recognises a B: operation in any of the cases vendors write", () => {
    for (const [written, op] of [
      ["B:LIGHTING_Taxi_Set", "set"],
      ["B:ENGINE1_Throttle_INC", "inc"],
      ["B:Fuel_Pump_dec", "dec"],
      ["B:PARKBRAKE_Toggle", "toggle"],
      ["B:Strobe_ON", "on"],
      ["B:Strobe_Off", "off"],
    ] as const) {
      const ref = parseVar(written)
      expect(ref.ns === "B" && ref.op).toBe(op)
    }
  })

  it("keeps the B: preset separate from the operation", () => {
    const ref = parseVar("B:LANDING_GEAR_PARKINGBRAKE_Set")
    expect(ref.ns === "B" && ref.preset).toBe("LANDING_GEAR_PARKINGBRAKE")
    expect(ref.ns === "B" && ref.name).toBe("LANDING_GEAR_PARKINGBRAKE_Set")
  })

  it("reads a bare B: preset with no operation", () => {
    const ref = parseVar("B:ENGINE1_Throttle")
    expect(ref.ns === "B" && ref.op).toBe(null)
    expect(ref.ns === "B" && ref.preset).toBe("ENGINE1_Throttle")
  })

  it("splits a component path off an I: or O: name", () => {
    expect(parseVar("O:Path:To:Component@alias:O_VARIABLE")).toEqual({
      ns: "O",
      full: "O:Path:To:Component@alias:O_VARIABLE",
      name: "O_VARIABLE",
      path: "Path:To:Component@alias",
    })
  })

  it("reads a plain I: name, which is all the corpus writes", () => {
    expect(parseVar("I:Map_Light_Drag_Nozzle_Pilot1_Horizontal")).toEqual({
      ns: "I",
      full: "I:Map_Light_Drag_Nozzle_Pilot1_Horizontal",
      name: "Map_Light_Drag_Nozzle_Pilot1_Horizontal",
      path: null,
    })
  })

  it("accepts a lowercase prefix and normalises the namespace", () => {
    const ref = parseVar("l:Battery1Switch")
    expect(ref.ns).toBe("L")
    expect(ref.full).toBe("l:Battery1Switch")
  })

  it("treats an unknown prefix letter as part of the name", () => {
    // To the sim an unrecognised prefix is just a name; so it is here.
    expect(parseVar("Q:NOT A NAMESPACE")).toEqual({
      ns: null,
      full: "Q:NOT A NAMESPACE",
      name: "Q:NOT A NAMESPACE",
    })
  })

  it("treats a bare name as namespace-less", () => {
    expect(parseVar("ELT ACTIVATED").ns).toBe(null)
    expect(parseVar("var_AccessLights_Button").ns).toBe(null)
  })

  it("treats a lone prefix with nothing after it as a bare name", () => {
    expect(parseVar("L:").ns).toBe(null)
  })

  it("does not mistake a trailing word for an index", () => {
    const ref = parseVar("L:FOO:BAR")
    expect(ref.ns).toBe("L")
    expect(ref.name).toBe("FOO:BAR")
  })
})

describe("varIdentity", () => {
  it("strips an A: instance index — two engines, one variable", () => {
    expect(varIdentity(parseVar("A:ADF ACTIVE FREQUENCY:1"))).toBe(
      "A:ADF ACTIVE FREQUENCY"
    )
  })

  it("collapses synonymous spellings", () => {
    expect(varIdentity(parseVar("L:1:MyVar"))).toBe("Z:MyVar")
    expect(varIdentity(parseVar("K:2:KOHLSMAN_SET"))).toBe("K:KOHLSMAN_SET")
  })

  it("keeps a B: operation — folding to the preset is a product decision", () => {
    expect(varIdentity(parseVar("B:PARKBRAKE_Set"))).toBe("B:PARKBRAKE_Set")
  })

  it("keeps an L: name whole, trailing digits and all", () => {
    expect(varIdentity(parseVar("L:A32NX_AUTOTHRUST_TLA:1"))).toBe(
      "L:A32NX_AUTOTHRUST_TLA:1"
    )
  })

  it("keeps the component path inside a scoped identity", () => {
    expect(varIdentity(parseVar("O:Panel@alias:BRIGHTNESS"))).toBe(
      "O:Panel@alias:BRIGHTNESS"
    )
  })

  it("is the bare string for a bare name", () => {
    expect(varIdentity(parseVar("ELT ACTIVATED"))).toBe("ELT ACTIVATED")
  })
})

describe("varColumns", () => {
  it("produces the columns the database caches", () => {
    expect(varColumns("A:CIRCUIT CONNECTION ON:3")).toEqual({
      namespace: "A",
      name: "CIRCUIT CONNECTION ON",
      index: "3",
    })
    expect(varColumns("L:1:MyVar")).toEqual({
      namespace: "Z",
      name: "MyVar",
      index: null,
    })
    expect(varColumns("PLAIN NAME")).toEqual({
      namespace: "",
      name: "PLAIN NAME",
      index: null,
    })
  })

  it("always agrees with varIdentity, which folds on those columns", () => {
    // The database computes identity as `namespace:name`; varIdentity computes
    // it from the parsed reference. If the two ever disagree, an old row and a
    // new one for the same variable stop folding together.
    const shapes = [
      "A:ENG RPM:2",
      "A:PLANE ALTITUDE",
      "L:XMLVAR_Battery",
      "L:A32NX_AUTOTHRUST_TLA:1",
      "L:1:MyVar",
      "Z:AUDIO_Knob_Selector_1",
      "K:TOGGLE_ICS",
      "K:2:KOHLSMAN_SET",
      "B:PARKBRAKE_Set",
      "B:ENGINE1_Throttle",
      "H:AS1000_PFD_SOFTKEYS_1",
      "I:Map_Light",
      "O:Panel@alias:BRIGHTNESS",
      "E:ZULU TIME",
      "ELT ACTIVATED",
      "Q:NOT A NAMESPACE",
    ]

    for (const shape of shapes) {
      const columns = varColumns(shape)
      const folded = columns.namespace
        ? `${columns.namespace}:${columns.name}`
        : columns.name
      expect(folded).toBe(varIdentity(parseVar(shape)))
    }
  })
})
