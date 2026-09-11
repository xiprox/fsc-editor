/**
 * The one thing a run reports that the editor cannot show you.
 *
 * Held and no-effect are deliberately silence — the `get:` line's live value
 * is sitting above the popover saying both — so most of these assert that
 * nothing is said. The case that must never be missed is the revert, because
 * to a person watching that number it looks identical to nothing happening.
 */

import { describe, expect, it } from "vitest"

import type { CapturedEvent } from "@shared/sim"

import { OBSERVE_MS, revertIn, runSetter, type RunDeps } from "./run"

const AT = 1_000_000
const TARGET = "L:Battery1Switch"

/** One `L:` change, as the module reports it. */
function moved(offset: number, value: number, name = TARGET): CapturedEvent {
  return { t: AT + offset, via: "link", kind: "var", name, value }
}

describe("revertIn", () => {
  it("reports where it went, where it came back to, and how long that took", () => {
    // The payoff of the whole feature: this line will desync if it is bound.
    expect(revertIn(TARGET, 0, AT, [moved(46, 1), moved(214, 0)])).toEqual({
      went: 1,
      back: 0,
      afterMs: 214,
    })
  })

  it("times it from when it got back, not from its last word", () => {
    expect(
      revertIn(TARGET, 0, AT, [moved(46, 1), moved(214, 0), moved(870, 0)])
    ).toMatchObject({ afterMs: 214 })
  })

  it("says nothing when the value held", () => {
    // Visible: the live value now reads 1 and stays there.
    expect(revertIn(TARGET, 0, AT, [moved(46, 1)])).toBeNull()
  })

  it("says nothing when nothing moved", () => {
    // Also visible: the live value never changed.
    expect(revertIn(TARGET, 0, AT, [])).toBeNull()
  })

  it("says nothing when the aircraft overrode it with a third value", () => {
    // Written to 5, walked to 3. It did not come back, so it did not revert —
    // and 3 is on screen, which is the honest thing to look at.
    expect(revertIn(TARGET, 0, AT, [moved(40, 5), moved(200, 3)])).toBeNull()
  })

  it("ignores everything that is not the target", () => {
    // A cockpit is never quiet, and ambient traffic in the window is somebody
    // else's business.
    const ambient = [
      moved(12, 3, "L:CabinAltitude"),
      moved(90, 7, "L:FuelFlow"),
    ]

    expect(revertIn(TARGET, 0, AT, ambient)).toBeNull()
  })

  it("does not read a repeat of the same number as a departure", () => {
    expect(revertIn(TARGET, 1, AT, [moved(50, 1), moved(120, 1)])).toBeNull()
  })

  it("ignores jitter in the last bits", () => {
    // The module deadbands at 1e-6 and so does this, so a variable that never
    // really left cannot come back.
    expect(
      revertIn(TARGET, 1, AT, [moved(50, 1 + 1e-9), moved(120, 1)])
    ).toBeNull()
  })

  it("says nothing when nothing had ever reported the variable", () => {
    // No `before` means no "back" to come to. The most that can be said is
    // that something moved, and the live value says that better.
    expect(revertIn(TARGET, null, AT, [moved(46, 1), moved(214, 0)])).toBeNull()
  })

  it("ignores anything stamped before the run", () => {
    // The slice edge is inclusive; a change that happened first cannot have
    // been caused by the write.
    expect(revertIn(TARGET, 0, AT, [moved(-30, 1), moved(-10, 0)])).toBeNull()
  })
})

describe("runSetter", () => {
  function deps(
    overrides: Partial<RunDeps> = {}
  ): RunDeps & { sent: string[] } {
    const sent: string[] = []

    return {
      sent,
      exec: async (code) => {
        sent.push(code)
        return { ok: true }
      },
      readValue: () => 0,
      slice: () => [],
      now: () => AT,
      wait: async () => {},
      ...overrides,
    }
  }

  it("sends the resolved code and reports the quiet case", async () => {
    const fake = deps({ slice: () => [moved(46, 1), moved(214, 0)] })

    const result = await runSetter(
      fake,
      { name: TARGET, units: "Number" },
      { value: 1, current: 0 }
    )

    // The implicit form, because the entry has no `set:` — 60% of the corpus.
    expect(fake.sent).toEqual(["1 (>L:Battery1Switch, Number)"])
    expect(result).toMatchObject({
      ok: true,
      code: "1 (>L:Battery1Switch, Number)",
      revert: { afterMs: 214 },
    })
  })

  it("reports a run with nothing to say as a run with nothing to say", async () => {
    const fake = deps({ slice: () => [moved(46, 1)] })

    const result = await runSetter(
      fake,
      { name: TARGET, units: "Number" },
      { value: 1, current: 0 }
    )

    expect(result).toMatchObject({ ok: true, revert: null })
  })

  it("sends nothing when the setter will not resolve", async () => {
    const fake = deps()

    const result = await runSetter(
      fake,
      { name: "L:Foo", units: "Number", set: "`${boom.boom}`" },
      { value: 1, current: 0 }
    )

    expect(fake.sent).toEqual([])
    expect(result.ok).toBe(false)
  })

  it("reports code the calculator rejected without waiting out the window", async () => {
    let waited = 0
    const fake = deps({
      exec: async () => ({ ok: false }),
      wait: async (ms) => {
        waited += ms
      },
    })

    const result = await runSetter(
      fake,
      { name: TARGET, units: "Number" },
      { value: 1, current: 0 }
    )

    expect(result.ok).toBe(false)
    expect(waited).toBe(0)
  })

  it("reads the value before writing, not from the window", async () => {
    // A variable the aircraft is already driving would otherwise have its own
    // motion read as the effect of the write.
    const asked: string[] = []
    const fake = deps({
      readValue: (name) => {
        asked.push(name)
        return 0
      },
    })

    await runSetter(
      fake,
      { name: TARGET, units: "Number" },
      { value: 4, current: 0 }
    )

    expect(asked).toEqual([TARGET])
  })

  it("watches for exactly the observation window", async () => {
    const windows: [number, number][] = []
    const fake = deps({
      slice: (from, to) => {
        windows.push([from, to])
        return []
      },
    })

    await runSetter(
      fake,
      { name: TARGET, units: "Number" },
      { value: 1, current: 0 }
    )

    expect(windows).toEqual([[AT, AT + OBSERVE_MS]])
  })
})
