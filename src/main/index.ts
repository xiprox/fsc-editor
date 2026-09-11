import path from "node:path"
import { fileURLToPath } from "node:url"

import { app, BrowserWindow, Menu, nativeTheme, session, shell } from "electron"

import { TITLE_BAR_HEIGHT } from "@shared/types"

import { closeDatabase, initDatabase } from "./db"
import { registerIpc } from "./ipc"
import { captureConsole, captureCrashes } from "./log"
import { bindHotkeys, unbindHotkeys } from "./marks"
import { startSim, stopSim } from "./sim/session"

const preloadPath = fileURLToPath(
  new URL("../preload/index.cjs", import.meta.url)
)

const rendererUrl = process.env.ELECTRON_RENDERER_URL
const rendererFile = fileURLToPath(
  new URL("../renderer/index.html", import.meta.url)
)

/**
 * The colors the caption buttons open with, before the renderer has resolved
 * the real tokens and sent them over. Barely visible — the window is held back
 * until `ready-to-show`, by which point the correction has usually landed — but
 * a wrong guess here is a flash of the wrong palette, so it follows the OS the
 * same way the app's own default theme does.
 */
function initialTitleBarColors() {
  return nativeTheme.shouldUseDarkColors
    ? { color: "#101418", symbolColor: "#a0a8b0" }
    : { color: "#ffffff", symbolColor: "#5a6169" }
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1500,
    height: 1050,
    minWidth: 940,
    minHeight: 560,
    show: false,
    backgroundColor: "#101418",
    autoHideMenuBar: true,
    // The app draws its own title bar — the strip carrying the app name is the
    // one the window is dragged by. Windows still draws the caption buttons
    // into it, rather than the app drawing three of its own: these are the real
    // ones, so the maximize button still opens Snap Layouts on hover, the
    // hit-testing and hover states are the system's, and there is no
    // maximized/restored icon state to keep in sync.
    titleBarStyle: "hidden",
    titleBarOverlay: {
      ...initialTitleBarColors(),
      height: TITLE_BAR_HEIGHT,
    },
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  window.once("ready-to-show", () => window.show())

  // Devtools in every build, not only development. A packaged build has no
  // terminal and no menu bar, so without this the renderer's half of a bad
  // session is whatever a tester can describe in words. The debug report
  // carries main's half; this is the only thing that carries the other.
  //
  // Reload stays development-only. Ctrl+R is muscle memory from other editors
  // for things that are not "throw away what is on screen", and a packaged
  // build has no question it is the answer to.
  window.webContents.on("before-input-event", (_event, input) => {
    if (input.type !== "keyDown") return

    if (input.key === "F12") window.webContents.toggleDevTools()
    else if (!app.isPackaged && input.control && input.key.toLowerCase() === "r")
      window.webContents.reload()
  })

  // Nothing in this app should open a second window or navigate away.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: "deny" }
  })

  if (rendererUrl) void window.loadURL(rendererUrl)
  else void window.loadFile(rendererFile)

  return window
}

/**
 * Locked down only for the packaged app: the dev server needs inline scripts
 * and a websocket for HMR.
 */
function applyContentSecurityPolicy(): void {
  if (!app.isPackaged) return

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "img-src 'self' data:",
            "worker-src 'self' blob:",
            "connect-src 'self'",
          ].join("; "),
        ],
      },
    })
  })
}

void app.whenReady().then(() => {
  // The default menu is hidden anyway, and it owns accelerators the app wants
  // for itself — Ctrl+W closes a tab here, not the window. Reload is re-bound
  // above for development, devtools for every build.
  Menu.setApplicationMenu(null)

  // Before anything that might warn. Main's console otherwise reaches only a
  // terminal, which a packaged build does not have.
  captureConsole()

  // Beside it, and for the same reason: an uncaught throw in main reaches a
  // terminal a packaged build does not have, and a debug report collected
  // afterwards would have no trace of the one event that mattered.
  captureCrashes()

  applyContentSecurityPolicy()

  // Before the IPC that uses it. Alongside settings.json rather than inside the
  // workspace: what is known about a variable outlives any one folder of
  // profiles, and will soon include things learned from the simulator that have
  // nothing to do with a folder at all.
  initDatabase(path.join(app.getPath("userData"), "vars.db"))

  const window = createWindow()
  registerIpc(() => window)

  // After the IPC, so the first state change has somewhere to go. Deliberately
  // not awaited and unable to fail: 04-connection's first rule is that launch
  // is unchanged, and a user who never starts MSFS should not be able to tell
  // this line is here.
  startSim(app.getPath("userData"))

  // The hotkey is bound at launch rather than when the Activity panel opens:
  // the whole point of it is that it works while MSFS has focus and this window
  // is behind it, which includes the case where nobody has opened the panel
  // yet. Failure is reported through the panel, not here — see `marks.ts` on
  // what registration can and cannot tell us.
  bindHotkeys()

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

// WAL leaves a sidecar file behind; closing checkpoints it back into the
// database rather than leaving the next launch to recover it.
app.on("will-quit", () => {
  // The capture is a write stream; ending it here is what flushes the last
  // events and renames the file to name its aircraft. `stopSim` also writes any
  // sim evidence still queued, which is why it runs before the database closes.
  stopSim()
  // Electron does this on quit anyway; doing it explicitly keeps the pairing
  // visible next to the bind above.
  unbindHotkeys()
  closeDatabase()
})
