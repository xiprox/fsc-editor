/**
 * Types shared across main, preload and renderer.
 * This file is the IPC contract — keep it free of runtime imports.
 */

import type {
  ManifestEntry,
  Presence,
  RemoteEvent,
  RemoteState,
} from "./remote-connect.ts"
import type { LogEntry, LogLevel } from "./log.ts"
import type { SdkVar } from "./sdk-catalog.ts"
import type {
  RunResult,
  SetterBindings,
  SetterEntry,
  SetterPreview,
} from "./setter.ts"
import type { SimState, SimValue, SimVarWatch } from "./sim.ts"
import type { WatchedRef } from "./link.ts"
import type { CaptureMode, Finding, HotkeyAction } from "./activity.ts"
import type { PanelEvent, PanelScan } from "./panels.ts"
import type {
  CommunityFolder,
  LinkInstallResult,
  LinkInstallState,
  LinkUninstallResult,
} from "./link-install.ts"

/**
 * The hotkey's state, and the limit of what it can claim.
 *
 * `ok` means Windows accepted the binding. It does **not** mean the key is free:
 * MSFS reads its own keybindings through raw input, where `globalShortcut`
 * cannot see them, so a key bound in the simulator registers happily here and
 * then does two things at once. The UI has to say so; nothing else can.
 */
export interface MarkHotkey {
  accelerator: string
  ok: boolean
}

/** Every binding the Radar panel offers, by what it does. */
export type Hotkeys = Record<HotkeyAction, MarkHotkey>

/** How the folder profiles are read from was arrived at. */
export type WorkspaceSource = "env" | "saved" | "manual"

export interface Workspace {
  /**
   * Absolute path to the directory profiles are read from — the `Definitions`
   * folder of an FS Copilot install, or a plain folder of profiles.
   */
  root: string
  /**
   * The FS Copilot install directory `root` sits inside, or null when there
   * isn't one.
   *
   * Kept apart from `root` because the two answer different questions: `root`
   * is where the files are, `installRoot` is where the program is. Nothing
   * reads it yet — launching FS Copilot from here is the reason it exists, and
   * a workspace that has no install is exactly the case that feature has to
   * stay out of the way of.
   */
  installRoot: string | null
  source: WorkspaceSource
}

/**
 * How a candidate turned up, strongest evidence first.
 *
 * Shown to the user, so each one has to be explainable in a phrase — "FS
 * Copilot is running from here" is a fact about this moment, "found in a
 * folder" is a guess that happened to pay off, and someone choosing between two
 * hits deserves to know which is which.
 */
export type CandidateSource =
  "process" | "shortcut" | "registry" | "index" | "folder"

/**
 * Detection as it happens, rather than as a list at the end.
 *
 * Streaming costs an ordering rule — see the renderer, which appends and never
 * reorders — and buys the ability to click the right folder the moment it shows
 * up.
 */
export type DetectResult =
  | { kind: "found"; candidate: WorkspaceCandidate }
  | { kind: "done"; stopped: boolean }

/**
 * A result, tagged with the run that produced it.
 *
 * The id is the renderer's, chosen before it asks for anything, because the
 * alternative does not work: a run abandoned mid-flight still finishes, and its
 * parting `done` travels back through promise microtasks that drain *before*
 * the next IPC message is even delivered. Any "is this still the current run?"
 * check on the sending side is therefore asked too early and answers yes. The
 * receiver knows which search it started, so the receiver decides what to
 * listen to.
 */
export type DetectEvent = { runId: number } & DetectResult

/**
 * A folder detection turned up, offered before anything is written down.
 *
 * Detection proposes and the user disposes: the app used to adopt whatever the
 * process list implied, which works right up until it is wrong and the person
 * it is wrong for has no idea a decision was made on their behalf.
 */
export interface WorkspaceCandidate {
  root: string
  installRoot: string | null
  source: CandidateSource
}

/** Which way FS Copilot is started — plain, or with the `--dev` flag. */
export type FscMode = "normal" | "dev"

/** One running FS Copilot, as the process list reports it. */
export interface FscInstance {
  pid: number
  /** Read off the process's command line, so it is right for instances this
   * app did not start. */
  mode: FscMode
}

