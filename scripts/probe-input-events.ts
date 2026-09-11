/**
 * What `B:` input events actually do, established rather than inferred.
 *
 * The 2026-09-03 probe recorded in `docs/sim-vars/build/v1-log.md` concluded
 * that `subscribeInputEvent` "is not a change feed" from five seconds of a
 * cold-and-dark A220 with nobody touching it. Silence from a static aeroplane
 * is what a change feed does, so that run could not tell "never reports" from
 * "nothing changed" — and `b-values-plan.md` chose polling on the strength of
 * it. This script runs the experiment that separates them: somebody moves a
 * control while it watches.
 *
 * Read-only. It enumerates, reads and subscribes; it never writes a value.
 * Safe to run beside the app, which holds its own connection.
 *
 * One phase per invocation, because the pacing is a person's: connect,
 * enumerate, do the phase, write the result, disconnect. Enumerating each time
 * costs a second and buys phases that can be run in any order, repeated when a
 * cockpit interaction did not go as planned, and read one at a time.
 *
 * Usage:
 *   npm run sim:probe -- enumerate        what the aeroplane declares
 *   npm run sim:probe -- params           what parameters each event takes
 *   npm run sim:probe -- read             getInputEvent across every event
 *   npm run sim:probe -- quiet [secs]     subscribed, hands off (default 10)
 *   npm run sim:probe -- move [secs]      subscribed, move controls (default 30)
 *
 * Each phase writes a JSON record to the results directory and prints the
 * summary that matters. `move` is the decisive one, and the only one whose
 * result depends on somebody working the cockpit — so it, and the `quiet`
 * baseline it is read against, refuse to run without a terminal to arm them.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  open,
  Protocol,
  type InputEventDescriptor,
  type RecvEnumerateInputEventParams,
  type RecvEnumerateInputEvents,
  type RecvException,
  type RecvGetInputEvent,
  type RecvSubscribeInputEvent,
  type SimConnectConnection,
} from "node-simconnect"

/** Where the raw records land, so a phase can be re-read without re-running. */
const OUT_DIR =
  process.env.FSCE_PROBE_OUT ??
  join(process.env.TEMP ?? ".", "fsc-b-probe")

/*
 * This client's own id space, unrelated to the app's `ENUMERATE_BASE`.
 *
 * Reads count up from well clear of the enumeration so a reply is always
 * attributable to one name — `RecvGetInputEvent` carries a requestID and no
 * hash, which is the whole reason the bookkeeping exists.
 */
const ENUMERATE_REQ = 1
const READ_BASE = 10_000

/** How long a phase waits for replies after the last request goes out. */
const REPLY_GRACE_MS = 3_000

type Phase = "enumerate" | "params" | "read" | "quiet" | "move"

interface Arrival {
  at: number
  name: string
  hash: string
  value: number | string
  /** What this event last read, before this arrival. */
  previous: number | string | null
  changed: boolean
}

const args = process.argv.slice(2)
const phase = (args[0] ?? "") as Phase
const seconds = Number(args[1]) || (phase === "move" ? 30 : 10)

if (!["enumerate", "params", "read", "quiet", "move"].includes(phase)) {
  console.error(
    "Usage: npm run sim:probe -- <enumerate|params|read|quiet|move> [seconds]"
  )
  process.exit(1)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Holds until the person running this is actually at the controls.
 *
 * `quiet` and `move` are worthless without a human: one needs the cockpit left
 * alone, the other needs it worked. A window that opens on a timer measures
 * whatever the aeroplane happened to be doing, and reads exactly like a real
 * result afterwards — which is how a first run of this produced forty seconds
 * of "nothing changed" from an empty chair.
 *
 * So it refuses to open one without a terminal to arm it from. Run these two
 * phases yourself; the read-only phases do not need this.
 */
async function arm(instruction: string): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error(
      `\n  This phase needs somebody at the controls, so it will not run` +
        `\n  unattended. Start it from your own terminal:` +
        `\n\n      npm run sim:probe -- ${args.join(" ")}\n`
    )
    process.exit(1)
  }

  const { createInterface } = await import("node:readline/promises")
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  await rl.question(`\n  ${instruction}\n  Press Enter when you are ready. `)
  rl.close()
}

