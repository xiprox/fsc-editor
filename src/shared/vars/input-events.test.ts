/**
 * The written-name-to-id mapping both the rule and the resolver depend on.
 *
 * Every case here is one the A220's own table produced on 2026-09-03. The
 * shape matters more than usual because two callers act on it in opposite
 * directions — one decides whether to warn that a control is missing, the
 * other decides which control's value to show — and a disagreement between
 * them is a warning that contradicts the number on the same line.
 */

import { describe, expect, it } from "vitest"

import { inputEventIds } from "./input-events.ts"
import { parseVar } from "./parse.ts"

/** As the callers have it: `parseVar`'s name and op-stripped preset. */
function ids(written: string): string[] {
  const ref = parseVar(written)
  if (ref.ns !== "B") throw new Error(`not a B: name: ${written}`)

  return inputEventIds(ref.name, ref.preset)
}

describe("inputEventIds", () => {
  it("offers the written name before anything derived from it", () => {
    // Presence is the strong evidence. A name the table holds verbatim is the
    // answer, and nothing stripped from it should be reached.
    expect(ids("B:AIRLINER_FCU_CHRONO_2_Push")[0]).toBe(
      "AIRLINER_FCU_CHRONO_2_Push"
    )
  })

  it("strips one trailing word, whichever word it is", () => {
    // `_Push` and `_Set` are the same shape. The 2026-08-28 entry established
    // no static rule can tell an operation from part of an id.
    expect(ids("B:AIRLINER_FCU_CHRONO_2_Push")).toContain(
      "AIRLINER_FCU_CHRONO_2"
    )
    expect(ids("B:HANDLING_Flaps_Set")).toContain("HANDLING_Flaps")
    expect(ids("B:SAFETY_ELT_1_ARM")).toContain("SAFETY_ELT_1")
  })

  it("strips only one", () => {
    // Two words off would reach a different control, and the table is a flat
    // list of ids rather than a hierarchy to walk up.
    expect(ids("B:AIRLINER_FCU_CHRONO_2_Push")).not.toContain("AIRLINER_FCU")
  })

  it("keeps both real ids when one is a prefix of the other", () => {
    // The A220 names `AIRLINER_FCU_SPD_PUSH` and `AIRLINER_FCU_SPD_PUSH_PUSH`,
    // both genuine. The longer must not resolve past the shorter.
    const candidates = ids("B:AIRLINER_FCU_SPD_PUSH_PUSH")

    expect(candidates[0]).toBe("AIRLINER_FCU_SPD_PUSH_PUSH")
    expect(candidates).toContain("AIRLINER_FCU_SPD_PUSH")
  })

  it("does not repeat a candidate", () => {
    // `parseVar`'s preset and the blind strip often agree. A duplicate would
    // reach the message text as "nor X or X".
    const candidates = ids("B:AIRLINER_FCU_CHRONO_2_Push")

    expect(new Set(candidates).size).toBe(candidates.length)
  })

  it("returns a bare name with nothing to strip unchanged and alone", () => {
    // A bare id is the canonical `get:` form — 411 of the corpus's 643 `B:`
    // `get:` lines carry no action at all.
    expect(ids("B:PARKBRAKE")).toEqual(["PARKBRAKE"])
  })

  /**
   * A numeric suffix is an index, not a preset.
   *
   * 71 of the corpus's 919 distinct `B:` names end in one, and they come in
   * families: `ELECTRICAL_Alternator_1` beside `_2`, `DEICE_Pitot_1` beside
   * `_2`. Stripping the number resolves every numbered control to its
   * siblings — which cost nothing while this list only suppressed a
   * missing-control warning, and shows the wrong engine's value now that the
   * same list decides what a `get:` line reads.
   */
  it("keeps a numeric suffix, because _1 and _2 are different controls", () => {
    expect(ids("B:ELECTRICAL_Alternator_2")).toEqual([
      "ELECTRICAL_Alternator_2",
    ])
    expect(ids("B:AIRLINER_FCU_CHRONO_2")).toEqual(["AIRLINER_FCU_CHRONO_2"])
  })

  it("still strips a preset from a numbered control", () => {
    // The index belongs to the id; only the preset on top of it comes off.
    expect(ids("B:AIRLINER_CPT_COMM_KP_0_Set")).toEqual([
      "AIRLINER_CPT_COMM_KP_0_Set",
      "AIRLINER_CPT_COMM_KP_0",
    ])
  })

  it("treats a suffix mixing letters and digits as a preset", () => {
    // Only an all-digit suffix is an index. `_P2` is a word.
    expect(ids("B:SOME_CONTROL_P2")).toContain("SOME_CONTROL")
  })

  it("never offers an empty id", () => {
    // A leading underscore would otherwise strip down to "", which matches
    // nothing and would read as a missing control rather than a malformed name.
    expect(inputEventIds("_Push", "_Push")).not.toContain("")
  })
})
