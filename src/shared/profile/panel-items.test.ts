import { describe, expect, it } from "vitest"

import { scanLines } from "./grammar.ts"
import { includePaths, pickSiteAt, pickedItems } from "./panel-items.ts"

const site = (text: string, line: number) => pickSiteAt(scanLines(text), line)

describe("pickSiteAt", () => {
  it("finds an empty item under pointer:", () => {
    expect(site("pointer:\n  - ", 2)).toMatchObject({
      line: 2,
      taken: [],
      spec: { block: "pointer" },
    })
  })

  it("finds one with no space after the dash yet", () => {
    expect(site("pointer:\n  -", 2)?.spec.block).toBe("pointer")
  })

  it("finds one under ignore:, which takes panels too", () => {
    expect(site("ignore:\n  - ", 2)?.spec.block).toBe("ignore")
  })

  it("leaves an item that already says something alone", () => {
    expect(site("pointer:\n  - DisplayUnits", 2)).toBeNull()
    expect(site("pointer:\n  - D", 2)).toBeNull()
  })

  it("has nothing to offer in a block that takes no panels", () => {
    expect(site("include:\n  - ", 2)).toBeNull()
    expect(site("shared:\n  - ", 2)).toBeNull()
  })

  it("reports what the block already lists, on both sides, comments off", () => {
    const text = [
      "ignore:",
      "  - Barometer",
      "pointer:",
      "  - DisplayUnits # both of them",
      "  - ",
      "  - CTP",
      "master:",
      "  - get: L:A",
    ].join("\n")

    expect(site(text, 5)?.taken).toEqual(["DisplayUnits", "CTP"])
  })
})

describe("pickedItems", () => {
  it("writes one item per panel at the grammar's indent", () => {
    expect(pickedItems(["CTP", "MKP"], [])).toBe("  - CTP\n  - MKP")
  })

  it("drops repeats and what is already listed", () => {
    // Four FCPs share one identifier, and the block may hold it already.
    expect(pickedItems(["FCP", "FCP", "CTP"], ["CTP"])).toBe("  - FCP")
  })

  it("leaves an ordinary key plain, query and all", () => {
    const key =
      "WasmInstrument|wasm_module=Gauge/TDSGTNXi.wasm&wasm_gauge=GTNXI650U2"

    expect(pickedItems([key], [])).toBe(`  - ${key}`)
  })

  it("quotes a key YAML would read as something else, and reads it back", () => {
    const awkward = ["EFB|title=Flight: Plan", "EFB|note=a #1", "-Standby"]

    for (const key of awkward) {
      const written = pickedItems([key], [])
      expect(written).toBe(`  - "${key}"`)

      // What the app writes, the app must recognise as already listed.
      const text = `pointer:\n${written}\n  - `
      expect(site(text, 3)?.taken).toEqual([key])
    }
  })

  it("is empty when nothing new was chosen", () => {
    expect(pickedItems(["CTP"], ["CTP"])).toBe("")
  })
})

describe("includePaths", () => {
  it("reads the include: items and nothing else", () => {
    const text = [
      "include:",
      "  - modules/payload.yaml",
      "  - modules\\fuel.yaml # ADDED BY somebody",
      "  # - modules/FSDT_GSX.yaml",
      "pointer:",
      "  - DisplayUnits",
    ].join("\n")

    expect(includePaths(scanLines(text))).toEqual([
      "modules/payload.yaml",
      "modules/fuel.yaml",
    ])
  })
})
