/**
 * The hover's judgement, headless. Rendering is Monaco's; what the card
 * *says* — natures, arity verdicts, direction warnings — is decided here
 * and pinned by phrase, not by full-text snapshot, so wording can breathe
 * without test surgery.
 */

import { describe, expect, it } from "vitest"

import { parseRef, tokenAt, tokenize } from "@shared/lang"
import type { VarEntry } from "@shared/types"

import { refCard, refHeader, wordCard } from "./hover-card"

function ref(text: string) {
  const [token] = tokenize(text)
  if (!token || token.kind !== "ref") throw new Error(`not a ref: ${text}`)
  return parseRef(token)
}

function kEntry(parameters: string): VarEntry {
  return {
    name: "K:KOHLSMAN_SET",
    sdk: { from: ["docs"], doc: { description: "", parameters } },
  }
}

describe("refHeader", () => {
  it("names the namespace's nature, scope included where it bites", () => {
    expect(refHeader(ref("(L:XMLVAR_Battery)"), { where: "expression" })).toContain(
      "session-global"
    )
    expect(refHeader(ref("(Z:AUDIO_Knob_Selector_1)"), { where: "expression" })).toContain(
      "`Z:` and `L:1:` are the same table"
    )
    expect(refHeader(ref("(>K:#84132)"), { where: "expression" })).toContain(
      "fired by numeric id"
    )
  })

  it("confirms a matching K:2: arity with the reversed-order rule", () => {
    const header = refHeader(ref("(>K:2:KOHLSMAN_SET)"), {
      where: "expression",
      entry: kEntry("[0]: Value to set [1]: Altimeter index"),
    })

    expect(header).toContain("pushed **reversed**")
    expect(header).not.toContain("⚠")
  })

  it("flags a missing arity against the catalogue", () => {
    const header = refHeader(ref("(>K:KOHLSMAN_SET)"), {
      where: "expression",
      entry: kEntry("[0]: Value to set [1]: Altimeter index"),
    })

    expect(header).toContain("⚠")
    expect(header).toContain("missing `K:2:`")
  })

  it("stays silent about arity with no catalogue entry", () => {
    expect(
      refHeader(ref("(>K:KOHLSMAN_SET)"), { where: "expression" })
    ).not.toContain("⚠")
  })

  it("warns about direction: reading what is fired, writing what is read-only", () => {
    expect(refHeader(ref("(K:TOGGLE_ICS)"), { where: "expression" })).toContain(
      "fired, not read"
    )
    expect(refHeader(ref("(>E:ZULU TIME)"), { where: "expression" })).toContain(
      "read-only"
    )
    // Not "cannot be written": the probe found it is per-preset, decided by
    // the code the aircraft attached — see the b-write-needs-action fact.
    expect(refHeader(ref("(>B:PARKBRAKE)"), { where: "expression" })).toContain(
      "up to the aircraft"
    )
  })

  it("explains the B: anatomy both ways", () => {
    const header = refHeader(ref("(B:ENGINE1_Throttle_Set)"), {
      where: "expression",
    })
    expect(header).toContain("operation `_set`")
    expect(header).toContain("value lives on `B:ENGINE1_Throttle`")
  })

  it("reads the dialect: K: in a get: is the sync, not a mistake", () => {
    const header = refHeader(ref("(K:TOGGLE_ICS)"), { where: "get" })
    expect(header).toContain("sync itself")
    expect(header).not.toContain("fired, not read")
  })

  it("explains skp: on the side it actually fires — sending, not applying", () => {
    const header = refHeader(ref("(L:Something)"), { where: "skp" })
    expect(header).toContain("when this entry sends")
    expect(header).toContain("`shared:`")
    // The echo after applying is automatic; saying skp: does it was the
    // error this wording replaces.
    expect(header).not.toMatch(/appl/i)
  })

  it("judges a unit by the namespace's relationship to units", () => {
    expect(
      refHeader(ref("(>K:TOGGLE_ICS, Bool)"), { where: "expression" })
    ).toContain("decides nothing")
    expect(
      refHeader(ref("(A:PLANE ALTITUDE, feet)"), { where: "expression" })
    ).toContain("asked in `feet`")
    expect(refHeader(ref("(L:Foo, Bool)"), { where: "expression" })).toContain(
      "display hint"
    )
  })
})