/**
 * Every `FsCopilot.exe` currently running, whoever started it.
 *
 * A list rather than a single mode because nothing stops two instances from
 * existing — FS Copilot has no single-instance guard. The launch controls never
 * *create* that state, but they have to be able to report and stop it.
 */
export interface FscState {
  instances: FscInstance[]
}

/**
 * What there is to say about updating, which is usually nothing.
 *
 * Three states rather than the five the mechanism has, because the other two —
 * checking, and an update merely being *available* — are not things the user
 * is told about. Downloading is silent until it has been going long enough to
 * be worth drawing, and an update is announced when restarting into it would
 * take two seconds rather than when a download might be about to start. See
 * docs/pipeline/06-updater.md.
 */
export type UpdateState =
  | { kind: "idle" }
  /** `percent` is null while the size is not yet known, or not reported. */
  | { kind: "downloading"; percent: number | null }
  | { kind: "ready"; version: string }

/**
 * The answer to a check somebody asked for.
 *
 * Returned rather than published, because a manual check is a question and the
 * ambient state's job is to stay quiet. `unavailable` is a portable or
 * development build, where there is nothing to replace.
 */
export type ManualCheck =
  | "unavailable"
  | "up-to-date"
  | "downloading"
  | "ready"
  | "failed"

/** What the app is, and whether it can replace itself. */
export interface About {
  version: string
  updates: "on" | "portable" | "development"
}

/**
 * The outcome of asking for a folder.
 *
 * A rejected folder comes back as a value rather than as a native error box, so
 * the explanation lands next to the button that caused it — during setup that
 * is the difference between a dead end and an obvious next try.
 */
export type WorkspacePick =
  | { ok: true; workspace: Workspace }
  | { ok: false; reason: "canceled" }
  /**
   * The folder holds files, and none of them is a profile — which is now the
   * only way a chosen folder is turned down. An *empty* folder is accepted, as
   * a workspace with nothing in it yet; see `resolveChosenFolder`.
   */
  | { ok: false; reason: "no-profiles"; path: string }

export interface ProfileFile {
  /** Path relative to the workspace root, always forward-slashed. */
  relPath: string
  /** File name without directories. */
  name: string
  /** Parent directory relative to root, "" for top level. */
  dir: string
  size: number
  mtimeMs: number
}

export type Block = "shared" | "master"

/** One concrete use of a variable, kept for provenance in completions. */
export interface VarSample {
  /** Profile file the sample came from, relative to root. */
  file: string
  block: Block
  set?: string
  skp?: string
  /** The `set:` was a block scalar, so its value spans lines. */
  scalar?: boolean
  /** Comment lines that preceded the entry, joined. */
  comment?: string
  /** Enclosing headings, e.g. "Electrical › Hot Battery Bus", when present. */
  heading?: string
}

/**
 * What the profiles in this workspace say about a variable.
 *
 * Absent on a variable no profile has ever named — which, now that the index
 * carries the simulator's enumeration and the SDK catalogue, is most of them.
 */
export interface CorpusFacet {
  /** Total number of occurrences across all profiles. */
  count: number
  sharedCount: number
  masterCount: number
  /** Number of distinct profiles that reference it. */
  fileCount: number
  /** Distinct profile files that reference it, truncated for payload size. */
  files: string[]
  /** Distinct usages, deduped by set expression. */
  samples: VarSample[]
  /** Best comment found for this variable, used as hover documentation. */
  doc?: string
  /**
   * Units it is read in, most used first.
   *
   * A list because units stopped being part of a variable's identity: the same
   * variable read as `Number` in one profile and `Bool` in another used to be
   * two rows, and is now one variable with two facts about how it gets read.
   * Callers that need a single unit — a completion inserting `A:FOO, Bool` —
   * take the first, which is the commonest.
   */
  units: string[]
  /** Indices it is written with — `1`, `2` — as the profiles write them. */
  indices: string[]
}

/** The simulator has this name. Global to the install; see `sim/store.ts`. */
export interface SimFacet {
  firstSeen: number
  lastSeen: number
}

/**
 * What is known about this variable *for the aircraft currently loaded*.
 *
 * The only per-aircraft facet, and the strongest evidence in the index: the sim
 * will not say which variables belong to an aircraft, so movement is the only
 * signal there is. Rebuilt when the aircraft changes.
 */