function typeName(type: number): string {
  return type === 0 ? "DOUBLE" : type === 1 ? "STRING" : `UNKNOWN(${type})`
}

/** Connects, preferring the protocol MSFS 2024 answers on. */
async function connect(): Promise<SimConnectConnection> {
  for (const protocol of [Protocol.SunRise, Protocol.KittyHawk]) {
    try {
      const { handle } = await open("fsc-b-probe", protocol)
      return handle
    } catch {
      // Try the older protocol before giving up.
    }
  }

  console.error("Could not connect. Is MSFS running and in a flight?")
  process.exit(1)
}

/** The whole input-event table, once the chunks are in. */
async function enumerate(
  handle: SimConnectConnection
): Promise<InputEventDescriptor[]> {
  const all: InputEventDescriptor[] = []

  const done = new Promise<void>((resolve) => {
    handle.on("inputEventsList", (list: RecvEnumerateInputEvents) => {
      if (list.requestID !== ENUMERATE_REQ) return

      all.push(...list.inputEventDescriptors)
      if (list.entryNumber + list.arraySize >= list.outOf) resolve()
    })
  })

  handle.enumerateInputEvents(ENUMERATE_REQ)

  /*
   * Cleared on success, because `Promise.race` does not cancel the loser: a
   * bare `setTimeout(exit)` fires fifteen seconds into whatever phase is
   * running by then, and kills a watch window mid-flight.
   */
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("Enumeration did not complete in 15s.")),
      15_000
    )
  })

  try {
    await Promise.race([done, timeout])
  } catch (error) {
    console.error(`  ${(error as Error).message}`)
    process.exit(1)
  } finally {
    clearTimeout(timer)
  }

  return all
}

/** Logs every exception with its request id, so a failed read is attributable. */
function watchExceptions(handle: SimConnectConnection): RecvException[] {
  const seen: RecvException[] = []
  handle.on("exception", (e: RecvException) => seen.push(e))
  return seen
}

function save(name: string, data: unknown): string {
  mkdirSync(OUT_DIR, { recursive: true })
  const path = join(OUT_DIR, `${name}.json`)
  writeFileSync(path, JSON.stringify(data, null, 2))
  return path
}

/**
 * Phase: what the aeroplane declares about itself.
 *
 * The declared type per event is the honest answer to "can a value be a
 * string" — better evidence than sampling values, which only ever shows what
 * happened to be there.
 */
async function runEnumerate(handle: SimConnectConnection): Promise<void> {
  const events = await enumerate(handle)
  const strings = events.filter((e) => e.type === 1)
  const doubles = events.filter((e) => e.type === 0)
  const names = new Set(events.map((e) => e.name))

  console.log(`\n  events declared    ${events.length}`)
  console.log(`  distinct names     ${names.size}`)
  console.log(`  declared DOUBLE    ${doubles.length}`)
  console.log(`  declared STRING    ${strings.length}`)

  if (strings.length) {
    console.log(`\n  STRING events — the guard in step 5 is not hypothetical:`)
    for (const e of strings.slice(0, 40)) console.log(`    ${e.name}`)
    if (strings.length > 40) console.log(`    ... and ${strings.length - 40} more`)
  } else {
    console.log(`\n  No event on this aircraft declares a string value.`)
  }

  const path = save("enumerate", {
    at: new Date().toISOString(),
    count: events.length,
    distinct: names.size,
    events: events.map((e) => ({
      name: e.name,
      hash: e.inputEventIdHash.toString(),
      type: typeName(e.type),
    })),
  })

  console.log(`\n  written to ${path}`)
}

/**
 * Phase: what parameters each event accepts.
 *
 * The `move` phase established that some events latch — they carry a state
 * that changes and is worth a gutter hint — while others are momentary and
 * fire at a constant 0, for which a live value would be a lie. Watching an
 * aeroplane cannot classify a table of 464: somebody would have to touch every
 * one of them. This asks the simulator instead.
 */
