/**
 * The SimConnect client, and the only place in the app that talks to MSFS.
 *
 * It lives in main for the same reason the relay socket does: the packaged
 * app's CSP puts the renderer out of reach of anything on the network, and this
 * is a TCP socket to a local port discovered from the registry.
 *
 * What it does *not* do is interpret anything. It turns SimConnect callbacks
 * into `SimEvent`s, hands them to the capture, and publishes a summary for the
 * chip. Anchors, findings, ranking and dedup are stage 4's, computed over the
 * captured stream — see the note in @shared/sim about why the raw record stays
 * raw.
 *
 * This replaces `scripts/spike-simconnect.ts`, the stage 0 throwaway, which was
 * the working reference for every call made here and is deleted now that the
 * calls live somewhere permanent. It is in the history if it is ever wanted.
 */

import fs from "node:fs"
import path from "node:path"

import type { SimConnectConnection } from "node-simconnect"

import {
  SIM_RETRY_MS,
  type CapturedEvent,
  type SimEvent,
  type SimProtocol,
  type SimState,
  type SimValue,
  type SimVarWatch,
  type SimVia,
} from "@shared/sim"

import { captureFile, record, startCapture, stopCapture } from "./capture"
import { LINK_AREA_BYTES as LINK_AREA_SIZE, packWatchAdds } from "@shared/link"
import { inputEventIds, parseVar, readOf } from "@shared/vars"

/**
 * The watch-reader half of the current watch set, remembered across link
 * connections. `watchSimVars` keeps it current; `attachLink` replays it.
 */
let moduleWatch: string[] = []

/**
 * The `B:` half of the current watch set, remembered for the same reason.
 *
 * Editors are open before an aeroplane is loaded, and input events belong to
 * an aircraft — so the names to read are usually known before there is
 * anything to read them from. `enumerated()` replays this once the table
 * arrives, exactly as `attachLink` replays `moduleWatch`.
 */
let inputWatch: string[] = []

/**
 * The `A:` half of the current watch set, remembered for the same reason and
 * defined by `ready()`.
 *
 * It was the one half that was not. A SimConnect data definition belongs to a
 * connection, so a watch set that arrived while MSFS was closed — the usual
 * order, since tabs are restored at launch — stopped at the connection check
 * and was never defined. The renderer does not re-send an unchanged set, so
 * `A:` hints stayed blank until somebody edited a `get:` line, and again after
 * every reconnect.
 */
let definitionWatch: SimVarWatch[] = []

/**
 * Hands the module its watch set: a reset, then the names in as many
 * `watch-add` chunks as they need — one, in any realistic set. The module
 * answers each command with its complete handle mapping, so the app's copy is
 * replaced rather than reconciled.
 */
function sendModuleWatch(channel: LinkChannel, names: string[]): void {
  sendLinkCommand(channel, { name: "watch-reset" })
  for (const command of packWatchAdds(names)) sendLinkCommand(channel, command)
}
import {
  LINK_REQUEST,
  linkState,
  receiveLink,
  resetLink,
  sendLinkCommand,
  subscribeLink,
  type LinkChannel,
} from "./link"
import { observeActivity, resetActivity, slice } from "../activity-buffer"
import { resetActivityHistory } from "../activity-history"
import { markAt } from "../marks"
import { linkInstalled, refreshLinkInstalled } from "./install"
import {
  recordValue,
  resetValues,
  setWatch,
  takeDirty,
  valueFor,
  watchedValues,
} from "./live-values"
import type { RunDeps } from "./run"
import {
  flushSimEvidence,
  observe,
  resetSimEvidence,
  startWatching,
} from "./store"
import { replayState, startReplay, stopReplay } from "./replay"
import { readTaggedValues } from "./tagged"

/**
 * Points the client at a capture file instead of at MSFS.
 *
 * Named after `FSCE_RELAY_URL`, which does the same job for the relay: one
 * environment variable that swaps a slow external dependency for a local one,
 * and is read in exactly one place.
 */
const REPLAY_FILE = process.env.FSCE_SIM_REPLAY
const REPLAY_SPEED = Number(process.env.FSCE_SIM_REPLAY_SPEED ?? "1")

/**
 * node-simconnect, loaded on first use rather than imported at the top.
 *
 * It is the app's only unbundled runtime dependency — it shells out to `.vbs`
 * scripts that have to exist as real files, so it cannot be rolled into the
 * main bundle — which makes it the one import that can fail in a packaged build
 * and not in development. A static import would turn that into a main process
 * that dies before the window opens.
 *
 * Loading it here instead means the worst case is the state this app is
 * designed around anyway: no simulator, everything else working. The failure is
 * logged rather than swallowed, because "Sim offline" forever is otherwise
 * indistinguishable from MSFS simply not running.
 */
type SimConnect = typeof import("node-simconnect")

let simconnect: SimConnect | null = null
let loadFailed = false

async function loadSimConnect(): Promise<SimConnect | null> {
  if (simconnect) return simconnect
  if (loadFailed) return null

  try {
    simconnect = await import("node-simconnect")
    await pointRegeditAtUnpackedScripts()
    return simconnect
  } catch (error) {
    loadFailed = true
    console.error(
      `sim: node-simconnect could not be loaded, so the simulator is ` +
        `unreachable for this session — ${describe(error)}`
    )
    return null
  }
}

/**
 * Tells `regedit` where its scripts really are, in a packaged build.
 *
 * node-simconnect finds the SimConnect port by reading the registry through
 * `regedit`, which shells out to `cscript` — a separate process, which cannot
 * see inside `app.asar`. `asarUnpack` puts the scripts on disk but does not
 * change the path regedit derives from its own `__dirname`, so without this the
 * spawn fails with "Can not find script file".
 *
 * That failure is caught inside node-simconnect and turned into a default port
 * of 2048, so nothing is raised and nothing is logged — the connection simply
 * never happens on any machine where the named pipe is absent, which is the
 * configuration stage 0 was on. Verified against a real packaged build rather
 * than reasoned about, because there is no symptom to notice if it is wrong.
 *
 * A no-op in development, where regedit's own path is already correct.
 */
async function pointRegeditAtUnpackedScripts(): Promise<void> {
  if (!process.resourcesPath) return

  const vbs = path.join(
    process.resourcesPath,
    "app.asar.unpacked",
    "node_modules",
    "regedit",
    "vbs"
  )
  if (!fs.existsSync(vbs)) return

  try {
    const regedit = await import("regedit")
    regedit.setExternalVBSLocation(vbs)
  } catch (error) {
    // Non-fatal: the named pipe is tried before the registry, so this only
    // costs the fallback.
    console.warn(`sim: could not redirect regedit — ${describe(error)}`)
  }
}

/** Distinct ids for everything this client asks the sim for. */
const REQ = { AIRCRAFT: 1, SIMVARS: 2 }