export interface AircraftFacet {
  /** The SimObject key this is about, so a stale facet can be spotted. */
  key: string
  /** Times it moved while this aircraft was loaded, across every session. */
  changes?: number
  /**
   * Times it was *worked* while this aircraft was loaded — `B:` only.
   *
   * An input event reports a firing when somebody presses it, and a momentary
   * control fires with the value 0 every time. So ten presses of a push button
   * are ten firings and zero `changes`, while ten flips of a latching switch
   * are ten of each — and a control nobody has touched has neither.
   *
   * That is the only available difference between a `B:` value that cannot be
   * read and one that simply has not moved yet: both read 0 forever, and
   * nothing the simulator declares tells them apart. See
   * `lang/rules/b-value-constant.ts`.
   */
  firings?: number
  /**
   * This aircraft's own profile names it.
   *
   * Profile basename is the SimObject folder name — verified against every
   * installed aircraft — with a `-default` suffix stripped.
   */
  inProfile?: boolean
  /**
   * The simulator enumerated it as one of this aircraft's input events — a
   * `B:` `<InputEvent ID>`, which is the strongest thing anything in this
   * index can say about a name: the aeroplane in front of you registered it.
   *
   * The name is the **ID**, not a reference anyone writes. A working `B:`
   * reference is `ID_Preset`, and the preset half never appears in the
   * enumeration — see `lang/rules/b-preset.ts`.
   *
   * The runtime table is a superset of the aircraft's own definitions: MSFS
   * 2024's `CLICKSPOT_*` and `WALKAROUND_*` templates are in it too, and
   * separating them needs a sim-global baseline that does not exist yet.
   */
  inputEvent?: boolean
}

/**
 * One variable, and everything any source knows about it.
 *
 * **Identity is the name and nothing else**: namespaced, and with any index
 * stripped — `A:ADF ACTIVE FREQUENCY`, never `…:1`. Everything else hangs off
 * it as an optional facet, one per source. A new source of knowledge is a new
 * optional key, which cannot disturb the existing ones; that property is the
 * point, and a change that breaks it is the wrong change.
 */
export interface VarEntry {
  name: string
  corpus?: CorpusFacet
  sim?: SimFacet
  aircraft?: AircraftFacet
  /** The shipped SDK catalogue — `src/main/catalog/sdk-var-catalog.json`. */
  sdk?: Omit<SdkVar, "name">
}

export interface VarIndex {
  entries: VarEntry[]
  scannedFiles: number
  /** Milliseconds the scan took, surfaced in the status bar. */
  elapsedMs: number
  /**
   * The aircraft the `aircraft` facets were built for, or null when none was
   * loaded. Carried so the panel can name what "this aircraft" means without
   * having to reconcile the index against a connection state that moves
   * independently of it.
   */
  aircraft: string | null
  /**
   * The input-event names this aircraft has registered — the `B:` presets it
   * actually has — or null when nothing is loaded.
   *
   * Rides the index because it is per-aircraft evidence with exactly the same
   * lifetime as the `aircraft` facets, and because the index is already
   * rebuilt and already re-runs diagnostics when the aeroplane changes.
   */
  inputEvents: string[] | null
}

export interface FileContent {
  relPath: string
  content: string
  mtimeMs: number
}

/** What to do with unsaved changes when a tab is closed. */
export type DiscardChoice = "save" | "discard" | "cancel"

/** Removes a subscription. Returned by every `on*` function on `Api`. */
export type Unsubscribe = () => void

/**
 * The height Windows is told to draw the caption buttons at.
 *
 * One pixel short of the 44px app header (`h-11` in both `Workbench` and
 * `Setup`) that the buttons sit in: the overlay paints its own background over
 * whatever is beneath it, and at the full 44 that would cut a gap in the
 * header's bottom border for exactly the width of the buttons.
 */
export const TITLE_BAR_HEIGHT = 43

/**
 * What the caption buttons are painted with. Windows draws them itself and
 * knows nothing about the stylesheet the rest of the header comes from, so the
 * renderer resolves these two tokens and hands them over on every theme change.
 */
