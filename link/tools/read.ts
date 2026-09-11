/*
 * Watches what the Link module is saying, without launching the app.
 *
 * The Log panel shows the same stream and is the normal way to look at it. This
 * exists for the cases where the app is the thing in doubt, or is not running,
 * or where a transcript on disk is more useful than a scrolling panel — which is
 * most of them when the sim has to be restarted between attempts.
 *
 * It imports the wire format from `src/shared/link.ts` rather than restating it.
 * That file has no imports of its own precisely so this is possible: a second
 * copy of a format that already has to be written twice — once here in
 * TypeScript, once in C++ — is the copy that drifts.
 *
 *   npm run link:read                    watch the stream
 *   npm run link:read -- enumerate       walk the L: table again, from scratch
 *   npm run link:read -- rescan          walk on for names registered since
 *   npm run link:read -- exec "<code>"   run calculator code in the sim
 *   npm run link:read -- probe           smoke-test the typed variable API
 *   npm run link:read -- watch <names>   replace the watch set and listen —
 *                                        e.g. watch Z:AUDIO_Knob_Selector_1 "E:ZULU TIME"
 *
 * The last one is the setter path without the app in it: whatever the editor
 * would resolve a `set:` line to, this runs the same way through the same
 * module. `npm run link:read -- exec "1 (>L:Battery1Switch)"` should move the
 * switch in the cockpit.
 */

import fs from "node:fs"
import path from "node:path"

import { open, Protocol, ClientDataPeriod } from "node-simconnect"

import {
  formatLinkCommand,
  packWatchAdds,
  LINK_AREA_BYTES,
  LINK_CMD,
  LINK_OUT,
  parseExecLine,
  parseLinkMessage,
  parseNameLine,
  parseValueLine,
  type LinkCommand,
} from "../../src/shared/link.ts"

const ID = { CMD: 0xe000, OUT: 0xe001 }

// `npm run link:read -- enumerate` puts a bare "--" in argv; running the file
// directly does not. Filtering rather than indexing makes both spellings work.
const ARGS = process.argv.slice(2).filter((arg) => arg !== "--")
const NAME = ARGS[0] ?? "start"

/**
 * The token is a constant, and 1 is as good as any.
 *
 * Nothing here is correlating concurrent runs — one command per invocation —
 * and a fixed number makes a transcript comparable to the one beside it.
 */
const COMMANDS: LinkCommand[] =
  NAME === "exec"
    ? [{ name: "exec", token: 1, code: ARGS.slice(1).join(" ") }]
    : NAME === "watch"
      ? // `watch Z:Foo "E:ZULU TIME"` — replace the module's watch set and
        // keep listening, which is the whole verification loop for protocol 4:
        // the `watched` mapping should answer, then values as they move.
        [{ name: "watch-reset" }, ...packWatchAdds(ARGS.slice(1))]
      : [{ name: NAME as "start" | "stop" | "enumerate" | "rescan" | "probe" }]

const LINES = COMMANDS.map(formatLinkCommand)
if (LINES.some((line) => line === null)) {
  console.error(
    "that code cannot be sent: it is too long for the 8 KB area, or holds a NUL."
  )
  process.exit(1)
}

const TRANSCRIPT = path.join(
  import.meta.dirname,
  "..",
  "transcripts",
  `${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}-${NAME}.txt`
)

fs.mkdirSync(path.dirname(TRANSCRIPT), { recursive: true })
const transcript = fs.createWriteStream(TRANSCRIPT, { flags: "a" })

/** Prints, and keeps a copy — a session is worth more than scrollback. */
function say(line: string): void {
  console.log(line)
  transcript.write(`${line}\n`)
}

const describe = (error: unknown): string =>
  error instanceof AggregateError
    ? error.errors.map(describe).join("; ")
    : error instanceof Error
      ? error.message || error.name
      : String(error)

let conn
try {
  conn = await open("fsc-editor-link reader", Protocol.SunRise)
} catch (error) {
  console.error(`could not connect: ${describe(error)}`)
  console.error("is the sim running and in a flight?")
  process.exit(1)
}

const { handle, recvOpen } = conn
say(`connected to ${recvOpen.applicationName}`)

