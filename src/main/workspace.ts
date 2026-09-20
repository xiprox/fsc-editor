import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { app, dialog, shell, type BrowserWindow } from "electron"

import type {
  DetectEvent,
  Workspace,
  WorkspacePick,
  WorkspaceSource,
} from "@shared/types"

import {
  detectWorkspaces,
  resolveChosenFolder,
  resolveFolder,
  type DetectDeps,
} from "./detect"

const SETTINGS_FILE = () => path.join(app.getPath("userData"), "settings.json")

interface Settings {
  workspaceRoot?: string
}

let current: Workspace | null = null

export function currentWorkspace(): Workspace {
  if (!current) throw new Error("No workspace selected")
  return current
}

async function readSettings(): Promise<Settings> {
  try {
    return JSON.parse(await fs.readFile(SETTINGS_FILE(), "utf8")) as Settings
  } catch {
    return {}
  }
}

async function writeSettings(settings: Settings): Promise<void> {
  await fs.mkdir(path.dirname(SETTINGS_FILE()), { recursive: true })
  await fs.writeFile(SETTINGS_FILE(), JSON.stringify(settings, null, 2), "utf8")
}

/**
 * The Electron half of detection: reading a `.lnk`, and the shell folders,
 * which OneDrive may have moved somewhere other than where their names suggest.
 */
function detectDeps(): DetectDeps {
  const folder = (name: "desktop" | "documents" | "downloads") => {
    try {
      return app.getPath(name)
    } catch {
      return path.join(os.homedir(), name)
    }
  }

  return {
    readShortcut: (lnkPath) => {
      try {
        return shell.readShortcutLink(lnkPath).target || null
      } catch {
        // Not a shortcut, unreadable, or not Windows at all.
        return null
      }
    },
    folders: {
      desktop: folder("desktop"),
      documents: folder("documents"),
      downloads: folder("downloads"),
    },
  }
}

/**
 * The search currently running, so a second start can call the first one off.
 *
 * A setup screen that mounts twice — React in development does exactly this —
 * would otherwise leave a folder walk grinding through every disk with nobody
 * listening to it.
 */
let running: AbortController | null = null

/**
 * Everything a run says is stamped with the id its caller chose.
 *
 * There is deliberately no "is this still the current run?" check here. An
 * abandoned run keeps unwinding after `abort()`, and the promise microtasks
 * that carry it to its `finally` all drain before the next IPC message
 * arrives — so at the moment the stale `done` is emitted, the replacement run
 * has not been registered yet and any such check would wave it through. The
 * renderer knows which search it started; it filters.
 */
export function startDetect(
  runId: number,
  emit: (event: DetectEvent) => void
): void {
  running?.abort()

  const controller = new AbortController()
  running = controller

  void detectWorkspaces(
    detectDeps(),
    (event) => emit({ ...event, runId }),
    controller.signal
  )
    .catch(() => {})
    .finally(() => {
      if (running === controller) running = null
    })
}

/** Gives up early. The run still reports `done`, which is how the UI settles. */
export function stopDetect(): void {
  running?.abort()
}

/**
 * The workspace a session starts with: an explicit override, or the folder the
 * user settled on last time.
 *
 * Deliberately does no detecting. This used to run the process query on every
 * launch — including the overwhelming majority that already knew where the
 * folder was — and spawning PowerShell before the window can decide what to
 * draw is a hitch on a path that should have none. Finding a folder is setup's
 * job, and setup is the one screen that can afford to wait.
 *
 * Both attempts go through `resolveChosenFolder` rather than `resolveFolder`,
 * because both *are* chosen folders — one typed into an environment variable,
 * one accepted on this screen already. The strict rule here would send someone
 * who adopted a blank folder yesterday, and has not saved a profile into it
 * yet, back to setup on every launch until they did.
 */
export async function locateWorkspace(): Promise<Workspace | null> {
  const attempts: Array<[WorkspaceSource, string | undefined]> = [
    ["env", process.env.FSCE_WORKSPACE],
    ["saved", (await readSettings()).workspaceRoot],
  ]

  for (const [source, candidate] of attempts) {
    if (!candidate) continue

    const resolved = await resolveChosenFolder(candidate)
    if (!resolved) continue

    current = { ...resolved, source }
    return current
  }

  return null
}

/**
 * Takes a folder the user accepted, and remembers it.
 *
 * Re-resolved here rather than taken on trust. The path arrives from the
 * renderer, which got it from a detection that may be minutes old by the time
 * anybody clicked the button, and a folder that has since moved should fail
 * like a bad folder rather than become the workspace.
 *
 * `chosen` says which of the two rules to re-resolve under. A row in setup's
 * list is detection's own offer and is held to detection's rule; a folder from
 * the native picker was navigated to by hand, and an empty one is somebody
 * starting a profile from scratch. See `resolveChosenFolder`.
 */
export async function adoptWorkspace(
  dir: string,
  chosen = false
): Promise<Workspace | null> {
  const resolved = chosen
    ? await resolveChosenFolder(dir)
    : await resolveFolder(dir)
  if (!resolved) return null

  current = { ...resolved, source: "manual" }
  await writeSettings({ workspaceRoot: resolved.root })
  return current
}

export async function chooseWorkspace(
  window: BrowserWindow
): Promise<WorkspacePick> {
  const result = await dialog.showOpenDialog(window, {
    // Not "your FSC folder" any more: a new, empty folder is a valid answer
    // now, and somebody starting from scratch does not have an FSC folder to
    // be asked for. `createDirectory` is macOS-only and free here — Windows'
    // own folder picker already has *New folder* in it, which is the button
    // that makes the blank-workspace case work at all.
    title: "Choose a folder for your profiles",
    buttonLabel: "Use this folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: current?.installRoot ?? current?.root,
  })

  const picked = result.filePaths[0]
  if (result.canceled || !picked) return { ok: false, reason: "canceled" }

  const workspace = await adoptWorkspace(picked, true)

  // Rejection travels back as a value. The screen that asked for this folder is
  // already explaining what one looks like, and a native alert on top of that
  // explanation would be saying it again, worse, in a box you have to dismiss.
  return workspace
    ? { ok: true, workspace }
    : { ok: false, reason: "no-profiles", path: picked }
}