export interface TitleBarColors {
  /** Behind the buttons — the header's own background. */
  color: string
  /** The minimize/maximize/close glyphs. */
  symbolColor: string
}

/** Shape exposed on `window.api` by the preload script. */
/**
 * A stored draft, handed back with the file it has to sit against.
 *
 * Reconciliation happens in main, where the base hash lives, so this carries an
 * answer rather than the evidence for one — see `main/drafts.ts`.
 */
export interface RestoredDraft {
  relPath: string
  /** The unsaved text. */
  text: string
  /** The file as it is now. Null where the draft has never been saved. */
  disk: { content: string; mtimeMs: number } | null
  /**
   * The file changed since this draft was taken from it.
   *
   * Not an error and not a reason to refuse the draft: it is a property of the
   * tab, which the editor shows and asks about at the one moment the answer
   * matters, which is the save.
   */
  stale: boolean
}

/**
 * Where a collected debug report went, or why it did not go anywhere.
 *
 * `zip` is nullable inside a successful result on purpose. The folder and the
 * zip fail independently, and a folder full of readable files with no archive
 * beside it is a report somebody can still send — losing eleven collected files
 * because the twelfth did not compress would be the wrong trade.
 *
 * `errors` counts collectors that failed, which is not the same as this having
 * failed: the package names them in `errors.txt` and is still worth having.
 * See docs/debug-report.md for what is in one.
 */
export type DebugReport =
  | {
      ok: true
      folder: string
      zip: string | null
      /** The zip's size, for the line the dialog shows when it is done. */
      bytes: number
      errors: number
    }
  | { ok: false; reason: string }

export interface Api {
  /**
   * The workspace this session starts with — an override, or the folder the
   * user settled on last time. Null means setup has not happened yet.
   *
   * Cheap on purpose: it is the first thing a launch waits on, so it reads a
   * settings file and stats a directory and does no searching.
   */
  locateWorkspace(): Promise<Workspace | null>
  /**
   * Starts hunting for FS Copilot. Results arrive on `onDetectEvent`, tagged
   * with `runId` — pass a fresh one per search and ignore anything else.
   *
   * Starting again while a search is running abandons the first one, so a
   * remounted setup screen cannot leave a second walk grinding away behind it.
   */
  startDetect(runId: number): Promise<void>
  /** Gives up early. The run still reports `done`, with `stopped` set. */
  stopDetect(): Promise<void>
  onDetectEvent(listener: (event: DetectEvent) => void): Unsubscribe
  /** Accepts a detected folder, remembering it for next time. */
  adoptWorkspace(root: string): Promise<Workspace | null>
  chooseWorkspace(): Promise<WorkspacePick>
  listFiles(): Promise<ProfileFile[]>
  readFile(relPath: string): Promise<FileContent>
  writeFile(relPath: string, content: string): Promise<FileContent>
  /** Shows a profile — or a module folder — in File Explorer. */
  revealFile(relPath: string): Promise<void>
  /**
   * Renames a profile within its folder. `name` is a bare filename, gains a
   * `.yaml` if it has no extension of its own, and rejects anything Windows
   * would refuse or that is already taken.
   */
  renameFile(relPath: string, name: string): Promise<ProfileFile>
  /** Copies a profile beside itself, under the first free `- Copy` name. */
  duplicateFile(relPath: string): Promise<ProfileFile>
  /**
   * Asks, then moves a profile to the Recycle Bin. False means the user backed
   * out. `dirty` only changes what the question says about unsaved work.
   */
  deleteFile(relPath: string, dirty: boolean): Promise<boolean>
  confirmDiscard(relPath: string): Promise<DiscardChoice>
  /**
   * Warns that saving is about to replace a file that moved underneath the
   * draft. False means the user backed out.
   */
  confirmStaleSave(relPath: string): Promise<boolean>
  /** Every unsaved buffer this workspace was left with. */
  loadDrafts(): Promise<RestoredDraft[]>
  /** Records one unsaved buffer, and what it was edited from. */
  saveDraft(relPath: string, text: string, base: string): Promise<void>
  /** Forgets one — it was saved, or discarded. */
  clearDraft(relPath: string): Promise<void>
  /**
   * Re-reads the profiles from disk, then returns the index.
   *
   * A write. `varIndex` is the read, and most callers want that one: a scan
   * walks the workspace, where the index is assembled from evidence already
   * stored.
   */
  scanVars(): Promise<VarIndex>
  /** Every variable anything knows about, for the aircraft currently loaded. */
  varIndex(): Promise<VarIndex>
  /**
   * Fires when the index would come back different — a scan, the simulator's
   * enumeration landing, or a different aircraft being loaded. Carries nothing:
   * ask for the index if you are showing one.
   */
  onVarsChanged(listener: () => void): Unsubscribe