describe("wordCard", () => {
  it("gives operators their stack arithmetic and registers their verbs", () => {
    const at = (text: string, offset: number) => {
      const hit = tokenAt(text, offset)
      if (!hit || hit.kind !== "word") throw new Error("not a word")
      return wordCard(hit)
    }

    expect(at("1 2 +", 4)).toContain("pops 2, pushes 1")
    expect(at("s0", 0)).toContain("stores the top value in register 0")
    expect(at("sp3", 0)).toContain("pops the top value into register 3")
    expect(at("l12", 0)).toContain("pushes the value of register 12")
  })

  it("says nothing about a word it does not know", () => {
    const hit = tokenAt("mystery-op", 2)
    if (!hit || hit.kind !== "word") throw new Error("not a word")
    expect(wordCard(hit)).toBeNull()
  })
})

/**
 * The card is the thing the hover renders, and its contract is a shape as
 * much as a wording: four parts, and exactly one position-specific fact.
 */
describe("refCard", () => {
  const kohlsman: VarEntry = {
    name: "K:KOHLSMAN_SET",
    sdk: {
      from: ["docs"],
      doc: {
        description: "Sets the altimeter's Kohlsman setting.",
        parameters: "[0]: Value to set [1]: Altimeter index",
      },
    },
  }

  it("lists a key event's operands in the order they are written", () => {
    const card = refCard(ref("(>K:2:KOHLSMAN_SET)"), {
      where: "expression",
      entry: kohlsman,
    })

    expect(card).toContain("Sets the altimeter's Kohlsman setting.")
    expect(card).toContain("· SDK")
    // [1] is written first because [0] is pushed last, nearest the call.
    expect(card.indexOf("[1]")).toBeLessThan(card.indexOf("[0]"))
    expect(card).toContain("pushed last")
  })

  it("prefers a profile's own comment to the catalogue's line", () => {
    const card = refCard(ref("(A:LIGHT LANDING)"), {
      where: "expression",
      entry: {
        name: "A:LIGHT LANDING",
        corpus: {
          doc: "Landing light, both sides.",
          fileCount: 3,
          sharedCount: 3,
          masterCount: 0,
          files: [],
          samples: [],
          units: [],
          count: 3,
          indices: [],
        },
        sdk: {
          from: ["docs"],
          doc: { description: "Light switch state." },
        },
      },
    })

    expect(card).toContain("Landing light, both sides.")
    expect(card).toContain("· from a profile")
    expect(card).not.toContain("Light switch state.")
    expect(card).toContain("Read by 3 profiles")
  })

  it("carries one position fact, and the most serious one", () => {
    // A direction problem outranks the operand list: both apply here, and
    // a card that says everything is the card this one replaced.
    const card = refCard(ref("(K:2:KOHLSMAN_SET)"), {
      where: "expression",
      entry: kohlsman,
    })

    expect(card).toContain("fired, not read")
    expect(card).not.toContain("[1]")
  })

  it("says what skp: does, on the side it does it", () => {
    const card = refCard(ref("(L:Something)"), { where: "skp" })
    expect(card).toContain("when this entry sends")
    expect(card).not.toMatch(/appl/i)
  })

  it("counts writes in write position and reads everywhere else", () => {
    expect(
      refCard(ref("(>K:LANDING_LIGHTS_TOGGLE)"), {
        where: "expression",
        writeCount: 41,
      })
    ).toContain("Written by 41 entries")

    // Nothing to say is said with nothing: no empty footer line.
    expect(refCard(ref("(>L:Foo)"), { where: "expression" })).not.toContain(
      "Written by"
    )
  })
})
