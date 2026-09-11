/**
 * The capture format, tested as the fixture format it is about to become.
 *
 * Stage 4's Activity logic will be developed against files written by this
 * code and read by `readCapture`. That makes the round trip — what the client
 * emitted comes back byte-identical in the same order — the property that
 * actually matters here, more than any individual field.
 */

import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { CAPTURE_DIR, type SimEvent } from "@shared/sim"

import { captureFile, captureFiles, record, startCapture, stopCapture } from "./capture"
import { readCapture } from "./replay"
import { folderFromPath } from "./session"

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "fsc-capture-"))
})

afterEach(() => {
  stopCapture()
  rmSync(dir, { recursive: true, force: true })
})

/** Waits for the write stream to flush and the rename to land. */
async function settle(): Promise<void> {
  stopCapture()
  await new Promise((done) => setTimeout(done, 50))
}

function written(): string[] {
  const captures = join(dir, CAPTURE_DIR)
  return existsSync(captures) ? readdirSync(captures) : []
}

const OPEN: SimEvent = {
  kind: "open",
  protocol: "SunRise",
  app: "SunRise",
  appVersion: "12.2",
  simConnectVersion: "12.2",
}

describe("record", () => {
  it("stamps and attributes without disturbing the event", () => {
    const before = Date.now()
    const event = record(OPEN, "client")

    expect(event.via).toBe("client")
    expect(event.t).toBeGreaterThanOrEqual(before)
    expect(event).toMatchObject(OPEN)
  })

  it("works with no capture open, so a failed start cannot break the client", () => {
    expect(() => record(OPEN, "client")).not.toThrow()
    expect(captureFile()).toBeNull()
  })
})

describe("round trip", () => {
  it("reads back exactly what was written, in order", async () => {
    startCapture(dir)

    const events: SimEvent[] = [
      OPEN,
      {
        kind: "aircraft",
        key: "pa24-250",
        path: "SimObjects\\Airplanes\\pa24-250\\presets\\a2a\\pa24-250\\config\\aircraft.CFG",
      },
      {
        kind: "input-events",
        events: [{ name: "SWITCH_PITOT_HEAT", hash: "12345678901234567890" }],
      },
      { kind: "input", name: "SWITCH_PITOT_HEAT", hash: "12345678901234567890", value: 1 },
      { kind: "simvar", name: "CIRCUIT CONNECTION ON:3", units: "Bool", value: 1 },
      { kind: "closed", reason: "sim quit" },
    ]

    const emitted = events.map((event) => record(event, "client"))
    const file = captureFile()!
    await settle()

    const read = readCapture(
      // The file was renamed on close to name its aircraft.
      join(dir, CAPTURE_DIR, written()[0]!)
    )

    expect(file).toBeTruthy()
    expect(read).toEqual(emitted)
  })

  it("keeps a hash that exceeds Number.MAX_SAFE_INTEGER intact", async () => {
    startCapture(dir)

    // The reason InputEventName.hash is a string. As a number this would come
    // back as ...840 and silently fail to match any subscription.
    const hash = "18446744073709551615"
    record({ kind: "input", name: "X", hash, value: 0 }, "client")
    await settle()

    const [event] = readCapture(join(dir, CAPTURE_DIR, written()[0]!))
    expect(event?.kind === "input" && event.hash).toBe(hash)
  })

  it("preserves a string-valued input event", async () => {
    startCapture(dir)
    record({ kind: "input", name: "X", hash: "1", value: "ARMED" }, "client")
    await settle()

    const [event] = readCapture(join(dir, CAPTURE_DIR, written()[0]!))
    expect(event?.kind === "input" && event.value).toBe("ARMED")
  })
})

