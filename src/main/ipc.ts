import { app, dialog, ipcMain, shell, type BrowserWindow } from "electron"

import {
  TITLE_BAR_HEIGHT,
  type About,
  type DebugReport,
  type DiscardChoice,
  type FileContent,
  type FscMode,
  type FscState,
  type ManualCheck,
  type ProfileFile,
  type RestoredDraft,
  type TitleBarColors,
  type UpdateState,
  type VarIndex,
  type Workspace,
  type WorkspacePick,
} from "@shared/types"

import type { Hotkeys } from "@shared/types"
import type {
  ManifestEntry,
  Presence,
  RemoteState,
} from "@shared/remote-connect"
import type { LogEntry, LogLevel } from "@shared/log"
import type { SimState, SimVarWatch } from "@shared/sim"
import type { WatchedRef } from "@shared/link"
import type {
  RunResult,
  SetterBindings,
  SetterEntry,
  SetterPreview,
} from "@shared/setter"
import type { CaptureMode, Finding, HotkeyAction } from "@shared/activity"
import type { PanelScan } from "@shared/panels"
import type {
  CommunityFolder,
  LinkInstallResult,
  LinkInstallState,
  LinkUninstallResult,
} from "@shared/link-install"

import { clearAnchors, slice } from "./activity-buffer"
import { collectReport } from "./report"
import { closeHolder, inspectorHolders } from "./sim/panel-holders"
import { PanelSession } from "./sim/panel-session"
import { scanPanels } from "./sim/panels"
import { picksIn } from "./sim/picks"
import { runSetter } from "./sim/run"
import { resolveSetter } from "./sim/setter"
import {
  armFromHotkey,
  captureMode,
  captures,
  clearCaptures,
  noteInteraction,
  noteMark,
  onCaptureChange,
  setCaptureMode,
  watchAircraft,
} from "./activity-history"
import {
  bindHotkey,
  hotkeys,
  mark,
  onHotkey,
  onMark,
  resetMarks,
} from "./marks"
import { clearDraft, loadDrafts, saveDraft } from "./drafts"
import * as files from "./files"
import { fscState, launchFsc, onFscChange, stopFsc, watchFsc } from "./fsc"
import {
  about,
  checkForUpdatesNow,
  installUpdate,
  onUpdateState,
  updateState,
  watchUpdates,
} from "./updates"
import { resolveEntryInside, resolveInside } from "./paths"
import {
  describeCommunity,
  installLink,
  linkInstallState,
  uninstallLink,
  updateStaleLinks,
} from "./sim/install"
import { buildManifest } from "./remote-connect/manifest"
import * as remote from "./remote-connect/session"
import { clearLog, log, logBacklog, logDetail, onLogBatch } from "./log"
import { logSimEvent } from "./sim-log"
import * as sim from "./sim/session"
import { onWatchResolution, watchResolution } from "./sim/link"
import { onSimEnumeration } from "./sim/store"
import { scanVars, varIndex } from "./vars"
import { watchWorkspace, type Watcher } from "./watch"
import {
  adoptWorkspace,
  chooseWorkspace,
  currentWorkspace,
  locateWorkspace,
  startDetect,
  stopDetect,
} from "./workspace"

let watcher: Watcher | null = null

/**
 * Which aircraft is loaded, or null when nothing is.
 *
 * `SimState` is a union and only its live arm carries an aircraft, which is
 * the shape that keeps "not connected" from having to pretend it knows.
 */
function loadedAircraft(): string | null {
  const state = sim.simState()
  return state.phase === "live" ? (state.aircraft ?? null) : null
}

/**
 * Follows whichever workspace is current. Pointing the app at a different
 * folder replaces the watcher rather than adding a second one, so a session
 * that changes folders twice does not end up with three of them reporting.
 */
function watchCurrent(
  getWindow: () => BrowserWindow,
  workspace: Workspace | null
): void {
  watcher?.close()
  watcher = null

  // The launch controls follow the workspace the same way the watcher does: a
  // folder with no install beside it stops the process polling outright.
  watchFsc(workspace)

  if (!workspace) return

  watcher = watchWorkspace(workspace.root, (found) => {
    log("files", "debug", "changed", `${found.length} profiles on disk`)

    const window = getWindow()
    if (!window.isDestroyed()) window.webContents.send("files:changed", found)

    // The same rescan feeds the session. A host publishes what moved from here
    // rather than from `save()`, so an edit made in another editor, or by FS
    // Copilot itself, reaches the guests exactly like one made in this app.
    void remote.filesChanged(found)
  })
}

