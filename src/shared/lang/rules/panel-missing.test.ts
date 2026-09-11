import { describe, expect, it } from "vitest"

import { analyzeProfileView, panelMissing } from "../index.ts"
import type { ProfileView } from "../profile.ts"
import type { CockpitPanelNames, RuleContext } from "../rules.ts"

/** The Black Square Baron, more or less: one unit live, its alternate dark. */
const BARON: CockpitPanelNames = {
  identifiers: [
    "BlackSquareTablet",
    "GTN750_INT",
    "KX155B_1",
    "WasmInstrument",
  ],
  keys: {
    BlackSquareTablet: ["BlackSquareTablet"],
    GTN750_INT: ["GTN750_INT"],
    KX155B_1: ["KX155B_1|Index=1"],
    WasmInstrument: [
      "WasmInstrument|wasm_gauge=GTNXI650U2",
      "WasmInstrument|wasm_gauge=GTNXI750U1",
    ],
  },
}

const cockpit = (panels: CockpitPanelNames | null): RuleContext => ({
  cockpitPanels: () => panels,
})

const view = (pointers: string[], ignores: string[] = []): ProfileView => ({
  entries: [],
  includes: [],
  pointers: pointers.map((text, index) => ({ line: index + 10, text })),
  ignores: ignores.map((text, index) => ({ line: index + 50, text })),
  blocks: [],
  mappings: [],
  updated: { line: 1, text: "2026-09-19" },
})

const run = (profile: ProfileView, context: RuleContext = cockpit(BARON)) =>
  analyzeProfileView([panelMissing], profile, context)

describe("panel-missing", () => {
  it("is silent about what the cockpit has", () => {
    expect(
      run(
        view(
          [
            "BlackSquareTablet",
            "KX155B_1",
            "KX155B_1|Index=1",
            "WasmInstrument|wasm_gauge=GTNXI750U1",
          ],
          ["BlackSquareTablet"]
        )
      )
    ).toEqual([])
  })

  it("does not care whether a panel is interactive — it is never told", () => {
    // The Baron's swapped-out GTN is dark and in the cockpit all the same.
    // The evidence has no interactivity in it to be wrong about, which is the
    // point: `CockpitPanelNames` is names, and this rule sees nothing else.
    expect(run(view(["GTN750_INT"]))).toEqual([])
    expect(Object.keys(BARON)).toEqual(["identifiers", "keys"])
  })

  it("flags a name no panel reports, at info, and offers the near one", () => {
    const [found, ...rest] = run(view(["BlackSquareTablt"]))

    expect(rest).toEqual([])
    expect(found).toMatchObject({
      ruleId: "panel-missing",
      severity: "info",
      line: 10,
      start: 0,
      end: "BlackSquareTablt".length,
      fix: {
        title: "Change to BlackSquareTablet",
        edits: [{ newText: "BlackSquareTablet" }],
      },
    })
    expect(found?.verdict).toContain("in the aircraft in the sim")
  })

  it("matches case the way FS Copilot does, which is exactly", () => {
    const [found] = run(view(["blacksquaretablet"]))

    expect(found?.fix?.title).toBe("Change to BlackSquareTablet")
  })

  it("keeps the query when it fixes the identifier of a full key", () => {
    const [found] = run(view(["KX155B1|Index=1"]))

    expect(found?.fix?.edits[0]?.newText).toBe("KX155B_1|Index=1")
  })

  it("says so without a fix when nothing is near", () => {
    const [found] = run(view(["DisplayUnits"]))

    expect(found?.severity).toBe("info")
    expect(found?.fix).toBeUndefined()
  })

  it("tells a key that matches nothing from a panel that is not there", () => {
    // The A220 case: right display, another livery's key.
    const [found] = run(view(["KX155B_1|Index=2"]))

    expect(found?.message).toContain("KX155B_1|Index=1")
    // The livery is the mechanism, so it is the fact's to explain.
    expect(found?.why).toEqual(["panel-key-query"])
    expect(found?.fix).toMatchObject({
      title: "Change to KX155B_1",
      edits: [{ start: 0, end: "KX155B_1|Index=2".length }],
    })
  })

  it("does not judge a key against panels nobody could read", () => {
    const held: CockpitPanelNames = {
      identifiers: ["DisplayUnits"],
      // Open in another debugger: known by its title, and no more.
      keys: {},
    }

    expect(run(view(["DisplayUnits|config=Default"]), cockpit(held))).toEqual(
      []
    )
  })

  it("reads an ignore: item as an identifier, bar and all", () => {
    // `Coordinator` compares the whole string, so a key there names nothing.
    const [found] = run(view([], ["KX155B_1|Index=1"]))

    expect(found?.line).toBe(50)
    expect(found?.message).toContain("KX155B_1|Index=1")
  })

  it("looks inside the quotes a key can need", () => {
    const [found] = run(view([], ['"BlackSquareTablt"']))

    expect(found).toMatchObject({
      start: 1,
      end: 1 + "BlackSquareTablt".length,
    })
  })

  it("says nothing without a cockpit to compare with", () => {
    const profile = view(["Nonsense"], ["AlsoNonsense"])

    expect(run(profile, {})).toEqual([])
    expect(run(profile, cockpit(null))).toEqual([])
    // Listed nothing yet is not evidence that the aircraft has nothing.
    expect(run(profile, cockpit({ identifiers: [], keys: {} }))).toEqual([])
  })
})
