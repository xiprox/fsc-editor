import { describe, expect, it } from "vitest"

import type { VarEntry } from "@shared/types"

import {
  buildSearchIndex,
  parseQuery,
  searchVars,
  splitPrefix,
} from "./var-search"

function entry(name: string, fileCount = 1): VarEntry {
  return {
    name,
    corpus: {
      count: fileCount,
      sharedCount: fileCount,
      masterCount: 0,
      fileCount,
      files: [],
      samples: [],
      units: ["Number"],
      indices: [],
    },
  }
}

/** A variable nothing local knows about — catalogue or enumeration only. */
function unknown(name: string): VarEntry {
  return { name }
}

function search(names: (string | VarEntry)[], query: string): string[] {
  const entries = names.map((n) => (typeof n === "string" ? entry(n) : n))
  return searchVars(buildSearchIndex(entries), query, 20).map(
    (r) => r.entry.name
  )
}

describe("parseQuery", () => {
  it("reads a namespace prefix as a filter", () => {
    expect(parseQuery("L:batt", ["l"])).toMatchObject({
      namespace: "l",
      terms: ["batt"],
    })
  })

  it("splits on separators and camelCase alike", () => {
    expect(parseQuery("battery_stby-switch State", ["l"]).terms).toEqual([
      "battery",
      "stby",
      "switch",
      "state",
    ])
  })
})

describe("searchVars", () => {
  const corpus = [
    "L:XMLVAR_BATTERYSTBY_SWITCHSTATE",
    "L:BatteryMasterSwitch",
    "A:ELECTRICAL MASTER BATTERY:1",
    "L:AdfOnOffKnob",
    "K:TOGGLE_MASTER_BATTERY",
  ]

  it("matches words in any order", () => {
    expect(search(corpus, "switch battery")).toContain(
      "L:XMLVAR_BATTERYSTBY_SWITCHSTATE"
    )
  })

  it("survives the extra space that breaks literal matching", () => {
    expect(search(corpus, "battery  stby")).toContain(
      "L:XMLVAR_BATTERYSTBY_SWITCHSTATE"
    )
  })

  it("matches a word that is only part of a longer one", () => {
    // Nothing could split BATTERYSTBY into two words, so this has to work by
    // containment rather than by tokenizing more cleverly.
    expect(search(corpus, "stby")).toContain("L:XMLVAR_BATTERYSTBY_SWITCHSTATE")
  })

  it("ignores separators entirely", () => {
    expect(search(corpus, "batterymasterswitch")).toContain(
      "L:BatteryMasterSwitch"
    )
  })

  it("finds a camelCase name from its spaced words", () => {
    expect(search(corpus, "adf knob")).toEqual(["L:AdfOnOffKnob"])
  })

  it("treats a namespace prefix as a filter, not as text", () => {
    const results = search(corpus, "K:battery")
    expect(results).toEqual(["K:TOGGLE_MASTER_BATTERY"])
  })

  it("lists a whole namespace when nothing else is typed", () => {
    expect(search(corpus, "A:")).toEqual(["A:ELECTRICAL MASTER BATTERY:1"])
  })

  it("requires every word to match", () => {
    expect(search(corpus, "battery zebra")).toEqual([])
  })

  it("ranks an exact word match above a partial one", () => {
    const results = search(
      ["L:BATTERYSTBY_STATE", "L:BATTERY", "L:BATTERY_RELAY"],
      "battery"
    )
    expect(results[0]).toBe("L:BATTERY")
  })

  it("breaks ties on how many profiles use it", () => {
    const results = search(
      [entry("L:BATTERY_A", 2), entry("L:BATTERY_B", 40)],
      "battery"
    )
    expect(results[0]).toBe("L:BATTERY_B")
  })

  it("falls back to a subsequence when nothing else matches", () => {
    expect(search(["L:BatteryMasterSwitch"], "bms")).toEqual([
      "L:BatteryMasterSwitch",
    ])
  })

  it("ranks a subsequence below a real word match", () => {
    const results = search(["L:BatteryMasterSwitch", "L:BMS_STATE"], "bms")
    expect(results[0]).toBe("L:BMS_STATE")
  })

  it("returns everything for an empty query", () => {
    expect(search(corpus, "")).toHaveLength(corpus.length)
  })
})

/**
 * Evidence ranking, and the one thing it must not do.
 *
 * The index now carries every name the simulator enumerated and every name the
 * SDK documents, so most of a result list is variables nobody here has ever
 * written. Ordering them by how much is known is what keeps a search useful —
 * and doing it *after* match quality is what keeps it honest.
 */
