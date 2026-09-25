/**
 * Whether a `get: B:` name reads the same value with and without its suffix.
 *
 * Open question 1 of docs/sim-vars/19-completion.md. FS Copilot reads a
 * `get: B:ID_Set` as calculator code — its module wraps the name as
 * `(B:ID_Set, Number)` and runs `execute_calculator_code` — and passes the
 * name through untouched, so `B:ID` and `B:ID_Set` are two watches under two
 * names. Whether the simulator answers them alike is the simulator's business,
 * and completion has to know which to offer first.
 *
 * Each read goes through the sim module's `exec`, which is the same call FS
 * Copilot's module makes, and is judged against `getInputEvent` on the ID's
 * hash — the input event's own value, which nothing about spelling can bend.
 * Four spellings per ID:
 *
 *   (B:ID, Number)          the bare ID, as 62 corpus reads write it
 *   (B:ID_Set, Number)      the generated operation 216 corpus gets use
 *   (B:ID_Toggle, Number)   another generated operation
 *   (B:ID_Bogus, Number)    a suffix nothing defines — the control. If this
 *                           tracks too, the suffix is ignored and proves nothing
 *
 * Read-only: calculator code that only reads, and `getInputEvent`. Needs the
 * sim module installed and the aircraft loaded; safe beside the app.
 *
 *   npm run sim:probe-reads -- snapshot           every ID, once, unattended
 *   npm run sim:probe-reads -- move <ID> [secs]   one control, while you work it
 *
 * `snapshot` is informative only where a control is not at zero, and it says
 * how many were. `move` is the decisive one: it needs somebody at the
 * controls, so it refuses to run without a terminal to arm it from, and it
 * calls a run in which the reference never changed inconclusive rather than a
 * result.
 */

import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import {
  ClientDataPeriod,
  open,
  Protocol,
  type InputEventDescriptor,
  type RecvEnumerateInputEvents,
  type RecvGetInputEvent,
  type SimConnectConnection,
} from "node-simconnect"

import {
  formatLinkCommand,
  LINK_AREA_BYTES,
  LINK_CMD,
  LINK_OUT,
  parseExecLine,
  parseLinkMessage,
} from "../src/shared/link.ts"

const OUT_DIR =
  process.env.FSCE_PROBE_OUT ?? join(process.env.TEMP ?? ".", "fsc-b-probe")

const SUFFIXES = ["", "_Set", "_Toggle", "_Bogus"] as const
type Suffix = (typeof SUFFIXES)[number]

/** Client data ids for this connection; the module answers every client. */
const AREA = { CMD: 0xe100, OUT: 0xe101 }
const ENUMERATE_REQ = 1
const READ_BASE = 10_000

/** An exec the module has not answered in this long is recorded as lost. */
const EXEC_TIMEOUT_MS = 1_000

const args = process.argv.slice(2).filter((arg) => arg !== "--")
const phase = args[0] ?? ""

if (phase !== "snapshot" && phase !== "move") {
  console.error(
    "Usage: npm run sim:probe-reads -- snapshot\n" +
      "       npm run sim:probe-reads -- move <INPUT_EVENT_ID> [seconds]"
  )
  process.exit(1)
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

/** See `arm` in probe-input-events.ts: an empty chair reads like a result. */
async function arm(instruction: string): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error(
      `\n  This phase needs somebody at the controls, so it will not run` +
        `\n  unattended. Start it from your own terminal:` +
        `\n\n      npm run sim:probe-reads -- ${args.join(" ")}\n`
    )
    process.exit(1)
  }

  const { createInterface } = await import("node:readline/promises")
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  await rl.question(`\n  ${instruction}\n  Press Enter when you are ready. `)
  rl.close()
}

async function connect(): Promise<SimConnectConnection> {
  for (const protocol of [Protocol.SunRise, Protocol.KittyHawk]) {
    try {
      const { handle } = await open("fsc-b-read-probe", protocol)
      return handle
    } catch {
      // Try the older protocol before giving up.
    }
  }

  console.error("Could not connect. Is MSFS running and in a flight?")
  process.exit(1)
}

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

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
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

/**
 * The input event's own value, by hash — the reference every spelling is
 * judged against. Requests are numbered so a reply is attributable.
 */
function inputEventReader(handle: SimConnectConnection) {
  let next = READ_BASE
  const waiting = new Map<number, (value: number | string | null) => void>()

  handle.on("getInputEvent", (recv: RecvGetInputEvent) => {
    waiting.get(recv.requestID)?.(recv.value)
    waiting.delete(recv.requestID)
  })

  return (event: InputEventDescriptor): Promise<number | string | null> => {
    const id = next++
    return new Promise((resolve) => {
      waiting.set(id, resolve)
      handle.getInputEvent(id, event.inputEventIdHash)
      setTimeout(() => {
        if (waiting.delete(id)) resolve(null)
      }, EXEC_TIMEOUT_MS)
    })
  }
}

interface ExecResult {
  ok: boolean
  value: number
}