/**
 * Enumeration gets a fresh request id every time, counting up from here.
 *
 * The list arrives in chunks and an aircraft change starts a new one, so two
 * enumerations can be in flight at once. Without a way to tell their chunks
 * apart they merge into one list, and every input event in it gets subscribed
 * twice — which on top of the sim's own duplicate would mean four events per
 * interaction, all of them looking legitimate.
 */
const ENUMERATE_BASE = 100

/*
 * Where `getInputEvent` request ids start, and why it is not 200.
 *
 * `ENUMERATE_BASE` counts *up* without bound — a fresh id per aircraft change,
 * for the whole life of a session. Anything close above it is a collision
 * waiting for a long session, and a collision merges two enumerations' chunks,
 * which is the exact failure that base was introduced to prevent.
 *
 * A million is not a guess at how many aircraft changes are too many; it is
 * far enough that the question never has to be asked.
 */
const READ_BASE = 1_000_000
const DEF = { SIMVARS: 1 }
const EVT = { AIRCRAFT_LOADED: 1 }

interface Live {
  handle: SimConnectConnection
  aircraft: string | null
  /** Input event names by hash — enumeration fills it, subscription reads it. */
  names: Map<bigint, string>
  /**
   * The same table the other way, for turning a watched name into a hash.
   *
   * Same per-aircraft lifetime as `names` and cleared beside it: hashes are
   * reassigned on a swap, so a stale entry would read a different control.
   */
  hashes: Map<string, bigint>
  /**
   * Which name each in-flight `getInputEvent` was asked about.
   *
   * `RecvGetInputEvent` carries a request id and no hash, so without this a
   * reply cannot be attributed. Entries are removed as replies land.
   */
  reads: Map<number, string>
  /** Counts up from `READ_BASE` — see the note there. */
  nextRead: number
  /** Watched `B:` names already asked for a first value, so each is asked once. */
  asked: Set<string>
  /** What we are subscribed to, so an aircraft change can undo it. */
  subscribed: bigint[]
  /** Accumulates the chunked enumeration response. */
  pending: { name: string; hash: bigint }[]
  /** Request id of the enumeration whose chunks are worth keeping. */
  enumeration: number
  /** The current `A:` watch set, in data-definition order. */
  watching: SimVarWatch[]
  /** When `A:` values last went into the capture. See the `simObjectData` handler. */
  captured: number
  /**
   * How to talk to the module, once it has been subscribed to.
   *
   * Held here because the aircraft handler needs it and only `attachLink`
   * builds it. Null when there is no module, which is the ordinary case.
   */
  link: LinkChannel | null
  /** The follow-up re-walk after an aircraft change. See `reenumerate`. */
  settle: ReturnType<typeof setTimeout> | undefined
  /**
   * Fires once, when the module has been given long enough to answer `start`.
   *
   * Held here rather than as a module-level timer so a connection that drops
   * inside the grace window takes its own timer with it — otherwise a publish
   * scheduled by one session lands during the next.
   */
  grace: ReturnType<typeof setTimeout> | undefined
  /** Set while shutting down on purpose, so handlers stay quiet. */
  stopping: boolean
}

/**
 * How long the module gets to answer before its silence means "not loaded".
 *
 * The reply to `start` comes back within a frame or two, so this is generous by
 * two orders of magnitude on purpose: the cost of waiting is that a correct
 * `Restart sim` appears three seconds late, and the cost of not waiting is
 * telling somebody to restart their simulator for no reason.
 */
const LINK_GRACE_MS = 3_000

let live: Live | null = null
let retry: ReturnType<typeof setTimeout> | undefined
let userDataDir = ""
let running = false

/*
 * Everyone listening, per stream. Sets rather than single slots: a slot meant
 * a second subscriber silently replaced the first, and `ipc.ts` carried a
 * comment warning about exactly that.
 */
const stateListeners = new Set<(state: SimState) => void>()
const eventListeners = new Set<(event: CapturedEvent) => void>()
const valueListeners = new Set<(values: SimValue[]) => void>()
const sessionListeners = new Set<() => void>()

function emitState(state: SimState): void {
  for (const listener of stateListeners) listener(state)
}

function emitEvent(event: CapturedEvent): void {
  for (const listener of eventListeners) listener(event)
}

function emitValues(values: SimValue[]): void {
  for (const listener of valueListeners) listener(values)
}

function sessionChanged(): void {
  for (const listener of sessionListeners) listener()
}

/** Where state changes go — real changes only; see `publish`. */
export function onSimState(listener: (state: SimState) => void): () => void {
  stateListeners.add(listener)
  return () => stateListeners.delete(listener)
}

/**
 * Told when a fact the variable index is built from has changed: the
 * connection dropped, an aircraft loaded, or its input-event list landed —
 * live or replayed.
 *
 * One signal, raised here where those facts live, so nothing downstream has to
 * recognise them by event kind. Before it, `ipc.ts` refreshed the index on an
 * `aircraft` event and nothing else, and a disconnect left the renderer
 * judging `B:` lines against an aeroplane that had gone.
 */
export function onSimSession(listener: () => void): () => void {
  sessionListeners.add(listener)
  return () => sessionListeners.delete(listener)
}

/**
 * Where raw events go, in addition to the capture file.
 *
 * Nothing consumes this in stage 2 — the capture is the deliverable. It exists
 * because stage 4 reads the same stream live that it reads from a fixture, and
 * having one emission point now is what keeps those two paths identical later.
 */