describe("evidence ranking", () => {
  const moves = (name: string): VarEntry => ({
    ...entry(name),
    aircraft: { key: "pa24-250", changes: 40 },
  })

  const bound = (name: string): VarEntry => ({
    ...entry(name),
    aircraft: { key: "pa24-250", inProfile: true },
  })

  it("puts a variable that moves in this aircraft first", () => {
    const results = search(
      [unknown("L:BATTERY_A"), entry("L:BATTERY_B", 99), moves("L:BATTERY_C")],
      "battery"
    )
    expect(results[0]).toBe("L:BATTERY_C")
  })

  it("ranks this aircraft's own profile above the rest of the corpus", () => {
    const results = search(
      [entry("L:BATTERY_A", 99), bound("L:BATTERY_B")],
      "battery"
    )
    expect(results[0]).toBe("L:BATTERY_B")
  })

  it("ranks anything the corpus knows above a name only the SDK has", () => {
    const results = search(
      [unknown("L:BATTERY_A"), entry("L:BATTERY_B")],
      "battery"
    )
    expect(results[0]).toBe("L:BATTERY_B")
  })

  it("still lets a better name match win", () => {
    // The whole point of applying evidence second. `L:BATTERY` is what was
    // typed; the other one merely moves, and moving is not a reason to answer
    // a different question.
    const results = search(
      [moves("L:BATTERYSTBY_STATE"), unknown("L:BATTERY")],
      "battery"
    )
    expect(results[0]).toBe("L:BATTERY")
  })

  it("keeps a filtered-out entry from eating a slot in the page", () => {
    // The filter runs before the limit, so a narrow filter over a wide corpus
    // returns a full page of matches rather than whatever survived the cap.
    const entries = [
      ...Array.from({ length: 30 }, (_, n) => entry(`L:BATTERY_${n}`)),
      bound("L:BATTERY_MINE"),
    ]

    const results = searchVars(
      buildSearchIndex(entries),
      "battery",
      5,
      (candidate) => Boolean(candidate.aircraft)
    )

    expect(results.map((r) => r.entry.name)).toEqual(["L:BATTERY_MINE"])
  })
})

/**
 * Quotes switch the loose rules off for what is inside them: the characters as
 * typed, anywhere in the name, separators included, case ignored.
 */
describe("quoted terms", () => {
  const names = [
    "L:XMLVAR_NAV_LIGHT_SWITCH",
    "L:NAV_LIGHTS_X",
    "L:NavLightSwitch",
    "A:LIGHT NAV",
    "L:NAV LIGHT",
  ]

  it("matches the characters literally, separators included", () => {
    expect(search(names, '"NAV_LIGHT"').sort()).toEqual([
      "L:NAV_LIGHTS_X",
      "L:XMLVAR_NAV_LIGHT_SWITCH",
    ])
  })

  it("is not the loose match the same words get unquoted", () => {
    expect(search(names, "nav light")).toHaveLength(5)
  })

  it("ignores case", () => {
    expect(search(names, '"navlight"')).toEqual(["L:NavLightSwitch"])
  })

  it("combines with loose words, all of which must match", () => {
    expect(search(names, 'switch "NAV_LIGHT"')).toEqual([
      "L:XMLVAR_NAV_LIGHT_SWITCH",
    ])
  })

  it("counts an unclosed quote as quoted to the end", () => {
    expect(parseQuery('"nav_li', ["l"])).toMatchObject({
      literals: ["nav_li"],
      terms: [],
    })
  })

  it("keeps the namespace prefix, and can quote one too", () => {
    expect(search(names, 'A:"light"')).toEqual(["A:LIGHT NAV"])
    expect(search(names, '"a:light"')).toEqual(["A:LIGHT NAV"])
  })

  it("ranks the name the quote spells whole above ones it only sits in", () => {
    expect(search(names, '"nav light"')[0]).toBe("L:NAV LIGHT")
  })
})

/**
 * The panel shows the prefix as a pill and lights the chip from this, so it
 * has to agree with what the search itself does with the same text.
 */
describe("splitPrefix", () => {
  const KNOWN = ["l", "a", "z"]

  it("is only a prefix for a namespace the index has", () => {
    expect(splitPrefix("W:foo", KNOWN)).toEqual({
      namespace: null,
      rest: "W:foo",
    })
  })

  it("takes a letter and a colon off the front", () => {
    expect(splitPrefix("L:battery", KNOWN)).toEqual({
      namespace: "l",
      rest: "battery",
    })
  })

  it("keeps an empty rest, so a prefix alone is still a prefix", () => {
    expect(splitPrefix("Z:", KNOWN)).toEqual({ namespace: "z", rest: "" })
  })

  it("does not read a quoted prefix as one", () => {
    expect(splitPrefix('"L:NAV"', KNOWN).namespace).toBeNull()
  })

  it("leaves text with no prefix alone", () => {
    expect(splitPrefix("battery switch", KNOWN)).toEqual({
      namespace: null,
      rest: "battery switch",
    })
  })
})