/**
 * Calculator code through the sim module, one at a time.
 *
 * Paced by the reply rather than fired in a burst: the command area is one
 * buffer, and a second write before the module has read the first would
 * replace it.
 */
async function execRunner(handle: SimConnectConnection) {
  let token = 1
  const waiting = new Map<number, (result: ExecResult | null) => void>()
  let hello = false

  handle.mapClientDataNameToID(LINK_OUT, AREA.OUT)
  handle.addToClientDataDefinition(AREA.OUT, 0, LINK_AREA_BYTES)
  handle.requestClientData(
    AREA.OUT,
    AREA.OUT,
    AREA.OUT,
    ClientDataPeriod.ON_SET,
    0,
    0,
    0,
    0
  )
  handle.mapClientDataNameToID(LINK_CMD, AREA.CMD)
  handle.addToClientDataDefinition(AREA.CMD, 0, LINK_AREA_BYTES)

  handle.on("clientData", (data) => {
    if (data.requestID !== AREA.OUT) return
    const message = parseLinkMessage(
      data.data.readBytes(LINK_AREA_BYTES).toString("utf8")
    )
    if (!message) return
    if (message.kind === "hello") hello = true
    if (message.kind !== "exec") return

    for (const line of message.lines) {
      const parsed = parseExecLine(line)
      if (!parsed) continue
      waiting.get(parsed.token)?.({ ok: parsed.ok, value: parsed.value })
      waiting.delete(parsed.token)
    }
  })

  const run = (code: string): Promise<ExecResult | null> => {
    const id = token++
    const line = formatLinkCommand({ name: "exec", token: id, code })
    if (line === null) return Promise.resolve(null)

    const payload = Buffer.alloc(LINK_AREA_BYTES)
    payload.write(line, 0, "utf8")

    return new Promise((resolve) => {
      waiting.set(id, resolve)
      handle.setClientData(AREA.CMD, AREA.CMD, 0, 0, LINK_AREA_BYTES, payload)
      setTimeout(() => {
        if (waiting.delete(id)) resolve(null)
      }, EXEC_TIMEOUT_MS)
    })
  }

  // A constant proves the module answers before anything is concluded from
  // its silence.
  await sleep(500)
  const check = await run("1")
  if (!check?.ok) {
    console.error(
      "\n  The sim module did not answer `exec 1`." +
        (hello ? "" : " No hello either — is it installed and loaded?") +
        "\n  Check with: npm run link:read -- exec 1\n"
    )
    process.exit(1)
  }

  return run
}

const code = (id: string, suffix: Suffix): string =>
  `(B:${id}${suffix}, Number)`

type Reading = Record<Suffix, ExecResult | null>

async function readSpellings(
  run: (code: string) => Promise<ExecResult | null>,
  id: string
): Promise<Reading> {
  const out = {} as Reading
  for (const suffix of SUFFIXES) out[suffix] = await run(code(id, suffix))
  return out
}

function describe(result: ExecResult | null): string {
  if (result === null) return "lost"
  return result.ok ? String(result.value) : "err"
}

function save(name: string, data: unknown): string {
  mkdirSync(OUT_DIR, { recursive: true })
  const path = join(OUT_DIR, `${name}.json`)
  writeFileSync(path, JSON.stringify(data, null, 2))
  return path
}

/**
 * Every ID once. Only IDs whose reference is non-zero can tell the spellings
 * apart — a control at rest reads 0 whichever way it is spelled — so those
 * are what the verdict counts; the zeros are reported only as a total.
 */
async function runSnapshot(handle: SimConnectConnection): Promise<void> {
  const events = await enumerate(handle)
  const readEvent = inputEventReader(handle)
  const run = await execRunner(handle)

  console.log(`\n  ${events.length} input events. Reading references…`)

  const references = new Map<string, number | string | null>()
  for (const event of events) references.set(event.name, await readEvent(event))

  const informative = events.filter((event) => {
    const value = references.get(event.name)
    return typeof value === "number" && value !== 0
  })

  // A table of zeros and a table of unanswered reads look the same in the
  // verdict below, and mean opposite things.
  const values = [...references.values()]
  console.log(
    `  references: ${values.filter((v) => v === null).length} unanswered, ` +
      `${values.filter((v) => v === 0).length} zero, ` +
      `${values.filter((v) => typeof v === "string").length} strings, ` +
      `${informative.length} away from zero`
  )
  console.log(`  Reading the four spellings of the ${informative.length}…`)

  const tally = Object.fromEntries(
    SUFFIXES.map((suffix) => [
      suffix,
      { equal: 0, different: 0, err: 0, lost: 0 },
    ])
  ) as Record<
    Suffix,
    { equal: number; different: number; err: number; lost: number }
  >

  const rows: Array<
    { id: string; reference: number | string | null } & Reading
  > = []

  for (const event of informative) {
    const reference = references.get(event.name)!
    const reading = await readSpellings(run, event.name)
    rows.push({ id: event.name, reference, ...reading })

    for (const suffix of SUFFIXES) {
      const result = reading[suffix]
      const bucket = tally[suffix]
      if (result === null) bucket.lost++
      else if (!result.ok) bucket.err++
      else if (result.value === reference) bucket.equal++
      else bucket.different++
    }
  }

  console.log(
    `\n  Against the input event's own value, over ${informative.length} IDs:\n`
  )
  console.log("  spelling            equal  different  err  lost")
  for (const suffix of SUFFIXES) {
    const t = tally[suffix]
    const label = `(B:ID${suffix})`.padEnd(18)
    console.log(
      `  ${label}  ${String(t.equal).padStart(5)}  ${String(t.different).padStart(9)}  ${String(t.err).padStart(3)}  ${String(t.lost).padStart(4)}`
    )
  }

  const odd = rows.filter((row) =>
    SUFFIXES.some((suffix) => {
      const result = row[suffix]
      return result?.ok && result.value !== row.reference
    })
  )
  if (odd.length) {
    console.log(`\n  Where a spelling disagreed (first 15):`)
    for (const row of odd.slice(0, 15))
      console.log(
        `    ${row.id}  ref ${row.reference}  ` +
          SUFFIXES.map((s) => `${s || "bare"}=${describe(row[s])}`).join("  ")
      )
  }

  const path = save("reads-snapshot", {
    at: new Date().toISOString(),
    events: events.length,
    informative: informative.length,
    tally,
    rows,
  })
  console.log(`\n  written to ${path}`)
}