export function onSimEvent(
  listener: (event: CapturedEvent) => void
): () => void {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

/** Live values for the watch set, for 09-live-values' inlay hints. */
export function onSimValues(listener: (values: SimValue[]) => void): () => void {
  valueListeners.add(listener)
  return () => valueListeners.delete(listener)
}

/**
 * The input-event names the loaded aircraft has registered, or null when no
 * aircraft is loaded and the question has no answer.
 *
 * Beside `simState` rather than inside it because this is a list, not a
 * status: `simState` goes to the renderer on every change and carries the
 * *count* for the status bar, while the names travel with the variable index,
 * which is already rebuilt per aircraft and already refreshes diagnostics.
 *
 * A caller must treat presence as strong evidence and absence as weak. The
 * table fills as add-ons wake up — the same reason the L: walk runs twice —
 * so a name missing a second after a swap may simply not have registered yet.
 *
 * Null, too, until an enumeration has landed. `names` is empty at the main
 * menu, between connecting and the first list, and for the moment after every
 * swap — and an empty list reads downstream as "this aircraft has none", which
 * flags every `B:` in every open file. Every real aircraft lists MSFS's own
 * `CLICKSPOT_*` templates, so an empty table is never an answer.
 */
export function inputEventNames(): string[] | null {
  // A replay answers from the capture, as `simState` does — otherwise the `B:`
  // rules and the panel's list were the one part a capture could not drive.
  const replay = replayState()
  if (replay) return replay.names.length ? replay.names : null

  if (!live || live.names.size === 0) return null
  return [...live.names.values()]
}

export function simState(): SimState {
  const installed = linkInstalled()
  const replay = replayState()

  if (replay) {
    return {
      installed,
      phase: "live",
      aircraft: replay.aircraft,
      inputEvents: replay.count,
      link: null,
      // A replay writes no capture. Recording a playback would produce a
      // near-copy of the file being played, which is a good way to end up with
      // a fixtures folder nobody trusts.
      capture: null,
      // Nothing to be silent about: a capture is a file, and telling somebody
      // to restart the simulator they do not have open would be nonsense.
      silent: false,
    }
  }

  // Not connected is not connected. `running` is not consulted: it means the
  // retry loop is alive, which it is from launch until quit, and reporting that
  // as a distinct state is what made the chip say `Connecting…` forever on a
  // machine where MSFS was simply closed. See @shared/sim.
  if (!live) return { installed, phase: "offline" }

  const link = linkState()

  return {
    installed,
    phase: "live",
    aircraft: live.aircraft,
    inputEvents: live.names.size,
    capture: captureFile(),
    link: link.present
      ? {
          version: link.version ?? "?",
          variables: link.variables,
          outdated: link.outdated,
        }
      : null,
    // Only ever true once the grace timer has run, which is what makes this an
    // answer rather than the ordinary first moment of a connection.
    silent: installed && !link.present && live.grace === undefined,
  }
}

/** The last state sent, serialized, so an unchanged one is not sent again. */
let published = ""

/**
 * Sends the state summary — if it changed.
 *
 * Callers publish whenever something *might* have moved, and the busiest is
 * the Link handler, which runs on every module message: ~15 a second for as
 * long as the module streams. Every one used to reach `ipc.ts`, which logged
 * it at info and pushed it to the renderer, where every subscriber to `sim`
 * re-rendered for a state identical to the last. The summary is a handful of
 * fields; comparing it here is cheaper than any of that.
 */
function publish(): void {
  const state = simState()
  const key = JSON.stringify(state)
  if (key === published) return

  published = key
  emitState(state)
}

/**
 * Feeds one event into the live-value store, and asks for a flush.
 *
 * Every value-bearing event kind lands here — `simvar` from SimConnect, `var`
 * from the module, `input` from both halves of the input-event read — so the
 * transports cannot drift apart in how a value becomes a hint. Everything else
 * is ignored, which is most of the stream.
 *
 * `input` keys as `B:<id>`, matching what `store.ts` records for a firing and
 * what `live-values.ts` resolves a written `<id>_<Preset>` down to. The
 * simulator's table holds ids, so there is no per-preset value to key by.
 */
function absorbValues(event: SimEvent): void {
  if (event.kind === "simvar") recordValue(event.name, event.value)
  else if (event.kind === "var") recordValue(event.name, event.value)
  else if (event.kind === "input") {
    if (!recordInputValue(event.name, event.value)) return
  } else return

  scheduleValueFlush()
}

/** Names already warned about, so one odd event is not one warning per tick. */
const warnedNonNumeric = new Set<string>()

/**
 * Puts one input-event value in the store, or drops it and says why.
 *
 * Shared by the two halves of the `B:` read — the subscription, which arrives
 * as a `SimEvent`, and `getInputEvent`, which does not go through one at all
 * (see the handler for why). Returns whether anything was recorded, so the
 * caller can decide about flushing.
 *
 * **Numbers only, and the descriptor's `why` says so.** `RecvGetInputEvent`
 * types its value `number | string`, and every one of the A220's 464 events
 * declares `DOUBLE` and answered numerically. Making `SimValue` carry a string
 * to serve zero observed cases would ripple through the wire, the capture,
 * replay, the gutter formatter and the value store — where `formatValue`
 * reaches `value.toFixed` and throws, and `run.ts` compares `NaN` and silently
 * decides nothing moved.
 *
 * Dropped loudly rather than quietly: a silent drop looks exactly like a
 * variable with no value, which is the wrong thing to conclude from it.
 */
function recordInputValue(name: string, value: number | string): boolean {
  if (typeof value !== "number") {
    if (!warnedNonNumeric.has(name)) {
      warnedNonNumeric.add(name)
      console.warn(
        `B:${name} reported a non-numeric value (${typeof value}), which the ` +
          `live-value store cannot hold. Ignored; no further warnings for ` +
          `this name.`
      )
    }
    return false
  }

  // Keyed by the input event's id, which is what the sim enumerates and what
  // `live-values.ts` resolves a written `<id>_<Preset>` down to.
  recordValue(`B:${name}`, value)
  return true
}

/**
 * How long changes are gathered before the renderer hears about them.
 *
 * Not a readability throttle. It was one, at 250 ms, on the reasoning that a
 * number updating faster than it can be read is harder to read — which is true
 * of a *number* and false of the thing people actually do with this: move a
 * control by hand in walkaround and watch the line follow. Anything that lags
 * behind the hand reads as broken rather than as calm.
 *
 * So this is only what it has to be: the module ticks at 15 Hz and sends one
 * message per tick unless a burst needs more than 8 KB, and the sole job here is
 * to merge the chunks of one tick into one IPC message. A frame is plenty for
 * that, and smaller than the tick it is merging — so it adds no latency of its
 * own, it just stops a chunked tick becoming three repaints.
 *
 * 15 Hz of repaints is affordable because the renderer no longer repaints on
 * receipt: `live-decorations.ts` compares what it would draw against what is
 * drawn, and a model showing none of the changed variables does nothing.
 */
const VALUE_FLUSH_MS = 16

/**
 * How often `A:` samples are written to the capture and the Log panel.
 *
 * The rate `A:` was *read* at until now, kept as the rate it is *recorded* at
 * so captures stay the size and shape they have always been. Reading moved to
 * per-sim-frame for the editor's sake; see the `simObjectData` handler.
 */
const SIMVAR_CAPTURE_MS = 1_000

let valueFlush: ReturnType<typeof setTimeout> | undefined

function scheduleValueFlush(): void {
  if (valueFlush) return

  valueFlush = setTimeout(() => {
    valueFlush = undefined
    // Nothing watched moved, so the renderer already has the truth. An idle
    // cockpit still produces a steady trickle of clock ticks, and none of them
    // is worth an IPC message.
    if (takeDirty()) emitValues(watchedValues())
  }, VALUE_FLUSH_MS)
}

/**
 * Re-reads whether the module is installed, and republishes.
 *
 * How the install flow tells the chip that the thing it was inviting somebody
 * to do has been done. It is the only path by which `installed` changes during
 * a session, which is why nothing here polls: an app that watched the Community
 * folder would be watching a directory of sixty packages to notice a change it
 * made itself.
 */
export async function refreshSimInstall(): Promise<void> {
  await refreshLinkInstalled()
  publish()
}

/**
 * Captures, records as evidence, and forwards — in that order.
 *
 * One emission point, so a capture on disk, the database and whatever the
 * renderer eventually sees can never describe different things.
 */
/**
 * Puts a mark into the stream, so the capture holds one too.
 *
 * Exported rather than emitted from `marks.ts` directly because `emit` is the
 * one emission point and that is worth more than the import it costs: a mark
 * that took a private path to the capture would be a mark the database, the
 * ring and the renderer disagreed about.
 *
 * Silently does nothing when the sim is not connected. A mark outside a session
 * has nothing to be relative to, and `marks.ts` has already kept it for the
 * panel either way.
 */
/**
 * Runs waiting on the module, by the token they sent.
 *
 * A map rather than a single slot because nothing stops two runs overlapping —
 * a keyboard-repeated Enter is enough — and answering the wrong one would be
 * silent and wrong rather than loud and wrong.
 */
const pendingExec = new Map<number, (reply: { ok: boolean }) => void>()
let execToken = 0

/**
 * How long a run waits for the module to answer.
 *
 * The module replies inside a frame — `exec` is handled in the same dispatch
 * that reads the command — so this is not a budget, it is the point at which
 * "it never answered" becomes the honest thing to say. Generous enough that a
 * sim in a loading screen, which does not schedule modules, is not called a
 * failure while it is still coming back.
 */
const EXEC_TIMEOUT_MS = 3_000

/**
 * Asks the module to run calculator code, and waits for its verdict.
 *
 * `ok: false` covers three different situations and says which: no module, a
 * command the wire refused to carry, and a module that did not answer. Only
 * the calculator's own rejection comes back from the simulator itself.
 */
export function execCalculator(
  code: string
): Promise<{ ok: boolean; reason?: string }> {
  if (!live?.link)
    return Promise.resolve({
      ok: false,
      reason: "the sim module is not connected",
    })

  const token = ++execToken
  if (!sendLinkCommand(live.link, { name: "exec", token, code }))
    return Promise.resolve({
      ok: false,
      reason: "that code is too long to send, or holds a NUL",
    })

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingExec.delete(token)
      resolve({ ok: false, reason: "the sim module did not answer" })
    }, EXEC_TIMEOUT_MS)

    pendingExec.set(token, (reply) => {
      clearTimeout(timer)
      pendingExec.delete(token)
      resolve(reply)
    })
  })
}

