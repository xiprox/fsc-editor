import { describe, expect, it } from "vitest"

import { whyCard } from "./why-card"

describe("whyCard", () => {
  it("has nothing to say for a diagnostic that cites nothing", () => {
    expect(whyCard({})).toBeNull()
    expect(whyCard({ why: [] })).toBeNull()
  })

  it("leads with the verdict's own basis", () => {
    const card = whyCard({ why: ["master-fallback"], basis: "source" })
    expect(card?.split("\n")[0]).toBe("**Why** — _Based on FSC source code_")
  })

  it("names a fact's basis only where it differs from the verdict's", () => {
    const same = whyCard({ why: ["master-fallback"], basis: "source" })
    expect(same?.match(/Based on FSC source code/g)).toHaveLength(1)

    const differs = whyCard({ why: ["k-bare-pops-one"], basis: "sdk-docs" })
    expect(differs).toContain("_Based on the MSFS SDK docs_")
    expect(differs).toContain("_Based on sim testing_")
  })
})
