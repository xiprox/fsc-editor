/**
 * The app, driven by a recorded simulator session instead of by MSFS.
 *
 * Captures accumulate in the Electron user-data folder every time the app is
 * connected to the sim. This script lists them, prints them, and replays one
 * into a running dev instance — which is the whole point of capturing in the
 * first place: getting MSFS into a flight, loading an aircraft and reaching a
 * switch is minutes of manual work that cannot be scripted, and the features
 * built on top of the event stream need to be rebuilt dozens of times an hour.
 *
 * The app itself does the replaying; this only chooses a file and sets
 * `FSCE_SIM_REPLAY`. Nothing here is a simulator stub — the events are real ones
 * that really happened, travelling the real path.
 *
 * Usage:
 *   npm run sim:sandbox                 list the captures
 *   npm run sim:sandbox -- 2            replay the third one, in real time
 *   npm run sim:sandbox -- 2 --speed 8  replay it eight times faster
 *   npm run sim:sandbox -- 2 --print    print it instead of replaying
 *   npm run sim:sandbox -- ./some.ndjson
 */

import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { CAPTURE_DIR, CAPTURE_EXT, type CapturedEvent } from "../src/shared/sim.ts"

const CAPTURES = join(homedir(), "AppData/Roaming/fsc-editor", CAPTURE_DIR)

const args = process.argv.slice(2)
const printOnly = args.includes("--print")
const speedAt = args.indexOf("--speed")
const speed = speedAt >= 0 ? (args[speedAt + 1] ?? "1") : "1"
// `speedAt + 1` is the value belonging to `--speed`, and must not be mistaken
// for the capture. Guarded on `speedAt >= 0` because without the flag it is
// -1, and -1 + 1 is index 0 — which is where the capture usually is.
const speedValueAt = speedAt >= 0 ? speedAt + 1 : -1
const target = args.find(
  (arg, index) => !arg.startsWith("--") && index !== speedValueAt
)

function captures(): string[] {
  if (!existsSync(CAPTURES)) return []

  return readdirSync(CAPTURES)
    .filter((name) => name.endsWith(CAPTURE_EXT))
    .sort()
    .map((name) => join(CAPTURES, name))
}

/**
 * A one-line summary of a capture, read from the file rather than the name.
 *
 * Everything identifying a session is inside it — the `open` event is always
 * first and the aircraft arrives moments later — so a capture whose rename was
 * missed by a crash still describes itself here.
 */
function summarize(file: string): string {
  const events = readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as CapturedEvent]
      } catch {
        return []
      }
    })

  if (!events.length) return "empty"

  const aircraft = events.find((event) => event.kind === "aircraft")
  const list = events.find((event) => event.kind === "input-events")
  const inputs = events.filter((event) => event.kind === "input").length
  const seconds = Math.round((events.at(-1)!.t - events[0]!.t) / 1000)
  const size = Math.round(statSync(file).size / 1024)

  return [
    (aircraft?.kind === "aircraft" ? (aircraft.key ?? "?") : "no aircraft").padEnd(18),
    `${String(seconds).padStart(4)}s`,
    `${String(events.length).padStart(6)} events`,
    `${String(inputs).padStart(5)} fired`,
    `${String(list?.kind === "input-events" ? list.events.length : 0).padStart(4)} enumerated`,
    `${String(size).padStart(5)} KB`,
  ].join("  ")
}

function print(file: string): void {
  const start = { t: 0 }

  for (const line of readFileSync(file, "utf8").split("\n").filter(Boolean)) {
    let event: CapturedEvent
    try {
      event = JSON.parse(line) as CapturedEvent
    } catch {
      console.log("  <unparseable line>")
      continue
    }

    if (!start.t) start.t = event.t
    const at = `${((event.t - start.t) / 1000).toFixed(3).padStart(9)}s`

    switch (event.kind) {
      case "open":
        console.log(`${at}  open        ${event.app} ${event.appVersion} (${event.protocol})`)
        break
      case "aircraft":
        console.log(`${at}  aircraft    ${event.key}`)
        console.log(`${at}              ${event.path}`)
        break
      case "input-events":
        console.log(`${at}  enumerated  ${event.events.length} input events`)
        break
      case "input":
        console.log(`${at}  input       ${event.name} = ${event.value}`)
        break
      case "simvar":
        console.log(`${at}  simvar      ${event.name} = ${event.value} ${event.units}`)
        break
      case "link":
        console.log(
          `${at}  link        module ${event.version} (protocol ${event.protocol}), ${event.variables} variables`
        )
        break
      case "vars":
        console.log(`${at}  vars        ${event.names.length} names from id ${event.from}`)
        break
      case "var":
        console.log(`${at}  var         ${event.name} = ${event.value}`)
        break
      case "exec":
        console.log(
          `${at}  exec        #${event.token} ${event.ok ? "ok" : "err"} -> ${event.value}`
        )
        break
      case "mark":
        console.log(`${at}  mark        (hotkey)`)
        break
      case "closed":
        console.log(`${at}  closed      ${event.reason}`)
        break
      default: {
        // Exhaustiveness, so a new event kind is a compile error here rather
        // than a line this quietly skips. It skipped 304 of them once.
        const unhandled: never = event
        console.log(`${at}  ??          ${JSON.stringify(unhandled)}`)
      }
    }
  }
}

const children: ChildProcess[] = []

function shutDown(): void {
  for (const child of children) {
    if (child.pid === undefined || child.exitCode !== null) continue
    // Electron spawns helpers, so the whole tree goes.
    if (process.platform === "win32")
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
      })
    else child.kill("SIGTERM")
  }
}

process.on("SIGINT", () => {
  shutDown()
  process.exit(0)
})
process.on("exit", shutDown)

// ---- go ------------------------------------------------------------------

const found = captures()

if (!target) {
  if (!found.length) {
    console.log(
      [
        `No captures in ${CAPTURES}`,
        "",
        "One is written every time the app connects to the sim. Start MSFS,",
        "load a flight, start the app, and flip a few switches.",
      ].join("\n")
    )
    process.exit(0)
  }

  console.log(`${found.length} captures in ${CAPTURES}\n`)
  found.forEach((file, index) => {
    console.log(`  ${String(index).padStart(2)}  ${summarize(file)}`)
  })
  console.log("\nReplay one:  npm run sim:sandbox -- <number>")
  process.exit(0)
}

const file = /^\d+$/.test(target) ? found[Number(target)] : target

if (!file || !existsSync(file)) {
  console.error(`No such capture: ${target}`)
  process.exit(1)
}

if (printOnly) {
  print(file)
  process.exit(0)
}

console.log(`Replaying ${file} at ${speed}×\n`)

children.push(
  spawn("npx electron-vite dev --watch", {
    shell: true,
    stdio: "inherit",
    env: {
      ...process.env,
      FSCE_SIM_REPLAY: file,
      FSCE_SIM_REPLAY_SPEED: speed,
    },
  })
)
