import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DEADMAN_MS,
  INJECT_GLOBAL,
  REMOVE_EXPRESSION,
  applyExpression,
  readSignals,
} from "./panel-inject.ts"

/**
 * Just enough of a panel to run the injected source in: one instrument
 * element, a body that remembers its children, and a window that remembers
 * its capture listeners so a test can fire an event at them.
 */
function fakePanel() {
  const listeners = new Map<string, Set<(event: unknown) => void>>()
  const children: unknown[] = []

  const node = () => {
    const self: Record<string, unknown> = {
      style: {},
      children: [] as unknown[],
      parentNode: null,
      setAttribute: () => {},
      appendChild(child: Record<string, unknown>) {
        child.parentNode = self
        ;(self.children as unknown[]).push(child)
      },
      removeChild(child: Record<string, unknown>) {
        child.parentNode = null
        const list = self.children as unknown[]
        list.splice(list.indexOf(child), 1)
      },
    }
    return self
  }

  const body = node()
  body.children = children

  const instrument = {
    tagName: "GTN-750",
    instrumentIdentifier: "GTN750_INT",
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 650, height: 768 }),
  }

  const window: Record<string, unknown> = {
    innerWidth: 650,
    innerHeight: 768,
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: (event: unknown) => void) =>
      listeners.get(type)?.delete(fn),
  }
  const document = {
    title: "VCockpit55 - GTN750_INT",
    body,
    documentElement: body,
    getElementsByTagName: () => [instrument],
    createElement: node,
  }

  const run = (expression: string): unknown =>
    new Function("window", "document", `return (${expression})`)(
      window,
      document
    )

  /** Fires at the capture listeners and says whether it was swallowed. */
  const fire = (type: string, extra: object = {}): boolean => {
    let swallowed = false
    const event = {
      type,
      relatedTarget: null,
      preventDefault: () => {},
      stopImmediatePropagation: () => (swallowed = true),
      ...extra,
    }
    for (const fn of [...(listeners.get(type) ?? [])]) fn(event)
    return swallowed
  }

  return {
    run,
    fire,
    window,
    instrument,
    overlays: () => children.length,
    listening: () => [...listeners.values()].some((set) => set.size > 0),
    /** Asks the way the session does: a `set`, whose answer is the queue. */
    heard: (state: { lit: boolean; inspect: boolean }) =>
      readSignals(String(run(applyExpression("t", state)))),
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe("the injected source", () => {
  it("is ES5 — one modern token fails the parse in Chrome 49", () => {
    const source = applyExpression("t", { lit: true, inspect: true })

    expect(source).not.toMatch(/\?\.|\?\?|=>|\blet\b|\bconst\b|\bclass\b/)
    expect(source).not.toMatch(/\.at\(|replaceAll|fromEntries|allSettled/)
    // A template literal in the injected code would end the one it lives in.
    expect(source).not.toContain("`")
  })

  it("lights a panel, and unlights it leaving nothing behind", () => {
    const panel = fakePanel()

    panel.run(applyExpression("t", { lit: true, inspect: false }))
    expect(panel.overlays()).toBe(1)
    // Lit alone takes no input: there is nothing to swallow.
    expect(panel.fire("mousedown")).toBe(false)

    panel.run(applyExpression("t", { lit: false, inspect: false }))
    expect(panel.overlays()).toBe(0)
    expect(panel.listening()).toBe(false)
    expect(panel.window[INJECT_GLOBAL]).toBeUndefined()
  })

  it("calls the panel what the app calls it, and by its identifier until then", () => {
    const panel = fakePanel()
    const label = (): unknown =>
      panel.run(`document.body.children[0].children[0].textContent`)

    panel.run(applyExpression("t", { lit: true, inspect: false }))
    expect(label()).toBe("GTN750_INT")

    // A key with every character JSON has to escape, to be sure it arrives.
    const key = 'WasmInstrument|wasm_gauge="GTN\\750"'
    panel.run(applyExpression("t", { lit: true, inspect: false, label: key }))
    expect(label()).toBe(key)
  })

  it("does not install in a panel it is only being told to leave", () => {
    const panel = fakePanel()

    expect(
      panel.run(applyExpression("t", { lit: false, inspect: false }))
    ).toBe("absent")
    expect(panel.window[INJECT_GLOBAL]).toBeUndefined()
  })

  it("in inspect mode, lights under the pointer and says so", () => {
    const panel = fakePanel()
    panel.run(applyExpression("t", { lit: false, inspect: true }))
    expect(panel.overlays()).toBe(0)

    panel.fire("mousemove")
    expect(panel.overlays()).toBe(1)

    // The pointer leaves the display: the outline goes with it, at once.
    panel.fire("mouseleave", { target: panel.instrument, relatedTarget: {} })
    expect(panel.overlays()).toBe(0)
    expect(panel.heard({ lit: false, inspect: true })).toEqual([
      "hover",
      "leave",
    ])
    // Collected once: asking again is an empty answer, not the same one.
    expect(panel.heard({ lit: false, inspect: true })).toEqual([])
  })

  it("keeps the outline while the pointer rests, or moves within the display", () => {
    const panel = fakePanel()
    panel.run(applyExpression("t", { lit: false, inspect: true }))
    panel.fire("mousemove")

    // Leaving a softkey for the glass beside it is not leaving the display.
    panel.fire("mouseleave", {
      target: { tagName: "BUTTON" },
      relatedTarget: {},
    })
    panel.fire("mouseout", { target: { tagName: "BUTTON" }, relatedTarget: {} })
    expect(panel.overlays()).toBe(1)

    // Nor is holding still, for a good while. The heartbeat is what keeps the
    // panel alive that long, as the session's would.
    vi.advanceTimersByTime(3000)
    panel.run(applyExpression("t", { lit: false, inspect: true }))
    expect(panel.overlays()).toBe(1)
  })

  it("gives up on a hover nobody ended, eventually", () => {
    const panel = fakePanel()
    panel.run(applyExpression("t", { lit: false, inspect: true }))
    panel.fire("mousemove")

    for (let beat = 0; beat < 5; beat++) {
      vi.advanceTimersByTime(1000)
      panel.run(applyExpression("t", { lit: false, inspect: true }))
    }
    expect(panel.overlays()).toBe(0)
  })

  it("takes the press, reports one pick, and hands input back", () => {
    const panel = fakePanel()
    panel.run(applyExpression("t", { lit: false, inspect: true }))

    expect(panel.fire("mousedown")).toBe(true)
    // The release of that same press must not reach the instrument either.
    expect(panel.fire("mouseup")).toBe(true)
    expect(panel.fire("click")).toBe(true)

    // And then it is the pilot's panel again, before the app has said a word.
    expect(panel.fire("mousedown")).toBe(false)
    expect(panel.fire("mouseup")).toBe(false)
    expect(panel.heard({ lit: true, inspect: false })).toEqual(["pick"])
  })

  it("is not re-armed by the stale 'inspect' that collects the pick", () => {
    const panel = fakePanel()
    panel.run(applyExpression("t", { lit: true, inspect: true }))
    panel.fire("mousedown")
    panel.fire("mouseup")
    panel.fire("click")

    // The session's next beat was sent before it could know about the pick.
    expect(panel.heard({ lit: true, inspect: true })).toEqual(["pick"])
    expect(panel.fire("mousedown")).toBe(false)

    // Once it has said "not inspecting", a new inspect is a real one.
    panel.heard({ lit: true, inspect: false })
    panel.heard({ lit: true, inspect: true })
    expect(panel.fire("mousedown")).toBe(true)
  })

  it("removes itself when nobody renews it", () => {
    const panel = fakePanel()
    panel.run(applyExpression("t", { lit: true, inspect: true }))

    vi.advanceTimersByTime(DEADMAN_MS - 100)
    panel.run(applyExpression("t", { lit: true, inspect: true }))
    vi.advanceTimersByTime(DEADMAN_MS - 100)
    expect(panel.overlays()).toBe(1)

    vi.advanceTimersByTime(200)
    expect(panel.overlays()).toBe(0)
    expect(panel.listening()).toBe(false)
    expect(panel.fire("mousedown")).toBe(false)
    expect(panel.window[INJECT_GLOBAL]).toBeUndefined()
  })

  it("can be removed by hand, by name, from anywhere", () => {
    const panel = fakePanel()
    panel.run(applyExpression("t", { lit: true, inspect: true }))

    expect(panel.run(REMOVE_EXPRESSION)).toBe("removed")
    expect(panel.overlays()).toBe(0)
    expect(panel.fire("mousedown")).toBe(false)
  })

  it("replaces what an earlier session left, rather than stacking on it", () => {
    const panel = fakePanel()
    panel.run(applyExpression("old", { lit: true, inspect: true }))
    panel.run(applyExpression("new", { lit: true, inspect: false }))

    expect(panel.overlays()).toBe(1)
    expect(panel.fire("mousedown")).toBe(false)
  })
})

describe("readSignals", () => {
  it("reads a set's answer, and nothing else as one", () => {
    expect(readSignals('["hover","pick"]')).toEqual(["hover", "pick"])
    expect(readSignals('["explode","leave"]')).toEqual(["leave"])
    // What remove() and an untouched panel answer with.
    expect(readSignals("removed")).toEqual([])
    expect(readSignals("absent")).toEqual([])
    expect(readSignals("[not json")).toEqual([])
  })
})