  /**
   * Fires when profiles change on disk, whoever changed them — this app, another
   * editor, or FS Copilot itself. Carries the whole list; compare `mtimeMs` to
   * find what moved.
   */
  onFilesChanged(listener: (files: ProfileFile[]) => void): Unsubscribe

  /**
   * This workspace hashed the same way a host hashes theirs, so the two lists
   * can be compared entry for entry. Cheap to ask for repeatedly — the hashes
   * are cached against size and mtime.
   */
  localManifest(): Promise<ManifestEntry[]>
  /** Overwriting a file whose tab has unsaved edits. Returns true to proceed. */
  confirmOverwrite(relPath: string): Promise<boolean>

  /**
   * Opens a session sharing exactly these profiles, and nothing else.
   *
   * There is no argumentless form. Hosting the whole workspace is a selection
   * like any other, so it cannot be arrived at by forgetting to pass one.
   */
  remoteHost(paths: string[]): Promise<void>
  /** Changes what a running session shares. Ignored unless hosting. */
  remoteShared(paths: string[]): Promise<void>
  remoteJoin(code: string): Promise<void>
  /** Ends the session for everyone in it, if hosting. */
  remoteDisconnect(): Promise<void>
  /** Guest → host: send me this file. The answer arrives as a `RemoteEvent`. */
  remoteRequestFile(relPath: string): Promise<void>
  /** Host → guests: where I am and what I have not saved. Ignored otherwise. */
  remotePresence(presence: Presence): Promise<void>
  /** The current session, for a renderer that started after it did. */
  remoteState(): Promise<RemoteState>
  onRemoteEvent(listener: (event: RemoteEvent) => void): Unsubscribe

  /**
   * The simulator connection, for a renderer that started after it did.
   *
   * There is no `simConnect()` to go with this. The client is always trying —
   * see 04-connection: the app never waits on MSFS and never asks permission to
   * notice it. Connecting is not a user action, so it is not in the API.
   */
  simState(): Promise<SimState>
  onSimState(listener: (state: SimState) => void): Unsubscribe
  /**
   * Replaces the set of `A:` variables being watched.
   *
   * Stage 3's, not stage 2's: the set comes from the `get:` lines of open
   * models, which is knowledge the renderer has and main does not.
   */
  watchSimVars(vars: SimVarWatch[]): Promise<void>
  /**
   * Current values for the watch set, whenever they change.
   *
   * Sent as the whole set rather than a delta: it is small by construction —
   * the `get:` lines of open files — and a full set means the renderer can
   * never drift out of sync with what is actually being watched.
   */
  onSimValues(listener: (values: SimValue[]) => void): Unsubscribe

  /**
   * Which of the watched refs the Link module could resolve on this aircraft.
   *
   * The evidence tier's second source, and the first with a channel of its
   * own — the input-event enumeration rides `VarIndex` because it changes only
   * when the aeroplane does, and this changes whenever a tab opens. Null is
   * "no module talking", which is not the same fact as an empty list and must
   * leave the rules silent rather than clear.
   *
   * Only the namespaces the module reads by typed id are ever in here (`Z:`,
   * `E:`, indexed `L:`); plain `L:` is streamed and never watched.
   */
  watchResolution(): Promise<WatchedRef[] | null>
  onWatchResolution(listener: (refs: WatchedRef[] | null) => void): Unsubscribe