/**
 * The whole filesystem surface available to the renderer. Keeping it here — one
 * file, one channel per operation — means path validation has a single place to
 * live rather than being spread across the UI.
 */
export function registerIpc(getWindow: () => BrowserWindow): void {
  ipcMain.handle("workspace:locate", async (): Promise<Workspace | null> => {
    const workspace = await locateWorkspace()
    watchCurrent(getWindow, workspace)
    return workspace
  })

  ipcMain.handle("workspace:detect-start", (_event, runId: number): void =>
    startDetect(runId, (detect) => {
      const window = getWindow()
      if (!window.isDestroyed())
        window.webContents.send("workspace:detect", detect)
    })
  )

  ipcMain.handle("workspace:detect-stop", (): void => stopDetect())

  ipcMain.handle(
    "workspace:adopt",
    async (_event, root: string): Promise<Workspace | null> => {
      const workspace = await adoptWorkspace(root)
      if (workspace) watchCurrent(getWindow, workspace)
      return workspace
    }
  )

  ipcMain.handle("workspace:choose", async (): Promise<WorkspacePick> => {
    const pick = await chooseWorkspace(getWindow())
    // A cancelled dialog leaves the current workspace, and its watcher, alone.
    if (pick.ok) watchCurrent(getWindow, pick.workspace)
    return pick
  })

  /*
   * The FS Copilot launch controls. State is pushed the way `sim:state` is —
   * main recomputes and resends whenever it changes, and the one-shot read
   * covers a renderer that started after it did.
   */
  ipcMain.handle("fsc:state", (): FscState => fscState())

  ipcMain.handle("fsc:launch", (_event, mode: FscMode): Promise<void> =>
    launchFsc(mode)
  )

  ipcMain.handle("fsc:stop", (): Promise<void> => stopFsc())

  ipcMain.handle("update:state", (): UpdateState => updateState())
  ipcMain.handle("update:install", (): void => installUpdate())
  ipcMain.handle("update:check", (): Promise<ManualCheck> => checkForUpdatesNow())
  ipcMain.handle("app:about", (): About => about())

  onUpdateState((state) => {
    const window = getWindow()
    if (!window.isDestroyed()) window.webContents.send("update:state", state)
  })

  onFscChange((state) => {
    const window = getWindow()
    if (!window.isDestroyed()) window.webContents.send("fsc:state", state)
  })

  ipcMain.handle("files:list", (): Promise<ProfileFile[]> =>
    files.listFiles(currentWorkspace().root)
  )

  ipcMain.handle(
    "files:read",
    (_event, relPath: string): Promise<FileContent> =>
      files.readFile(currentWorkspace().root, relPath)
  )

  ipcMain.handle(
    "files:write",
    (_event, relPath: string, content: string): Promise<FileContent> =>
      files.writeFile(currentWorkspace().root, relPath, content)
  )

  ipcMain.handle(
    "files:confirm-discard",
    (_event, relPath: string): Promise<DiscardChoice> =>
      confirmDiscard(getWindow(), relPath)
  )

  /*
   * The three ways the sidebar changes the folder, and the one way it looks at
   * it. None of them tells the renderer what the workspace now contains: the
   * watcher is already the answer to that question, and a second one arriving
   * by another route is how two lists start to disagree.
   */
  ipcMain.handle(
    "files:reveal",
    async (_event, relPath: string): Promise<void> => {
      const { root } = currentWorkspace()
      const full = resolveEntryInside(root, relPath)

      // A folder opens; a profile is selected in the folder it lives in. Both are
      // "show me this in Explorer", and which one it means depends on what is
      // there rather than on which row was clicked.
      if (await files.isFolder(root, relPath)) await shell.openPath(full)
      else shell.showItemInFolder(full)
    }
  )

  ipcMain.handle(
    "files:rename",
    (_event, relPath: string, name: string): Promise<ProfileFile> =>
      files.renameFile(currentWorkspace().root, relPath, name)
  )

  ipcMain.handle(
    "files:duplicate",
    (_event, relPath: string): Promise<ProfileFile> =>
      files.duplicateFile(currentWorkspace().root, relPath)
  )

  /**
   * Deleting is the one thing here that cannot be undone from inside the app,
   * so it asks first and then goes to the Recycle Bin rather than to nothing.
   * Windows has no dialog to borrow for this — Explorer's confirmation belongs
   * to Explorer — so this is the same native message box the editor already
   * uses to ask about unsaved work.
   */
  ipcMain.handle(
    "files:delete",
    async (_event, relPath: string, dirty: boolean): Promise<boolean> => {
      const full = resolveInside(currentWorkspace().root, relPath)
      if (!(await confirmDelete(getWindow(), relPath, dirty))) return false

      await shell.trashItem(full)
      return true
    }
  )

  // The loaded aircraft travels with the request rather than being read
  // inside `scanVars`: main owns the connection state and the scanner owns the
  // database, and having the scanner reach for the sim would tie a corpus read
  // to a connection it has no other business knowing about.
  /*
   * The index, and the three things that change it.
   *
   * A scan is a write and this is the read — see `varIndex`. The push exists
   * because two of the three have nothing to do with the user: the enumeration
   * lands a second after MSFS appears, and the aircraft changes when somebody
   * loads a different aeroplane. Both rewrite the strongest evidence in the
   * list, and neither is something the panel could know to ask about.
   *
   * Debounced, because a connection delivers an aircraft and an enumeration
   * within a second of each other and rebuilding the index twice for one event
   * is the same answer computed at 25,000 rows a go.
   */
  ipcMain.handle("vars:index", (): VarIndex =>
    varIndex(currentWorkspace().root, loadedAircraft(), sim.inputEventNames())
  )

  let indexTimer: ReturnType<typeof setTimeout> | undefined
  const varsChanged = (): void => {
    clearTimeout(indexTimer)
    indexTimer = setTimeout(() => {
      const window = getWindow()
      if (!window.isDestroyed()) window.webContents.send("vars:changed")
    }, 250)
  }

  onSimEnumeration(varsChanged)
  // The connection dropped, an aircraft loaded, or its input-event list
  // landed — raised by the session, which is where those facts live.
  sim.onSimSession(varsChanged)

  ipcMain.handle("vars:scan", (): Promise<VarIndex> =>
    scanVars(currentWorkspace().root, loadedAircraft(), sim.inputEventNames())
  )

  ipcMain.handle("files:manifest", async (): Promise<ManifestEntry[]> => {
    const { root } = currentWorkspace()
    return buildManifest(root, await files.listFiles(root))
  })

  ipcMain.handle(
    "files:confirm-overwrite",
    (_event, relPath: string): Promise<boolean> =>
      confirmOverwrite(getWindow(), relPath)
  )

  ipcMain.handle(
    "files:confirm-stale-save",
    (_event, relPath: string): Promise<boolean> =>
      confirmStaleSave(getWindow(), relPath)
  )

  ipcMain.handle("drafts:load", (): Promise<RestoredDraft[]> =>
    loadDrafts(app.getPath("userData"), currentWorkspace().root)
  )

  ipcMain.handle(
    "drafts:save",
    (_event, relPath: string, text: string, base: string): Promise<void> =>
      saveDraft(
        app.getPath("userData"),
        currentWorkspace().root,
        relPath,
        text,
        base
      )
  )

  ipcMain.handle("drafts:clear", (_event, relPath: string): Promise<void> =>
    clearDraft(app.getPath("userData"), currentWorkspace().root, relPath)
  )

  remote.onRemoteEvent((event) => {
    log(
      "remote",
      "info",
      event.kind,
      event.kind === "state" ? `phase ${event.state.phase}` : event.kind,
      event
    )

    const window = getWindow()
    if (!window.isDestroyed()) window.webContents.send("remote:event", event)
  })

  ipcMain.handle("remote:host", (_event, paths: string[]): Promise<void> =>
    remote.host(paths)
  )

  ipcMain.handle("remote:shared", (_event, paths: string[]): Promise<void> =>
    remote.setShared(paths)
  )

  ipcMain.handle("remote:join", (_event, code: string): Promise<void> =>
    remote.join(code)
  )

  ipcMain.handle("remote:disconnect", (): void => remote.disconnect())

  ipcMain.handle("remote:request-file", (_event, relPath: string): void =>
    remote.requestFile(relPath)
  )

  ipcMain.handle("remote:presence", (_event, presence: Presence): void =>
    remote.publishPresence(presence)
  )

  ipcMain.handle("remote:state", (): RemoteState => remote.remoteState())

  sim.onSimState((state) => {
    log(
      "sim",
      "info",
      "state",
      state.phase === "live"
        ? `live · ${state.aircraft ?? "no aircraft"} · ${state.inputEvents} input events`
        : state.phase,
      state
    )

    const window = getWindow()
    if (!window.isDestroyed()) window.webContents.send("sim:state", state)
  })

  // The raw stream. Built in stage 2 with no consumer, on the grounds that
  // stage 4 would want to read live what it reads from a fixture; the Log panel
  // is that consumer, arriving first.
  // Everything from the simulator is one source. Which half of the pipeline
  // carried it is `via`, and it travels in the detail where a diagnosis can
  // reach it without making the filter chips lie about where data comes from.
  sim.onSimEvent((event) => {
    // Counted rather than logged one row each, for the values. See `sim-log.ts`
    // — a stream running at ~1,000 events a second is not a log of anything,
    // and it was evicting the whole ring every five seconds.
    logSimEvent(event)

    // Both consumers of the raw stream share this one subscription. That used
    // to be required — `onSimEvent` held a single sink, so a second
    // registration silently replaced the first — and now only keeps the two
    // side by side.
    //
    // Only interactions signal Activity. Values arrive in thousands and never
    // create a finding; they only fill in one some anchor already made.
    // Every interaction teaches, and captures depending on the mode. The panel
    // is told by `onCaptureChange` rather than from here, because "something
    // happened" and "the list changed" stopped being the same event when
    // arming moved out of the renderer.
    if (event.kind === "input") noteInteraction(event.name, event.t)

    // The index refresh an aircraft change needs is `onSimSession`'s, above,
    // which also covers the disconnect and the enumeration this never saw.
    if (event.kind === "aircraft") watchAircraft(event.key)
  })

  onLogBatch((entries) => {
    const window = getWindow()
    if (!window.isDestroyed()) window.webContents.send("log:batch", entries)
  })

  ipcMain.handle(
    "log:write",
    (
      _event,
      level: LogLevel,
      kind: string,
      message: string,
      detail?: unknown
    ): void =>
      // Source is fixed here rather than taken from the renderer: a caller that
      // could claim to be `sim` could put words in the simulator's mouth.
      log("ui", level, kind, message, detail)
  )

  ipcMain.handle("log:backlog", (): LogEntry[] => logBacklog())

  // The object behind one row, fetched when it is expanded rather than carried
  // by every entry that might one day be. See `hasDetail` in @shared/log.
  ipcMain.handle("log:detail", (_event, id: number): unknown => logDetail(id))

  ipcMain.handle("log:clear", (): void => clearLog())

  ipcMain.handle("sim:state", (): SimState => sim.simState())

  /*
   * Which watched refs the module could not resolve — the evidence tier's
   * second wire, and the first with a channel of its own.
   *
   * The input-event enumeration rides `VarIndex` because per-aircraft evidence
   * has exactly the index's lifetime. This does not: the watch set is built
   * from the `get:` lines of the open tabs, so it moves when somebody opens a
   * file, and rebuilding 25,000 rows to answer that would be the wrong trade.
   * Small payload, own channel, and the renderer re-runs diagnostics on it.
   */
  ipcMain.handle("sim:watch-resolution", (): WatchedRef[] | null =>
    watchResolution()
  )

  onWatchResolution(() => {
    const window = getWindow()
    if (!window.isDestroyed())
      window.webContents.send("sim:watch-resolution", watchResolution())
  })

  ipcMain.handle("sim:watch", (_event, vars: SimVarWatch[]): void =>
    sim.watchSimVars(vars)
  )

  sim.onSimValues((values) => {
    const window = getWindow()
    if (!window.isDestroyed()) window.webContents.send("sim:values", values)
  })

  /*
   * Activity, computed rather than streamed.
   *
   * A finding is a view over the raw-event ring — see `activity.ts` — and the
   * ring already holds everything, so recomputing on demand costs a pass over
   * two minutes of memory and pushing it would cost an IPC message per change
   * at 15 Hz. The renderer is told *that* something moved and asks if it cares.
   */
  /*
   * The captures, not everything that happened.
   *
   * This used to rank the whole ring on every ask, which produced a row for
   * every interaction in the last two minutes and left the panel to hide the
   * ones nobody requested. A capture is now created only when somebody asks for
   * one and is computed once, so what the list holds is exactly what was
   * captured — and it survives the ring rolling over underneath it.
   */
  /*
   * The run-setter popover's three calls.
   *
   * `preview` never touches the simulator and is called on every keystroke;
   * `run` touches it once and then waits out the observation window before
   * answering, which is why the popover stays open rather than closing on
   * click. See `sim/run.ts` for what the wait is for.
   */
  ipcMain.handle(
    "setter:preview",
    (_event, entry: SetterEntry, bindings: SetterBindings): SetterPreview =>
      resolveSetter(entry, bindings)
  )

  ipcMain.handle(
    "setter:run",
    (
      _event,
      entry: SetterEntry,
      bindings: SetterBindings
    ): Promise<RunResult> => runSetter(sim.simRunDeps(), entry, bindings)
  )

  ipcMain.handle("setter:picks", (_event, name: string): number[] | null =>
    picksIn(slice(), name)
  )

  /*
   * The panel picker's session: one at a time, alive only while its popup is.
   *
   * It holds a debugger connection to every cockpit panel, which keeps anyone
   * else's debugger out of them — so besides the popup closing it, anything
   * that can end a renderer without the renderer saying so closes it here.
   */
  let panels: PanelSession | null = null
  const panelsWatched = new WeakSet<BrowserWindow>()

  const closePanels = async (): Promise<void> => {
    const session = panels
    panels = null
    await session?.close()
  }

  const scanWith = async (session: PanelSession): Promise<PanelScan> => {
    const scan = await session.scan()
    // Only worth asking Windows when something was held.
    if (!scan.ok || !scan.skipped.length) return scan

    return { ...scan, holders: await inspectorHolders() }
  }

  /**
   * A look at the cockpit for the diagnostics: connect, read, hang up.
   *
   * The simulator gives each panel to one debugger at a time, and this app is
   * two of them — so the two are kept off each other here rather than left to
   * find out. While the picker is open its session already holds every panel,
   * and the look goes through it. While a look is in flight, the picker waits
   * the tenth of a second it takes rather than being refused the panels and
   * telling the user that some other debugger has them.
   */
  let looking: Promise<PanelScan> | null = null

  ipcMain.handle("panels:scan", (): Promise<PanelScan> => {
    if (panels) return panels.scan()

    looking ??= scanPanels().finally(() => {
      looking = null
    })
    return looking
  })

  ipcMain.handle("panels:open", async (): Promise<PanelScan> => {
    await closePanels()
    await looking?.catch(() => {})

    const window = getWindow()
    const session = new PanelSession((event) => {
      if (panels === session && !window.isDestroyed())
        window.webContents.send("panels:event", event)
    })
    panels = session

    // A reload and a crash both end the popup without its `close` running.
    // Once per window, however many times the popup is opened in it.
    if (!panelsWatched.has(window)) {
      panelsWatched.add(window)
      window.webContents.on("did-start-loading", () => void closePanels())
      window.webContents.on("render-process-gone", () => void closePanels())
    }

    return scanWith(session)
  })

  ipcMain.handle("panels:rescan", async (): Promise<PanelScan> =>
    panels
      ? scanWith(panels)
      : { ok: false, reason: "failed", detail: "the picker is not open" }
  )

  ipcMain.handle(
    "panels:highlight",
    (_event, pages: number[]): Promise<void> | undefined =>
      panels?.highlight(pages)
  )

  ipcMain.handle(
    "panels:labels",
    (_event, labels: Record<number, string>): Promise<void> | undefined =>
      panels?.label(labels)
  )

  ipcMain.handle(
    "panels:inspect",
    (_event, on: boolean): Promise<void> | undefined => panels?.inspect(on)
  )

  ipcMain.handle("panels:close", (): Promise<void> => closePanels())

  app.on("before-quit", () => void closePanels())

  ipcMain.handle(
    "panels:close-holder",
    (_event, pid: number): Promise<string | null> => closeHolder(pid)
  )

  ipcMain.handle("activity:findings", (): Finding[] => captures())

  ipcMain.handle("activity:mode", (): CaptureMode => captureMode())
  ipcMain.handle("activity:set-mode", (_event, mode: CaptureMode): void =>
    setCaptureMode(mode)
  )

  const activityChanged = (): void => {
    const window = getWindow()
    if (!window.isDestroyed()) window.webContents.send("activity:changed")
  }

  onMark((made) => {
    log(
      "sim",
      "info",
      "mark",
      `mark at ${new Date(made.t).toISOString()}`,
      made
    )
    // Into the capture as well as the panel. A marking session that cannot be
    // replayed is a session that can only be debugged while it is happening.
    sim.recordMark()
    noteMark(made.t)
  })

  // One signal for "the list changed", raised by the thing that owns the list.
  onCaptureChange(activityChanged)

  ipcMain.handle("activity:mark", (): void => void mark())

  /*
   * Clears the list, and only the list.
   *
   * Anchors and marks go; the change ring stays, because it is what baselines
   * are measured from. See `clearAnchors`.
   */
  ipcMain.handle("activity:clear", (): void => {
    resetMarks()
    clearAnchors()
    clearCaptures()
    log("app", "info", "activity", "activity entries cleared")
  })

  /*
   * Everything the app knows about itself, packaged for a tester to send.
   *
   * The collection is deliberately not chatty: it is one action a person took,
   * it lands in one folder, and the dialog that started it says where. The two
   * log lines here are for the report itself — a report that failed halfway is
   * a thing the *next* report should be able to see.
   */
  ipcMain.handle("report:collect", async (): Promise<DebugReport> => {
    const report = await collectReport(loadedAircraft())

    log(
      "app",
      report.ok ? "info" : "error",
      "report",
      report.ok
        ? `debug report written to ${report.folder}`
        : `could not write debug report — ${report.reason}`,
      report
    )

    return report
  })

  ipcMain.handle("report:reveal", (_event, file: string): void => {
    shell.showItemInFolder(file)
  })
  ipcMain.handle("activity:hotkey", (): Hotkeys => hotkeys())
  ipcMain.handle(
    "activity:bind-hotkey",
    (_event, action: HotkeyAction, accelerator: string): Hotkeys => {
      const result = bindHotkey(action, accelerator)
      log(
        "app",
        result.ok ? "info" : "warn",
        "hotkey",
        result.ok
          ? `${action} hotkey bound to ${result.accelerator}`
          : `Windows refused ${result.accelerator} — another application holds it`,
        result
      )
      return hotkeys()
    }
  )

  // The key that arms, which is the other half of not having to alt-tab: the
  // panel's own button is out of reach while the simulator is fullscreen.
  onHotkey("arm", armFromHotkey)

  ipcMain.handle("link:install-state", (): Promise<LinkInstallState> =>
    linkInstallState()
  )

  /*
   * Keeping an installed module in step with the app that installs it, without
   * asking.
   *
   * 04-connection describes this as a fifth chip state that "offers an update
   * rather than failing silently", and the offer is the part that does not
   * survive contact with a real user: they cannot evaluate what changed inside
   * a WASM module, the only answer that ever makes sense is yes, and a prompt
   * that always has one right answer is a prompt that should not exist. So the
   * app does it and writes a line about it.
   *
   * Fire and forget, for the same reason `startSim` is: launch does not wait on
   * any of this. The chip corrects itself when it lands.
   */
  void updateStaleLinks()
    .then(async (updates) => {
      for (const result of updates) {
        log(
          "sim",
          result.ok ? "info" : "warn",
          "link-update",
          result.ok
            ? `updated the Link package in ${result.path} — restart MSFS to load it`
            : `could not update the Link package — ${result.reason}`,
          result
        )
      }

      if (updates.length) await sim.refreshSimInstall()
    })
    .catch((error: unknown) => {
      // Bookkeeping on a background promise is never a reason to take down a
      // working session, which is the same rule `store.ts` follows.
      console.warn(`sim: link auto-update failed — ${String(error)}`)
    })

  // The app's own updates, which are the same idea one level up: check
  // quietly, download quietly, and say something only when restarting into the
  // new version would take two seconds. Does nothing in a portable or
  // development build. See docs/pipeline/06-updater.md.
  watchUpdates()

  ipcMain.handle(
    "link:choose-folder",
    async (_event, defaultPath?: string): Promise<CommunityFolder | null> => {
      const result = await dialog.showOpenDialog(getWindow(), {
        title: "Choose your Community folder",
        buttonLabel: "Use this folder",
        properties: ["openDirectory"],
        // Opens next to whatever discovery already proposed, so overriding it
        // means picking the folder beside it rather than navigating from the
        // drive root to somewhere five levels inside AppData.
        defaultPath,
      })

      const picked = result.filePaths[0]
      if (result.canceled || !picked) return null

      // Rejection travels back as a value, the same way `chooseWorkspace` does
      // it: the dialog that asked for this folder is already explaining what one
      // looks like, and a native alert on top would say it again, worse.
      return describeCommunity(picked)
    }
  )

  ipcMain.handle(
    "link:install",
    async (_event, community: string): Promise<LinkInstallResult> => {
      const result = await installLink(community)
      log(
        "sim",
        result.ok ? "info" : "warn",
        "link-install",
        result.ok
          ? `${result.replaced ? "replaced" : "installed"} ${result.files.length} files in ${result.path}`
          : `install failed — ${result.reason}`,
        result
      )

      // The chip is the thing that was asking for this, so it is told before
      // the dialog gets its answer back.
      await sim.refreshSimInstall()
      return result
    }
  )

  ipcMain.handle(
    "link:uninstall",
    async (_event, community: string): Promise<LinkUninstallResult> => {
      const result = await uninstallLink(community)
      log(
        "sim",
        result.ok ? "info" : "warn",
        "link-uninstall",
        result.ok
          ? `removed ${result.path}`
          : `uninstall failed — ${result.reason}`,
        result
      )

      await sim.refreshSimInstall()
      return result
    }
  )

  // Windows-only: everywhere else the window still has its own frame, and
  // setTitleBarOverlay throws rather than being ignored.
  ipcMain.handle(
    "window:title-bar-colors",
    (_event, colors: TitleBarColors): void => {
      if (process.platform !== "win32") return

      const window = getWindow()
      if (!window.isDestroyed())
        window.setTitleBarOverlay({ ...colors, height: TITLE_BAR_HEIGHT })
    }
  )
}

