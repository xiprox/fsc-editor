import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron"

import type { RemoteEvent } from "@shared/remote-connect"
import type { LogEntry } from "@shared/log"
import type { PanelEvent } from "@shared/panels"
import type { SimState, SimValue } from "@shared/sim"
import type { WatchedRef } from "@shared/link"
import type {
  Api,
  DetectEvent,
  FscState,
  ProfileFile,
  UpdateState,
} from "@shared/types"

/**
 * The renderer gets these functions and nothing else — no ipcRenderer, no fs,
 * no path. Adding a capability here is a deliberate act.
 *
 * `onFilesChanged` is the first channel that pushes rather than answering, so
 * it is named for exactly what it carries rather than being a general event
 * pipe. The `IpcRendererEvent` is dropped on the way through: it carries a
 * sender the renderer has no business holding.
 */
const api: Api = {
  locateWorkspace: () => ipcRenderer.invoke("workspace:locate"),
  startDetect: (runId) => ipcRenderer.invoke("workspace:detect-start", runId),
  stopDetect: () => ipcRenderer.invoke("workspace:detect-stop"),

  onDetectEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, detect: DetectEvent) =>
      listener(detect)

    ipcRenderer.on("workspace:detect", handler)
    return () => ipcRenderer.off("workspace:detect", handler)
  },

  adoptWorkspace: (root) => ipcRenderer.invoke("workspace:adopt", root),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  listFiles: () => ipcRenderer.invoke("files:list"),
  readFile: (relPath) => ipcRenderer.invoke("files:read", relPath),
  writeFile: (relPath, content) =>
    ipcRenderer.invoke("files:write", relPath, content),
  revealFile: (relPath) => ipcRenderer.invoke("files:reveal", relPath),
  renameFile: (relPath, name) =>
    ipcRenderer.invoke("files:rename", relPath, name),
  duplicateFile: (relPath) => ipcRenderer.invoke("files:duplicate", relPath),
  deleteFile: (relPath, dirty) =>
    ipcRenderer.invoke("files:delete", relPath, dirty),
  confirmDiscard: (relPath) =>
    ipcRenderer.invoke("files:confirm-discard", relPath),
  confirmStaleSave: (relPath) =>
    ipcRenderer.invoke("files:confirm-stale-save", relPath),
  loadDrafts: () => ipcRenderer.invoke("drafts:load"),
  saveDraft: (relPath, text, base) =>
    ipcRenderer.invoke("drafts:save", relPath, text, base),
  clearDraft: (relPath) => ipcRenderer.invoke("drafts:clear", relPath),
  scanVars: () => ipcRenderer.invoke("vars:scan"),
  varIndex: () => ipcRenderer.invoke("vars:index"),

  onVarsChanged: (listener) => {
    const handler = (): void => listener()

    ipcRenderer.on("vars:changed", handler)
    return () => ipcRenderer.off("vars:changed", handler)
  },

  onFilesChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, files: ProfileFile[]) =>
      listener(files)

    ipcRenderer.on("files:changed", handler)
    return () => ipcRenderer.off("files:changed", handler)
  },

  localManifest: () => ipcRenderer.invoke("files:manifest"),
  confirmOverwrite: (relPath) =>
    ipcRenderer.invoke("files:confirm-overwrite", relPath),

  remoteHost: (paths) => ipcRenderer.invoke("remote:host", paths),
  remoteShared: (paths) => ipcRenderer.invoke("remote:shared", paths),
  remoteJoin: (code) => ipcRenderer.invoke("remote:join", code),
  remoteDisconnect: () => ipcRenderer.invoke("remote:disconnect"),
  remoteRequestFile: (relPath) =>
    ipcRenderer.invoke("remote:request-file", relPath),
  remotePresence: (presence) => ipcRenderer.invoke("remote:presence", presence),
  remoteState: () => ipcRenderer.invoke("remote:state"),

  onRemoteEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, remote: RemoteEvent) =>
      listener(remote)

    ipcRenderer.on("remote:event", handler)
    return () => ipcRenderer.off("remote:event", handler)
  },

  simState: () => ipcRenderer.invoke("sim:state"),

  onSimState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: SimState) =>
      listener(state)

    ipcRenderer.on("sim:state", handler)
    return () => ipcRenderer.off("sim:state", handler)
  },

  watchResolution: () => ipcRenderer.invoke("sim:watch-resolution"),

  onWatchResolution: (listener) => {
    const handler = (_event: IpcRendererEvent, refs: WatchedRef[] | null) =>
      listener(refs)

    ipcRenderer.on("sim:watch-resolution", handler)
    return () => ipcRenderer.off("sim:watch-resolution", handler)
  },

  watchSimVars: (vars) => ipcRenderer.invoke("sim:watch", vars),

  onSimValues: (listener) => {
    const handler = (_event: IpcRendererEvent, values: SimValue[]) =>
      listener(values)

    ipcRenderer.on("sim:values", handler)
    return () => ipcRenderer.off("sim:values", handler)
  },

  linkInstallState: () => ipcRenderer.invoke("link:install-state"),
  chooseCommunityFolder: (defaultPath) =>
    ipcRenderer.invoke("link:choose-folder", defaultPath),
  installLink: (community) => ipcRenderer.invoke("link:install", community),
  uninstallLink: (community) => ipcRenderer.invoke("link:uninstall", community),

  previewSetter: (entry, bindings) =>
    ipcRenderer.invoke("setter:preview", entry, bindings),
  runSetter: (entry, bindings) =>
    ipcRenderer.invoke("setter:run", entry, bindings),
  setterPicks: (name) => ipcRenderer.invoke("setter:picks", name),

  scanPanels: () => ipcRenderer.invoke("panels:scan"),
  openPanels: () => ipcRenderer.invoke("panels:open"),
  rescanPanels: () => ipcRenderer.invoke("panels:rescan"),
  highlightPanels: (pages) => ipcRenderer.invoke("panels:highlight", pages),
  labelPanels: (labels) => ipcRenderer.invoke("panels:labels", labels),
  inspectPanels: (on) => ipcRenderer.invoke("panels:inspect", on),
  closePanels: () => ipcRenderer.invoke("panels:close"),
  onPanelEvent: (listener) => {
    const handler = (_event: IpcRendererEvent, event: PanelEvent): void =>
      listener(event)

    ipcRenderer.on("panels:event", handler)
    return () => ipcRenderer.off("panels:event", handler)
  },
  closePanelHolder: (pid) => ipcRenderer.invoke("panels:close-holder", pid),

  activityFindings: () => ipcRenderer.invoke("activity:findings"),

  onActivity: (listener) => {
    const handler = (): void => listener()

    ipcRenderer.on("activity:changed", handler)
    return () => ipcRenderer.off("activity:changed", handler)
  },

  addMark: () => ipcRenderer.invoke("activity:mark"),
  markHotkey: () => ipcRenderer.invoke("activity:hotkey"),
  bindMarkHotkey: (action, accelerator) =>
    ipcRenderer.invoke("activity:bind-hotkey", action, accelerator),
  captureMode: () => ipcRenderer.invoke("activity:mode"),
  setCaptureMode: (mode) => ipcRenderer.invoke("activity:set-mode", mode),
  clearActivity: () => ipcRenderer.invoke("activity:clear"),
  collectReport: () => ipcRenderer.invoke("report:collect"),
  revealReport: (file) => ipcRenderer.invoke("report:reveal", file),

  log: (level, kind, message, detail) =>
    ipcRenderer.invoke("log:write", level, kind, message, detail),

  logBacklog: () => ipcRenderer.invoke("log:backlog"),

  logDetail: (id) => ipcRenderer.invoke("log:detail", id),

  onLogBatch: (listener) => {
    const handler = (_event: IpcRendererEvent, entries: LogEntry[]) =>
      listener(entries)

    ipcRenderer.on("log:batch", handler)
    return () => ipcRenderer.off("log:batch", handler)
  },

  clearLog: () => ipcRenderer.invoke("log:clear"),

  setTitleBarColors: (colors) =>
    ipcRenderer.invoke("window:title-bar-colors", colors),

  fscState: () => ipcRenderer.invoke("fsc:state"),

  onFscState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: FscState) =>
      listener(state)

    ipcRenderer.on("fsc:state", handler)
    return () => ipcRenderer.off("fsc:state", handler)
  },

  launchFsc: (mode) => ipcRenderer.invoke("fsc:launch", mode),
  stopFsc: () => ipcRenderer.invoke("fsc:stop"),

  updateState: () => ipcRenderer.invoke("update:state"),

  onUpdateState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) =>
      listener(state)

    ipcRenderer.on("update:state", handler)
    return () => ipcRenderer.off("update:state", handler)
  },

  installUpdate: () => ipcRenderer.invoke("update:install"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  about: () => ipcRenderer.invoke("app:about"),
}

contextBridge.exposeInMainWorld("api", api)