  /**
   * Where the Link module could go, and what is there now.
   *
   * Asked when the install dialog opens, and again after every write, because
   * it is the answer to "did that work" as well as to "what are my options" —
   * one call rather than a result type the dialog would have to reconcile
   * against its own idea of the folder.
   */
  linkInstallState(): Promise<LinkInstallState>
  /**
   * Opens a folder picker and describes what came back.
   *
   * Null for a cancelled dialog. 04-connection says to accept anything that
   * looks right rather than validating hard, so nothing is rejected here — the
   * dialog shows what was found in the folder and lets the user decide.
   */
  chooseCommunityFolder(defaultPath?: string): Promise<CommunityFolder | null>
  /** Copies the package in, replacing anything already there. */
  installLink(community: string): Promise<LinkInstallResult>
  /** Takes it back out. 04-connection asks for this explicitly. */
  uninstallLink(community: string): Promise<LinkUninstallResult>

  /**
   * The Activity feed: every interaction with what it plausibly moved.
   *
   * Computed on demand rather than pushed, because it is a *view* over the
   * raw-event ring and recomputing it costs nothing next to streaming it. The
   * panel asks when it opens and whenever `onActivity` says something changed.
   */
  /**
   * The calculator code an entry would run, without running it.
   *
   * Main's job rather than the popover's because the JavaScript branch needs an
   * engine and the window's CSP forbids one — and because a preview computed by
   * the same code that sends is a preview that cannot disagree with what is
   * sent. Called as the value is typed, so it is cheap and never touches the
   * simulator.
   */
  previewSetter(
    entry: SetterEntry,
    bindings: SetterBindings
  ): Promise<SetterPreview>
  /**
   * Runs it, then watches the `get:` variable for a second.
   *
   * Resolves when the watching is over, which is deliberate: the popover stays
   * open and the answer it is waiting for — did the aircraft put the value
   * back — is not knowable sooner. Held and no-effect come back as no revert at
   * all, because the live value on the `get:` line already shows both.
   */
  runSetter(entry: SetterEntry, bindings: SetterBindings): Promise<RunResult>
  /**
   * Values this variable has been seen at, or null when there is no useful list.
   *
   * The `get:` variable's, never the write target's: `value` is the input to
   * the expression, and a transforming setter writes something else entirely.
   */
  setterPicks(name: string): Promise<number[] | null>
  /**
   * Opens the panel picker's session and reads the loaded aircraft's cockpit
   * panels from the simulator's debugger. Never rejects: every way it can fail
   * is a `reason`.
   *
   * The session holds a debugger connection to each panel until `closePanels`,
   * which keeps any other debugger out of them — so it is opened with the
   * popup and closed with it, and never kept.
   */
  openPanels(): Promise<PanelScan>
  /**
   * Reads the cockpit once and lets go of it — for the diagnostics, which want
   * to know what panels there are and nothing else. Goes through the picker's
   * session while that is open. Never rejects.
   */
  scanPanels(): Promise<PanelScan>
  /** Reads again, picking up panels that have appeared or been let go. */
  rescanPanels(): Promise<PanelScan>
  /** Outlines these panels in the cockpit, by page. An empty list clears. */
  highlightPanels(pages: number[]): Promise<void>
  /**
   * What each panel's outline is to call it, by page — the text the picker
   * would write for that panel, so the cockpit and the list agree on a name.
   */
  labelPanels(labels: Record<number, string>): Promise<void>
  /**
   * Inspect mode: the next press on a panel in the cockpit is taken as a pick
   * instead of reaching the instrument. One pick turns it off again, and
   * either way the change comes back as an `inspect` event.
   */
  inspectPanels(on: boolean): Promise<void>
  closePanels(): Promise<void>
  onPanelEvent(listener: (event: PanelEvent) => void): Unsubscribe
  /**
   * Asks another process holding the debugger to close. Resolves to null when
   * it was asked, or a lowercase reason when it was not.
   */
  closePanelHolder(pid: number): Promise<string | null>
  activityFindings(): Promise<Finding[]>
  /** Fires when a mark is made or an interaction lands. */
  onActivity(listener: () => void): Unsubscribe
  /** Records a mark now — the in-window equivalent of the hotkey. */
  addMark(): Promise<void>
  /** What the hotkeys are bound to, and whether Windows accepted them. */
  markHotkey(): Promise<Hotkeys>
  /** Rebinds one. See `MarkHotkey` on what a `true` here does not promise. */
  bindMarkHotkey(action: HotkeyAction, accelerator: string): Promise<Hotkeys>
  /**
   * Whether auto-capture is armed.
   *
   * Main's, not the panel's. Arming decides whether an interaction *becomes* a
   * capture, which is a policy about what is recorded rather than a filter over
   * what is shown — a renderer-side flag left the list growing behind it and
   * released the backlog on re-arming.
   */
  captureMode(): Promise<CaptureMode>
  setCaptureMode(mode: CaptureMode): Promise<void>
  /**
   * Input events Radar ignores for the aircraft in the sim: never captured,
   * never ranked. For controls an aircraft fires with nobody touching them.
   */
  ignoredControls(): Promise<string[]>
  setIgnored(control: string, on: boolean): Promise<void>
  /**
   * Empties the list: anchors and marks, not the values behind them.
   *
   * The values stay because baselines are measured from them — see
   * `clearAnchors`. Clearing a list should not quietly re-rank what follows it.
   */
  clearActivity(): Promise<void>
  /**
   * Collects a debug report and says where it landed.
   *
   * Everything the app knows about itself, anonymized and packaged for a tester
   * to send by hand — see docs/debug-report.md. Nothing is uploaded.
   */
  collectReport(): Promise<DebugReport>
  /** Opens the report's folder with the zip selected. */
  revealReport(file: string): Promise<void>

