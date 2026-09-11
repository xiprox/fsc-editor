/**
 * Calibrates the evidence-tier rules against a running simulator, in numbers.
 *
 *   npm run lang:calibrate
 *
 * The tier's rules answer from the sim, so the only honest test of one is to
 * ask the sim — and until now that has meant loading an aeroplane, opening a
 * profile, and reporting what a squiggle looked like. That is how a real
 * defect hid on 2026-08-30: protocol 5 reported every not-yet-tried ref as
 * absent, so each `Z:` line flashed a warning for a frame. Nobody watching a
 * file could tell that from the rule simply being slow. This script prints it
 * as a transition count on the first run.
 *
 * What it does, with no app in the way: reads the configured Definitions
 * folder, collects every `get:` name the module can watch, hands the whole set
 * over at once, and records **every** mapping that comes back with the time it
 * arrived. Then it runs the real rule — `analyzeProfile` with a `RuleContext`
 * built from the settled verdicts — so the calibration data is the rule's own
 * output rather than a proxy for it.
 *
 * Machine-dependent by design, like the other sweeps: it needs a Definitions
 * folder and a running MSFS, which is why it is a script and not a vitest
 * file.
 *
 * Needs a protocol-6 module (0.7.0+). Under 5 the "not tried" state does not
 * exist on the wire and the settle report below would be meaningless, so it
 * says so and stops rather than printing numbers that read fine.
 */

import {
  createWriteStream,
  mkdirSync,
  readFileSync,
  readdirSync,
} from "node:fs"
import { dirname, join } from "node:path"

import { ClientDataPeriod, Protocol, open } from "node-simconnect"

import {
  LINK_AREA_BYTES,
  LINK_CMD,
  LINK_OUT,
  RESOLUTION_PROTOCOL,
  formatLinkCommand,
  packWatchAdds,
  parseLinkMessage,
  parseWatchedLine,
} from "../src/shared/link.ts"
import { scanEntries } from "../src/shared/profile/index.ts"
import { readOf } from "../src/shared/vars/index.ts"
import { analyzeProfile } from "../src/shared/analysis.ts"
import type { RuleContext } from "../src/shared/lang/index.ts"

// ------------------------------------------------------------- workspace

/**
 * The same folder the app has open. Restated rather than imported: every
 * script here reads on its own, and this is four lines.
 */
function workspaceRoot(): string {
  if (process.env.FSCE_WORKSPACE) return process.env.FSCE_WORKSPACE

  const appData =
    process.env.APPDATA ??
    join(process.env.USERPROFILE ?? "", "AppData/Roaming")
  const settings = JSON.parse(
    readFileSync(join(appData, "fsc-editor/settings.json"), "utf8")
  ) as { workspaceRoot?: string }

  if (!settings.workspaceRoot) throw new Error("no workspace configured")
  return settings.workspaceRoot
}

const root = workspaceRoot()
const files = readdirSync(root).filter((name) => /\.ya?ml$/i.test(name))

/** Where each watchable name is written, so a verdict can name its lines. */
const sites = new Map<string, string[]>()

for (const file of files) {
  const text = readFileSync(join(root, file), "utf8")
  for (const entry of scanEntries(file, text)) {
    // Only what the module reads by typed id. Plain `L:` is streamed and `A:`
    // goes through SimConnect, so neither ever enters a watch mapping.
    if (readOf(entry.name) !== "watch") continue
    const at = sites.get(entry.name) ?? []
    at.push(`${file}:${entry.at.get}`)
    sites.set(entry.name, at)
  }
}

const NAMES = [...sites.keys()].sort()

// ------------------------------------------------------------ transcript

const TRANSCRIPT = join(
  import.meta.dirname,
  "..",
  "link",
  "transcripts",
  `${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-calibrate.txt`
)
mkdirSync(dirname(TRANSCRIPT), { recursive: true })
const transcript = createWriteStream(TRANSCRIPT, { flags: "a" })

