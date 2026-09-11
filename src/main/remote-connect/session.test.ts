import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * `workspace.ts` reaches for Electron's `app` at import time, and nothing in
 * the session path needs the real one — it only ever asks which folder is
 * current.
 */
let root = ""
vi.mock("../workspace", () => ({ currentWorkspace: () => ({ root }) }))

/**
 * A socket that goes nowhere. The relay is not what these tests are about: what
 * matters is that opening a session, and the frames that follow it, do not
 * throw — and what ends up in the frames that would have been sent.
 */
const sent: string[] = []

class FakeSocket {
  static readonly OPEN = 1
  readyState = FakeSocket.OPEN
  listeners = new Map<string, (event: unknown) => void>()

  addEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners.set(type, handler)
  }

  send(data: string): void {
    sent.push(data)
  }

  close(): void {}

  /** Whatever the relay would have said next. */
  receive(frame: unknown): void {
    this.listeners.get("message")?.({ data: JSON.stringify(frame) })
  }
}

const sockets: FakeSocket[] = []
vi.stubGlobal(
  "WebSocket",
  class {
    constructor() {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as WebSocket
    }
    static readonly OPEN = 1
  }
)

const { disconnect, host, publishPresence, remoteState, setShared } =
  await import("./session")

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fsc-session-"))
  await fs.mkdir(path.join(root, "modules"))
  await fs.writeFile(path.join(root, "a320.yaml"), "one: 1\n")
  await fs.writeFile(path.join(root, "b738.yaml"), "two: 2\n")
  await fs.writeFile(path.join(root, "modules", "fuel.yaml"), "three: 3\n")

  sent.length = 0
  sockets.length = 0
})

afterEach(async () => {
  disconnect()
  await fs.rm(root, { recursive: true, force: true })
})

/** Opens a session and plays the relay's `hosting` reply, as it would arrive. */
async function open(paths: string[]): Promise<FakeSocket> {
  await host(paths)

  const socket = sockets[0]
  socket.receive({ type: "hosting", code: "K7RM2Q", resume: "r" })

  // `receive` is driven by the socket event and not awaited by it, so the
  // manifest it builds settles a microtask later.
  await vi.waitFor(() => expect(sent.length).toBeGreaterThan(0))

  return socket
}

function framesOf(kind: string): Array<Record<string, unknown>> {
  return sent
    .map((raw) => JSON.parse(raw) as { message?: { kind?: string } })
    .filter((frame) => frame.message?.kind === kind)
    .map((frame) => frame.message as Record<string, unknown>)
}

describe("opening a session", () => {
  it("reports the selection back to the renderer", async () => {
    await open(["a320.yaml"])

    expect(remoteState()).toMatchObject({
      phase: "hosting",
      shared: ["a320.yaml"],
    })
  })

  it("publishes a manifest of only the selected profiles", async () => {
    await open(["a320.yaml", "modules/fuel.yaml"])

    const [manifest] = framesOf("manifest")
    const files = manifest.files as Array<{ relPath: string }>

    expect(files.map((file) => file.relPath).sort()).toEqual([
      "a320.yaml",
      "modules/fuel.yaml",
    ])
  })

  it("never names an unshared profile", async () => {
    await open(["a320.yaml"])
    expect(sent.join("")).not.toContain("b738")
  })
})

describe("serving a file", () => {
  it("sends a shared profile the guest asks for", async () => {
    const socket = await open(["a320.yaml"])
    sent.length = 0

    socket.receive({
      type: "from-guest",
      from: "g1",
      message: { kind: "get-file", relPath: "a320.yaml" },
    })

    await vi.waitFor(() => expect(framesOf("file")).toHaveLength(1))
    expect(framesOf("file")[0]).toMatchObject({ content: "one: 1\n" })
  })

  /**
   * The point of the whole exercise: leaving a file out of the manifest only
   * stops a guest that plays by the rules. This is the one that stops the other
   * kind, who can name any path they like.
   */
  it("refuses an unshared profile even though it exists", async () => {
    const socket = await open(["a320.yaml"])
    sent.length = 0

    socket.receive({
      type: "from-guest",
      from: "g1",
      message: { kind: "get-file", relPath: "b738.yaml" },
    })

    await vi.waitFor(() => expect(framesOf("file-error")).toHaveLength(1))
    expect(framesOf("file-error")[0]).toMatchObject({
      relPath: "b738.yaml",
      message: "Not available.",
    })
    expect(framesOf("file")).toHaveLength(0)
  })

  it("refuses it however the path is spelled", async () => {
    const socket = await open(["a320.yaml"])
    sent.length = 0

    for (const relPath of ["B738.yaml", ".\\b738.yaml", "./B738.YAML"])
      socket.receive({
        type: "from-guest",
        from: "g1",
        message: { kind: "get-file", relPath },
      })

    await vi.waitFor(() => expect(framesOf("file-error")).toHaveLength(3))
    expect(framesOf("file")).toHaveLength(0)
  })

  it("serves a shared profile however the path is spelled", async () => {
    const socket = await open(["modules/fuel.yaml"])
    sent.length = 0

    socket.receive({
      type: "from-guest",
      from: "g1",
      message: { kind: "get-file", relPath: "modules\\Fuel.yaml" },
    })

    await vi.waitFor(() => expect(framesOf("file")).toHaveLength(1))
  })
})

describe("presence", () => {
  it("names the host's file when it is shared", async () => {
    await open(["a320.yaml"])
    sent.length = 0

    publishPresence({
      activeFile: "a320.yaml",
      activeLine: 12,
      dirty: ["a320.yaml"],
    })

    expect(framesOf("presence")[0].presence).toEqual({
      activeFile: "a320.yaml",
      activeLine: 12,
      dirty: ["a320.yaml"],
    })
  })

  it("says nothing about an unshared one", async () => {
    await open(["a320.yaml"])
    sent.length = 0

    publishPresence({
      activeFile: "b738.yaml",
      activeLine: 12,
      dirty: ["b738.yaml", "a320.yaml"],
    })

    expect(framesOf("presence")[0].presence).toEqual({
      activeFile: null,
      activeLine: 12,
      dirty: ["a320.yaml"],
    })
  })
})

describe("changing the selection mid-session", () => {
  it("announces what was added and what went away", async () => {
    await open(["a320.yaml"])
    sent.length = 0

    await setShared(["b738.yaml"])

    const [delta] = framesOf("manifest-delta")
    const changed = delta.changed as Array<{ relPath: string }>

    expect(changed.map((entry) => entry.relPath)).toEqual(["b738.yaml"])
    expect(delta.removed).toEqual(["a320.yaml"])
  })

  it("serves what was just added", async () => {
    const socket = await open(["a320.yaml"])
    await setShared(["a320.yaml", "b738.yaml"])
    sent.length = 0

    socket.receive({
      type: "from-guest",
      from: "g1",
      message: { kind: "get-file", relPath: "b738.yaml" },
    })

    await vi.waitFor(() => expect(framesOf("file")).toHaveLength(1))
  })

  it("stops serving what was just removed", async () => {
    const socket = await open(["a320.yaml"])
    await setShared([])
    sent.length = 0

    socket.receive({
      type: "from-guest",
      from: "g1",
      message: { kind: "get-file", relPath: "a320.yaml" },
    })

    await vi.waitFor(() => expect(framesOf("file-error")).toHaveLength(1))
  })

  it("leaves the session open when everything is unticked", async () => {
    await open(["a320.yaml"])
    await setShared([])

    expect(remoteState()).toMatchObject({ phase: "hosting", shared: [] })
  })
})