describe("naming", () => {
  it("renames on close to name the aircraft", async () => {
    startCapture(dir)
    record(OPEN, "client")
    record({ kind: "aircraft", key: "pa24-250", path: "x/Airplanes/pa24-250/y.cfg" }, "client")
    await settle()

    expect(written()[0]).toMatch(/-pa24-250\.ndjson$/)
  })

  it("leaves the timestamp name when no aircraft was ever reported", async () => {
    startCapture(dir)
    record(OPEN, "client")
    await settle()

    expect(written()[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.ndjson$/)
  })
})

describe("readCapture", () => {
  it("tolerates a truncated last line, which a killed app leaves behind", () => {
    const file = join(dir, "partial.ndjson")
    writeFileSync(
      file,
      `${JSON.stringify({ t: 1, via: "client", ...OPEN })}\n{"t":2,"source":"cli`
    )

    const read = readCapture(file)
    expect(read).toHaveLength(1)
    expect(read[0]?.kind).toBe("open")
  })

  it("returns nothing for an empty file rather than throwing", () => {
    const file = join(dir, "empty.ndjson")
    writeFileSync(file, "")
    expect(readCapture(file)).toEqual([])
  })
})

describe("folderFromPath", () => {
  it("takes the folder after Airplanes, whatever the case", () => {
    // Exactly what stage 0 saw the sim return, including the shouting.
    expect(
      folderFromPath(
        "SimObjects\\AIRPLANES\\pa24-250\\presets\\a2a\\pa24-250\\config\\aircraft.CFG"
      )
    ).toBe("pa24-250")
  })

  it("handles forward slashes", () => {
    expect(folderFromPath("SimObjects/Airplanes/FNX_320_CFM/aircraft.cfg")).toBe(
      "FNX_320_CFM"
    )
  })

  it("falls back to the containing directory when there is no Airplanes", () => {
    expect(folderFromPath("some/other/layout/aircraft.cfg")).toBe("layout")
  })

  it("gives up rather than guessing on a bare filename", () => {
    expect(folderFromPath("aircraft.cfg")).toBeNull()
  })
})

describe("readCapture on a real file shape", () => {
  it("parses what print and the sandbox will read", async () => {
    startCapture(dir)
    record(OPEN, "client")
    await settle()

    const raw = readFileSync(join(dir, CAPTURE_DIR, written()[0]!), "utf8")

    // One JSON object per line, newline-terminated — the property the sandbox
    // script, the fixtures and anything reading these with `jq` all rely on.
    expect(raw.endsWith("\n")).toBe(true)
    expect(raw.trim().split("\n")).toHaveLength(1)
  })
})

/**
 * The two ways an always-on recording runs away, and what stops each.
 *
 * These matter more now than when capture was a development aid: it runs in
 * packaged builds because a debug report needs the evidence to already exist
 * when somebody clicks — see docs/debug-report.md — which makes an unbounded
 * NDJSON stream something a user's disk finds out about.
 */
describe("bounds", () => {
  /** Small enough to reach honestly; the shape under test is the same. */
  const TINY = { partBytes: 2_000, dirBytes: 6_000 }

  /** Enough events to pass `partBytes` several times over. */
  function fill(n: number): void {
    for (let i = 0; i < n; i++)
      record({ kind: "var", name: `L:Var${i}`, value: i }, "link")
  }

  it("rolls into a new part rather than growing one file forever", async () => {
    startCapture(dir, { ...TINY, dirBytes: Number.MAX_SAFE_INTEGER })
    record(OPEN, "client")
    fill(200)
    await settle()

    const parts = written()
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.some((name) => name.includes(".p2."))).toBe(true)
  })

  /**
   * The property that makes rolling safe. A part with no `open` in it is a file
   * of values by name with nothing anywhere to say what session produced them —
   * `readCapture` gets a stream it cannot attribute, and replay gets a session
   * that never started.
   */
  it("re-announces into each part, so a part still stands alone", async () => {
    startCapture(dir, { ...TINY, dirBytes: Number.MAX_SAFE_INTEGER })
    record(OPEN, "client")
    record({ kind: "aircraft", key: "pa24-250", path: "x/Airplanes/pa24-250/y.cfg" }, "client")
    fill(200)
    await settle()

    const later = written().filter((name) => name.includes(".p"))
    expect(later.length).toBeGreaterThan(0)

    for (const name of later) {
      const read = readCapture(join(dir, CAPTURE_DIR, name))
      expect(read[0]?.kind).toBe("open")
      expect(read.some((event) => event.kind === "aircraft")).toBe(true)
    }
  })

  /**
   * Re-timed rather than replayed at their original stamps. A reader that sorts
   * on `t` would otherwise interleave a part's header with the part before it,
   * and replay — which plays gaps faithfully — would sit through the whole
   * session before reaching the events the part actually holds.
   */
  it("re-times a part's header to just before the part", async () => {
    startCapture(dir, { ...TINY, dirBytes: Number.MAX_SAFE_INTEGER })
    record(OPEN, "client")
    const first = Date.now()
    fill(200)
    await settle()

    const [second] = written().filter((name) => name.includes(".p2."))
    const read = readCapture(join(dir, CAPTURE_DIR, second!))

    expect(read[0]!.t).toBeLessThan(first)
    expect(read[0]!.t).toBeGreaterThan(first - 5_000)
    // Everything after the header keeps the time it actually happened at.
    expect(read[read.length - 1]!.t).toBeGreaterThanOrEqual(first)
  })

  /**
   * Polled rather than asserted once. Eviction happens when a part's handle
   * actually closes — it has to, because Windows will not delete an open file —
   * so it is one turn of the event loop behind the roll that caused it. This
   * test rolls eight times inside a single synchronous burst, which no real
   * session does; what it is entitled to check is where that settles, not when.
   */
  it("evicts the oldest parts to hold the directory under its cap", async () => {
    startCapture(dir, TINY)
    record(OPEN, "client")
    fill(2_000)
    await settle()

    const total = (): number =>
      written()
        .map((name) => statSync(join(dir, CAPTURE_DIR, name)).size)
        .reduce((sum, bytes) => sum + bytes, 0)

    await expect.poll(total).toBeLessThanOrEqual(TINY.dirBytes)
    expect(written().length).toBeGreaterThan(0)
  })

  it("keeps the newest, which is the session somebody is about to report on", async () => {
    startCapture(dir, TINY)
    record(OPEN, "client")
    fill(2_000)
    const last = captureFile()
    await settle()

    expect(captureFiles(dir).map((file) => file.replace(/-\w[\w-]*\.ndjson$/, ".ndjson")))
      .toContain(last)
  })
})