/**
 * The simulator, as `run.ts` wants it.
 *
 * Built here because this file is the one place that already holds all three
 * sources — the module channel, the value map and the ring buffer — and
 * because `run.ts` taking them as arguments is what keeps a one-second window
 * out of the test suite.
 */
export function simRunDeps(): RunDeps {
  return {
    exec: execCalculator,
    readValue: valueFor,
    slice,
    now: () => Date.now(),
    wait: (ms) => new Promise((done) => setTimeout(done, ms)),
  }
}

export function recordMark(): void {
  if (!live) return
  emit({ kind: "mark" }, "app")
}

function emit(event: SimEvent, via: SimVia = "client"): void {
  observe(event)

  const captured = record(event, via)
  // Activity's working set. Fed from the same one emission point as the capture
  // file and the database, so a finding can never describe a stream that the
  // capture beside it does not contain.
  observeActivity(captured)
  emitEvent(captured)
}

/**
 * Errors arrive bare, or as an AggregateError with one entry per transport
 * tried. Either way the useful text is inside — the same unwrapping the spike
 * needed, for the same reason: "AggregateError" alone says nothing.
 */
function describe(error: unknown): string {
  if (error instanceof AggregateError) {
    const inner = error.errors.map(describe).filter(Boolean)
    return inner.length ? inner.join("; ") : "AggregateError with no causes"
  }
  if (error instanceof Error) return error.message || error.name

  const text = String(error)
  return text === "undefined" || text === "" ? "unknown error" : text
}

/**
 * Turns a loaded-aircraft path into the SimObject folder name — the key
 * profiles are named after.
 *
 * Matched case-insensitively because stage 0 saw the sim return `aircraft.CFG`,
 * and there is no reason to trust the casing of any other segment either.
 */
export function folderFromPath(filePath: string): string | null {
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  const at = parts.findIndex((part) => part.toLowerCase() === "airplanes")
  if (at >= 0 && parts[at + 1]) return parts[at + 1]

  return parts.length >= 2 ? (parts[parts.length - 2] ?? null) : null
}

/**
 * Begins trying to reach the simulator, and keeps trying.
 *
 * Never throws and never blocks: 04-connection's first rule is that launch is
 * unchanged and the app never waits on MSFS. A user who never starts the sim
 * should not be able to tell this function was called.
 */
export function startSim(userData: string): void {
  if (running) return

  running = true
  userDataDir = userData

  // Asked once, here, rather than on every publish: it is a question about the
  // filesystem whose answer changes when somebody installs the module, and the
  // chip reads it on every state change. `void` because launch does not wait on
  // it — 04-connection's first rule — and the chip simply corrects itself a few
  // milliseconds later.
  void refreshSimInstall()

  if (REPLAY_FILE) {
    /*
     * Replay drives live values too, not just the event stream.
     *
     * It did not, which made stage 3 impossible to exercise without the
     * simulator — the one thing the harness exists to avoid. In the live path
     * a whole set arrives per tick; a capture holds one event per variable, so
     * the set is rebuilt as they arrive and re-sent each time. Same shape out,
     * which is the property that makes replay worth having.
     */
    startReplay(
      REPLAY_FILE,
      REPLAY_SPEED,
      (event) => {
        // Deliberately `emitEvent` rather than `emit`: a replay does not write
        // sim evidence. The same capture played twenty times would inflate every
        // change count twentyfold, and `sim_observation` is meant to say how
        // often a variable really moved on an aircraft.
        emitEvent(event)

        // Through the same store the live path uses, rather than a Map of its
        // own. A replay that assembles values differently is a replay that can
        // agree with the simulator and disagree with the app, which is the one
        // thing the harness must never do — and it is how `L:` hints get
        // developed with MSFS closed.
        absorbValues(event)

        // And into Activity's ring, so a replayed session ranks. Not evidence
        // and not a database write, so the reason `emit` is skipped above does
        // not apply here: this is the working set, and without it the panel is
        // the one part of the app a capture cannot exercise.
        observeActivity(event)

        // Marks are in the capture now, so a replay can put them back. This is
        // what makes a marking session reproducible with the simulator closed —
        // the case the ranking most needs to be tuned against.
        if (event.kind === "mark") markAt(event.t)

        // The same session facts the live client announces, from the same
        // events. `replayState` has taken them in by the time this runs.
        if (event.kind === "aircraft" || event.kind === "input-events")
          sessionChanged()
      },
      publish
    )
    return
  }

  void attempt()
}