async function runParams(handle: SimConnectConnection): Promise<void> {
  const events = await enumerate(handle)
  const exceptions = watchExceptions(handle)
  const params = new Map<string, string>()

  handle.on(
    "enumerateInputEventParams",
    (recv: RecvEnumerateInputEventParams) => {
      const hash = recv.inputEventIdHash.toString()
      params.set(hash, recv.value)
    }
  )

  console.log(`\n  asking ${events.length} events for their parameters...`)

  for (const event of events) {
    handle.enumerateInputEventParams(event.inputEventIdHash)
  }

  await sleep(REPLY_GRACE_MS * 2)

  const shapes = new Map<string, string[]>()
  for (const event of events) {
    const value = params.get(event.inputEventIdHash.toString())
    if (value === undefined) continue

    const list = shapes.get(value) ?? []
    list.push(event.name)
    shapes.set(value, list)
  }

  console.log(`\n  answered           ${params.size} / ${events.length}`)
  console.log(`  exceptions         ${exceptions.length}`)
  console.log(`  distinct shapes    ${shapes.size}`)

  const sorted = [...shapes.entries()].sort((a, b) => b[1].length - a[1].length)
  for (const [shape, names] of sorted.slice(0, 25)) {
    console.log(`\n  ${names.length} events with params: ${JSON.stringify(shape)}`)
    for (const name of names.slice(0, 4)) console.log(`      ${name}`)
    if (names.length > 4) console.log(`      ... and ${names.length - 4} more`)
  }

  const path = save("params", {
    at: new Date().toISOString(),
    asked: events.length,
    answered: params.size,
    exceptions: exceptions.length,
    byName: Object.fromEntries(
      events
        .map((e): [string, string | undefined] => [
          e.name,
          params.get(e.inputEventIdHash.toString()),
        ])
        .filter((pair): pair is [string, string] => pair[1] !== undefined)
    ),
  })

  console.log(`\n  written to ${path}`)
}

/**
 * Phase: ask every event for its value.
 *
 * Re-establishes the one finding of the original probe that was actually
 * tested, and records the received type alongside the declared one — a
 * mismatch between the two would matter more than either alone.
 */
async function runRead(handle: SimConnectConnection): Promise<void> {
  const events = await enumerate(handle)
  const exceptions = watchExceptions(handle)

  const byRequest = new Map<number, InputEventDescriptor>()
  const answers = new Map<string, { type: string; value: number | string }>()

  handle.on("getInputEvent", (recv: RecvGetInputEvent) => {
    const event = byRequest.get(recv.requestID)
    if (!event) return

    answers.set(event.name, { type: typeName(recv.type), value: recv.value })
  })

  console.log(`\n  asking ${events.length} events for a value...`)

  events.forEach((event, index) => {
    const requestId = READ_BASE + index
    byRequest.set(requestId, event)
    handle.getInputEvent(requestId, event.inputEventIdHash)
  })

  await sleep(REPLY_GRACE_MS)

  const silent = events.filter((e) => !answers.has(e.name))
  const received = [...answers.values()]
  const stringValues = received.filter((a) => typeof a.value === "string")

  console.log(`\n  answered           ${answers.size} / ${events.length}`)
  console.log(`  no reply           ${silent.length}`)
  console.log(`  exceptions         ${exceptions.length}`)
  console.log(`  string values      ${stringValues.length}`)

  if (silent.length) {
    console.log(`\n  Silent events:`)
    for (const e of silent.slice(0, 20)) console.log(`    ${e.name}`)
    if (silent.length > 20) console.log(`    ... and ${silent.length - 20} more`)
  }

  const path = save("read", {
    at: new Date().toISOString(),
    asked: events.length,
    answered: answers.size,
    exceptions: exceptions.length,
    values: Object.fromEntries(answers),
    silent: silent.map((e) => e.name),
  })

  console.log(`\n  written to ${path}`)
}

/**
 * Phases `quiet` and `move`, which differ only in what the person is doing.
 *
 * Subscribes to everything, records every arrival against the value the event
 * last had, and — for arrivals that changed — asks `getInputEvent` for the same
 * event so the two transports can be compared on the same value.
 */
