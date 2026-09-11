import { describe, expect, it } from "vitest"

import { FACTS, factOf, type FactId } from "./facts.ts"
import { diagnose } from "./rules.ts"

const ids = Object.keys(FACTS) as FactId[]

describe("the facts table", () => {
  it("gives every source-backed fact something to be checked against", () => {
    // `npm run check:claims` greps these in an FS Copilot checkout. A source
    // fact without one is a claim nothing will ever notice going stale.
    for (const id of ids) {
      const fact = factOf(id)
      if (fact.basis !== "source") continue
      expect(fact.anchors?.length, id).toBeGreaterThan(0)
    }
  })

  it("says where every other fact was established", () => {
    for (const id of ids) {
      const fact = factOf(id)
      if (fact.basis === "source" || fact.basis === "grammar") continue
      expect(fact.record, id).toBeTruthy()
    }
  })

  it("keeps an anchor to one line, which is all a grep can find", () => {
    for (const id of ids)
      for (const { anchor } of factOf(id).anchors ?? [])
        expect(anchor, id).not.toContain("\n")
  })

  it("states mechanisms, and leaves advice to the diagnostic", () => {
    // A fact is cited from lines it has never seen, so it cannot know what
    // the reader should do about theirs.
    for (const id of ids)
      expect(factOf(id).statement, id).not.toMatch(
        /\b(you should|try|consider)\b/i
      )
  })
})

describe("diagnose", () => {
  const base = {
    ruleId: "x",
    severity: "warning" as const,
    confidence: "certain" as const,
    start: 0,
    end: 1,
  }

  it("composes the plain message in reading order", () => {
    const diagnostic = diagnose({
      ...base,
      verdict: "This setter never runs.",
      consequence: "The value will go elsewhere.",
      remedy: "Wrap it.",
    })

    expect(diagnostic.message).toBe(
      "This setter never runs. The value will go elsewhere. Wrap it."
    )
  })

  it("leaves out the parts a finding does not have", () => {
    expect(diagnose({ ...base, verdict: "Only this." }).message).toBe(
      "Only this."
    )
  })
})
