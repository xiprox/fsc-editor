import { describe, expect, it } from "vitest"

import { scanLines } from "../profile/grammar.ts"
import type {
  CorpusFacet,
  ProfileSummary,
  VarEntry,
  VarIndex,
} from "../types.ts"
import {
  complete,
  completionIndex,
  completionSlot,
  detailOf,
  documentFacts,
  type NameSlot,
  type Offer,
} from "./index.ts"

/**
 * A document with its caret marked `|`, and the slot there.
 *
 * Fixtures read as the file the person is looking at: the caret is where they
 * are typing, and everything else is what the file already says.
 */
function at(source: string, relPath: string | null = "pa24-250.yaml") {
  const index = source.indexOf("|")
  const text = source.slice(0, index) + source.slice(index + 1)
  const before = text.slice(0, index).split("\n")
  const lines = scanLines(text)
  const slot = completionSlot(lines, before.length, before.at(-1)!.length)
  return { slot, document: documentFacts(lines, relPath) }
}

function corpus(partial: Partial<CorpusFacet>): CorpusFacet {
  return { samples: [], units: [], indices: [], ...partial }
}

function indexOf(
  entries: VarEntry[],
  extra: { profiles?: ProfileSummary[]; aircraft?: string | null } = {}
) {
  const index: VarIndex = {
    entries,
    scannedFiles: 0,
    elapsedMs: 0,
    aircraft: extra.aircraft ?? null,
    inputEvents: null,
    profiles: extra.profiles ?? [],
  }
  return completionIndex(index)
}

const written = (files: string[], entries = files.length) => ({
  entries,
  files,
})

function labels(offers: Offer[]): string[] {
  return offers.map((offer) => offer.label)
}

describe("where the caret is", () => {
  it("finds a write target, with the (> it reaches back over", () => {
    const { slot } = at("shared:\n  - get: B:SOME_VAR\n    set: 1 (>B:|")
    expect(slot).toMatchObject({
      kind: "name",
      position: "write",
      typed: "B:",
      cover: { text: "(>" },
      closed: false,
    })
  })

  it("finds a read, which the old regex never did", () => {
    const { slot } = at("shared:\n  - get: L:X\n    set: (L:Y|) 1 (>K:Z)")
    expect(slot).toMatchObject({ position: "read", typed: "L:Y" })
  })

  it("replaces a closed reference's whole name, not only what is typed", () => {
    const line = "    set: 1 (>K:LANDING_LIGHTS_SET)"
    const { slot } = at(
      `shared:\n  - get: L:X\n${line.replace("LIGHTS", "LI|GHTS")}`
    )
    const name = slot as NameSlot
    expect(line.slice(name.start, name.end)).toBe("K:LANDING_LIGHTS_SET")
    expect(name.typed).toBe("K:LANDING_LI")
  })

  it("finds a reference inside a JavaScript string", () => {
    const { slot } = at(
      "shared:\n  - get: L:X\n    set: \"value ? '(>K:AP_|' : ''\""
    )
    expect(slot).toMatchObject({ position: "write", typed: "K:AP_" })
  })

  it("does not read a JavaScript parenthesis as a reference", () => {
    const { slot } = at(
      'shared:\n  - get: L:X\n    set: "value ? Math.abs(|value) : 0"'
    )
    expect(slot).toBeNull()
  })

  it("reads a parenthesis as a reference where FS Copilot runs RPN", () => {
    // No quote, backtick, `?` or brace, so FS Copilot runs this as calculator
    // code, where `(` opens a reference whatever follows it.
    const { slot } = at("shared:\n  - get: L:X\n    set: Math.abs(|value)")
    expect(slot).toMatchObject({ position: "read", typed: "" })
  })

  it("replaces a get: line's whole value, since a name brings its unit", () => {
    const line = "  - get: A:OLD, Bool"
    const { slot } = at(`shared:\n${line.replace("OLD", "O|LD")}`)
    const name = slot as NameSlot
    expect(name.position).toBe("get")
    expect(line.slice(name.start, name.end)).toBe("A:OLD, Bool")
  })

  it("finds the unit inside a reference, and the name it is for", () => {
    const line = "    set: (A:FUEL TOTAL QUANTITY, gal) 1 (>K:X)"
    const { slot } = at(`shared:
  - get: L:X
${line.replace("gal)", "ga|l)")}`)
    expect(slot).toMatchObject({
      kind: "units",
      typed: " ga",
      of: "A:FUEL TOTAL QUANTITY",
    })
    expect(line.slice(slot!.start, slot!.end)).toBe(" gal")
  })

  it("finds the unit after a get:'s comma, and the name it is for", () => {
    const { slot } = at("shared:\n  - get: A:FOO:1, Bo|")
    expect(slot).toMatchObject({ kind: "units", typed: " Bo", of: "A:FOO:1" })
  })
})