/** Stops for good — app quit, or the user turning it off. */
export function stopSim(): void {
  running = false
  clearTimeout(retry)
  retry = undefined

  const replaying = replayState() !== null
  stopReplay()
  // Evidence, values, Activity and the module are ended by `teardown`, which
  // is the one place per-connection state ends — see there.
  teardown("stopped")
  // A replay has no `live` for `teardown` to end, but the index was built from
  // its capture and has to hear that it stopped.
  if (replaying) sessionChanged()
  publish()
}

function scheduleRetry(): void {
  if (!running || retry) return
  retry = setTimeout(() => {
    retry = undefined
    void attempt()
  }, SIM_RETRY_MS)
}

/**
 * Ends the connection and everything that belonged to it, leaving the retry
 * loop alone.
 *
 * **The one place per-connection state ends.** Every module holding some —
 * the capture, the evidence queue, the value store, Activity, the Link
 * protocol — is reset from here, and whatever the renderer built from any of
 * it is told. Two used to be missing: the Link state was only reset by the
 * *next* connection, so its verdicts outlived the one they described, and the
 * evidence queue only by `stopSim`, so a dropped connection kept its
 * observation clock running. A new per-connection store belongs on this list.
 *
 * Called on quit, on error, and on purpose, so it has to be safe to call when
 * there is nothing to close.
 */
function teardown(reason: string): void {
  if (!live) return

  const handle = live.handle
  live.stopping = true
  clearTimeout(live.grace)
  clearTimeout(live.settle)
  live = null

  // Anything waiting on the module will now wait forever, so it is told. Its
  // own timeout would eventually fire, but three seconds of a popover saying
  // nothing is three seconds of looking like the app hung.
  for (const answer of pendingExec.values()) answer({ ok: false })
  pendingExec.clear()

  emit({ kind: "closed", reason })
  stopCapture()

  // Anything queued belongs to the session that is ending, so it is written
  // before the aircraft it belongs to is forgotten — and the observation clock
  // stops, so the gap until the next connection is not counted as watching.
  flushSimEvidence()
  resetSimEvidence()

  // Values die with the connection. A hint showing what a switch read before
  // MSFS quit is worse than no hint: it looks live, and there is no way to tell
  // from the editor that it is not. The renderer does the same on its side.
  clearTimeout(valueFlush)
  valueFlush = undefined
  resetValues()
  emitValues([])

  // The working set belongs to a connection. Anchoring an interaction from the
  // last session against changes from this one would be a finding built across
  // a gap of unknown length.
  resetActivity()

  // And the pending conclusions with it: a collector timer that survived the
  // disconnect would rank a buffer that had just been emptied, and write the
  // nothing it found down as evidence.
  resetActivityHistory()

  // The module is not talking any more, so neither are its verdicts. This
  // wakes the resolution listeners, and the renderer's `refResolved` goes
  // quiet instead of holding the last aircraft's answers.
  resetLink()

  // The index was built from this connection's aircraft and input events.
  sessionChanged()

  try {
    handle.close()
  } catch {
    // Already gone. Nothing to tell it.
  }
}

async function attempt(): Promise<void> {
  if (!running || live) return

  const sc = await loadSimConnect()
  if (!sc) {
    // Nothing to retry. A module that failed to load will fail again.
    running = false
    publish()
    return
  }

  // SunRise first — it is what MSFS 2024 answers on, and stage 0 connected
  // first try. KittyHawk is the 2020 fallback.
  const tries: [SimProtocol, number][] = [
    ["SunRise", sc.Protocol.SunRise],
    ["KittyHawk", sc.Protocol.KittyHawk],
  ]

  for (const [label, protocol] of tries) {
    try {
      const { recvOpen, handle } = await sc.open("fsc-editor", protocol)
      if (!running) {
        handle.close()
        return
      }
      ready(handle, label, recvOpen)
      return
    } catch {
      // ECONNREFUSED is the ordinary "sim is not running" signature and is not
      // worth a line in the log every five seconds. A genuine misconfiguration
      // looks identical from here, which is why the chip says "offline" rather
      // than claiming to know why.
    }
  }

  scheduleRetry()
}

type RecvOpen = Awaited<ReturnType<SimConnect["open"]>>["recvOpen"]