function say(line = ""): void {
  console.log(line)
  transcript.write(`${line}\n`)
}

say(`workspace: ${root}`)
const LINES = [...sites.values()].reduce((n, at) => n + at.length, 0)
say(
  `${files.length} profiles, ${NAMES.length} watchable get: names ` +
    `across ${LINES} lines`
)

if (NAMES.length === 0) {
  say("Nothing to calibrate: no Z:, E: or indexed L: get: line in the corpus.")
  process.exit(0)
}

// ------------------------------------------------------------ connection

/** Ours, and distinct from the app's and from `link:read`'s. */
const ID = { CMD: 0xe010, OUT: 0xe011 }

const describe = (error: unknown): string =>
  error instanceof AggregateError
    ? error.errors.map(describe).join("; ")
    : error instanceof Error
      ? error.message || error.name
      : String(error)

let conn
try {
  conn = await open("fsc-editor-link calibrate", Protocol.SunRise)
} catch (error) {
  say(`could not connect: ${describe(error)}`)
  say("is the sim running and in a flight?")
  process.exit(1)
}

const { handle } = conn

handle.on("systemState", (state) => {
  if (state.requestID !== 1 || !state.dataString) return
  const parts = state.dataString.split(/[\\/]/).filter(Boolean)
  const at = parts.findIndex((part) => part.toLowerCase() === "airplanes")
  say(`aircraft: ${at >= 0 ? parts[at + 1] : state.dataString}`)
})
handle.requestSystemState(1, "AircraftLoaded")

handle.on("exception", (recv) => {
  if (recv.exception === 31)
    say("  ! no client data area — the module is not running")
})

handle.mapClientDataNameToID(LINK_OUT, ID.OUT)
handle.addToClientDataDefinition(ID.OUT, 0, LINK_AREA_BYTES)
handle.requestClientData(
  ID.OUT,
  ID.OUT,
  ID.OUT,
  ClientDataPeriod.ON_SET,
  0,
  0,
  0,
  0
)

handle.mapClientDataNameToID(LINK_CMD, ID.CMD)
handle.addToClientDataDefinition(ID.CMD, 0, LINK_AREA_BYTES)

function send(line: string): void {
  const payload = Buffer.alloc(LINK_AREA_BYTES)
  payload.write(line, 0, "utf8")
  handle.setClientData(ID.CMD, ID.CMD, 0, 0, LINK_AREA_BYTES, payload)
}

// ------------------------------------------------------------- recording

/** One complete mapping, at the moment it arrived. */
interface Snapshot {
  at: number
  states: Map<string, boolean | null>
}

const snapshots: Snapshot[] = []
/** The states each name has been reported in, in order, without repeats. */
const history = new Map<string, (boolean | null)[]>()

let protocol: number | null = null
let started = 0
let lastAt = 0
let pending: Map<string, boolean | null> | null = null

handle.on("clientData", (data) => {
  if (data.requestID !== ID.OUT) return

  const message = parseLinkMessage(
    data.data.readBytes(LINK_AREA_BYTES).toString("utf8")
  )
  if (!message) return

  if (message.kind === "hello") {
    const [version, spoken] = (message.lines[0] ?? "").split(" ")
    protocol = Number(spoken)
    say(`module: ${version} protocol ${spoken}`)
    return
  }

  if (message.kind !== "watched") return

  const target = pending ?? new Map<string, boolean | null>()
  for (const line of message.lines) {
    const parsed = parseWatchedLine(line)
    if (parsed) target.set(parsed.name, parsed.resolved)
  }

  // A chunked mapping is one snapshot, not several: the module splits on the
  // 8 KB area, which is a fact about the wire and not about the aircraft.
  if (message.remaining > 0) {
    pending = target
    return
  }
  pending = null

  const at = Date.now() - started
  lastAt = Date.now()
  snapshots.push({ at, states: target })

  for (const [name, state] of target) {
    const seen = history.get(name) ?? []
    if (seen.length === 0 || seen[seen.length - 1] !== state) seen.push(state)
    history.set(name, seen)
  }

  let present = 0
  let absent = 0
  let untried = 0
  for (const state of target.values()) {
    if (state === null) untried += 1
    else if (state) present += 1
    else absent += 1
  }

  say(
    `  +${String(at).padStart(5)}ms  ${target.size} refs — ` +
      `${present} present, ${absent} absent, ${untried} not tried`
  )
})