async function runWatch(
  handle: SimConnectConnection,
  moving: boolean
): Promise<void> {
  const events = await enumerate(handle)
  const exceptions = watchExceptions(handle)

  await arm(
    moving
      ? `Get to the cockpit, powered up, with a hand on a control you mean to move.`
      : `Leave the cockpit alone — nothing touched for the whole window.`
  )

  const byHash = new Map<string, InputEventDescriptor>()
  for (const event of events) byHash.set(event.inputEventIdHash.toString(), event)

  const arrivals: Arrival[] = []
  const pendingReads = new Map<number, (value: number | string) => void>()
  let nextRequest = READ_BASE

  handle.on("getInputEvent", (recv: RecvGetInputEvent) => {
    const resolve = pendingReads.get(recv.requestID)
    if (!resolve) return

    pendingReads.delete(recv.requestID)
    resolve(recv.value)
  })

  /** One `getInputEvent` per event, collected into a snapshot. */
  async function sweep(): Promise<Map<string, number | string>> {
    const out = new Map<string, number | string>()

    for (const event of events) {
      const requestId = nextRequest++
      pendingReads.set(requestId, (value) => out.set(event.name, value))
      handle.getInputEvent(requestId, event.inputEventIdHash)
    }

    await sleep(REPLY_GRACE_MS)
    return out
  }

  /*
   * A full read either side of the window, which is what makes one run
   * decisive.
   *
   * Without it, "the subscription reported no change" and "nothing in the
   * cockpit moved" produce identical output, and the run cannot tell you which
   * happened. `before` versus `after` is the ground truth the subscription is
   * then scored against.
   */
  console.log(`\n  reading ${events.length} values before the window...`)
  const before = await sweep()
  console.log(`  read ${before.size}`)

  /** The running value, so an arrival is judged against the last one seen. */
  const last = new Map(before)

  handle.on("subscribeInputEvent", (recv: RecvSubscribeInputEvent) => {
    const hash = recv.inputEventIdHash.toString()
    const event = byHash.get(hash)
    if (!event) return

    const previous = last.get(event.name) ?? null
    const changed = previous !== null && previous !== recv.value

    arrivals.push({
      at: Date.now(),
      name: event.name,
      hash,
      value: recv.value,
      previous,
      changed,
    })

    last.set(event.name, recv.value)
  })

  for (const event of events) handle.subscribeInputEvent(event.inputEventIdHash)

  console.log(`\n  subscribed to ${events.length} events.`)
  if (moving) {
    console.log(`\n  >>> MOVE CONTROLS NOW — switches, knobs, levers, buttons.`)
    console.log(`  >>> Vary them: a toggle, a rotary, a guarded switch, a lever.`)
  } else {
    console.log(`\n  >>> HANDS OFF. Do not touch anything in the cockpit.`)
  }
  console.log(`  >>> Watching for ${seconds}s.\n`)

  const started = Date.now()
  for (let left = seconds; left > 0; left--) {
    await sleep(1_000)
    if (left % 5 === 0 || left <= 3) {
      process.stdout.write(`  ${left}s left — ${arrivals.length} arrivals\r`)
    }
  }

  const elapsed = (Date.now() - started) / 1_000

  console.log(`\n\n  reading ${events.length} values after the window...`)
  const after = await sweep()

  /** Ground truth: what the simulator says moved, whoever reported it. */
  const moved = [...before.entries()].filter(
    ([name, value]) => after.get(name) !== value
  )
  const reported = new Set(
    arrivals.filter((a) => a.changed).map((a) => a.name)
  )
  const missed = moved.filter(([name]) => !reported.has(name))
  const perName = new Map<string, Arrival[]>()
  for (const arrival of arrivals) {
    const list = perName.get(arrival.name) ?? []
    list.push(arrival)
    perName.set(arrival.name, list)
  }

  const changedNames = [...perName.entries()].filter(([, list]) =>
    list.some((a) => a.changed)
  )
  const tickerNames = [...perName.entries()].filter(
    ([, list]) => !list.some((a) => a.changed)
  )

  console.log(`\n\n  window             ${elapsed.toFixed(1)}s`)
  console.log(`  total arrivals     ${arrivals.length}`)
  console.log(`  events heard from  ${perName.size} / ${events.length}`)
  console.log(`  events that CHANGED value   ${changedNames.length}`)
  console.log(`  events that only ticked     ${tickerNames.length}`)
  console.log(`  exceptions         ${exceptions.length}`)

  if (changedNames.length) {
    console.log(`\n  Changed — the subscription reported a real movement:`)
    for (const [name, list] of changedNames.slice(0, 25)) {
      const changes = list.filter((a) => a.changed)
      const first = changes[0]
      console.log(
        `    ${name}` +
          `\n      ${String(first?.previous)} -> ${String(first?.value)}` +
          `  (${changes.length} change(s), ${list.length} arrival(s))`
      )
    }
    if (changedNames.length > 25) {
      console.log(`    ... and ${changedNames.length - 25} more`)
    }

  }

  /*
   * The verdict, stated only when the ground truth supports one.
   *
   * "No control moved" is a failed run, not a finding, and saying so is the
   * whole reason for the second sweep.
   */
  /*
   * Two independent kinds of evidence, because neither is sufficient alone.
   *
   * The endpoints catch a move the subscription slept through. The arrivals
   * catch a move the endpoints cannot see — a switch flipped and flipped back
   * reads identically either side, which is exactly what somebody toggling a
   * light does. An earlier version scored on endpoints alone and called eleven
   * observed transitions "nothing moved".
   */
  console.log(`\n  --- what moved ---`)
  console.log(`  reported by the subscription        ${reported.size}`)
  console.log(`  visible in the endpoints            ${moved.length}`)
  console.log(`  endpoint moves the subscription missed  ${missed.length}`)

  for (const [name, wasValue] of moved.slice(0, 25)) {
    const mark = reported.has(name) ? "caught " : "MISSED "
    console.log(`    ${mark} ${name}: ${String(wasValue)} -> ${String(after.get(name))}`)
  }
  if (moved.length > 25) console.log(`    ... and ${moved.length - 25} more`)

  if (!moving) return

  if (!reported.size && !moved.length) {
    console.log(
      `\n  NOTHING MOVED — this run proves nothing either way.` +
        `\n  Nothing was touched, or what was touched is not backed by an` +
        `\n  input event on this aircraft. Pick a different control and re-run.`
    )
  } else if (missed.length) {
    console.log(
      `\n  The subscription MISSED ${missed.length} change(s) the endpoints show.` +
        `\n  It cannot be the only read; a poll is needed to cover the gap.`
    )
  } else {
    console.log(
      `\n  The subscription reported ${reported.size} changed event(s) and missed none.` +
        `\n  It is a change feed. Polling is not required for updates.`
    )
  }

  if (tickerNames.length) {
    const rates = tickerNames.map(
      ([name, list]) => `${name} @ ${(list.length / elapsed).toFixed(1)} Hz`
    )
    console.log(`\n  Tickers (arrived, value never differed):`)
    for (const rate of rates.slice(0, 15)) console.log(`    ${rate}`)
    if (rates.length > 15) console.log(`    ... and ${rates.length - 15} more`)
  }

  const path = save(moving ? "move" : "quiet", {
    at: new Date().toISOString(),
    seconds: elapsed,
    subscribed: events.length,
    arrivals,
    changed: changedNames.map(([name]) => name),
    tickers: tickerNames.map(([name, list]) => ({
      name,
      hz: Number((list.length / elapsed).toFixed(2)),
    })),
    before: Object.fromEntries(before),
    after: Object.fromEntries(after),
    moved: moved.map(([name, was]) => ({
      name,
      was,
      now: after.get(name),
      caught: reported.has(name),
    })),
    exceptions: exceptions.length,
  })

  console.log(`\n  written to ${path}`)
}

const handle = await connect()

console.log(`\n  connected — phase "${phase}"`)

if (phase === "enumerate") await runEnumerate(handle)
else if (phase === "params") await runParams(handle)
else if (phase === "read") await runRead(handle)
else await runWatch(handle, phase === "move")

handle.close()
process.exit(0)
