import { describe, expect, it } from "vitest"

import { analyzeEntry, getNoPrefix } from "../index.ts"
import type { EntryView } from "../entry.ts"
import type { RuleContext } from "../rules.ts"

const entry = (get: string): EntryView => {
  const [name, units] = get.split(",").map((part) => part.trim())
  return {
    line: 10,
    get,
    name: name ?? "",
    units: units ?? "Number",
    unitsExplicit: units !== undefined,
    block: "shared",
  }
}

/** The catalogue, as far as this rule asks it anything. */
const catalogue = (known: string[]): RuleContext => ({
  simVarSettable: (name) => (known.includes(name) ? true : null),
})

const run = (get: string, context: RuleContext = catalogue([])) =>
  analyzeEntry([getNoPrefix], entry(get), context)

describe("get-no-prefix", () => {
  it("says nothing about a prefixed name, known letter or not", () => {
    for (const get of [
      "A:LIGHT LANDING, Bool",
      "L:XPDR_CLR",
      "K:PITOT_HEAT_TOGGLE",
      "B:ENGINE1_Throttle",
      // An unknown letter still routes — anything `X:`-shaped reaches the
      // sim module as a client variable, so it is not this rule's business.
      "Q:SOMETHING",
    ])
      expect(run(get), get).toEqual([])
  })

  it("flags a bare name as an error the profile will not report", () => {
    const [found] = run("var_HornTest")
    expect(found?.severity).toBe("error")
    expect(found?.ruleId).toBe("get-no-prefix")
    expect(found?.target).toBe("get")
    expect(found?.message).toContain("do nothing")
  })

  it("marks the name, not the units after it", () => {
    const [found] = run("ELT ACTIVATED, Bool")
    expect(found?.start).toBe(0)
    expect(found?.end).toBe("ELT ACTIVATED".length)
  })

  it("offers the A: prefix only when the catalogue knows the name", () => {
    // Indexed: the catalogue is asked for the base name.
    const known = catalogue(["NAV ACTIVE FREQUENCY"])
    const [documented] = run("NAV ACTIVE FREQUENCY:2", known)
    expect(documented?.fix?.title).toBe("Change to A:NAV ACTIVE FREQUENCY:2")
    expect(documented?.fix?.edits[0]).toEqual({
      start: 0,
      end: 0,
      newText: "A:",
    })

    // `LXPDR_CLR` wants `L:` and a missing character, not a prefix bolted on
    // the front — so nothing is offered and the remedy names the shape.
    const [guessed] = run("LXPDR_CLR", known)
    expect(guessed?.fix).toBeUndefined()
    expect(guessed?.message).toContain("A:, L:, K:, B:, H:")
  })

  it("stays silent without a catalogue rather than guessing", () => {
    const [found] = run("ELT ACTIVATED", {})
    expect(found?.fix).toBeUndefined()
  })
})
