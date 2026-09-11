/**
 * Replay, tested for the two properties stage 4 will depend on.
 *
 * The first is that a capture plays back **in order and complete** — a fixture
 * that drops or reorders events would produce findings that differ from what
 * the session actually contained, which is the one thing a fixture must never
 * do.
 *
 * The second is that timestamps are **not** rewritten. Correlation is defined
 * on the deltas between events, so restamping to wall-clock time would make
 * every run of one capture produce slightly different answers.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import type { CapturedEvent } from "@shared/sim"

import { readCapture, replayState, startReplay, stopReplay } from "./replay"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fsc-replay-"))
})

afterEach(() => {
  stopReplay()
  rmSync(dir, { recursive: true, force: true })
})

const T0 = 1_700_000_000_000

const SESSION: CapturedEvent[] = [
  {
    t: T0,
    via: "client",
    kind: "open",
    protocol: "SunRise",
    app: "SunRise",
    appVersion: "12.2",
    simConnectVersion: "12.2",
  },
  {
    t: T0 + 120,
    via: "client",
    kind: "aircraft",
    key: "pa24-250",
    path: "SimObjects/Airplanes/pa24-250/aircraft.cfg",
  },
  {
    t: T0 + 300,
    via: "client",
    kind: "input-events",
    events: [
      { name: "RADIO1_DME_Switch", hash: "1" },
      { name: "SWITCH_PITOT_HEAT", hash: "2" },
    ],
  },
  // The double-fire, kept verbatim. Replay must not tidy it away either.
  { t: T0 + 5000, via: "client", kind: "input", name: "RADIO1_DME_Switch", hash: "1", value: 1 },
  { t: T0 + 5038, via: "client", kind: "input", name: "RADIO1_DME_Switch", hash: "1", value: 1 },
  { t: T0 + 9000, via: "client", kind: "closed", reason: "sim quit" },
]

function write(events: CapturedEvent[] = SESSION): string {
  const file = join(dir, "session.ndjson")
  writeFileSync(file, `${events.map((e) => JSON.stringify(e)).join("\n")}\n`)
  return file
}

/** Lets the zero-delay timers fire. */
const tick = () => new Promise((done) => setTimeout(done, 5))

describe("startReplay", () => {
  it("delivers every event, in order, with its original timestamp", async () => {
    const seen: CapturedEvent[] = []
    startReplay(write(), 0, (event) => seen.push(event), () => {})
    await tick()

    expect(seen).toEqual(SESSION)
  })

  it("keeps both halves of the double-fire", async () => {
    const seen: CapturedEvent[] = []
    startReplay(write(), 0, (event) => seen.push(event), () => {})
    await tick()

    const fired = seen.filter((event) => event.kind === "input")
    expect(fired).toHaveLength(2)
    expect(fired[1]!.t - fired[0]!.t).toBe(38)
  })

  it("tracks the aircraft and its input events for the chip and the index", async () => {
    startReplay(write(), 0, () => {}, () => {})
    await tick()

    expect(replayState()).toEqual({
      aircraft: "pa24-250",
      count: 2,
      names: ["RADIO1_DME_Switch", "SWITCH_PITOT_HEAT"],
    })
  })

  it("forgets the input events on an aircraft change, as the live client does", async () => {
    // The table belongs to an aircraft. Carrying it across a swap would have
    // the `B:` rules judge the new aeroplane against the old one's controls.
    startReplay(
      write([
        ...SESSION.slice(0, 3),
        {
          t: T0 + 400,
          via: "client",
          kind: "aircraft",
          key: "a220",
          path: "SimObjects/Airplanes/a220/aircraft.cfg",
        },
      ]),
      0,
      () => {},
      () => {}
    )
    await tick()

    expect(replayState()).toEqual({ aircraft: "a220", count: 0, names: [] })
  })

  it("publishes after every event, so the chip is never behind", async () => {
    let published = 0
    startReplay(write(), 0, () => {}, () => published++)
    await tick()

    expect(published).toBe(SESSION.length)
  })

  it("spaces delivery by the original gaps when running at speed", async () => {
    const seen: CapturedEvent[] = []
    // 1000× — the 5 s switch press lands 5 ms in, the 9 s close at 9 ms.
    startReplay(write(), 1000, (event) => seen.push(event), () => {})

    await new Promise((done) => setTimeout(done, 2))
    expect(seen.map((event) => event.kind)).toEqual([
      "open",
      "aircraft",
      "input-events",
    ])

    await new Promise((done) => setTimeout(done, 20))
    expect(seen).toHaveLength(SESSION.length)
  })

  it("reports nothing playing before it starts and after it stops", async () => {
    expect(replayState()).toBeNull()

    startReplay(write(), 0, () => {}, () => {})
    await tick()
    expect(replayState()).not.toBeNull()

    stopReplay()
    expect(replayState()).toBeNull()
  })

  it("cancels pending events when stopped mid-session", async () => {
    const seen: CapturedEvent[] = []
    startReplay(write(), 1000, (event) => seen.push(event), () => {})

    await new Promise((done) => setTimeout(done, 2))
    const delivered = seen.length
    stopReplay()

    await new Promise((done) => setTimeout(done, 20))
    expect(seen).toHaveLength(delivered)
  })

  it("reads a capture written before `source` was renamed to `via`", () => {
    // Both fixtures in the repo and every capture already in a user's app data
    // carry `source`. They are evidence, so they are read forgivingly rather
    // than rewritten — and a capture that replayed with an undefined transport
    // would do so silently.
    const file = join(dir, "old.ndjson")
    writeFileSync(
      file,
      `${JSON.stringify({
        t: T0,
        source: "client",
        kind: "aircraft",
        key: "pa24-250",
        path: "x/Airplanes/pa24-250/y.cfg",
      })}\n`
    )

    const [event] = readCapture(file)
    expect(event?.via).toBe("client")
    expect(event as unknown as { source?: string }).not.toHaveProperty("source")
  })

  it("does nothing with an empty capture rather than throwing", () => {
    const file = join(dir, "empty.ndjson")
    writeFileSync(file, "")

    expect(() => startReplay(file, 0, () => {}, () => {})).not.toThrow()
    expect(replayState()).toBeNull()
  })

  it("replaces a session already playing rather than interleaving two", async () => {
    const seen: CapturedEvent[] = []
    startReplay(write(), 1000, (event) => seen.push(event), () => {})
    startReplay(write(), 0, (event) => seen.push(event), () => {})
    await tick()

    // The first was cancelled before any of its timers could fire.
    expect(seen).toHaveLength(SESSION.length)
  })
})