describe("the write position", () => {
  it("offers the entry's own variable first — the reported case", () => {
    // Three names other profiles write most, and the one the entry reads
    // nowhere in the corpus: that list used to lead with the three.
    const index = indexOf(
      ["B:OTHER_ONE_Set", "B:OTHER_TWO_Toggle", "B:OTHER_THREE_Push"].map(
        (name) => ({
          name,
          corpus: corpus({ write: written(["a.yaml", "b.yaml", "c.yaml"]) }),
        })
      )
    )
    const { slot, document } = at(
      "shared:\n  - get: B:SOME_VAR\n    set: 1 (>B:|"
    )

    const offers = complete(slot!, document, index)
    expect(offers[0]).toMatchObject({
      label: "B:SOME_VAR",
      evidence: { from: "entry" },
    })
    expect(labels(offers).slice(1, 4)).toEqual([
      "B:OTHER_ONE_Set",
      "B:OTHER_THREE_Push",
      "B:OTHER_TWO_Toggle",
    ])
  })

  it("puts what this variable's setters write elsewhere second", () => {
    const index = indexOf([
      {
        name: "A:LIGHT LANDING",
        corpus: corpus({
          setsWrite: [
            {
              form: "K:LANDING_LIGHTS_TOGGLE",
              entries: 3,
              files: ["a.yaml", "b.yaml", "c.yaml"],
            },
          ],
        }),
      },
      {
        name: "K:LANDING_LIGHTS_TOGGLE",
        corpus: corpus({ write: written(["a.yaml", "b.yaml", "c.yaml"]) }),
      },
      {
        name: "K:POPULAR",
        corpus: corpus({
          write: written(["d.yaml", "e.yaml", "f.yaml", "g.yaml"]),
        }),
      },
    ])
    const { slot, document } = at(
      "shared:\n  - get: A:LIGHT LANDING\n    set: (>|"
    )

    const offers = complete(slot!, document, index)
    expect(labels(offers).slice(0, 3)).toEqual([
      "A:LIGHT LANDING",
      "K:LANDING_LIGHTS_TOGGLE",
      "K:POPULAR",
    ])
    expect(detailOf(offers[1]!.evidence)).toBe(
      "written for this variable in 3 profiles"
    )
  })

  it("finds the pairing through an index, which the old lookup could not", () => {
    const index = indexOf([
      {
        name: "A:LIGHT BEACON",
        corpus: corpus({
          setsWrite: [
            {
              form: "K:TOGGLE_BEACON_LIGHTS",
              entries: 2,
              files: ["a.yaml", "b.yaml"],
            },
          ],
        }),
      },
    ])
    const { slot, document } = at(
      "shared:\n  - get: A:LIGHT BEACON:1\n    set: (>K:|"
    )
    expect(labels(complete(slot!, document, index))).toContain(
      "K:TOGGLE_BEACON_LIGHTS"
    )
  })

  it("offers what this file writes elsewhere before the corpus", () => {
    const index = indexOf([
      {
        name: "K:POPULAR",
        corpus: corpus({ write: written(["a.yaml", "b.yaml"]) }),
      },
    ])
    const { slot, document } = at(
      "shared:\n  - get: L:A\n    set: (>K:MINE)\n  - get: L:B\n    set: (>|"
    )
    const offers = complete(slot!, document, index)
    // Another entry's get: counts as this file using the name, as the
    // measurement behind the tier counted it.
    expect(labels(offers).slice(0, 4)).toEqual([
      "L:B",
      "K:MINE",
      "L:A",
      "K:POPULAR",
    ])
  })

  it("does not offer the name being typed as one this file uses", () => {
    const { slot, document } = at("shared:\n  - get: L:A\n    set: (>K:HALF|")
    expect(labels(complete(slot!, document, indexOf([])))).not.toContain(
      "K:HALF"
    )
  })

  it("leaves the open file's saved copy out of the corpus", () => {
    // Only the open file wrote it, and its buffer no longer does.
    const index = indexOf([
      {
        name: "L:A",
        corpus: corpus({
          setsWrite: [
            { form: "K:DELETED", entries: 1, files: ["pa24-250.yaml"] },
          ],
        }),
      },
      {
        name: "K:DELETED",
        corpus: corpus({ write: written(["pa24-250.yaml"]) }),
      },
    ])
    const { slot, document } = at("shared:\n  - get: L:A\n    set: (>|")
    const offers = complete(slot!, document, index)
    const deleted = offers.find((offer) => offer.label === "K:DELETED")
    expect(deleted?.evidence.from).not.toBe("sets-write")
    expect(deleted?.evidence.from).not.toBe("corpus")
  })

  it("offers a two-parameter key event as its calling shape", () => {
    const index = indexOf([
      {
        name: "K:KOHLSMAN_SET",
        sdk: {
          from: ["docs"],
          doc: {
            description: "",
            parameters: "[0]: Value [1]: Altimeter index",
          },
        },
        corpus: corpus({ write: written(["a.yaml"]) }),
      },
    ])
    const { slot, document } = at("shared:\n  - get: L:A\n    set: 1 (>K:KOH|")
    const offer = complete(slot!, document, index).find(
      (o) => o.label === "K:2:KOHLSMAN_SET"
    )
    expect(offer?.snippet).toBe(
      "${1:Altimeter index} ${2:Value} (>K:2:KOHLSMAN_SET"
    )
  })

  it("withholds a documented read-only variable", () => {
    const index = indexOf([
      {
        name: "A:AIRSPEED INDICATED",
        sdk: { from: ["docs"], doc: { description: "", settable: false } },
      },
    ])
    const { slot, document } = at("shared:\n  - get: L:A\n    set: (>A:|")
    expect(labels(complete(slot!, document, index))).not.toContain(
      "A:AIRSPEED INDICATED"
    )
  })
})

