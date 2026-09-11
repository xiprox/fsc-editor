/**
 * The descriptor table, held to what the app actually does.
 *
 * Seeded in step 2 with what the replaced call sites believed; amended in
 * step 3 when protocol 4 gave `Z:` and `E:` a reader. Every row change is a
 * capability change and shows up here first, deliberately.
 */

import { describe, expect, it } from "vitest"

import { NAMESPACES, readOf, watchUnitsOf } from "./namespaces.ts"
import type { NamespaceId } from "./parse.ts"

describe("readOf", () => {
  it("routes each namespace to the reader that serves it", () => {
    // A: through SimConnect, L: off the module's enumerated stream, and —
    // since protocol 4 — Z: and E: through the module's typed-id watch,
    // whichever spelling the profile used.
    expect(readOf("A:PLANE ALTITUDE")).toBe("definition")
    expect(readOf("L:XMLVAR_Battery")).toBe("stream")
    expect(readOf("Z:AUDIO_Knob_Selector_1")).toBe("watch")
    expect(readOf("L:1:MyVar")).toBe("watch")
    expect(readOf("E:ZULU TIME")).toBe("watch")

    // The written name carries a preset the sim's table does not hold; the
    // route is still the input read, which strips it to find the control.
    expect(readOf("B:PARKBRAKE_Set")).toBe("input")

    for (const name of [
      "K:TOGGLE_ICS",
      "H:AS1000_PFD_SOFTKEYS_1",
      "I:Map_Light",
      "O:Panel@a:BRIGHTNESS",
      "P:ZULU TIME",
      "ELT ACTIVATED",
    ]) {
      expect(readOf(name)).toBe(null)
    }
  })
})

describe("watchUnitsOf", () => {
  it("matches what the store's UI-watch entries asked for", () => {
    expect(watchUnitsOf("A:PLANE ALTITUDE")).toBe("Number")
    expect(watchUnitsOf("L:XMLVAR_Battery")).toBe("")
    expect(watchUnitsOf("Z:AUDIO_Knob_Selector_1")).toBe("")
    expect(watchUnitsOf("ELT ACTIVATED")).toBe("")
  })
})

describe("the table itself", () => {
  it("explains every namespace it cannot read", () => {
    // `why` is UI copy, not documentation: wherever read is null the value
    // cell renders this sentence instead of a blank.
    for (const descriptor of Object.values(NAMESPACES)) {
      if (descriptor.read === null) {
        expect(descriptor.why, `${descriptor.id} needs a why`).toBeTruthy()
      }
    }
  })

  it("keys every row by its own id", () => {
    for (const [key, descriptor] of Object.entries(NAMESPACES)) {
      expect(descriptor.id).toBe(key as NamespaceId)
    }
  })
})