// -------------------------------------------------------------------- run

/** Quiet for this long and the aircraft has said what it has to say. */
const SETTLE_MS = 2000
/** A module that never stops changing its mind still has to be reported on. */
const MAX_MS = 25_000

setTimeout(() => {
  if (protocol !== null && protocol < RESOLUTION_PROTOCOL) {
    say("")
    say(
      `module speaks protocol ${protocol}; resolution can only be believed ` +
        `from ${RESOLUTION_PROTOCOL}. Run \`npm run link:build\`, then restart ` +
        `the sim.`
    )
    process.exit(1)
  }

  say("")
  say(`watching ${NAMES.length} names:`)
  started = Date.now()
  lastAt = Date.now()

  send(formatLinkCommand({ name: "watch-reset" })!)
  for (const command of packWatchAdds(NAMES)) send(formatLinkCommand(command)!)
}, 500)

const timer = setInterval(() => {
  if (!started) return
  if (Date.now() - lastAt < SETTLE_MS && Date.now() - started < MAX_MS) return

  clearInterval(timer)
  report()
}, 250)

// ----------------------------------------------------------------- report

function report(): void {
  const last = snapshots[snapshots.length - 1]
  const final = last?.states ?? new Map<string, boolean | null>()

  say("")
  say(
    `settled after ${last?.at ?? 0}ms, ` +
      `${snapshots.length} mapping${snapshots.length === 1 ? "" : "s"}`
  )
  say("")

  say("verdicts:")
  for (const name of NAMES) {
    const state = final.get(name)
    const label =
      state === undefined
        ? "never reported"
        : state === null
          ? "NOT TRIED"
          : state
            ? "present"
            : "ABSENT"

    say(`  ${label.padEnd(14)} ${name}`)
    for (const site of sites.get(name) ?? []) say(`                 ${site}`)
  }

  /*
   * The invariant protocol 6 exists for.
   *
   * A ref reported absent and *then* present was never absent — that is the
   * module answering `watch-add` before the tick has looked, which the app
   * renders as a warning on correct code. The one thing here worth failing
   * over rather than printing.
   */
  const flashed = [...history.entries()].filter(([, seen]) =>
    seen.some((state, n) => state === false && seen.slice(n + 1).includes(true))
  )

  say("")
  if (flashed.length === 0) {
    say("PASS  no ref was called absent and later found present.")
  } else {
    say(`FAIL  ${flashed.length} ref(s) reported absent, then present:`)
    for (const [name, seen] of flashed) {
      const path = seen
        .map((state) => (state === null ? "?" : state ? "1" : "0"))
        .join(" -> ")
      say(`        ${name}: ${path}`)
    }
  }

  // -------------------------------------------------- the rule's own output

  const context: RuleContext = {
    refResolved: (name) => {
      const state = final.get(name)
      return state === undefined || state === null ? null : state
    },
  }

  say("")
  say("ref-unresolved, over the whole corpus:")

  let fired = 0
  for (const file of files) {
    const text = readFileSync(join(root, file), "utf8")
    for (const diagnostic of analyzeProfile(text, context)) {
      if (diagnostic.ruleId !== "ref-unresolved") continue
      fired += 1
      say(`  ${file}:${diagnostic.start.lineNumber}`)
    }
  }

  say(`  ${fired} line${fired === 1 ? "" : "s"} flagged`)
  say("")
  say(`Saved to ${TRANSCRIPT}`)

  process.exit(flashed.length === 0 ? 0 : 1)
}
