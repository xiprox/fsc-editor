/**
 * Two instances of the app and a local relay, for trying Remote Connect without
 * a second machine.
 *
 * Each instance gets its own copy of a Definitions folder and its own Electron
 * user-data directory, so neither can reach the real one — the app remembers the
 * last workspace it opened, and pointing a throwaway instance at a sandbox would
 * otherwise leave that as your saved choice.
 *
 * The two copies are seeded to differ in every way the panel can show, including
 * one written LF and the other CRLF, so the file list has something to say the
 * moment you connect.
 *
 * Both instances run against the dev server rather than a production build. The
 * host is a plain `electron-vite dev`; the guest is a second Electron pointed at
 * the same renderer URL, so edits to the renderer hot-reload in both windows.
 * A change to main or preload rebuilds and restarts only the host — restart the
 * script to pick it up in the guest.
 *
 * Usage: npm run remote:sandbox [path to a Definitions folder]
 */

import { spawn, type ChildProcess } from "node:child_process"
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

const RELAY_PORT = 8787
const SANDBOX = resolve(import.meta.dirname, "..", ".sandbox")

const args = process.argv.slice(2)
const explicitRoot = args.find((arg) => !arg.startsWith("--"))

/** The same folder the app itself would find, without asking the app. */
function findDefinitions(): string {
  const saved = () => {
    try {
      const file = join(homedir(), "AppData/Roaming/fsc-editor/settings.json")
      return (
        JSON.parse(readFileSync(file, "utf8")) as { workspaceRoot?: string }
      ).workspaceRoot
    } catch {
      return undefined
    }
  }

  const candidates = [explicitRoot, process.env.FSCE_WORKSPACE, saved()]

  for (const candidate of candidates) {
    if (!candidate) continue
    if (existsSync(candidate)) return candidate
    const nested = join(candidate, "Definitions")
    if (existsSync(nested)) return nested
  }

  throw new Error(
    "Could not find a Definitions folder. Pass one:\n" +
      '  npm run remote:sandbox -- "C:/path/to/FSCopilot/Definitions"'
  )
}

function profilesIn(dir: string, base = ""): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) return profilesIn(join(dir, entry.name), rel)
    return /\.ya?ml$/i.test(entry.name) ? [rel] : []
  })
}

/**
 * Builds the two workspaces.
 *
 * The host is written LF and the guest CRLF from the *same* text, so the only
 * difference between them is the line ending — which is the case that would make
 * every file look modified if the hashes were not normalized. Anything the panel
 * then marks as changed is a difference this script put there on purpose.
 */
function seed(source: string): {
  host: string
  guest: string
  notes: string[]
} {
  const host = join(SANDBOX, "host")
  const guest = join(SANDBOX, "guest")

  rmSync(SANDBOX, { recursive: true, force: true })
  cpSync(source, host, { recursive: true })
  cpSync(source, guest, { recursive: true })

  const files = profilesIn(host).filter((rel) => !rel.includes("/"))
  if (files.length < 2) throw new Error(`No profiles found in ${source}`)

  for (const rel of profilesIn(host)) {
    const text = readFileSync(join(host, rel), "utf8").replace(/\r\n?/g, "\n")
    writeFileSync(join(host, rel), text, "utf8")
    writeFileSync(join(guest, rel), text.replace(/\n/g, "\r\n"), "utf8")
  }

  const [onlyOnHost, changed] = files
  rmSync(join(guest, onlyOnHost))
  writeFileSync(
    join(guest, changed),
    readFileSync(join(guest, changed), "utf8") +
      "\r\n# A local edit, so this profile differs from the host's\r\n",
    "utf8"
  )
  writeFileSync(
    join(guest, "__only-here.yaml"),
    "# This one exists only on the guest\r\nshared:\r\n  - get: A:LIGHT POTENTIOMETER:1, percent\r\n    set: 100\r\n",
    "utf8"
  )

  return {
    host,
    guest,
    notes: [
      `+  ${onlyOnHost} — only the host has it`,
      `~  ${changed} — both have it, contents differ`,
      `−  __only-here.yaml — only the guest has it`,
      `   the other ${profilesIn(host).length - 2} are identical, despite LF vs CRLF`,
    ],
  }
}