  /**
   * Everything the app is doing, for the Log panel.
   *
   * The backlog is asked for on mount rather than replayed: the buffer lives in
   * main precisely so a renderer reload does not lose it, which only works if
   * the renderer can ask for what it missed.
   */
  /**
   * Writes into the Log panel from the renderer.
   *
   * Without this the panel shows only the main process, which makes it a poor
   * "everything the system is doing" — half the app is on this side of the
   * bridge, and in a packaged build there is no console to fall back on.
   */
  log(
    level: LogLevel,
    kind: string,
    message: string,
    detail?: unknown
  ): Promise<void>
  logBacklog(): Promise<LogEntry[]>
  onLogBatch(listener: (entries: LogEntry[]) => void): Unsubscribe
  /**
   * The object behind one row, for a row that says it has one.
   *
   * Asked for on expansion rather than delivered with every entry — see
   * `hasDetail` in @shared/log. Resolves to undefined for a row that has since
   * fallen out of main's ring.
   */
  logDetail(id: number): Promise<unknown>
  clearLog(): Promise<void>

  /**
   * Repaints the Windows caption buttons so they match the theme the rest of
   * the header is drawn in. Does nothing on platforms without the overlay.
   */
  setTitleBarColors(colors: TitleBarColors): Promise<void>

  /**
   * What FS Copilot is doing right now, for a renderer that started after it.
   *
   * Fed by a process-list poll in main, so it covers instances launched by
   * hand as well as ones launched from here — see `main/fsc.ts`.
   */
  fscState(): Promise<FscState>
  onFscState(listener: (state: FscState) => void): Unsubscribe
  /**
   * Stops whatever FS Copilot is running, then starts the workspace's
   * executable in the given mode. Launch, restart and switch-mode are all this
   * one call — the difference is only what happened to be running before it.
   * Resolves when the new instance has been spawned, which is what lets a
   * button show in-flight for exactly as long as the operation takes.
   */
  launchFsc(mode: FscMode): Promise<void>
  /** Stops every running instance and waits for the exit. */
  stopFsc(): Promise<void>

  /**
   * Whether there is an update worth mentioning, for a renderer that started
   * after the check did.
   *
   * Always `idle` in a portable or development build, where there is no
   * installer to replace.
   */
  updateState(): Promise<UpdateState>
  onUpdateState(listener: (state: UpdateState) => void): Unsubscribe
  /**
   * Quits, installs what was already downloaded, and relaunches.
   *
   * Only ever called from a control that is offered once an update is staged,
   * so it is a restart rather than a download. Does nothing otherwise.
   */
  installUpdate(): Promise<void>
  /**
   * Asks now rather than waiting for the next cycle, and **answers**.
   *
   * The scheduled check is silent on purpose; one somebody asked for is a
   * question, and the answer goes back to the caller rather than into the
   * ambient state.
   */
  checkForUpdates(): Promise<ManualCheck>
  /** The version, and whether this build can replace itself at all. */
  about(): Promise<About>
}