function ready(
  handle: SimConnectConnection,
  protocol: SimProtocol,
  recvOpen: RecvOpen
): void {
  live = {
    handle,
    aircraft: null,
    names: new Map(),
    hashes: new Map(),
    reads: new Map(),
    nextRead: READ_BASE,
    asked: new Set(),
    subscribed: [],
    pending: [],
    enumeration: ENUMERATE_BASE,
    watching: [],
    captured: 0,
    link: null,
    settle: undefined,
    grace: undefined,
    stopping: false,
  }

  // Started here rather than in `attachLink`, because the thing being timed is
  // the connection: a module that is not installed produces no call to time
  // from, and that is exactly the case the timer has to cover.
  live.grace = setTimeout(() => {
    if (live) live.grace = undefined
    publish()
  }, LINK_GRACE_MS)

  startCapture(userDataDir)

  // The observation clock. What `sim_observation`'s counts are a rate *of*, and
  // it starts with the connection rather than with the first event so a quiet
  // aircraft is still time spent watching it.
  startWatching()

  emit({
    kind: "open",
    protocol,
    app: recvOpen.applicationName,
    appVersion: `${recvOpen.applicationVersionMajor}.${recvOpen.applicationVersionMinor}`,
    simConnectVersion: `${recvOpen.simConnectVersionMajor}.${recvOpen.simConnectVersionMinor}`,
  })
  publish()

  const dropped = (reason: string): void => {
    if (live?.stopping) return
    teardown(reason)
    publish()
    scheduleRetry()
  }

  handle.on("quit", () => dropped("sim quit"))
  handle.on("close", () => dropped("connection closed"))
  handle.on("error", (error) => dropped(describe(error)))
  handle.on("exception", (recv) => {
    // Not fatal, and not silent either: an exception here means a request was
    // rejected, and the request that gets rejected is the one worth knowing
    // about while this is still new.
    console.warn(`sim: exception ${recv.exception} on sendId ${recv.sendId}`)
  })

  // Which aircraft. Subscribe for changes *and* ask for the current one, so
  // connecting mid-flight works as well as connecting before loading.
  handle.subscribeToSystemEvent(EVT.AIRCRAFT_LOADED, "AircraftLoaded")
  handle.requestSystemState(REQ.AIRCRAFT, "AircraftLoaded")

  handle.on("systemState", (state) => {
    if (state.requestID === REQ.AIRCRAFT && state.dataString) {
      // `dataString`, not `stringValue`: reading the wrong field is what made
      // stage 0's question 2 report nothing, silently.
      aircraftChanged(state.dataString)
    }
  })
  handle.on("eventFilename", (event) => {
    if (event.clientEventId === EVT.AIRCRAFT_LOADED) {
      aircraftChanged(event.fileName)
    }
  })

  handle.on("simObjectData", (data) => {
    if (!live || data.requestID !== REQ.SIMVARS) return

    /*
     * Tagged: every record carries the datum id it belongs to.
     *
     * Reading positionally against the watch list crashed — `Illegal offset:
     * 0 <= 476 (+8) <= 476`, one read past the end. The definition and the
     * watch list are not the same length, because `addToDataDefinition` for a
     * name this sim does not have is rejected *asynchronously*: the entry never
     * joins the definition, nothing throws where it was added, and the list
     * still counts it.
     *
     * Positional reads cannot survive that even bounded — a rejected entry in
     * the middle shifts every value after it onto the wrong variable, which is
     * worse than a crash because it looks like data. The datum id removes the
     * assumption entirely.
     */
    const values = readTaggedValues(data.data, data.defineCount, live.watching)

    /*
     * Read fast, record fast, write to disk slowly.
     *
     * The editor and the capture want opposite things from `A:`. Somebody
     * dragging a control surface in walkaround wants the number to follow their
     * hand, which means sampling per sim frame; a capture wants to stay a file
     * a person can read, and 12 variables at 60 Hz is 720 events a second of
     * mostly-identical readings.
     *
     * So the two rates are separated here. Every sample reaches the value store
     * — and through it the editor, coalesced to a frame. One sample a second
     * reaches the capture and the Log panel.
     *
     * This is the one place the "one emission point" rule is bent, and it is
     * safe to bend precisely here: `observe()` ignores `simvar` entirely, so no
     * evidence in the database is downsampled by it. The capture loses
     * resolution it never had — `A:` was requested once a second until now —
     * while the editor gains all of it.
     */
    for (const value of values) recordValue(value.name, value.value)
    scheduleValueFlush()

    const now = Date.now()
    if (now - live.captured < SIMVAR_CAPTURE_MS) return

    live.captured = now
    for (const value of values) emit({ kind: "simvar", ...value })
  })

  handle.on("inputEventsList", (list) => {
    // Chunks from a superseded enumeration are dropped rather than merged.
    if (!live || list.requestID !== live.enumeration) return

    for (const descriptor of list.inputEventDescriptors) {
      live.pending.push({
        name: descriptor.name,
        hash: descriptor.inputEventIdHash,
      })
    }

    // Arrives in chunks; the last one is when the list is whole.
    if (list.entryNumber + list.arraySize < list.outOf) return

    enumerated()
  })

  /*
   * The reply to a first-value read, which is deliberately **not** emitted.
   *
   * `emit` writes sim evidence, and `observe()` reads an `input` arrival as
   * somebody working the control. This arrival is the app asking, not a person
   * pressing — so emitting it would manufacture a firing every time a watch set
   * changed, which is every time a file is opened, and `b-value-constant`
   * would be reading its own reads back as evidence.
   *
   * Straight to the value store instead, the way `simObjectData` puts `A:`
   * values there without emitting each one.
   */
  handle.on("getInputEvent", (event) => {
    if (!live) return

    const id = live.reads.get(event.requestID)
    if (id === undefined) return

    live.reads.delete(event.requestID)

    if (recordInputValue(id, event.value)) scheduleValueFlush()
  })

  handle.on("subscribeInputEvent", (event) => {
    const name = live?.names.get(event.inputEventIdHash)
    if (!name) return

    const value: SimEvent = {
      kind: "input",
      name,
      hash: event.inputEventIdHash.toString(),
      value: event.value,
    }

    // Emitted, because a firing *is* evidence and Activity has always consumed
    // it — and absorbed, because `emit` does not reach the value store. Only
    // the replay and link paths call `absorbValues` for themselves; SimConnect
    // handlers do their own, as the `simObjectData` one does.
    emit(value)
    absorbValues(value)
  })

  // No enumeration here. Input events belong to an aircraft, so the list is
  // meaningless until the sim has said which one is loaded — and the request
  // for that has already gone out above. `aircraftChanged` is the single
  // trigger, which is also what keeps there from being two of them in flight.

  // The `A:` watch set usually arrived before the connection did — tabs are
  // restored at launch — and a data definition belongs to a connection. The
  // module and `B:` halves are replayed by `attachLink` and `enumerated()`;
  // this is the third.
  defineWatch()

  attachLink(handle)
}

/**
 * Subscribes to the Link module and asks it to start.
 *
 * All of it is best-effort. The module is optional — it is not installed until
 * a user chooses to, and 04-connection is explicit that everything degrades to
 * the `A:`/`B:` behaviour that works without it. So a missing module produces
 * SimConnect exceptions on these calls and nothing else: no error state, no
 * retry, no mention.
 */
function attachLink(handle: SimConnectConnection): void {
  if (!simconnect) return

  resetLink()

  const onSet = simconnect.ClientDataPeriod.ON_SET
  const channel = {
    mapClientDataNameToID: (name: string, id: number) =>
      handle.mapClientDataNameToID(name, id),
    addToClientDataDefinition: (id: number, offset: number, size: number) =>
      handle.addToClientDataDefinition(id, offset, size),
    requestClientData: (
      dataId: number,
      requestId: number,
      defineId: number,
      period: number
    ) =>
      handle.requestClientData(dataId, requestId, defineId, period, 0, 0, 0, 0),
    setClientData: (dataId: number, defineId: number, data: Buffer) =>
      handle.setClientData(dataId, defineId, 0, 0, data.length, data),
  }

  // `attachLink` is called from `ready`, which has just built `live` — but this
  // file is long enough that saying so beats asserting it.
  if (live) live.link = channel

  handle.on("clientData", (data) => {
    if (data.requestID !== LINK_REQUEST.OUT) return

    // The area is a fixed-size buffer; everything past the payload is NUL and
    // the parser trims it.
    const raw = data.data.readBytes(LINK_AREA_SIZE).toString("utf8")
    for (const event of receiveLink(raw)) {
      emit(event, "link")
      // Before anything else looks at it: a run is blocked on this reply, and
      // the token is how it knows the reply is its own rather than another
      // client's. Replies for tokens nobody here sent fall through, which is
      // what a `link:read` running a setter alongside the app produces.
      if (event.kind === "exec") pendingExec.get(event.token)?.(event)
      // Every `L:` that moves is kept, not only the watched ones. The module
      // sends deltas, so a switch nobody has touched since enumeration would
      // otherwise never have a value — and those are precisely the lines
      // somebody writing a profile is looking at. See `live-values.ts`.
      absorbValues(event)
    }

    publish()
  })

  subscribeLink(channel, onSet)

  // The module does not stream until asked: it boots with the simulator and we
  // connect whenever, so streaming to nobody would spend a frame budget on
  // messages no one reads.
  sendLinkCommand(channel, { name: "start" })

  // The module outlives the app and holds whatever watch set the last client
  // left it; this client's is the one that matches its open editors.
  sendModuleWatch(channel, moduleWatch)

  /*
   * And then settle, because `start` is not enough on its own.
   *
   * The module walks the table on `start` only when it has never walked one —
   * it outlives the app, so an editor restarted mid-session finds it already
   * enumerated. That case is covered by the module reseeding its `last` array,
   * which makes it re-report everything it knows about; what it cannot do is
   * discover names registered since its one and only walk.
   *
   * So only the waiting is wanted here, not another full walk: `start` has just
   * sent everything it knows, and following it with `enumerate` threw all of
   * that away to send an identical copy. The sequence stops itself as soon as
   * the count holds still.
   */
  settleAfterStart()
}