const children: ChildProcess[] = []

function run(command: string, extra: NodeJS.ProcessEnv = {}): ChildProcess {
  const child = spawn(command, {
    shell: true,
    stdio: "inherit",
    env: { ...process.env, ...extra },
  })
  children.push(child)
  return child
}

/**
 * Starts `electron-vite dev` and resolves with the renderer dev server's URL,
 * which it prints only after main and preload are built — so by then there is
 * also an out/ for the second Electron to run.
 */
function runDev(extra: NodeJS.ProcessEnv): Promise<string> {
  const child = spawn("npx electron-vite dev --watch", {
    shell: true,
    stdio: ["inherit", "pipe", "inherit"],
    env: { ...process.env, ...extra },
  })
  children.push(child)

  return new Promise<string>((done, fail) => {
    const giveUp = setTimeout(
      () => fail(new Error("electron-vite printed no dev server URL")),
      120_000
    )

    child.stdout?.setEncoding("utf8")
    child.stdout?.on("data", (chunk: string) => {
      process.stdout.write(chunk)
      // Vite bolds the port, so the URL arrives with escapes inside it.
      const url = chunk
        .replace(/\u001b\[[0-9;]*m/g, "")
        .match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+/)
      if (!url) return
      clearTimeout(giveUp)
      done(url[0])
    })

    child.on("exit", (code) => {
      clearTimeout(giveUp)
      fail(new Error(`electron-vite exited (${code})`))
    })
  })
}

function shutDown(): void {
  for (const child of children) {
    if (child.pid === undefined || child.exitCode !== null) continue
    // Electron and wrangler both spawn helpers, so the whole tree goes.
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

const waitFor = (ms: number) => new Promise((done) => setTimeout(done, ms))

const source = findDefinitions()
console.log(`Copying ${source}`)
const { host, guest, notes } = seed(source)

console.log(`Starting the relay on :${RELAY_PORT}`)
run(`npx wrangler dev --config relay/wrangler.toml --port ${RELAY_PORT}`)

// Wrangler needs a moment to bind before an app tries to reach it. A failed
// first connect is not fatal — the client retries — but it is confusing to read.
await waitFor(4000)

const relay = `ws://127.0.0.1:${RELAY_PORT}`

console.log("Starting the host on the dev server…")
// electron-vite spawns Electron itself, and passes on whatever this holds.
const rendererUrl = await runDev({
  FSCE_WORKSPACE: host,
  FSCE_RELAY_URL: relay,
  ELECTRON_CLI_ARGS: JSON.stringify([
    `--user-data-dir=${join(SANDBOX, "host-data")}`,
  ]),
})

await waitFor(1200)

console.log(`Starting the guest against ${rendererUrl}`)
run(`npx electron . --user-data-dir="${join(SANDBOX, "guest-data")}"`, {
  FSCE_WORKSPACE: guest,
  FSCE_RELAY_URL: relay,
  // The same dev server as the host, so a renderer edit reaches both windows.
  ELECTRON_RENDERER_URL: rendererUrl,
})

console.log(
  [
    "",
    "Two windows are open. They are separate installs as far as the app knows.",
    "",
    `  host   ${host}`,
    `  guest  ${guest}`,
    `  relay  ${relay}`,
    `  dev    ${rendererUrl} — both windows, hot-reloading`,
    "",
    "In one window: open Remote Connect on the right, press Host, copy the code.",
    "In the other: press Connect and type it in.",
    "",
    "The guest's list should then show:",
    ...notes.map((line) => `  ${line}`),
    "",
    "Then try: click a changed row to open the diff, take a change with the ←",
    "arrow in the gutter, select a range and take just that, and turn Mirror on",
    "before saving an edit in the host window.",
    "",
    "Renderer edits hot-reload in both. A main or preload edit restarts only the",
    "host — rerun this script to give the guest the new one too.",
    "",
    "Ctrl+C here closes everything.",
    "",
  ].join("\n")
)
