/**
 * The SimConnect client's lifecycle, driven through a fake connection.
 *
 * `node-simconnect` is replaced by a handle that records what was asked of it
 * and lets a test fire the callbacks MSFS would. Everything that writes — the
 * capture, the database, Activity — is stubbed; what is under test is which
 * state the session is in, and what it ends when the connection does. The
 * Link protocol is the real one, because "the module's verdicts end with the
 * connection" is a claim about both files at once.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  LINK_REQUEST,
  linkState,
  onWatchResolution,
  watchResolution,
} from "./link"

/**
 * The fake handle, and the knobs the stubbed modules read, hoisted so the
 * module mocks can reach them.
 *
 * A listener map rather than an EventEmitter: `vi.mock` factories run before
 * imports, and the session only ever calls `on` and a set of fire-and-forget
 * requests.
 */
const sim = vi.hoisted(() => {
  class FakeHandle {
    listeners = new Map<string, ((payload?: unknown) => void)[]>()
    /** Every enumeration request id, in order — the last is the live one. */
    enumerations: number[] = []
    /** The `A:` data definition as SimConnect holds it, by datum id. */
    defined: string[] = []
    cleared = 0
    requested = 0

    on(name: string, listener: (payload?: unknown) => void): void {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
    }

    fire(name: string, payload?: unknown): void {
      for (const listener of this.listeners.get(name) ?? []) listener(payload)
    }

    enumerateInputEvents(requestId: number): void {
      this.enumerations.push(requestId)
    }

    addToDataDefinition(_definition: number, name: string): void {
      this.defined.push(name)
    }

    clearDataDefinition(): void {
      this.cleared++
      this.defined = []
    }

    requestDataOnSimObject(): void {
      this.requested++
    }

    subscribeToSystemEvent(): void {}
    requestSystemState(): void {}
    subscribeInputEvent(): void {}
    unsubscribeInputEvent(): void {}
    getInputEvent(): void {}
    mapClientDataNameToID(): void {}
    addToClientDataDefinition(): void {}
    requestClientData(): void {}
    setClientData(): void {}
    close(): void {}
  }

  return {
    FakeHandle,
    handle: null as InstanceType<typeof FakeHandle> | null,
    /** What `replayState` answers; null is "not replaying". */
    replay: null as {
      aircraft: string | null
      count: number
      names: string[]
    } | null,
    evidence: { flushed: 0, reset: 0 },
  }
})

type Handle = InstanceType<typeof sim.FakeHandle>

vi.mock("node-simconnect", () => ({
  Protocol: { SunRise: 1, KittyHawk: 2 },
  ClientDataPeriod: { ON_SET: 2 },
  SimConnectDataType: { FLOAT64: 4 },
  SimConnectConstants: { OBJECT_ID_USER: 0 },
  SimConnectPeriod: { SIM_FRAME: 3 },
  DataRequestFlag: { DATA_REQUEST_FLAG_TAGGED: 2 },
  open: async () => {
    sim.handle = new sim.FakeHandle()
    return {
      handle: sim.handle,
      recvOpen: {
        applicationName: "MSFS",
        applicationVersionMajor: 12,
        applicationVersionMinor: 1,
        simConnectVersionMajor: 12,
        simConnectVersionMinor: 1,
      },
    }
  },
}))

vi.mock("./capture", () => ({
  captureFile: () => null,
  record: (event: object, via: string) => ({ ...event, via, t: Date.now() }),
  startCapture: () => {},
  stopCapture: () => {},
}))
vi.mock("./install", () => ({
  linkInstalled: () => false,
  refreshLinkInstalled: () => Promise.resolve(false),
}))
vi.mock("./store", () => ({
  flushSimEvidence: () => {
    sim.evidence.flushed++
  },
  observe: () => {},
  resetSimEvidence: () => {
    sim.evidence.reset++
  },
  startWatching: () => {},
}))
vi.mock("./replay", () => ({
  replayState: () => sim.replay,
  startReplay: () => {},
  stopReplay: () => {},
}))
vi.mock("../activity-buffer", () => ({
  observeActivity: () => {},
  resetActivity: () => {},
  slice: () => [],
}))
vi.mock("../activity-history", () => ({ resetActivityHistory: () => {} }))
vi.mock("../marks", () => ({ markAt: () => {} }))

const {
  inputEventNames,
  onSimSession,
  onSimState,
  simState,
  startSim,
  stopSim,
  watchSimVars,
} = await import("./session")

/** Starts the client and waits for the fake sim to answer. */
async function connect(): Promise<Handle> {
  sim.handle = null
  startSim("")
  await vi.waitFor(() => expect(simState().phase).toBe("live"))
  return sim.handle!
}

/** The sim reporting an aircraft load. */
function loadAircraft(handle: Handle, folder: string): void {
  handle.fire("eventFilename", {
    clientEventId: 1,
    fileName: `SimObjects\\Airplanes\\${folder}\\aircraft.cfg`,
  })
}

/** The enumeration for the current aircraft, delivered in one chunk. */
function enumerate(handle: Handle, names: string[]): void {
  handle.fire("inputEventsList", {
    requestID: handle.enumerations.at(-1),
    inputEventDescriptors: names.map((name, index) => ({
      name,
      inputEventIdHash: BigInt(index + 1),
    })),
    entryNumber: 0,
    arraySize: names.length,
    outOf: names.length,
  })
}

/** One message from the Link module's output area. */
function link(handle: Handle, message: string): void {
  handle.fire("clientData", {
    requestID: LINK_REQUEST.OUT,
    data: { readBytes: () => Buffer.from(message) },
  })
}