/**
 * Asks for the current value of every watched `B:` name not already asked.
 *
 * The one thing the subscription cannot do. Everything after this arrives on
 * `subscribeInputEvent`, which was measured on 2026-09-04 to report real
 * transitions — every detent of a three-position switch included — so this
 * fires on a *watch-set change* rather than on a clock. A screenful of rows
 * costs one request each, once.
 *
 * `asked` is what makes it once. Watch sets are rebuilt wholesale whenever an
 * editor opens, closes or is typed in, and re-reading a value the subscription
 * has been maintaining since would be a request per keystroke.
 */
function readInputValues(names: string[]): void {
  if (!live) return

  for (const written of names) {
    if (live.asked.has(written)) continue

    const ref = parseVar(written)
    if (ref.ns !== "B") continue

    // The table holds ids and profiles write `<id>_<Preset>`; the shared
    // helper owns that stripping, and `b-preset-unknown` asks the same
    // question of the same list.
    const id = inputEventIds(ref.name, ref.preset).find((candidate) =>
      live?.hashes.has(candidate)
    )
    // No hash yet means the enumeration has not arrived. Left unasked on
    // purpose, so `enumerated()` picks it up when it does.
    if (id === undefined) continue

    const hash = live.hashes.get(id)
    if (hash === undefined) continue

    const requestId = live.nextRead++
    live.reads.set(requestId, id)
    live.asked.add(written)
    live.handle.getInputEvent(requestId, hash)
  }
}

/**
 * A new aircraft means a different set of input events, so the old
 * subscriptions are dropped and enumeration runs again.
 *
 * The event is recorded even when the key is unchanged. A reload of the same
 * aircraft still resets sim state, and 07-activity wants that as a separator
 * rather than as silence.
 */
function aircraftChanged(filePath: string): void {
  if (!live) return

  const key = folderFromPath(filePath)
  live.aircraft = key

  emit({ kind: "aircraft", key, path: filePath })

  for (const hash of live.subscribed) {
    try {
      live.handle.unsubscribeInputEvent(hash)
    } catch {
      // The connection is going away anyway if this fails.
    }
  }

  live.subscribed = []
  live.names.clear()
  // Hashes are reassigned on a swap, so everything keyed by one goes with it —
  // including the record of what has been asked, since the answers were about
  // the previous aeroplane's controls.
  live.hashes.clear()
  live.reads.clear()
  live.asked.clear()
  live.pending = []
  live.enumeration += 1

  live.handle.enumerateInputEvents(live.enumeration)
  reenumerate()
  // Every `aircraft` facet in the index describes the previous aeroplane, and
  // its input-event list is gone until the new one lands.
  sessionChanged()
  publish()
}

/**
 * Asks the module to walk the `L:` table again, now and once more shortly.
 *
 * **An aircraft's variables do not exist before the aircraft does.** The module
 * walks the table when the app says `start`, and the app connects as soon as
 * SimConnect answers — which is at the main menu, with no aircraft loaded. Every
 * `L:` the profile is about is registered afterwards, and nothing was telling
 * the module to look again: the table it enumerated at the menu was the table it
 * used for the rest of the session.
 *
 * That is why a profile could show values for a handful of lines and nothing for
 * the rest, in both directions of the "which started first" question. It was
 * never about ordering.
 *
 * Twice, because the table demonstrably keeps filling: 2,282 names on a freshly
 * started sim against 6,152 in a longer-running one, as add-ons wake up. The
 * aircraft event arrives before an aircraft has finished registering everything
 * it owns, so a single walk at that instant catches most of it and not all.
 *
 * Re-walking also fixes something the value store could not: `enumerate` clears
 * the module's `last` array, so every variable reports again — and the values
 * left over from the previous aircraft, which were stale and had no way of
 * knowing it, are replaced rather than lingering.
 *
 * That reset is why this is the aircraft-change path and not the connect one.
 * It is wanted exactly once per swap, and the re-walks that follow are asking
 * a different question — see `settle`.
 */
function reenumerate(): void {
  if (!live?.link) return

  clearTimeout(live.settle)

  // Values belonging to the aircraft that just went away. The module is about
  // to resend everything, so this is a blink rather than a gap — and a blank
  // line is honest where a number from the last aircraft is not.
  resetValues()

  sendLinkCommand(live.link, { name: "enumerate" })
  settle(0, linkState().variables)
}

/**
 * The same wait, for a connection rather than an aircraft change.
 *
 * `start` has already done the resetting half: the module either walks the
 * table for the first time or reseeds `last`, and either way everything it
 * knows about is on its way. What it cannot do is discover names registered
 * *after* that moment, which at the main menu is nearly all of them — so the
 * backoff still runs, and it runs on its own rather than behind a second full
 * walk that would re-report every value `start` had just sent.
 */
function settleAfterStart(): void {
  if (!live?.link) return

  clearTimeout(live.settle)
  settle(0, linkState().variables)
}

/**
 * Keeps re-walking until the table stops growing.
 *
 * How long an aircraft takes to register its variables is not a number worth
 * guessing. It depends on the aircraft — an A2A with a WASM gauge stack is not
 * a default Cessna — on the machine, and on what else the sim is loading at the
 * time. A fixed delay is either too short for the aircraft that needed it or a
 * pointless wait for every aircraft that did not.
 *
 * So the sim is asked instead. Walk, wait, walk again, and stop as soon as two
 * consecutive walks find the same number of names: that is the table having
 * settled, whenever it happens. The backoff means a slow load costs a few more
 * frames spread over half a minute, and a fast one stops after the second walk.
 *
 * `SETTLE_STEPS` bounds it. `L:` genuinely does keep growing for as long as a
 * session runs — 2,282 names on a fresh sim against 6,152 later, as add-ons
 * wake up — so "wait until it stops changing" without a cap is a walk every
 * thirty seconds forever.
 *
 * **Known wrong in principle, observed failing once.** Two equal walks detect
 * a *pause*, not a finished table, and an aircraft loading cold registers in
 * bursts with pauses between them — its own controls last of all. On
 * 2026-08-24 an A2A PA-24 ended enumeration holding 74% of its table and
 * stayed there. A Bonanza on 2026-08-27 did not reproduce it: all four steps
 * ran and all 88 of the aircraft's own names arrived, the last of them 35
 * seconds after the load. The difference is not understood, so the rule stands
 * as suspect rather than as a bug with a known trigger. Stopping on evidence
 * rather than on absence of evidence is still the fix wanted, whenever the
 * failure can be produced on demand — see both 2026-08-27 log entries, and
 * note that a walk finding nothing new leaves no trace in a capture.
 */
