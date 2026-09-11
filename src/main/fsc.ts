import { execFile, spawn } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

import type { FscInstance, FscMode, FscState, Workspace } from "@shared/types"

import { EXE } from "./detect"
import { log } from "./log"

const execFileAsync = promisify(execFile)

/**
 * Launching, stopping and watching FS Copilot itself.
 *
 * The title bar's launch controls live on top of this. Two facts shape it:
 *
 * - **Any running `FsCopilot.exe` counts, not only ones this app started.**
 *   People launch FS Copilot by hand all day, and a button that says "not
 *   running" while its window is on screen is a button nobody trusts again. So
 *   the state comes from the process list, and the children this app spawns are
 *   only an *earlier* source of the same fact — their exit event lands the
 *   moment it happens instead of at the next poll.
 *
 * - **FS Copilot has no single-instance guard**, and a normal and a `--dev`
 *   instance genuinely coexist. The launch controls deliberately do not offer
 *   that: `launchFsc` stops everything first, so "launch", "restart" and
 *   "switch mode" are all the same operation and there is no way to end up
 *   with two copilots fighting over one simulator by clicking the wrong thing.
 */

const POLL_MS = 5000

/** `installRoot\FsCopilot.exe` for the current workspace, or null. */
let exePath: string | null = null

let instances: FscInstance[] = []
let timer: NodeJS.Timeout | undefined

/**
 * When the last spawn or stop happened.
 *
 * A poll is a snapshot of the process list taken *before* it resolves, so one
 * that was in flight while a launch landed would publish a list without the new
 * pid and flick the UI back to "not running" for a poll interval. A result
 * older than the last mutation is stale and is dropped; the mutation runs its
 * own fresh poll anyway.
 */
let mutatedAt = 0

type Listener = (state: FscState) => void
let sink: Listener | null = null

export function onFscChange(next: Listener): void {
  sink = next
}

export function fscState(): FscState {
  return { instances }
}

function publish(next: FscInstance[]): void {
  const changed =
    next.length !== instances.length ||
    next.some(
      (instance, n) =>
        instances[n]?.pid !== instance.pid ||
        instances[n]?.mode !== instance.mode
    )

  instances = next
  if (changed) sink?.(fscState())
}

/**
 * The process list, or null when the query itself failed.
 *
 * The distinction matters: an empty list is a fact worth publishing, while a
 * failed PowerShell spawn publishing "nothing running" would flick every
 * control to its launch state for one poll interval.
 *
 * `Get-CimInstance` for the same reason `detect.ts` uses it — `wmic` is gone
 * from Windows 11 24H2 and `tasklist` cannot see a command line, which is the
 * only place `--dev` is written down.
 */
async function processList(): Promise<FscInstance[] | null> {
  if (process.platform !== "win32") return []

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `Get-CimInstance Win32_Process -Filter "Name='${EXE}'" | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`,
      ],
      { windowsHide: true, timeout: 15_000, maxBuffer: 1024 * 1024 }
    )

    const found: FscInstance[] = []
    for (const line of stdout.split(/\r?\n/)) {
      const match = /^(\d+)(?:\s(.*))?$/.exec(line.trim())
      if (!match) continue

      found.push({
        pid: Number(match[1]),
        // The one flag FS Copilot's Main() reads. Case-insensitive because it
        // compares OrdinalIgnoreCase, so a hand-typed shortcut with --DEV is a
        // dev instance whether or not it looks like one.
        mode: /--dev\b/i.test(match[2] ?? "") ? "dev" : "normal",
      })
    }
    return found
  } catch {
    return null
  }
}

async function poll(): Promise<void> {
  if (!exePath) return

  const started = Date.now()
  const found = await processList()
  if (found && started > mutatedAt) publish(found)
}

/**
 * Follows whichever workspace is current, like the file watcher does.
 *
 * Polling only runs while the workspace has an install to launch from — a bare
 * folder of profiles has nothing to watch, and the controls it would feed are
 * disabled anyway.
 */
export function watchFsc(workspace: Workspace | null): void {
  const next = workspace?.installRoot
    ? path.join(workspace.installRoot, EXE)
    : null
  if (next === exePath) return

  exePath = next
  clearInterval(timer)
  timer = undefined

  if (!exePath) {
    publish([])
    return
  }

  void poll()
  timer = setInterval(() => void poll(), POLL_MS)
}

/** `process.kill(pid, 0)` sends nothing; it only asks whether the pid exists. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Errors are swallowed on purpose: "no such process" means already done, and
 * "could not be terminated" is what the caller's liveness check is for.
 */
async function taskkill(pid: number, force: boolean): Promise<void> {
  const args = force
    ? ["/PID", String(pid), "/F"]
    : ["/PID", String(pid)]

  try {
    await execFileAsync("taskkill", args, { windowsHide: true, timeout: 10_000 })
  } catch {
    // Handled by the wait that follows.
  }
}

async function waitGone(pid: number, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!alive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return !alive(pid)
}

/**
 * Graceful first: `taskkill` without `/F` posts WM_CLOSE, which lets FS
 * Copilot run its shutdown instead of vanishing mid-write. Force is the
 * fallback for an instance that ignores it — hung, or minimized somewhere the
 * message cannot reach.
 */
async function stopPid(pid: number): Promise<void> {
  if (!alive(pid)) return

  await taskkill(pid, false)
  if (await waitGone(pid, 4000)) return

  log("app", "warn", "fsc", `pid ${pid} ignored close, forcing`)
  await taskkill(pid, true)
  await waitGone(pid, 2000)
}

/** Stops every running instance, whoever started it, and waits for the exit. */
export async function stopFsc(): Promise<void> {
  const targets = instances.map((instance) => instance.pid)
  if (targets.length === 0) return

  log("app", "info", "fsc", `stopping ${targets.length} instance(s)`)
  await Promise.all(targets.map((pid) => stopPid(pid)))

  mutatedAt = Date.now()
  publish(instances.filter((instance) => !targets.includes(instance.pid)))
  void poll()
}

/**
 * Stops whatever is running, then starts the executable beside the workspace
 * in the given mode. One operation on purpose — see the note at the top on why
 * two instances are never offered.
 */
export async function launchFsc(mode: FscMode): Promise<void> {
  const exe = exePath
  if (!exe) return

  await stopFsc()

  // Detached, with the install directory as cwd: FS Copilot resolves its
  // Definitions folder and logs relative to itself, and its lifetime is its
  // own — quitting this editor must not take the copilot down with it.
  const child = spawn(exe, mode === "dev" ? ["--dev"] : [], {
    cwd: path.dirname(exe),
    detached: true,
    stdio: "ignore",
  })

  child.once("error", (error) => {
    log("app", "error", "fsc", `launch failed: ${error.message}`)
  })

  const pid = child.pid
  if (pid === undefined) return

  child.unref()
  log("app", "info", "fsc", `launched pid ${pid}${mode === "dev" ? " --dev" : ""}`)

  mutatedAt = Date.now()
  publish([...instances, { pid, mode }])

  // The exit event beats the poll by up to POLL_MS, which is the difference
  // between a restart button that answers a crash and one that notices it.
  child.once("exit", () => {
    mutatedAt = Date.now()
    publish(instances.filter((instance) => instance.pid !== pid))
  })
}