beforeEach(() => {
  sim.evidence = { flushed: 0, reset: 0 }
})

afterEach(() => {
  sim.replay = null
  stopSim()
  watchSimVars([])
})

describe("inputEventNames", () => {
  it("is null with no connection", () => {
    expect(inputEventNames()).toBeNull()
  })

  it("is null while connected with nothing enumerated", async () => {
    // The main menu: SimConnect answers before any aircraft exists. An empty
    // list here read downstream as "this aircraft has none" and flagged every
    // `B:` line in every open file.
    await connect()
    expect(inputEventNames()).toBeNull()
  })

  it("is null after an aircraft loads, until its list lands", async () => {
    const handle = await connect()

    loadAircraft(handle, "pa24-250")
    expect(inputEventNames()).toBeNull()

    enumerate(handle, ["PARKBRAKE", "CLICKSPOT_DOOR"])
    expect(inputEventNames()).toEqual(["PARKBRAKE", "CLICKSPOT_DOOR"])
  })

  it("goes null across a swap, not stale and not empty", async () => {
    const handle = await connect()
    loadAircraft(handle, "pa24-250")
    enumerate(handle, ["PARKBRAKE"])

    loadAircraft(handle, "a220")
    expect(inputEventNames()).toBeNull()

    enumerate(handle, ["AIRLINER_FCU_CHRONO_2"])
    expect(inputEventNames()).toEqual(["AIRLINER_FCU_CHRONO_2"])
  })

  it("is null once the connection drops", async () => {
    const handle = await connect()
    loadAircraft(handle, "pa24-250")
    enumerate(handle, ["PARKBRAKE"])

    handle.fire("close")

    expect(simState().phase).toBe("offline")
    expect(inputEventNames()).toBeNull()
  })

  it("answers from the capture while one is replaying", () => {
    sim.replay = { aircraft: "pa24-250", count: 1, names: ["PARKBRAKE"] }
    expect(inputEventNames()).toEqual(["PARKBRAKE"])

    // The capture's aircraft line has played and its list has not yet.
    sim.replay = { aircraft: "pa24-250", count: 0, names: [] }
    expect(inputEventNames()).toBeNull()
  })
})

describe("onSimSession", () => {
  it("fires for every change the variable index is built from", async () => {
    let fired = 0
    const stop = onSimSession(() => fired++)

    const handle = await connect()
    // Connecting alone changes nothing the index reads: no aircraft, no list.
    expect(fired).toBe(0)

    loadAircraft(handle, "pa24-250")
    expect(fired).toBe(1)

    enumerate(handle, ["PARKBRAKE"])
    expect(fired).toBe(2)

    handle.fire("close")
    expect(fired).toBe(3)

    stop()
  })
})

describe("a dropped connection", () => {
  it("ends the Link module's verdicts with it", async () => {
    const handle = await connect()
    link(handle, "hello 1 0\n0.1.0 6 2\n")
    link(handle, "watched 2 0\n1000000 0 Z:Foo\n")
    expect(watchResolution()).toEqual([{ name: "Z:Foo", resolved: false }])

    let woken = 0
    const stop = onWatchResolution(() => woken++)
    handle.fire("close")

    // Reset by this connection's end, not by the next one's start — the
    // renderer's rules read these while nothing is connected.
    expect(linkState().present).toBe(false)
    expect(watchResolution()).toBeNull()
    // Woken, so `ipc.ts` pushes the null and the warnings go quiet.
    expect(woken).toBe(1)

    stop()
  })

  it("writes its evidence and stops the observation clock", async () => {
    const handle = await connect()
    handle.fire("close")

    expect(sim.evidence).toEqual({ flushed: 1, reset: 1 })
  })
})

describe("the A: watch set", () => {
  it("is defined on connect when it arrived first", async () => {
    // The order the app hits: tabs are restored at launch, before MSFS answers.
    watchSimVars([
      { name: "A:BATTERY VOLTAGE", units: "Volts" },
      { name: "L:Beacon", units: "Number" },
    ])

    const handle = await connect()

    expect(handle.defined).toEqual(["BATTERY VOLTAGE"])
    expect(handle.requested).toBe(1)
    // Nothing to clear on a fresh connection, and SimConnect objects to trying.
    expect(handle.cleared).toBe(0)
  })

  it("is defined again on the next connection", async () => {
    watchSimVars([{ name: "A:BATTERY VOLTAGE", units: "Volts" }])
    const first = await connect()
    first.fire("close")
    // The retry loop would reconnect by itself in five seconds.
    stopSim()

    const second = await connect()
    expect(second.defined).toEqual(["BATTERY VOLTAGE"])
  })

  it("replaces the definition when the set changes while connected", async () => {
    const handle = await connect()

    watchSimVars([{ name: "A:BATTERY VOLTAGE", units: "Volts" }])
    watchSimVars([{ name: "A:GENERAL ENG RPM:1", units: "RPM" }])

    expect(handle.cleared).toBe(1)
    expect(handle.defined).toEqual(["GENERAL ENG RPM:1"])
  })
})

describe("onSimState", () => {
  it("sends a state only when it changed", async () => {
    const states: string[] = []
    const stop = onSimState((state) => states.push(JSON.stringify(state)))

    const handle = await connect()
    link(handle, "hello 1 0\n0.1.0 6 2\n")
    const settled = states.length

    // The module's steady stream. Every message used to publish, and every
    // publish was a Log row and an IPC push of the same summary.
    link(handle, "values 3 0\n0 1\n")
    link(handle, "values 4 0\n0 2\n")

    expect(states.length).toBe(settled)
    expect(new Set(states).size).toBe(states.length)

    stop()
  })
})