describe("aircraft scope", () => {
  const moved: VarEntry = {
    name: "L:A220_THING",
    aircraft: { key: "a220", changes: 40 },
  }

  it("ranks what moved on the aircraft in the sim first, in its own profile", () => {
    const index = indexOf(
      [
        moved,
        {
          name: "L:OTHER",
          corpus: corpus({
            get: { ...written(["x.yaml"]), shared: 1, master: 0 },
          }),
        },
      ],
      {
        aircraft: "a220",
        profiles: [
          { relPath: "a220.yaml", includes: [], gets: [], master: [] },
        ],
      }
    )
    const { slot, document } = at("shared:\n  - get: L:|", "a220.yaml")
    expect(complete(slot!, document, index)[0]?.label).toBe("L:A220_THING")
  })

  it("says nothing about a profile for another aircraft", () => {
    const index = indexOf(
      [
        moved,
        {
          name: "L:OTHER",
          corpus: corpus({
            get: { ...written(["x.yaml"]), shared: 1, master: 0 },
          }),
        },
      ],
      {
        aircraft: "a220",
      }
    )
    const { slot, document } = at("shared:\n  - get: L:|", "pa24-250.yaml")
    expect(complete(slot!, document, index)[0]?.label).toBe("L:OTHER")
  })

  it("applies to a module the aircraft's profile includes", () => {
    const index = indexOf([moved], {
      aircraft: "a220",
      profiles: [
        {
          relPath: "a220.yaml",
          includes: ["modules/lights.yaml"],
          gets: [],
          master: [],
        },
        { relPath: "modules/lights.yaml", includes: [], gets: [], master: [] },
      ],
    })
    const { slot, document } = at(
      "shared:\n  - get: L:|",
      "modules/lights.yaml"
    )
    expect(complete(slot!, document, index)[0]?.evidence).toEqual({
      from: "aircraft",
      how: "moved",
    })
  })
})

