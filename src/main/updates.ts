import { app } from "electron"
import electronUpdater from "electron-updater"

import type { About, ManualCheck, UpdateState } from "@shared/types"

import { log } from "./log"

/**
 * Keeping the app up to date, and deciding when there is anything to say
 * about it.
 *
 * The design this implements is in docs/pipeline/06-updater.md. Two things
 * about it shape this file:
 *
 * - **Downloading is silent.** `autoDownload` is left on, and nothing is
 *   published while a check is in flight or an update is merely *available*.
 *   The user hears about an update — an icon beside the app menu's name —
 *   when restarting into it would take two seconds, not when a hundred
 *   megabytes might be about to arrive.
 * - **A failed check is not news.** Every failure below is a log line and a
 *   retry on the next cycle. Nothing that goes wrong here is worth a dialog,
 *   because nothing the user could do about it is a thing they would want to
 *   be interrupted for.
 *
 * `autoInstallOnAppQuit` is also left on, which means somebody who never
 * restarts from the app menu still gets the update the next time they close the
 * app normally. The menu is the *now* path, not the only one.
 */

// electron-updater is CommonJS, and `autoUpdater` is a property of the default
// export rather than a named one. Destructuring it at the top is what keeps
// every call site from repeating that.
const { autoUpdater } = electronUpdater

/** First check after the window has settled, then every four hours. */
const FIRST_CHECK_MS = 10_000
const EVERY_MS = 4 * 60 * 60 * 1000

/**
 * How long a download has to be in flight before it is worth drawing.
 *
 * A blockmap diff is often a few megabytes, which on a decent connection is
 * under a second — and a progress ring that appears and vanishes reads as a
 * glitch rather than as information. This only ever *suppresses*: it never
 * holds the ring on screen after the work is done, so a fast update simply
 * goes straight to the restart row with nothing before it.
 *
 * It lives here rather than in the renderer because the state this module
 * publishes is already "what there is to say", and a second opinion about that
 * in the component would be two places to look when the answer is wrong.
 */
const RING_AFTER_MS = 400

type Listener = (state: UpdateState) => void

let sink: Listener | null = null
let state: UpdateState = { kind: "idle" }
let showRingAt: NodeJS.Timeout | undefined
let downloading = false

export function onUpdateState(next: Listener): void {
  sink = next
}

export function updateState(): UpdateState {
  return state
}

function publish(next: UpdateState): void {
  if (next.kind === state.kind && next.kind !== "downloading") return

  state = next
  sink?.(state)
}

/**
 * Why this machine will never be offered an update.
 *
 * Both cases are honest dead ends rather than failures. A portable build has
 * no installer to replace, and a development run has no packaged app to
 * replace it with — electron-updater refuses both, and asking it anyway would
 * only produce errors in the log that look like something is broken.
 */
export function updatesUnavailable(): "portable" | "development" | null {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return "portable"
  if (!app.isPackaged) return "development"
  return null
}

function clearRingTimer(): void {
  if (showRingAt === undefined) return

  clearTimeout(showRingAt)
  showRingAt = undefined
}

export function watchUpdates(): void {
  const unavailable = updatesUnavailable()
  if (unavailable) {
    log("app", "debug", "update-skip", `Updates are off in a ${unavailable} build.`)
    return
  }

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  // electron-updater's own logger writes to a file this app does not own. Its
  // failures belong in the log the debug report already collects.
  autoUpdater.logger = null

  autoUpdater.on("update-available", (info: { version: string }) => {
    log("app", "info", "update-found", `Version ${info.version} is downloading.`)

    downloading = true
    clearRingTimer()
    showRingAt = setTimeout(() => {
      showRingAt = undefined
      if (downloading) publish({ kind: "downloading", percent: null })
    }, RING_AFTER_MS)
  })

  autoUpdater.on("download-progress", (progress: { percent?: number }) => {
    if (!downloading || showRingAt !== undefined) return

    const percent =
      typeof progress.percent === "number" && Number.isFinite(progress.percent)
        ? Math.max(0, Math.min(100, progress.percent))
        : null

    publish({ kind: "downloading", percent })
  })

  autoUpdater.on("update-downloaded", (info: { version: string }) => {
    downloading = false
    clearRingTimer()

    log("app", "info", "update-ready", `Version ${info.version} is ready to install.`)
    publish({ kind: "ready", version: info.version })
  })

  autoUpdater.on("update-not-available", () => {
    downloading = false
    clearRingTimer()
    publish({ kind: "idle" })
  })

  // Everything that can go wrong lands here: no network, a feed that 404s, a
  // checksum that does not match, a staging directory that cannot be written.
  // All of it is the same response — drop what was in flight, say so in the
  // log, and try again on the next cycle.
  autoUpdater.on("error", (error: Error) => {
    downloading = false
    clearRingTimer()

    log("app", "warn", "update-failed", "Checking for an update did not finish.", {
      message: error.message,
    })
    publish({ kind: "idle" })
  })

  setTimeout(check, FIRST_CHECK_MS)
  setInterval(check, EVERY_MS)
}

function check(): void {
  // Nothing to gain from checking while one is already staged: the answer
  // would be the same version, and `update-available` would restart a download
  // of something already on disk.
  if (state.kind === "ready" || downloading) return

  void autoUpdater.checkForUpdates().catch(() => {
    // Already reported through the error event above. Swallowed here so an
    // unhandled rejection does not reach the top level every four hours.
  })
}

/**
 * The manual check, from the app menu.
 *
 * Unlike the scheduled one this **answers its caller**. A check somebody asked
 * for is a question, and the honest response to "is there a new version" is not
 * silence — which is exactly what the ambient state gives, and correctly, since
 * nothing is worth interrupting an edit for. So the answer is returned rather
 * than published: the automatic path stays as quiet as it was.
 */
export async function checkForUpdatesNow(): Promise<ManualCheck> {
  if (updatesUnavailable()) return "unavailable"
  if (state.kind === "ready") return "ready"
  if (downloading) return "downloading"

  try {
    const result = await autoUpdater.checkForUpdates()
    // `downloadPromise` is present only when a download actually started,
    // which is the difference between "there is one" and "you have it".
    return result?.downloadPromise ? "downloading" : "up-to-date"
  } catch {
    // Already logged by the error handler above, which fires for this too.
    return "failed"
  }
}

/** Version, and why updating is or is not possible on this machine. */
export function about(): About {
  const unavailable = updatesUnavailable()

  return {
    version: app.getVersion(),
    updates: unavailable ?? "on",
  }
}

/**
 * Quit, install what was staged, and come back.
 *
 * Unsaved work is deliberately not a consideration: drafts are restored
 * against the file they were taken from (`main/drafts.ts`), so a restart loses
 * nothing and must not prompt. What *is* a consideration — a live Remote
 * Connect session — is handled by the menu row being disabled while one is
 * open.
 */
export function installUpdate(): void {
  if (state.kind !== "ready") return

  log("app", "info", "update-install", `Restarting into version ${state.version}.`)
  autoUpdater.quitAndInstall()
}