// Stamps the transcript with the aircraft, so a file says what it is a
// transcript *of*. A snap/delta pair once could not be read for want of this.
handle.on("systemState", (state) => {
  if (state.requestID !== 1 || !state.dataString) return

  const parts = state.dataString.split(/[\\/]/).filter(Boolean)
  const at = parts.findIndex((part) => part.toLowerCase() === "airplanes")
  say(`aircraft: ${at >= 0 ? parts[at + 1] : state.dataString}`)
})
handle.requestSystemState(1, "AircraftLoaded")

for (const line of LINES) say(`command: ${line!.split("\n").join(" | ")}`)
say("")

/*
 * An exception here is the answer rather than an error: defining bytes in an
 * area that does not exist is OUT_OF_BOUNDS, and an area that does not exist
 * means the module is not running.
 */
const EXCEPTION: Record<number, string> = {
  31: "OUT_OF_BOUNDS — the client data area does not exist, so the module is not running",
  20: "DATA_ERROR — the area exists but the size does not match",
  29: "DUPLICATE_ID — something else already claimed this id",
}

handle.on("exception", (recv) => {
  const known = EXCEPTION[recv.exception]
  say(`  ! exception ${recv.exception}${known ? ` — ${known}` : ""}`)
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

let names = 0
let values = 0
let execs = 0

handle.on("clientData", (data) => {
  if (data.requestID !== ID.OUT) return

  const raw = data.data.readBytes(LINK_AREA_BYTES).toString("utf8")
  const message = parseLinkMessage(raw)
  if (!message) {
    say("  <unparseable message>")
    return
  }

  if (message.kind === "hello") {
    say(`hello: ${message.lines[0] ?? "(empty)"}`)
    return
  }

  if (message.kind === "watched") {
    say(
      `watched: ${message.lines.length} mapped` +
        (message.remaining ? ` (${message.remaining} chunks left)` : "") +
        (message.lines[0] ? `  e.g. ${message.lines[0]}` : "")
    )
    return
  }

  if (message.kind === "probe") {
    // Verbatim, one per line: the payload is the answers, already worded for a
    // person, and the transcript is the deliverable.
    for (const line of message.lines) say(`probe: ${line}`)
    return
  }

  if (message.kind === "exec") {
    for (const line of message.lines) {
      const parsed = parseExecLine(line)
      execs++
      say(
        parsed
          ? `exec: #${parsed.token} ${parsed.ok ? "ok" : "err"} -> ${parsed.value}`
          : `exec: <unparseable> ${line}`
      )
    }
    return
  }

  if (message.kind === "names") {
    const parsed = message.lines
      .map(parseNameLine)
      .filter((entry) => entry !== null)
    names += parsed.length
    // One line per chunk rather than per name: enumeration is thousands of
    // names and printing each would bury everything that follows.
    say(
      `names: +${parsed.length} (${names} so far, ${message.remaining} chunks left)` +
        (parsed[0] ? `  e.g. L:${parsed[0].name}` : "")
    )
    return
  }

  const parsed = message.lines
    .map(parseValueLine)
    .filter((entry) => entry !== null)
  values += parsed.length
  say(
    `values: ${parsed.map((entry) => `${entry.id}=${entry.value}`).join(" ")}`
  )
})

function send(line: string): void {
  const payload = Buffer.alloc(LINK_AREA_BYTES)
  payload.write(line, 0, "utf8")
  handle.setClientData(ID.CMD, ID.CMD, 0, 0, LINK_AREA_BYTES, payload)
}

setTimeout(() => {
  for (const line of LINES) send(line!)
}, 500)

setTimeout(() => {
  // An `exec` that answered is a complete session: the module is not streaming
  // unless somebody said `start`, so silence afterwards is the normal case and
  // the advice below would be wrong.
  if (names === 0 && values === 0 && execs === 0) {
    say("")
    say("Nothing after 20s.")
    say("  exception 31 above  -> no area: the module is not running.")
    say("  a hello and nothing else -> it loaded, but is not streaming.")
    say("  neither -> it loaded and SimConnect_Open failed inside the sim.")
  }
}, 20_000)

process.on("SIGINT", () => {
  say("")
  say(
    `${names} names, ${values} value records${execs ? `, ${execs} exec replies` : ""}. ` +
      `Saved to ${TRANSCRIPT}`
  )
  process.exit(0)
})