const SETTLE_STEPS = [3_000, 6_000, 12_000, 24_000]

function settle(step: number, before: number): void {
  const delay = SETTLE_STEPS[step]
  if (delay === undefined || !live) return

  live.settle = setTimeout(() => {
    if (!live?.link) return

    const now = linkState().variables

    // Two walks in a row agreeing is the signal to stop. Not checked on the
    // first pass, where `before` was measured before the walk that is being
    // judged and would compare a table against itself.
    if (step > 0 && now === before) return

    // `rescan`, not `enumerate`. The question here is only ever "did anything
    // new register?", and asking it with `enumerate` made the module forget
    // every value it held — so each of these rounds re-reported all ~6,150,
    // four or five times per aircraft change, to learn a number. `rescan`
    // appends what is new and leaves the rest alone.
    sendLinkCommand(live.link, { name: "rescan" })
    settle(step + 1, now)
  }, delay)
}

/** Enumeration finished: record the list, then subscribe to all of it. */
function enumerated(): void {
  if (!live) return

  const events = live.pending
  live.pending = []

  for (const { name, hash } of events) {
    live.names.set(hash, name)
    live.hashes.set(name, hash)
  }

  emit({
    kind: "input-events",
    events: events.map(({ name, hash }) => ({
      name,
      hash: hash.toString(),
    })),
  })

  // The whole list, including MSFS 2024's own CLICKSPOT_* and WALKAROUND_*
  // templates. Stage 0 found the runtime list is a superset of the aircraft's
  // own definitions; separating the two needs a sim-global baseline that does
  // not exist yet, and subtracting it here would throw away the evidence
  // needed to build one.
  for (const { hash } of events) {
    live.handle.subscribeInputEvent(hash)
    live.subscribed.push(hash)
  }

  /*
   * The watch set usually arrives first.
   *
   * Editors are open before an aeroplane is loaded, so `watchSimVars` has
   * normally already run and found no hashes to resolve against. This is the
   * moment those names become answerable, and without it a `get: B:` line
   * shows nothing until something edits the watch set again.
   */
  readInputValues(inputWatch)

  sessionChanged()
  publish()
}

/**
 * Replaces the `A:` watch set.
 *
 * Nothing calls this in stage 2 — stage 3 derives the set from the `get:` lines
 * of open models. It is here because it is the same transport, and building it
 * alongside the code it belongs to is cheaper than coming back for it.
 */
export function watchSimVars(vars: SimVarWatch[]): void {
  /*
   * Every namespace, straight through to the value store.
   *
   * `L:` needs no subscription and never did: the module streams every variable
   * that moves, to anyone listening, so watching one is a question of what to
   * forward rather than what to ask for. That is why this happens before the
   * connection check — the store is the app's, not the connection's, and a
   * watch set that arrives while MSFS is closed should still be remembered.
   */
  setWatch(vars)
  scheduleValueFlush()

  /*
   * The module's half of the set — names whose descriptor says the module
   * reads them by typed id (`Z:`, `E:`). Remembered before the connection
   * check for the same reason the store is: the set describes the open
   * editors, and `attachLink` replays it when the module says hello.
   */
  moduleWatch = vars
    .filter((entry) => readOf(entry.name) === "watch")
    .map((entry) => entry.name)

  /*
   * The `B:` half, and the one that does not become a subscription.
   *
   * Every input event is already subscribed — `enumerated()` subscribes the
   * whole table on every aircraft load, for Activity's sake — so updates need
   * nothing from this. What a newly watched name needs is its *first* value,
   * because subscribing does not deliver one: probed on the A220, four of five
   * events subscribed sent nothing at all until they were touched.
   */
  inputWatch = vars
    .filter((entry) => readOf(entry.name) === "input")
    .map((entry) => entry.name)

  // Only definition-read namespaces go to SimConnect — `A:`, per the
  // descriptor table. The stream reaches the store on its own; the module's
  // watch half is above, and what is left has no route — the table's `why`
  // says so where it matters. Remembered before the connection check, like the
  // other two halves, so `ready()` can define it.
  definitionWatch = vars.filter(
    (entry) => readOf(entry.name) === "definition"
  )

  // `simconnect` is necessarily loaded if there is a connection to watch on.
  if (!live || !simconnect) return

  if (live.link) sendModuleWatch(live.link, moduleWatch)

  readInputValues(inputWatch)

  defineWatch()
}

/**
 * Builds this connection's `A:` data definition from `definitionWatch`, and
 * asks for it per frame.
 *
 * Called when the watch set changes and when a connection opens — the second
 * is the one that was missing. See `definitionWatch`.
 */
function defineWatch(): void {
  if (!live || !simconnect) return

  // Only a definition that exists can be cleared. A fresh connection has none,
  // and clearing one SimConnect never saw comes back as an exception.
  if (live.watching.length) live.handle.clearDataDefinition(DEF.SIMVARS)

  // Stays `A:`-only, and separate from the store's list, because these indices
  // *are* the datum ids the tagged reader resolves against. See `tagged.ts`.
  const watchable = definitionWatch
  live.watching = watchable

  if (!watchable.length) return

  const handle = live.handle
  const sc = simconnect

  watchable.forEach(({ name, units }, index) => {
    handle.addToDataDefinition(
      DEF.SIMVARS,
      // SimConnect names carry no namespace prefix; the profile's does.
      name.slice(2),
      units,
      sc.SimConnectDataType.FLOAT64,
      0,
      // The datum id, and the whole point: it is this variable's index in the
      // watch list, so a rejected entry leaves a gap rather than a shift.
      index
    )
  })

  live.handle.requestDataOnSimObject(
    REQ.SIMVARS,
    DEF.SIMVARS,
    simconnect.SimConnectConstants.OBJECT_ID_USER,
    /*
     * Per sim frame, not per second.
     *
     * 09-live-values chose `SECOND` because "a value that updates 60 times a
     * second is harder to read than one that updates once", which is true of a
     * number being read and false of a control surface being dragged — and the
     * latter is what these are for. `L:` runs at 15 Hz end to end, so a second
     * of lag on `A:` also made two namespaces on one screen behave visibly
     * differently.
     *
     * The cost this reasoning was protecting against — a capture full of
     * near-identical readings — is handled where it belongs, by recording one
     * sample a second in the handler rather than by reading slowly.
     */
    simconnect.SimConnectPeriod.SIM_FRAME,
    // Tagged, so each value says which variable it is. See the handler.
    simconnect.DataRequestFlag.DATA_REQUEST_FLAG_TAGGED
  )
}
