/**
 * Who else is connected to the simulator's debugger, and closing them.
 *
 * The sim allows one inspector client per document and refuses the second, so
 * a panel the scan could not read is a panel something else has open — almost
 * always the Coherent GT debugger from the SDK, left running on a panel from
 * an earlier session. The sim will not say who; Windows will. `netstat` lists
 * every established connection to the port with the process that owns it, in
 * about 30 ms, and `tasklist` puts a name to the pid.
 *
 * This cannot say *which* panel a process holds, only that it holds some. That
 * is enough: the list is nearly always one process long.
 *
 * ## Closing is asked for, never assumed
 *
 * `closeHolder` ends somebody else's process, so it is narrow on purpose. It
 * takes a pid and believes nothing about it: the pid has to be holding a
 * connection to the port *now*, by this module's own reading, and it is never
 * the app or the simulator. It sends a close request rather than a kill —
 * `taskkill` without `/F` — which a debugger window honours and which leaves
 * anything with unsaved work the chance to say so.
 *
 * Apart from `scanPanels` so that file stays free of `child_process` and
 * stays something that can only read.
 */

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type { PanelHolder } from "../../shared/panels.ts"
import { INSPECTOR_PORT } from "./panels.ts"

const run = promisify(execFile)

const COMMAND_TIMEOUT_MS = 4000

/** Pids with an established connection *to* the port — clients, not the sim. */
async function clientPids(port: number): Promise<number[]> {
  const { stdout } = await run("netstat", ["-ano", "-p", "TCP"], {
    timeout: COMMAND_TIMEOUT_MS,
    windowsHide: true,
  })

  const pids = new Set<number>()
  for (const line of stdout.split(/\r?\n/)) {
    // `TCP  <local>  <remote>  ESTABLISHED  <pid>`. The remote end is the
    // port for a client; for the sim's side of the same connection it is the
    // local end, which is how the sim itself stays out of this list.
    const [protocol, , remote, state, pid] = line.trim().split(/\s+/)
    if (protocol !== "TCP" || state !== "ESTABLISHED") continue
    if (!remote?.endsWith(`:${port}`)) continue

    const id = Number(pid)
    if (Number.isInteger(id) && id > 0 && id !== process.pid) pids.add(id)
  }
  return [...pids]
}

async function nameOf(pid: number): Promise<string | null> {
  const { stdout } = await run(
    "tasklist",
    ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
    { timeout: COMMAND_TIMEOUT_MS, windowsHide: true }
  )
  return /^"([^"]+)"/.exec(stdout.trim())?.[1] ?? null
}

/** Never throws: not knowing who holds a panel is not a reason to fail a scan. */
export async function inspectorHolders(
  port = INSPECTOR_PORT
): Promise<PanelHolder[]> {
  try {
    const pids = await clientPids(port)
    const names = await Promise.all(pids.map((pid) => nameOf(pid)))

    return pids.flatMap((pid, index) => {
      const name = names[index]
      return name ? [{ pid, name }] : []
    })
  } catch {
    return []
  }
}

/** A lowercase fragment when it could not be done, null when it was asked. */
export async function closeHolder(
  pid: number,
  port = INSPECTOR_PORT
): Promise<string | null> {
  const holders = await inspectorHolders(port)
  const holder = holders.find((entry) => entry.pid === pid)

  if (!holder) return "it is no longer connected to the simulator"
  if (/^FlightSimulator/i.test(holder.name)) return "that is the simulator"

  try {
    await run("taskkill", ["/PID", String(pid)], {
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true,
    })
    return null
  } catch (error) {
    return closeRefusal(holder.name, stderrOf(error))
  }
}

function stderrOf(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr
  if (typeof stderr === "string" && stderr.trim()) return stderr
  return error instanceof Error ? error.message : String(error)
}

/**
 * `taskkill`'s own words, reduced to the part that is a reason.
 *
 * A close request goes to a window, so a process without one — a script, a
 * service — cannot be asked, and `taskkill` says so by recommending `/F`.
 * That is not taken up here: forcing an arbitrary process to end is a bigger
 * thing than this button is for, and whoever started a script knows how to
 * stop it.
 */
export function closeRefusal(name: string, stderr: string): string {
  if (/\/F\b/.test(stderr))
    return `${name} has no window to ask — end it yourself, then scan again`

  const reason = /Reason:\s*(.+)/i.exec(stderr)?.[1] ?? stderr
  const line = reason.trim().split(/\r?\n/)[0] ?? ""
  return line ? line.charAt(0).toLowerCase() + line.slice(1) : "taskkill failed"
}