/**
 * One control, sampled while somebody works it. A line is printed whenever
 * anything changes, so the transcript is the timeline; the verdict counts
 * agreement per sample, and refuses one if the reference never moved.
 */
async function runMove(handle: SimConnectConnection): Promise<void> {
  const id = args[1]
  const seconds = Number(args[2]) || 30
  if (!id) {
    console.error("  Name the input event ID: move <ID> [seconds]")
    process.exit(1)
  }

  const events = await enumerate(handle)
  const event = events.find((e) => e.name === id)
  if (!event) {
    const near = events
      .map((e) => e.name)
      .filter((name) =>
        name.toLowerCase().includes(id.toLowerCase().slice(0, 8))
      )
      .slice(0, 10)
    console.error(
      `  ${id} is not one of this aircraft's ${events.length} input events.` +
        (near.length ? `\n  Near it: ${near.join(", ")}` : "")
    )
    process.exit(1)
  }

  const readEvent = inputEventReader(handle)
  const run = await execRunner(handle)

  await arm(
    `Watching ${id} for ${seconds}s. Work that control in the cockpit — ` +
      `several times, through every position it has — until the timer ends.`
  )

  const samples: Array<
    { t: number; reference: number | string | null } & Reading
  > = []
  const started = Date.now()
  let last = ""

  console.log(
    `\n  t(s)   reference   ${SUFFIXES.map((s) => (s || "bare").padEnd(8)).join(" ")}`
  )

  while (Date.now() - started < seconds * 1000) {
    const reference = await readEvent(event)
    const reading = await readSpellings(run, id)
    const t = (Date.now() - started) / 1000
    samples.push({ t, reference, ...reading })

    const line = [
      String(reference),
      ...SUFFIXES.map((s) => describe(reading[s])),
    ].join(" ")
    if (line !== last) {
      console.log(
        `  ${t.toFixed(1).padStart(5)}  ${String(reference).padEnd(10)}  ` +
          SUFFIXES.map((s) => describe(reading[s]).padEnd(8)).join(" ")
      )
      last = line
    }
  }

  const distinct = new Set(samples.map((s) => String(s.reference)))
  console.log(
    `\n  ${samples.length} samples, ${distinct.size} distinct reference values.`
  )

  if (distinct.size < 2) {
    console.log(
      "  Inconclusive: the input event never changed, so nothing here can tell" +
        "\n  the spellings apart. Work the control during the window and run again."
    )
  } else {
    console.log("\n  spelling            agrees with the reference")
    for (const suffix of SUFFIXES) {
      const agree = samples.filter(
        (s) => s[suffix]?.ok && s[suffix]!.value === s.reference
      ).length
      const label = `(B:ID${suffix})`.padEnd(18)
      console.log(`  ${label}  ${agree} of ${samples.length}`)
    }
  }

  const path = save(`reads-move-${id}`, {
    at: new Date().toISOString(),
    id,
    seconds,
    distinctReferences: distinct.size,
    samples,
  })
  console.log(`\n  written to ${path}`)
}

const handle = await connect()

// Which aeroplane the record is about, since the answer may differ by vendor.
handle.on("systemState", (state) => {
  if (state.requestID !== 2 || !state.dataString) return
  const parts = state.dataString.split(/[\\/]/).filter(Boolean)
  const at = parts.findIndex((part) => part.toLowerCase() === "airplanes")
  console.log(`  aircraft: ${at >= 0 ? parts[at + 1] : state.dataString}`)
})
handle.requestSystemState(2, "AircraftLoaded")

if (phase === "snapshot") await runSnapshot(handle)
else await runMove(handle)
handle.close()
process.exit(0)
