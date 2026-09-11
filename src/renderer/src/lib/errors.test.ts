import { describe, expect, it } from "vitest"

import { messageOf } from "./errors"

describe("messageOf", () => {
  it("takes Electron's channel wrapper off a rejected invoke", () => {
    expect(
      messageOf(
        new Error(
          "Error invoking remote method 'files:write': Error: Could not save a320.yaml — the disk is full."
        )
      )
    ).toBe("Could not save a320.yaml — the disk is full.")
  })

  it("leaves a message raised in the renderer alone", () => {
    expect(messageOf(new Error("The host did not answer in time."))).toBe(
      "The host did not answer in time."
    )
  })

  it("keeps a sentence that happens to contain quotes", () => {
    expect(
      messageOf(new Error(`A profile name cannot contain < > : " / \ | ? *`))
    ).toBe(`A profile name cannot contain < > : " / \ | ? *`)
  })

  it("survives a thrown non-error", () => {
    expect(messageOf("plain string")).toBe("plain string")
  })
})