/**
 * One line per simulator event, for the Log row.
 *
 * The whole event travels in `detail` regardless, so this only has to be the
 * part worth reading at a glance while a hundred of them scroll past.
 */
const CHOICES = ["save", "discard", "cancel"] as const

/**
 * Native rather than an in-app modal: this is a question about data on disk,
 * and it has to be answered before the tab goes away.
 */
async function confirmDiscard(
  window: BrowserWindow,
  relPath: string
): Promise<DiscardChoice> {
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    buttons: ["Save", "Don't save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: `Save changes to ${relPath}?`,
    detail: "Your changes will be lost if you close this file without saving.",
  })

  return CHOICES[response] ?? "cancel"
}

/**
 * Moving a profile to the Recycle Bin. False means the user backed out.
 *
 * The unsaved-changes line is the whole reason the renderer passes `dirty`:
 * everything else about this question is visible on screen, and that one thing
 * is about to be thrown away without ever having been on disk.
 */
async function confirmDelete(
  window: BrowserWindow,
  relPath: string,
  dirty: boolean
): Promise<boolean> {
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    buttons: ["Delete", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: `Move ${relPath} to the Recycle Bin?`,
    detail: dirty
      ? "This profile has unsaved changes. They will be lost — only what is on disk goes to the Recycle Bin."
      : "You can put it back from the Recycle Bin.",
  })

  return response === 0
}

/**
 * Saving over a file that moved while the draft was put away.
 *
 * The one question this feature has to ask, asked at the one moment it can be
 * answered: not at startup, where the user has just launched the app and has
 * the least context they will ever have about a draft they cannot see, but at
 * the save, which is the only irreversible act in the whole flow.
 */
async function confirmStaleSave(
  window: BrowserWindow,
  relPath: string
): Promise<boolean> {
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    buttons: ["Overwrite", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: `${relPath} changed on disk since you edited it.`,
    detail: "Saving replaces what is there now with your version.",
  })

  return response === 0
}

/**
 * The one moment taking a file could destroy work: the tab holds edits nobody
 * has saved, and the remote copy is about to land on top of them. Everywhere
 * else the action is immediate, which is what makes stopping here read as a
 * real warning rather than as the usual friction.
 */
async function confirmOverwrite(
  window: BrowserWindow,
  relPath: string
): Promise<boolean> {
  const { response } = await dialog.showMessageBox(window, {
    type: "warning",
    buttons: ["Overwrite", "Cancel"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    message: `Replace ${relPath} with the remote copy?`,
    detail:
      "This profile has unsaved changes. They will be lost — the remote copy replaces them.",
  })

  return response === 0
}