describe("the get: position", () => {
  it("never offers a key event with its arity", () => {
    const index = indexOf([
      {
        name: "K:KOHLSMAN_SET",
        corpus: corpus({
          written: [{ form: "K:2:KOHLSMAN_SET", at: "write", entries: 3 }],
          write: written(["a.yaml"]),
        }),
      },
    ])
    const { slot, document } = at("shared:\n  - get: K:KOH|")
    const offer = complete(slot!, document, index).find((o) =>
      o.text.includes("KOHLSMAN")
    )
    expect(offer?.text).toBe("K:KOHLSMAN_SET")
    expect(offer?.units).toBeUndefined()
  })

  it("brings the variable's commonest unit", () => {
    const index = indexOf([
      {
        name: "A:LIGHT LANDING",
        corpus: corpus({
          units: ["Bool", "Number"],
          get: { ...written(["a.yaml"]), shared: 1, master: 0 },
        }),
      },
    ])
    const { slot, document } = at("shared:\n  - get: A:LIG|")
    expect(complete(slot!, document, index)[0]).toMatchObject({
      text: "A:LIGHT LANDING",
      units: "Bool",
    })
  })

  it("never offers back a name only the open file's saved copy has", () => {
    // Saving a half-typed `get: L:UNIQ` puts it in the index on the next
    // rescan. The buffer speaks for the open file, so the copy on disk is no
    // evidence — and the name under the caret must not come back as one.
    const index = indexOf([
      {
        name: "L:UNIQ",
        corpus: corpus({
          get: { ...written(["pa24-250.yaml"]), shared: 1, master: 0 },
        }),
      },
    ])
    const { slot, document } = at("shared:\n  - get: L:UNIQ|")
    expect(labels(complete(slot!, document, index))).not.toContain("L:UNIQ")
  })

  it("offers a name only this unsaved file uses", () => {
    const { slot, document } = at(
      "shared:\n  - get: L:A\n    set: (>L:BRAND_NEW)\n  - get: L:|"
    )
    expect(labels(complete(slot!, document, indexOf([])))).toContain(
      "L:BRAND_NEW"
    )
  })
})

describe("skp:", () => {
  it("offers the entry's own variable first, then this file's by distance", () => {
    // 228 of the corpus's 235 skp: values name their own entry's get:.
    const { slot, document } = at(
      [
        "shared:",
        "  - get: L:FAR",
        "  - get: L:NEAR",
        "  - get: L:MINE",
        "    skp: |",
        "  - get: L:NEXT",
      ].join("\n")
    )
    expect(labels(complete(slot!, document, indexOf([])))).toEqual([
      "L:MINE",
      "L:NEXT",
      "L:NEAR",
      "L:FAR",
    ])
  })

  it("offers nothing in a master: entry, where skp: does nothing", () => {
    const { slot, document } = at(
      "shared:\n  - get: L:A\nmaster:\n  - get: L:B\n    skp: |"
    )
    expect(complete(slot!, document, indexOf([]))).toEqual([])
  })

  it("reaches the files this one includes", () => {
    const index = indexOf([], {
      profiles: [
        {
          relPath: "pa24-250.yaml",
          includes: ["modules/fuel.yaml"],
          gets: ["L:MINE"],
          master: [],
        },
        {
          relPath: "modules/fuel.yaml",
          includes: [],
          gets: ["L:FUEL"],
          master: [],
        },
      ],
    })
    const { slot, document } = at(
      "include:\n  - modules/fuel.yaml\nshared:\n  - get: L:MINE\n    skp: |"
    )
    expect(
      complete(slot!, document, index).map((o) => [
        o.label,
        detailOf(o.evidence),
      ])
    ).toEqual([
      ["L:MINE", "this entry's variable"],
      ["L:FUEL", "used under shared: in modules/fuel.yaml"],
    ])
  })
})

describe("units", () => {
  it("offers nothing for a key event, whose unit FS Copilot ignores", () => {
    const { slot, document } = at("shared:\n  - get: K:FOO, |")
    expect(complete(slot!, document, indexOf([]))).toEqual([])
  })

  it("offers the variable's own units first", () => {
    const index = indexOf([
      {
        name: "A:FOO",
        corpus: corpus({
          units: ["Percent"],
          get: { ...written(["a.yaml"]), shared: 1, master: 0 },
        }),
      },
    ])
    const { slot, document } = at("shared:\n  - get: A:FOO, |")
    expect(complete(slot!, document, index)[0]?.label).toBe("Percent")
  })
})
