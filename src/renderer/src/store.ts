import { create } from "zustand"

import {
  newProfile,
  parseOutline,
  profileFilename,
  profileKey,
  type OutlineNode,
} from "@shared/profile"
import type {
  FileStatus,
  ManifestEntry,
  Presence,
  RemoteState,
} from "@shared/remote-connect"
import type { LogEntry } from "@shared/log"
import { LOG_BUFFER_MAX } from "@shared/log"
import { watchUnitsOf } from "@shared/vars"
import { refreshAllDiagnostics } from "@/lib/diagnostics-store"
import { messageOf } from "@/lib/errors"
import { setWatchResolution } from "@/lib/watch-resolution"
import type { SimState } from "@shared/sim"
import type {
  FileContent,
  FscState,
  ProfileFile,
  RestoredDraft,
  UpdateState,
  VarIndex,
  Workspace,
  WorkspacePick,
} from "@shared/types"

import { setProfileFiles, setVarIndex } from "@/lib/completions"
import {
  createGroup,
  groupById,
  moveBetween,
  moveWithin,
  normalize,
  openCount,
  renamedTab,
  resizeAt,
  splitGroup,
  unionTabs,
  withoutTab,
  withoutTabEverywhere,
  withTab,
  type EditorGroup,
  type GroupOrientation,
  type SplitSide,
} from "@/lib/groups"
import {
  forgetGroupViewStates,
  existingModel,
  modelFor,
} from "@/lib/monaco-setup"
import { clearSimValues, refreshCounters, setSimValues } from "@/lib/sim-values"
import { onWatchedByUiChange, watchedByUi } from "@/lib/var-watch"
import { watchSetFor } from "@/lib/watch-set"
import { loadTabs, saveTabs, type OpenTabs } from "@/lib/session"
import { loadShared, saveShared } from "@/lib/share-selection"

const OUTLINE_DEBOUNCE_MS = 200

/**
 * The smallest share of the row a pane can be dragged down to.
 *
 * A fraction rather than a pixel floor, so the limit means the same thing on
 * any window: below about an eighth there is no file left to read, only a
 * gutter and a scrollbar.
 */
const MIN_GROUP_SHARE = 0.12

const PANEL_KEY = "open-panel"

/** The side panels, in rail order. */
export type Panel = "remote" | "variables"

/**
 * The bottom slot. One panel at a time — they replace each other rather than
 * stacking, so the editor only ever gives up height once.
 *
 * Radar used to be one of these and is now a side panel, stacked under
 * whichever of Remote Connect or Variables is open. What is left here is the
 * diagnostics group: Log, Issues and Trace — what the app is doing, what is
 * wrong with the file, and what the file will do.
 */
export type BottomPanel = "log" | "issues" | "trace"

const PANELS: Panel[] = ["remote", "variables"]

/**
 * Migrates the older boolean, so an existing install does not lose its open
 * panel the first time it runs a build that has two of them.
 */
const BOTTOM_KEY = "bottom-panel"
const BOTTOM_PANELS: BottomPanel[] = ["log", "issues", "trace"]

/** What the bottom slot called Radar before Radar moved to the side column. */
const BOTTOM_RADAR = "activity"

function readBottom(): BottomPanel | null {
  const stored = localStorage.getItem(BOTTOM_KEY)
  return stored && (BOTTOM_PANELS as string[]).includes(stored)
    ? (stored as BottomPanel)
    : null
}

const RADAR_KEY = "radar-open"

/** The Variables panel's search, as it was left. See `variablesView`. */
export interface VariablesView {
  query: string
  /** The namespace chip, as `L`, `A` and so on, or null for all. */
  namespace: string | null
  thisAircraft: boolean
}
const PROFILES_KEY = "profiles-open"

/** Whether the Profiles panel is showing. Open unless somebody closed it. */
function readProfiles(): boolean {
  return localStorage.getItem(PROFILES_KEY) !== "false"
}

/**
 * Whether Radar is showing.
 *
 * A boolean rather than a member of a union, because Radar no longer shares a
 * slot with anything — it stacks under the side panel instead of replacing it,
 * so both can be open and the rail's two buttons are independent.
 *
 * The fallback migrates an install that had Radar open in the bottom slot, so
 * the move does not read as the panel having closed itself. `readBottom` drops
 * that same stored value, so the two cannot both claim it.
 */
function readRadar(): boolean {
  const stored = localStorage.getItem(RADAR_KEY)
  if (stored !== null) return stored === "true"

  return localStorage.getItem(BOTTOM_KEY) === BOTTOM_RADAR
}

/** Matches main's ring, so a long session cannot grow the mirror without end. */
function trimLog(entries: LogEntry[]): LogEntry[] {
  return entries.length > LOG_BUFFER_MAX
    ? entries.slice(-LOG_BUFFER_MAX)
    : entries
}

function readPanel(): Panel | null {
  const stored = localStorage.getItem(PANEL_KEY)
  if (stored && (PANELS as string[]).includes(stored)) return stored as Panel

  return localStorage.getItem("remote-panel-open") === "true" ? "remote" : null
}

interface OpenFile {
  /** Content as it exists on disk. */
  saved: string
  /** Content in the editor. */
  draft: string
  /**
   * Modification time of `saved`, as reported by the read or write that
   * produced it. This is what tells an edit from elsewhere apart from our own:
   * a rescan naming the mtime we already hold is the echo of our own save.
   */
  mtimeMs: number
  /**
   * The file on disk has moved on from `saved`, and this buffer has edits that
   * would replace it.
   *
   * Not an error state and not a reason to refuse anything: the draft is
   * always kept, because keeping it destroys nothing while dropping it destroys
   * work. What it changes is the save, which is the one irreversible act — that
   * asks first. Set both by a change arriving while the app runs and by a
   * restored draft finding the file already different, because those are the
   * same situation and used to be two.
   */
  stale?: boolean
  /**
   * The last save was refused, and this is the sentence main gave for it.
   *
   * On the file rather than in a map of its own, because it is a fact about this
   * buffer in exactly the way `stale` is, and because that puts it where every
   * path that replaces the entry wholesale — a save that works, a reload, a file
   * taken from the host — drops it without having to remember to.
   *
   * Typing does not clear it. `setDraft` keeps it, and should: the file is still
   * not on disk and the reason it would not go is almost certainly still true.
   * Retrying is what settles this, which is the only control the bar offers.
   */
  saveError?: string
}

interface State {
  workspace: Workspace | null
  /**
   * Whether `init` has answered yet.
   *
   * Separate from `workspace` being null, which is a real answer meaning "this
   * machine has not been set up". Without the distinction the first frame of
   * every launch is indistinguishable from a first run, and the workbench comes
   * up behind a flash of the setup screen.
   */
  initialized: boolean
  files: ProfileFile[]
  vars: VarIndex | null
  /**
   * The split panes, in layout order. See `lib/groups`.
   *
   * This is the truth about what is open where. `tabs` and `activePath` below
   * are mirrors of it, recomputed by `commit` on every change — they are kept
   * because they are what the rest of the app has always asked for, and because
   * both questions still have one answer: which files are open at all, and
   * which one the user is looking at.
   */
  groups: EditorGroup[]
  /**
   * The group with the user's attention, which is what "the editor" means.
   *
   * Set from Monaco's own focus events rather than from clicking a tab, so it
   * follows a caret placed in the other pane.
   */
  focusedGroup: string
  /** Which way the groups are laid out. */
  orientation: GroupOrientation
  /**
   * The active file of the focused group.
   *
   * A mirror — see `groups`. Everything that asks for it means "the file the
   * user is looking at": the sidebar's highlight, the Issues list, what a peer
   * is told you are reading, what Ctrl+S writes.
   */
  activePath: string | null
  /**
   * Every open file, once, whichever pane is showing it.
   *
   * A mirror — see `groups`. Everything that asks for it means "the open
   * buffers": drafts to flush, buffers to reconcile against a rescan, `get:`
   * lines to watch, models it is safe to free. A file open in two panes is one
   * open file to all of them.
   */
  tabs: string[]
  open: Record<string, OpenFile>
  outlines: Record<string, OutlineNode[]>
  /**
   * 1-based first visible line of the active file, for highlighting the
   * outline. The viewport rather than the caret, so scrolling through the file
   * moves the highlight and the sidebar agrees with the sticky header.
   */
  activeLine: number
  busy: boolean

  /** The session, as the main process reports it. */
  remote: RemoteState
  /**
   * Whether there is an update worth mentioning, which is usually not.
   *
   * Main decides that, including when a download has been going long enough to
   * be worth drawing — see `main/updates.ts`. This is only where the answer is
   * kept.
   */
  update: UpdateState
  /**
   * What the picker has ticked, or null when it is not open.
   *
   * Kept here rather than in the panel because the panel is closeable: the rail
   * can hide it and the Variables panel can take its column, and a half-made
   * selection thrown away by looking at something else would be a reason not to
   * look at anything else. Null rather than an empty array, so "not choosing"
   * and "chose nothing" stay different states — one of them starts a session
   * and the other cannot.
   */
  hostDraft: string[] | null
  /**
   * The picker has been submitted and the relay has not answered yet.
   *
   * Separate from the phases because main has none for it: `host()` publishes
   * `idle` on its way in and says nothing more until the relay hands back a
   * code, so between the click and the session there is no state that describes
   * what is happening. Without this the panel sits on a picker that no longer
   * responds to anything, which reads as a button that did not work.
   */
  hostOpening: boolean
  /** Why the last attempt to open a session failed, shown above the picker. */
  hostError: string | null
  /**
   * The simulator connection.
   *
   * Read-only here, and deliberately without an action to change it: nothing in
   * the UI connects or disconnects, because the client is always trying. See
   * 04-connection.
   */
  sim: SimState
  /**
   * What FS Copilot is doing, as main's process poll reports it.
   *
   * Read-only here like `sim` — the actions that change it (`launchFsc`,
   * `stopFsc`) are called by the launch controls directly, because the only
   * state they add is "in flight", which belongs to the button showing it.
   */
  fsc: FscState
  /**
   * The Log buffer, mirrored from main.
   *
   * Main owns the real one — see src/main/log.ts on why a renderer reload must
   * not lose it. This is a copy kept for rendering, capped identically so a
   * long session cannot grow it without bound.
   */
  log: LogEntry[]
  bottom: BottomPanel | null
  /** This workspace hashed the host's way, so the two lists can be compared. */
  localManifest: ManifestEntry[]
  /**
   * Which side panel is showing, if any. One at a time: they occupy the same
   * column, and the rail is how you choose between them.
   */
  panel: Panel | null
  /**
   * Whether Radar is showing, under the side panel. Independent of `panel`:
   * Radar and Variables are read together, which is the whole reason Radar
   * sits in that column rather than in the bottom slot.
   */
  radar: boolean
  /**
   * Whether the Profiles panel is showing, at the leading edge. Remembered
   * like the others, so a window somebody collapsed to write in stays so.
   */
  profiles: boolean
  /**
   * What the Variables panel was showing, kept here so hiding the panel does
   * not throw it away: the panel is unmounted while closed, and its own state
   * went with it.
   *
   * Session only, deliberately not in `localStorage`. Coming back to a search
   * from a minute ago is picking up where you were; coming back to one typed
   * yesterday is a list somebody has to clear before they can start.
   */
  variablesView: VariablesView
  /**
   * How far the Variables list was scrolled. Apart from `variablesView`, and
   * read with `getState` only, so a scroll writes it without re-rendering any
   * component — nothing subscribes to it.
   */
  variablesScroll: number
  /**
   * The capture Radar has selected, by anchor time, or null for the newest.
   * Here for the same reason as `variablesView`.
   */
  radarPinned: number | null
  /** Where the host is, and what they have not saved. Null unless connected. */
  presence: Presence | null
  /**
   * Which copy of a file a tab is showing, yours or the host's.
   *
   * A *mode* of the file's tab rather than a tab of its own, so tab order,
   * dirty dots, Ctrl+W and the model cache all keep working untouched — and the
   * remote view's hidden half is literally the same model as the plain editor,
   * so there is one dirty state and one undo stack however you look at it.
   */
  viewMode: Record<string, "local" | "remote">
  /** The host's copy of files we are showing a diff for. */
  remoteContent: Record<string, string>
  /**
   * Their outlines, beside `outlines` for ours.
   *
   * Kept rather than parsed where it is needed, because two places need it —
   * the sticky header over their pane and the sidebar's section list — and a
   * section list that describes a different document from the one on screen is
   * the bug this exists to make impossible. Written wherever `remoteContent` is,
   * which is what keeps the pair honest.
   */
  remoteOutlines: Record<string, OutlineNode[]>
  /** Files whose local copy follows the host's saves onto disk. */
  mirroring: Record<string, boolean>
  /**
   * The file on disk, for a tab that is comparing itself against it.
   *
   * Presence *is* the mode: a path in here is showing the comparison, and the
   * value is the text it is comparing against. Deliberately not a second entry
   * in `viewMode` — that is the remote view's, and the two want almost opposite
   * editors. See `components/stale-bar.tsx`.
   *
   * Read fresh when the comparison opens rather than reused from whatever was
   * true at restore, because "what is there now" is the entire question.
   */
  comparing: Record<string, string>

  init: () => Promise<void>
  /** Takes a folder detection offered and setup accepted. False if it is gone. */
  adoptWorkspace: (root: string) => Promise<boolean>
  /** Asks for a folder through the native picker. */
  chooseWorkspace: () => Promise<WorkspacePick>
  refresh: () => Promise<void>
  applyFiles: (files: ProfileFile[]) => Promise<void>
  reload: (relPath: string) => Promise<void>
  /**
   * Opens a file, in the focused group unless told otherwise.
   *
   * `group` is what the sidebar's drag, a jump into a pane already showing the
   * file, and a split all use to name where the tab is to land.
   */
  openFile: (relPath: string, options?: { group?: string }) => Promise<void>
  /**
   * Writes a starter profile for an aircraft that has none, and opens it.
   *
   * Named for the aircraft rather than taking a path, because the name *is* the
   * path — that 1:1 rule is what lets a button offer this without asking where
   * to put anything. See `profileKey`.
   *
   * No refusal comes back: the offer is a button with nowhere to show one, so a
   * write that fails falls back to an unsaved buffer and the log. See the
   * implementation.
   */
  createProfile: (aircraft: string) => Promise<void>
  /**
   * Whether Profiles is currently asking for a new profile's name.
   *
   * In the store rather than in `FileTree` because the field is in one panel
   * and three things open it — the Profiles header, the Profiles empty state,
   * and the empty editor in the middle of the window. A workspace with nothing
   * in it shows two of those at once, and neither is inside the other.
   */
  namingProfile: boolean
  /** Opens the name field in Profiles, from wherever the offer was made. */
  startNamingProfile: () => void
  /** Closes it, having created nothing. */
  cancelNamingProfile: () => void
  /**
   * Writes a starter profile under a name somebody typed, opens it, and answers
   * whether it happened.
   *
   * The refusal comes back rather than only going to the log, for the reason
   * `renameProfile`'s does: the thing that asked is a field with the name still
   * in it, and a name that cannot be used is a question still open.
   */
  createNamedProfile: (name: string) => Promise<string | null>
  /**
   * Renames a profile on disk and moves its tab across with it.
   *
   * `name` is what was typed into the row — a bare filename. Main decides what
   * that means for the path, so the rule that a rename cannot move a profile
   * between folders is stated once, on the side that touches the filesystem.
   */
  /**
   * Renames a profile, and answers whether it happened.
   *
   * The reason comes back rather than only going to the log, because the thing
   * that asked is a field with the name still in it: a rename Windows refused is
   * a question still open, and the answer belongs under the field where it can
   * be corrected. Null on success — there is nothing to say, and the list
   * rebuilding under the row is the confirmation.
   */
  renameProfile: (relPath: string, name: string) => Promise<string | null>
  /** Copies a profile beside itself and opens the copy. */
  duplicateProfile: (relPath: string) => Promise<void>
  /** Asks, then moves a profile to the Recycle Bin and closes its tab. */
  deleteProfile: (relPath: string) => Promise<void>
  /**
   * Closes a tab in one group.
   *
   * Only the last group holding a file closes the file: with the same profile
   * up in two panes, shutting one of them is a change to the layout and not to
   * the work, so nothing is asked and no buffer is dropped. The prompt about
   * unsaved edits belongs to the close that actually loses them.
   */
  closeFile: (relPath: string, group?: string) => Promise<void>
  moveTab: (group: string, from: number, to: number) => void
  /** Drags a tab out of one strip and into another. */
  moveTabToGroup: (
    relPath: string,
    from: string,
    to: string,
    index?: number
  ) => void

  /** Which group Monaco says has the caret. */
  focusGroup: (id: string) => void
  /**
   * Opens a new group beside one, showing a file.
   *
   * `relPath` defaults to what the source group is showing — the Ctrl+\ gesture
   * of putting the current file up twice. A split with nothing to show is not
   * a split, and does nothing.
   */
  splitEditor: (options?: {
    from?: string
    relPath?: string
    side?: SplitSide
    /**
     * A group the file leaves as it lands in the new one.
     *
     * A tab dragged to a pane's edge has been carried there — it should not
     * also stay behind. A file dragged from the sidebar has nowhere to leave.
     */
    move?: string
  }) => void
  /** Closes a whole group, and every tab in it. */
  closeGroup: (id: string) => Promise<void>
  setOrientation: (orientation: GroupOrientation) => void
  /**
   * A divider dragged: `delta` is the fraction of the row it moved by, and it
   * moves room between the panes either side of `index` only.
   */
  resizeGroups: (index: number, delta: number) => void
  /** Which group is showing a file, if any — the nearest one to focus first. */
  groupShowing: (relPath: string) => string | null
  /** What a group is showing, without reaching into `groups` at the call site. */
  groupActive: (id: string) => string | null

  setDraft: (relPath: string, draft: string) => void
  setActiveLine: (line: number) => void
  save: (relPath: string) => Promise<void>

  setPanel: (panel: Panel | null) => void
  setBottom: (bottom: BottomPanel | null) => void
  setRadar: (radar: boolean) => void
  setProfiles: (profiles: boolean) => void
  setVariablesView: (patch: Partial<VariablesView>) => void
  setRadarPinned: (pinned: number | null) => void
  /** Empties both the mirror and main's ring. */
  clearLog: () => Promise<void>
  /**
   * Opens the picker, ticked with what this folder was shared with last.
   *
   * No code exists, and nothing is shared, until Start — which is exactly what
   * makes remembering safe: the remembered set is a filled-in form you have to
   * look at, not a decision already carried out.
   */
  beginHosting: () => void
  /** Abandons the picker, dropping an attempt in flight if there is one. */
  cancelHosting: () => Promise<void>
  /** The picker's working selection, before it becomes a session. */
  setHostDraft: (paths: string[]) => void
  startHosting: () => Promise<void>
  /** Changes what a running session shares. */
  setShared: (paths: string[]) => Promise<void>
  joinSession: (code: string) => Promise<void>
  leaveSession: () => Promise<void>
  /** Writes the remote copy over the local one, reviewing nothing. */
  takeRemote: (relPath: string) => Promise<void>
  /** Opens a file showing your own copy, whatever it was last showing. */
  openLocal: (relPath: string) => Promise<void>
  /** Opens a file, in diff view when there is a remote copy to compare against. */
  openRemote: (relPath: string) => Promise<void>
  setViewMode: (relPath: string, mode: "local" | "remote") => void
  /** Re-fetches what we are showing, and mirrors what is armed, after a delta. */
  followRemoteChanges: (before: ManifestEntry[]) => Promise<void>
  /** Fetches the host's copy if we do not already hold it. */
  ensureRemoteContent: (relPath: string) => Promise<void>
  setMirroring: (relPath: string, on: boolean) => Promise<void>
  /** Opens the comparison against the file as it is on disk right now. */
  compareWithDisk: (relPath: string) => Promise<void>
  /** Closes it, back to plain editing. */
  stopComparing: (relPath: string) => void
}

const outlineTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Bound once, however many times `init` runs. */
let watchingFiles = false

/**
 * How long a buffer has to sit still before it is written to the draft store.
 *
 * Long enough that typing costs one write per pause rather than one per
 * keystroke, short enough that the exposure on a crash is a sentence. The same
 * reasoning as `OUTLINE_DEBOUNCE_MS`, and a slower interval because the cost
 * here is a file rather than a parse.
 */
const DRAFT_DEBOUNCE_MS = 500

/**
 * What the draft store already holds, so a flush can tell what moved.
 *
 * Keyed the way the store is, and reset whenever the workspace is — drafts
 * belong to a folder, and carrying this across a switch would have the first
 * flush in the new folder clear the old one's work.
 */
let persisted = new Map<string, string>()
let draftTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Writes every dirty buffer, and forgets every one that stopped being dirty.
 *
 * Reconciling rather than reacting: an action that makes a buffer clean does
 * not have to remember to clear its draft, because the next flush notices the
 * absence. The explicit clears in `save` and `closeFile` are not duplicates of
 * this — they close the window where quitting immediately after either one
 * would leave a draft behind to resurrect text the user just dealt with.
 */
async function flushDrafts(): Promise<void> {
  const state = useStore.getState()
  if (!state.workspace) return

  const dirty = new Map<string, string>()

  for (const relPath of state.tabs) {
    const file = state.open[relPath]
    if (file && file.draft !== file.saved) dirty.set(relPath, file.draft)
  }

  for (const [relPath, text] of dirty) {
    if (persisted.get(relPath) === text) continue

    const file = state.open[relPath]
    if (!file) continue

    try {
      await window.api.saveDraft(relPath, text, file.saved)
      persisted.set(relPath, text)
    } catch {
      // Left out of `persisted`, so the next flush tries again. A draft store
      // that cannot be written is not worth interrupting the editing for.
    }
  }

  for (const relPath of [...persisted.keys()]) {
    if (dirty.has(relPath)) continue

    persisted.delete(relPath)
    await window.api.clearDraft(relPath).catch(() => undefined)
  }
}

function scheduleDraftFlush(): void {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(() => void flushDrafts(), DRAFT_DEBOUNCE_MS)
}

/** Drops one from the mirror, for a caller that has already cleared the store. */
function forgetDraft(relPath: string): void {
  persisted.delete(relPath)
  void window.api.clearDraft(relPath).catch(() => undefined)
}

/**
 * What a tab leaves behind when it goes — closed, or deleted out from under.
 *
 * Shared because the two callers must agree: a delete that forgot one of these
 * would leave a buffer keyed to a file that no longer exists, and the next
 * rescan would treat it as a profile the watcher had merely failed to mention.
 */
function dropTab(state: State, relPath: string): Partial<State> {
  return {
    ...commit(withoutTabEverywhere(state.groups, relPath), state.focusedGroup),
    open: without(state.open, [relPath]),
    outlines: without(state.outlines, [relPath]),
    comparing: without(state.comparing, [relPath]),
  }
}

/**
 * A change to the groups, with the two mirrors brought back into agreement.
 *
 * Every path that opens, closes, moves or renames a tab goes through here, and
 * that is the whole reason `tabs` and `activePath` can be trusted by the twenty
 * or so places that read them. Recomputed rather than patched: a mirror that is
 * maintained by each caller remembering to is a mirror that is wrong.
 */
function commit(
  groups: EditorGroup[],
  focusedGroup: string
): Pick<State, "groups" | "focusedGroup" | "tabs" | "activePath"> {
  const settled = normalize(groups, focusedGroup)

  // Positions belong to a pane, so a pane that has gone takes them with it.
  const alive = new Set(settled.groups.map((group) => group.id))
  for (const group of groups)
    if (!alive.has(group.id)) forgetGroupViewStates(group.id)

  return {
    groups: settled.groups,
    focusedGroup: settled.focusedGroup,
    tabs: unionTabs(settled.groups),
    activePath:
      groupById(settled.groups, settled.focusedGroup)?.active ?? null,
  }
}

/** A window with one empty pane — where every workspace starts. */
function blankGroups(): Pick<
  State,
  "groups" | "focusedGroup" | "tabs" | "activePath"
> {
  const group = createGroup()
  return { groups: [group], focusedGroup: group.id, tabs: [], activePath: null }
}

/**
 * The same tab under a new name.
 *
 * Everything a tab knows is keyed by path, so a rename is a re-keying rather
 * than a close and a reopen: the draft, the dirty dot and the tab's place in
 * the strip all cross over, which is what makes renaming a profile you are
 * halfway through editing something you can do.
 *
 * The remote keys are dropped rather than moved. They describe how this file
 * stands against the host's copy, and the host has a file by the old name — the
 * comparison the rename invalidated is not one to carry forward under a new
 * key.
 */
function renameTab(state: State, from: string, to: string): Partial<State> {
  const carry = <T>(record: Record<string, T>): Record<string, T> => {
    if (!(from in record)) return record

    const next = { ...record, [to]: record[from] }
    delete next[from]
    return next
  }

  return {
    ...commit(renamedTab(state.groups, from, to), state.focusedGroup),
    open: carry(state.open),
    outlines: carry(state.outlines),
    comparing: without(state.comparing, [from]),
    viewMode: without(state.viewMode, [from]),
    remoteContent: without(state.remoteContent, [from]),
    remoteOutlines: without(state.remoteOutlines, [from]),
    mirroring: without(state.mirroring, [from]),
  }
}

/**
 * True while remembered tabs are being reopened.
 *
 * The tab list is saved by watching it change, and reopening it changes it once
 * per file. Without this, a restore that stops halfway — a file that has gone
 * missing, a workspace switched again mid-flight — would write the half it got
 * through back over the list it was reading.
 */
let restoring = false

/**
 * Files asked for over the network, waiting on the answer.
 *
 * A request and its reply are separate messages travelling through a relay, so
 * the promise that represents "fetch this file" has to be parked somewhere
 * until the reply names the same path.
 */
const awaitingFile = new Map<
  string,
  { resolve: (content: string) => void; reject: (error: Error) => void }
>()

function settleFile(relPath: string, content: string | Error): void {
  const waiting = awaitingFile.get(relPath)
  if (!waiting) return

  awaitingFile.delete(relPath)
  if (content instanceof Error) waiting.reject(content)
  else waiting.resolve(content)
}

/**
 * Where a failure goes: the Log panel.
 *
 * It timestamps the message, keeps it beside whatever main was doing at the
 * time, and carries it into a debug report.
 */
function logFailure(kind: string, error: unknown): void {
  void window.api.log("error", kind, messageOf(error))
}

const PRESENCE_DEBOUNCE_MS = 400

let presenceTimer: ReturnType<typeof setTimeout> | undefined

function presenceOf(state: State): Presence {
  return {
    activeFile: state.activePath,
    activeLine: state.activeLine,
    dirty: state.tabs.filter((relPath) => {
      const file = state.open[relPath]
      return !!file && file.draft !== file.saved
    }),
  }
}

/**
 * Publishes where the host is, at a rate a person can read.
 *
 * Scrolling and typing both move this several times a second, and a guest
 * watching a label flicker learns less than one watching it settle. A save is
 * the exception and goes at once: it is the moment the guest has been waiting
 * for, and holding it back for another fifth of a second would take the point
 * off the whole indicator.
 */
function publishPresence(state: State, immediate: boolean): void {
  clearTimeout(presenceTimer)
  presenceTimer = undefined

  if (state.remote.phase !== "hosting") return

  if (immediate) {
    void window.api.remotePresence(presenceOf(state))
    return
  }

  presenceTimer = setTimeout(() => {
    presenceTimer = undefined
    const current = useStore.getState()
    if (current.remote.phase === "hosting")
      void window.api.remotePresence(presenceOf(current))
  }, PRESENCE_DEBOUNCE_MS)
}

function fetchRemote(relPath: string): Promise<string> {
  const existing = awaitingFile.get(relPath)
  if (existing) return Promise.reject(new Error("Already fetching that file."))

  return new Promise<string>((resolve, reject) => {
    awaitingFile.set(relPath, { resolve, reject })
    void window.api.remoteRequestFile(relPath)

    setTimeout(() => {
      if (awaitingFile.has(relPath))
        settleFile(relPath, new Error("The host did not answer in time."))
    }, 15_000)
  })
}

type SetState = (
  partial: Partial<State> | ((state: State) => Partial<State>)
) => void

/**
 * Moving into a workspace: at startup, from setup, or from the footer.
 *
 * Everything derived from the old folder is dropped first and in one step. Tabs
 * name files that may not exist here, and a buffer left behind would be one
 * folder's profile showing under another folder's name. Clearing it before the
 * rescan is also what lets the editor free the models it was holding — it
 * prunes whatever is no longer a tab, and by the time the file list comes back
 * over IPC there is nothing stale left for a restored tab to pick up.
 *
 * The rescan fills the sidebar and makes the restore possible in the same
 * stroke: tabs are only reopened for files this folder actually has, which is
 * not a question that can be asked before the list arrives.
 */
async function enter(
  set: SetState,
  get: () => State,
  workspace: Workspace
): Promise<void> {
  // Read before the reset below can overwrite it. The tab list is saved by
  // watching it change, and emptying it is a change like any other — asking
  // storage afterwards would only ever return the blank we just wrote.
  const remembered = loadTabs(workspace.root)

  restoring = true
  set({
    workspace,
    ...blankGroups(),
    open: {},
    outlines: {},
    comparing: {},
    // A half-typed name belongs to the folder it was going to be created in.
    namingProfile: false,
  })

  // Drafts belong to a folder. Whatever the last one had outstanding is not
  // this one's business, and leaving it in the mirror would have the first
  // flush here clear files it has never seen.
  clearTimeout(draftTimer)
  persisted = new Map()

  try {
    await get().refresh()

    // Asked for after the rescan, because reconciling a draft means reading the
    // file it belongs to, and both halves want main to have the same idea of
    // which workspace this is.
    const drafts = await window.api.loadDrafts().catch(() => [])

    await restoreTabs(set, get, workspace, remembered, drafts)
  } finally {
    restoring = false
  }

  if (get().workspace === workspace) saveTabs(workspace.root, sessionOf(get()))
}

/**
 * Puts the starter template in a tab of the focused group.
 *
 * `saved` is what is on disk, which is the whole of the difference between the
 * two ways this is reached: the written text when the file exists, and `""`
 * when it does not. That one field decides everything downstream — a buffer
 * whose `saved` is `""` is dirty from its first frame, so the dot shows,
 * closing routes through `confirmDiscard`, `save` writes it and records a real
 * mtime, and `applyFiles` knows to keep it because its file is not on disk.
 */
function openScaffold(
  set: SetState,
  relPath: string,
  content: string,
  saved: string,
  mtimeMs: number
): void {
  set((state) => ({
    ...commit(
      withTab(state.groups, state.focusedGroup, relPath),
      state.focusedGroup
    ),
    open: { ...state.open, [relPath]: { saved, draft: content, mtimeMs } },
    outlines: { ...state.outlines, [relPath]: parseOutline(content) },
    // Whichever way a profile just appeared, the field asking for a name is
    // asking about a question that has been answered.
    namingProfile: false,
  }))
}

/**
 * Writes a new profile, lists it, and opens it clean. The refusal, or null.
 *
 * Both ways of making one go through here, so they cannot drift on the order
 * of those three steps — and the order is the point. The listing happens
 * *before* the tab, the way `duplicateProfile` does it, so the file is a row in
 * the sidebar by the time its tab appears rather than a tab for a file the list
 * denies. The watcher reports the same write a moment later and finds nothing
 * left to change.
 *
 * `content` is the caller's so that a failure can reuse it without building a
 * second copy that might carry a different date across midnight.
 */
async function startProfile(
  set: SetState,
  get: () => State,
  relPath: string,
  content: string
): Promise<string | null> {
  let written: FileContent
  try {
    written = await window.api.writeFile(relPath, content)
  } catch (error) {
    logFailure("create", error)
    return messageOf(error)
  }

  await get().applyFiles(await window.api.listFiles())
  openScaffold(set, relPath, written.content, written.content, written.mtimeMs)

  return null
}

/**
 * How long the layout sits still before it is written down.
 *
 * Every other change here — a tab opened, a pane closed — happens once and
 * could be saved on the spot. Dragging a divider does not: it moves the layout
 * on every pointer move, and writing storage sixty times a second to record a
 * size the user is still choosing is work for an answer that is about to
 * change. Short enough that letting go and quitting immediately still keeps it.
 */
const LAYOUT_DEBOUNCE_MS = 150

let layoutTimer: ReturnType<typeof setTimeout> | undefined

function scheduleLayoutSave(root: string): void {
  clearTimeout(layoutTimer)
  layoutTimer = setTimeout(() => {
    const state = useStore.getState()

    // The folder can change while this waits, and a layout belongs to the one
    // it was made in.
    if (state.workspace?.root === root) saveTabs(root, sessionOf(state))
  }, LAYOUT_DEBOUNCE_MS)
}

/** The layout, in the shape storage keeps it. */
function sessionOf(state: State): OpenTabs {
  return {
    tabs: state.tabs,
    activePath: state.activePath,
    orientation: state.orientation,
    focused: Math.max(
      0,
      state.groups.findIndex((group) => group.id === state.focusedGroup)
    ),
    groups: state.groups.map((group) => ({
      tabs: group.tabs,
      active: group.active,
      share: group.share,
    })),
  }
}

/**
 * Puts the restored buffers back into the panes they were left in.
 *
 * The files are opened first, one at a time and into whatever group exists,
 * because opening is what reads them and reading is what decides whether a
 * remembered path is still a file. Only then is the layout rebuilt, over the
 * buffers that actually arrived — a pane whose every file has gone is a pane
 * that is not restored, rather than an empty split to close by hand.
 */
function arrange(state: State, remembered: OpenTabs): Partial<State> {
  const layout = remembered.groups?.length
    ? remembered.groups
    : [{ tabs: remembered.tabs, active: remembered.activePath }]

  const placed = new Set<string>()
  const groups = layout
    .map((entry) => {
      const tabs = entry.tabs.filter((tab) => state.open[tab])
      for (const tab of tabs) placed.add(tab)

      const active =
        entry.active && tabs.includes(entry.active)
          ? entry.active
          : (tabs[0] ?? null)

      // A pane whose files have partly gone keeps the size it was left at.
      // `normalize` rebalances whatever this adds up to, so a layout that lost
      // a pane entirely still comes back to a row that fills the window.
      return createGroup(tabs, active, entry.share ?? 1)
    })
    .filter((group) => group.tabs.length)

  if (!groups.length) groups.push(createGroup())

  // A draft can outlive the tab entry that named it — that is the point of
  // having kept it — so anything restored that the layout never mentioned joins
  // the first pane rather than being read back and then not shown.
  const orphans = state.tabs.filter((tab) => !placed.has(tab))
  if (orphans.length) {
    groups[0] = {
      ...groups[0],
      tabs: [...groups[0].tabs, ...orphans],
      active: groups[0].active ?? orphans[0],
    }
  }

  const focused = groups[remembered.focused ?? 0] ?? groups[0]

  return {
    ...commit(groups, focused.id),
    orientation: remembered.orientation ?? "row",
  }
}

/**
 * Reopens the tabs this folder was left with, skipping files that have gone.
 *
 * A file that has gone is not the same as a file that never was. A draft is
 * restored whether or not anything is on disk for it — that is the whole point
 * of having kept it — so drafts are walked alongside the remembered list rather
 * than filtered by it, and one that outlived its tab entry still comes back.
 */
async function restoreTabs(
  set: SetState,
  get: () => State,
  workspace: Workspace,
  remembered: OpenTabs,
  drafts: RestoredDraft[]
): Promise<void> {
  if (!remembered.tabs.length && !drafts.length) return

  const known = new Set(get().files.map((file) => file.relPath))
  const byPath = new Map(drafts.map((draft) => [draft.relPath, draft]))

  const paths = [...remembered.tabs]
  for (const draft of drafts)
    if (!paths.includes(draft.relPath)) paths.push(draft.relPath)

  for (const relPath of paths) {
    // Somebody changed folders again while this was running. Their workspace
    // wins, and reopening the previous one's tabs into it would be a mess.
    if (get().workspace !== workspace) return

    const draft = byPath.get(relPath)

    if (draft) {
      restoreDraft(set, relPath, draft)
      persisted.set(relPath, draft.text)
      continue
    }

    if (known.has(relPath)) await get().openFile(relPath)
  }

  // Opening leaves everything in one pane with the last file forward. The
  // layout — which panes there were, what each was showing, which had focus —
  // is put back over the buffers that made it.
  set((state) => arrange(state, remembered))
}

/**
 * Seeds one restored draft as a tab.
 *
 * `saved` is the file as it is *now*, not as the draft was taken from — so the
 * dirty comparison, the diff and any later save are all against the thing that
 * will actually be overwritten. Where there is no file, `saved` is empty, which
 * is both true and exactly the shape `createProfile` produces for a profile
 * that has never been written.
 */
function restoreDraft(
  set: SetState,
  relPath: string,
  draft: RestoredDraft
): void {
  set((state) => ({
    ...commit(
      withTab(state.groups, state.focusedGroup, relPath),
      state.focusedGroup
    ),
    open: {
      ...state.open,
      [relPath]: {
        saved: draft.disk?.content ?? "",
        draft: draft.text,
        mtimeMs: draft.disk?.mtimeMs ?? 0,
        stale: draft.stale,
      },
    },
    outlines: { ...state.outlines, [relPath]: parseOutline(draft.text) },
  }))
}

export const useStore = create<State>((set, get) => ({
  workspace: null,
  initialized: false,
  files: [],
  namingProfile: false,
  vars: null,
  ...blankGroups(),
  orientation: "row",
  open: {},
  outlines: {},
  activeLine: 1,
  busy: false,
  remote: { phase: "idle" },
  update: { kind: "idle" },
  hostDraft: null,
  comparing: {},
  hostOpening: false,
  hostError: null,
  // `installed: false` before main has answered, which is the right way round
  // to be wrong for a moment: a brief invitation resolving to silence is a
  // smaller mistake than a `Restart sim` instruction shown to somebody who has
  // installed nothing.
  sim: { installed: false, phase: "offline" },
  fsc: { instances: [] },
  log: [],
  bottom: readBottom(),
  localManifest: [],
  panel: readPanel(),
  radar: readRadar(),
  profiles: readProfiles(),
  variablesView: { query: "", namespace: null, thisAircraft: false },
  variablesScroll: 0,
  radarPinned: null,
  presence: null,
  viewMode: {},
  remoteContent: {},
  remoteOutlines: {},
  mirroring: {},

  async init() {
    if (!watchingFiles) {
      watchingFiles = true
      window.api.onFilesChanged((files) => void get().applyFiles(files))

      // No reconciliation on reconnect and nothing to unsubscribe: this is a
      // summary main recomputes and resends whenever it changes, so the last
      // message received is always the truth. The one-shot read after it covers
      // a renderer that started late — including a devtools reload, which is
      // how this will usually be seen during development.
      window.api.onSimState((sim) => {
        // Hints vanish rather than going stale. A number frozen at whatever it
        // read when the sim quit is worse than no number, because it still
        // looks live.
        if (sim.phase !== "live") clearSimValues()
        set({ sim })
      })
      void window.api.simState().then((sim) => set({ sim }))

      // Same shape as the sim connection above: a pushed summary where the
      // last message is always the truth, and a one-shot read for a renderer
      // that started late.
      window.api.onFscState((fsc) => set({ fsc }))
      void window.api.fscState().then((fsc) => set({ fsc }))

      // Same shape again. The read matters more here than elsewhere: the first
      // check runs ten seconds after launch, so a renderer that reloaded later
      // would otherwise never learn about an update already staged.
      window.api.onUpdateState((update) => set({ update }))
      void window.api.updateState().then((update) => set({ update }))

      window.api.onSimValues(setSimValues)

      /*
       * The module's verdict on the refs it is watching.
       *
       * Its own subscription rather than a facet of the index, because it
       * changes for a different reason: the watch set is these tabs' `get:`
       * lines, so opening a file moves it. Main only speaks when the
       * unresolved set actually differs, so this is not a per-keystroke wake.
       */
      window.api.onWatchResolution((refs) => {
        setWatchResolution(refs)
        refreshAllDiagnostics()
      })

      void window.api
        .watchResolution()
        .then((refs) => {
          setWatchResolution(refs)
          refreshAllDiagnostics()
        })
        .catch(() => {
          // A renderer that started before the module said hello simply has no
          // verdicts yet, which is the tier's silent case rather than a fault.
        })

      /*
       * The index, when something other than the user changed it.
       *
       * Two of the three causes are the simulator's: the `L:` enumeration lands
       * a second after MSFS appears, and loading a different aeroplane rewrites
       * every `aircraft` facet in the list. Neither is a rescan — nothing on
       * disk moved — so this asks for the index rather than calling `refresh`,
       * which would walk the whole workspace to answer a question about the
       * database.
       */
      window.api.onVarsChanged(() => {
        void window.api
          .varIndex()
          .then((vars) => {
            setVarIndex(vars)
      refreshAllDiagnostics()
            set({ vars })
          })
          .catch(() => {
            // A failed refresh leaves the last good index on screen, which is
            // stale in one facet rather than absent in all of them.
          })
      })

      // Reports which half of the live-value path is moving — see the note in
      // sim-values.ts. Only speaks up when a counter actually changed, so an
      // idle session stays silent, and it is `debug` so the panel's level
      // filter can bury it once stage 3 is settled.
      let lastFired = 0
      let lastAsked = 0
      setInterval(() => {
        const { fired, asked } = refreshCounters()
        if (fired === lastFired && asked === lastAsked) return

        const note =
          fired > lastFired && asked === lastAsked
            ? "values changed but Monaco did not ask — the hint refresh is stuck"
            : "both moving"

        lastFired = fired
        lastAsked = asked
        void window.api.log(
          "debug",
          "live-values",
          `${fired} value updates, ${asked} hint requests — ${note}`
        )
      }, 3000)

      // Batches, not individual entries — main coalesces, because a 318-event
      // burst inside two milliseconds is a real shape this has to survive.
      window.api.onLogBatch((entries) =>
        set((state) => ({ log: trimLog([...state.log, ...entries]) }))
      )
      void window.api.logBacklog().then((entries) => set({ log: trimLog(entries) }))

      window.api.onRemoteEvent((event) => {
        if (event.kind === "file") {
          settleFile(event.relPath, event.content)
          return
        }

        if (event.kind === "file-error") {
          settleFile(event.relPath, new Error(event.message))
          return
        }

        if (event.kind === "presence") {
          set({ presence: event.presence })
          return
        }

        const before = get().remote
        set({ remote: event.state })

        // A session that has just ended has nothing left to compare against, so
        // every trace of the host goes with it — a stale manifest would keep
        // colouring rows, and a mirror left armed would be a remote peer who is
        // no longer there still owning a file on disk.
        if (event.state.phase === "idle") {
          for (const relPath of [...awaitingFile.keys()])
            settleFile(relPath, new Error("The session ended."))

          set({
            presence: null,
            remoteContent: {},
            remoteOutlines: {},
            mirroring: {},
            viewMode: {},
            localManifest: [],
          })

          // The reason travels in the state, and the panel is what shows it.
          //
          // Only a *failed* idle ends the wait for a code. `host()` publishes
          // one on its way in, because it disconnects whatever was there
          // before opening anything, and that arrives a beat after Start is
          // pressed — closing the Opening view a moment after it appeared and
          // dropping straight back to the picker.
          if (event.state.error && get().hostOpening)
            set({ hostOpening: false, hostError: event.state.error })

          return
        }

        if (event.state.phase === "connected")
          void get().followRemoteChanges(
            before.phase === "connected" ? before.files : []
          )

        // A guest that has just arrived has no idea where we are yet.
        //
        // This is also where the picker closes: the session existing is what
        // replaces it, so a Start that never arrives leaves the selection on
        // screen rather than dropping the panel back to "Not connected".
        if (event.state.phase === "hosting") {
          if (get().hostDraft !== null || get().hostOpening)
            set({ hostDraft: null, hostOpening: false, hostError: null })

          publishPresence(get(), true)
        }
      })

      // Presence is derived from state the editor already keeps, so it is
      // watched rather than reported from every place that could move it —
      // there is no way to add a new caret path and forget to tell anyone.
      useStore.subscribe((state, previous) => {
        if (state.remote.phase !== "hosting") return

        const moved =
          state.activePath !== previous.activePath ||
          state.activeLine !== previous.activeLine ||
          state.open !== previous.open
        if (!moved) return

        const was = presenceOf(previous).dirty.length
        const now = presenceOf(state).dirty.length
        publishPresence(state, now < was)
      })

      // Which files are open is remembered the same way it is changed: watched,
      // rather than written down by each of the several actions that can open
      // or close a tab. Nothing has to remember to record anything.
      useStore.subscribe((state, previous) => {
        if (restoring || !state.workspace) return

        // Watching the groups rather than the mirrors: which pane a file is in
        // and which pane has focus are both part of the layout being
        // remembered, and neither of them necessarily moves `tabs`.
        if (
          state.groups === previous.groups &&
          state.focusedGroup === previous.focusedGroup &&
          state.orientation === previous.orientation
        )
          return

        scheduleLayoutSave(state.workspace.root)
      })

      // Unsaved buffers, remembered the same way and for a stronger reason: a
      // tab list costs one click to rebuild, and this is the work itself.
      useStore.subscribe((state, previous) => {
        if (restoring || !state.workspace) return
        if (state.open === previous.open) return

        scheduleDraftFlush()
      })

      // A last, best-effort write. The debounce means up to half a second of
      // typing is in the air at any moment, and quitting does not wait for a
      // promise — so this is a narrowing of the window rather than a close of
      // it, and the periodic flush is what actually does the job.
      window.addEventListener("beforeunload", () => {
        clearTimeout(draftTimer)
        void flushDrafts()
      })
    }

    set({ busy: true })
    const workspace = await window.api.locateWorkspace()

    // Both facts in one update. A frame where the app is initialized but the
    // workspace has not landed yet is a frame of the setup screen on a machine
    // that was set up months ago.
    set({ busy: false, initialized: true, workspace })

    if (workspace) await enter(set, get, workspace)
  },

  async adoptWorkspace(root) {
    // Anything still in the air belongs to the folder we are leaving, and main
    // is about to stop pointing at it — so the last write has to happen while
    // it still knows where these drafts go.
    clearTimeout(draftTimer)
    await flushDrafts()

    const workspace = await window.api.adoptWorkspace(root)
    if (!workspace) return false

    await enter(set, get, workspace)
    return true
  },

  async chooseWorkspace() {
    // Anything still in the air belongs to the folder we are leaving, and main
    // is about to stop pointing at it — so the last write has to happen while
    // it still knows where these drafts go.
    clearTimeout(draftTimer)
    await flushDrafts()

    const pick = await window.api.chooseWorkspace()

    if (pick.ok) await enter(set, get, pick.workspace)

    return pick
  },

  async refresh() {
    set({ busy: true })

    try {
      const [files, vars] = await Promise.all([
        window.api.listFiles(),
        window.api.scanVars(),
      ])

      setVarIndex(vars)
      refreshAllDiagnostics()
      await get().applyFiles(files)
      set({ vars })
    } catch (error) {
      logFailure("scan", error)
    } finally {
      set({ busy: false })
    }
  },

  /**
   * A new view of what is on disk, from the watcher or from a manual rescan.
   *
   * The variable index is deliberately not rebuilt here. It is a scan of every
   * profile in the workspace, and paying for it on each keystroke-to-save cycle
   * would trade a background nicety for the responsiveness the editor is built
   * around. The rescan button owns that.
   */
  async applyFiles(files) {
    setProfileFiles(files)
    set({ files })

    // Comparing against the host means knowing what we ourselves have, so the
    // local side of the comparison is rebuilt whenever the workspace moves —
    // including when it moves because we just took a file.
    if (get().remote.phase === "connected")
      set({ localManifest: await window.api.localManifest() })

    const state = get()
    const byPath = new Map(files.map((file) => [file.relPath, file]))

    for (const relPath of state.tabs) {
      const open = state.open[relPath]
      const found = byPath.get(relPath)

      // Same mtime means this is the echo of our own save, or a change to some
      // other file entirely. A file that has vanished keeps its buffer: the tab
      // still holds the last good content, and saving puts the file back.
      if (!open || !found || found.mtimeMs === open.mtimeMs) continue

      // Someone else's edit only wins where there is nothing of ours to lose.
      // A dirty buffer keeps its draft and is marked instead: silence was the
      // old answer, and it meant the next save quietly threw away whatever had
      // arrived. The mark is what the save asks about.
      if (open.draft !== open.saved) {
        set((current) => ({
          open: {
            ...current.open,
            [relPath]: { ...open, stale: true },
          },
        }))
        continue
      }

      await get().reload(relPath)
    }
  },

  /** Pulls a file back off disk, replacing a buffer the user has not touched. */
  async reload(relPath) {
    try {
      const file = await window.api.readFile(relPath)

      // The editor is the owner of its text, so the model is told first and the
      // store follows. Undo history goes with it, which is the honest outcome:
      // undoing to a state the file no longer has would be a worse offer.
      const model = existingModel(relPath)
      if (model && model.getValue() !== file.content) model.setValue(file.content)

      // Taking the file wholesale is the answer to being stale, so the mark and
      // the comparison it opened both go with it. No `stale` here is the point
      // rather than an omission.
      set((state) => {
        const comparing = { ...state.comparing }
        delete comparing[relPath]

        return {
          comparing,
          open: {
            ...state.open,
            [relPath]: {
              saved: file.content,
              draft: file.content,
              mtimeMs: file.mtimeMs,
            },
          },
          outlines: {
            ...state.outlines,
            [relPath]: parseOutline(file.content),
          },
        }
      })
    } catch {
      // Unreadable right now — mid-write, or gone. The buffer we have is still
      // the best answer, and the next rescan will try again.
    }
  },

  async openFile(relPath, options) {
    const target = options?.group ?? get().focusedGroup

    // Already read — this is only a question of which pane shows it, and
    // whether that pane already does.
    if (get().open[relPath]) {
      set((state) => commit(withTab(state.groups, target, relPath), target))
      return
    }

    try {
      const file = await window.api.readFile(relPath)
      set((state) => ({
        ...commit(withTab(state.groups, target, relPath), target),
        open: {
          ...state.open,
          [relPath]: {
            saved: file.content,
            draft: file.content,
            mtimeMs: file.mtimeMs,
          },
        },
        outlines: { ...state.outlines, [relPath]: parseOutline(file.content) },
      }))
    } catch (error) {
      logFailure("open", error)
    }
  },

  /*
   * The file is written, the same as `createNamedProfile` — a button that says
   * *Create profile* and leaves nothing behind in the sidebar is reporting a
   * failure it did not have.
   *
   * This used to write nothing on purpose: the scaffold went straight into a
   * tab as a buffer with no file behind it, so the offer read as "here is what
   * one looks like" rather than a folder that quietly grew a file. The argument
   * did not survive contact with the word *Create*. Nobody presses it to be
   * shown a sample, and nobody then thinks to save the file they just asked for
   * — they look at the list, and the list is empty.
   *
   * The unsaved buffer survives as the **fallback**, which is what `refused`
   * below is for. A write can fail for reasons the aircraft is innocent of, and
   * this offer comes from a button with nowhere to put a sentence; handing over
   * the buffer anyway keeps the click worth something, and the next Ctrl+S
   * routes the same failure to the save error bar, which exists to explain it.
   */
  async createProfile(aircraft) {
    const key = aircraft.toLowerCase()
    const existing = get().files.find(
      (file) => profileKey(file.relPath) === key
    )

    // The button only offers this when nothing matched, but the file list is a
    // snapshot. Anything that turned up in between is the aircraft's profile
    // and this is not, so it wins.
    if (existing) {
      await get().openLocal(existing.relPath)
      return
    }

    const relPath = `${aircraft}.yaml`
    if (get().open[relPath]) {
      await get().openFile(relPath)
      return
    }

    const content = newProfile(aircraft)
    if (await startProfile(set, get, relPath, content))
      openScaffold(set, relPath, content, "", 0)
  },

  startNamingProfile: () => set({ namingProfile: true }),
  cancelNamingProfile: () => set({ namingProfile: false }),

  /*
   * The same starter template `createProfile` writes, under a name somebody
   * typed instead of one the simulator supplied.
   *
   * A separate action rather than `createProfile` with an argument, because the
   * two differ on what a taken name means. Here it is a refusal; there it opens
   * the existing profile, which is right when the aircraft is the subject and
   * the button really means "get me to this aircraft's profile", and wrong when
   * the subject is a name being typed — silently opening somebody else's file
   * is not what typing a new name asked for.
   */
  async createNamedProfile(name) {
    const checked = profileFilename(name)
    if (!checked.ok) return checked.reason

    const relPath = checked.filename
    const taken = relPath.toLowerCase()

    /*
     * Asked before the write rather than left to it. `writeFile` would happily
     * overwrite, and the two things it would overwrite are somebody's profile
     * and somebody's unsaved buffer — so this is the check that makes Enter
     * safe, not a courtesy ahead of one the disk would repeat.
     */
    if (get().files.some((file) => file.relPath.toLowerCase() === taken))
      return `${relPath} already exists.`

    if (get().tabs.some((tab) => tab.toLowerCase() === taken))
      return `${relPath} is already open.`

    /*
     * The refusal goes back to the field rather than falling back to a buffer
     * the way `createProfile` does. The field is still on screen with the name
     * in it, so there is somewhere for a sentence to land — and a folder that
     * refuses writes is worth saying out loud before the user types a second
     * name into it.
     */
    return startProfile(
      set,
      get,
      relPath,
      newProfile(relPath.replace(/\.ya?ml$/i, ""))
    )
  },

  /*
   * Main is asked first and the tab follows, rather than the other way round:
   * a rename that the filesystem refuses — the name is taken, the file is open
   * in FS Copilot — must leave the editor exactly as it was, with the reason
   * logged and the tab still pointing at a file that exists.
   *
   * The undo stack is the one thing that does not survive. Monaco keys its
   * buffers by URI as well, and a model cannot be renamed: the text crosses
   * into a new one and its history stays behind with the old.
   */
  async renameProfile(relPath, name) {
    let renamed: ProfileFile

    try {
      renamed = await window.api.renameFile(relPath, name)
    } catch (error) {
      logFailure("rename", error)
      return messageOf(error)
    }

    if (renamed.relPath !== relPath) {
      clearTimeout(outlineTimers.get(relPath))
      outlineTimers.delete(relPath)

      set((state) => renameTab(state, relPath, renamed.relPath))

      // The draft in the store is now filed under a name the draft store has
      // never heard of, and nothing else would write it there until the next
      // keystroke — which, for a rename made to put a file away, never comes.
      forgetDraft(relPath)
      scheduleDraftFlush()
    }

    await get().applyFiles(await window.api.listFiles())

    return null
  },

  async duplicateProfile(relPath) {
    try {
      const copy = await window.api.duplicateFile(relPath)

      // Listed before it is opened, so the copy is a row in the sidebar by the
      // time its tab appears rather than a tab for a file the list denies.
      await get().applyFiles(await window.api.listFiles())
      await get().openLocal(copy.relPath)
    } catch (error) {
      logFailure("duplicate", error)
    }
  },

  /*
   * The tab goes without the usual question. `closeFile` asks whether to save,
   * and there is nothing left to save to — the file is in the Recycle Bin, and
   * offering to write it back out is offering to undo what was just confirmed.
   * The warning about unsaved work happens before the delete instead, in the
   * dialog, which is where it can still be acted on.
   */
  async deleteProfile(relPath) {
    const file = get().open[relPath]

    try {
      const dirty = !!file && file.draft !== file.saved
      if (!(await window.api.deleteFile(relPath, dirty))) return
    } catch (error) {
      logFailure("delete", error)
      return
    }

    if (file) {
      clearTimeout(outlineTimers.get(relPath))
      outlineTimers.delete(relPath)

      forgetDraft(relPath)
      set((state) => dropTab(state, relPath))
    }

    await get().applyFiles(await window.api.listFiles())
  },

  async closeFile(relPath, group) {
    const file = get().open[relPath]
    if (!file) return

    const from = group ?? get().groupShowing(relPath) ?? get().focusedGroup

    // Another pane still has it up, so nothing is being lost: the tab leaves
    // this strip and the buffer, the draft and the undo stack stay exactly
    // where they are. Asking about unsaved edits here would be asking about
    // edits that are still on screen next door.
    if (openCount(get().groups, relPath) > 1) {
      set((state) => commit(withoutTab(state.groups, from, relPath), from))
      return
    }

    if (file.draft !== file.saved) {
      const choice = await window.api.confirmDiscard(relPath)
      if (choice === "cancel") return

      if (choice === "save") {
        await get().save(relPath)

        // save() logs its failures rather than throwing, so the file still
        // being dirty is how we hear about them. Closing anyway would discard
        // exactly what the user asked us to keep.
        const after = get().open[relPath]
        if (after && after.draft !== after.saved) return
      }
    }

    clearTimeout(outlineTimers.get(relPath))
    outlineTimers.delete(relPath)

    // Whatever the answer above was, this file is no longer unsaved work: it
    // was saved, or the user said not to keep it. Either way a draft surviving
    // here is the bug this feature would otherwise ship with.
    forgetDraft(relPath)

    set((state) => dropTab(state, relPath))
  },

  moveTab(group, from, to) {
    set((state) =>
      commit(moveWithin(state.groups, group, from, to), state.focusedGroup)
    )
  },

  moveTabToGroup(relPath, from, to, index) {
    set((state) =>
      commit(moveBetween(state.groups, relPath, from, to, index), to)
    )
  },

  focusGroup(id) {
    // Guarded rather than set blindly: this runs on every Monaco focus event,
    // and a `set` per click into the pane you are already in would re-render
    // every tab strip in the window for nothing.
    if (get().focusedGroup === id || !groupById(get().groups, id)) return
    set((state) => commit(state.groups, id))
  },

  splitEditor(options) {
    const state = get()
    const from = options?.from ?? state.focusedGroup
    const relPath = options?.relPath ?? groupById(state.groups, from)?.active

    // Nothing to put in it. A split showing an empty pane is a pane to close
    // again, not a feature.
    if (!relPath) return

    const { groups, group } = splitGroup(
      state.groups,
      from,
      relPath,
      options?.side
    )

    const moved = options?.move
      ? withoutTab(groups, options.move, relPath)
      : groups

    set(commit(moved, group.id))
  },

  async closeGroup(id) {
    const group = groupById(get().groups, id)
    if (!group) return

    // Through `closeFile`, so a dirty buffer that only this pane holds still
    // gets its question — closing a split must not be a quieter way to throw
    // work away than closing a tab. A cancelled prompt stops the whole thing,
    // leaving the pane with what it had left.
    for (const relPath of [...group.tabs]) {
      await get().closeFile(relPath, id)
      if (groupById(get().groups, id)?.tabs.includes(relPath)) return
    }
  },

  setOrientation(orientation) {
    set({ orientation })
  },

  resizeGroups(index, delta) {
    // Not through `commit`: a drag changes no tab, no focus and no membership,
    // so recomputing the mirrors on every pointer move would be work for an
    // answer that cannot have changed.
    set((state) => ({
      groups: resizeAt(state.groups, index, delta, MIN_GROUP_SHARE),
    }))
  },

  groupShowing(relPath) {
    const state = get()

    // The focused group first, so a file up in two panes answers with the one
    // the user is in rather than with whichever is leftmost.
    if (groupById(state.groups, state.focusedGroup)?.tabs.includes(relPath))
      return state.focusedGroup

    return (
      state.groups.find((group) => group.tabs.includes(relPath))?.id ?? null
    )
  },

  groupActive(id) {
    return groupById(get().groups, id)?.active ?? null
  },

  setDraft(relPath, draft) {
    set((state) => {
      const file = state.open[relPath]
      if (!file) return state

      return { open: { ...state.open, [relPath]: { ...file, draft } } }
    })

    // Reparsing is cheap, but re-rendering the outline on every keystroke is
    // not, so it settles after typing stops.
    clearTimeout(outlineTimers.get(relPath))
    outlineTimers.set(
      relPath,
      setTimeout(() => {
        outlineTimers.delete(relPath)
        const current = get().open[relPath]
        if (!current) return
        set((state) => ({
          outlines: {
            ...state.outlines,
            [relPath]: parseOutline(current.draft),
          },
        }))
      }, OUTLINE_DEBOUNCE_MS)
    )
  },

  setActiveLine(line) {
    if (get().activeLine !== line) set({ activeLine: line })
  },

  async save(relPath) {
    const file = get().open[relPath]
    if (!file || file.draft === file.saved) return

    // The only irreversible step in the whole draft story, and so the only one
    // that asks. Everything before it — restoring, marking, keeping — can be
    // undone by closing the tab.
    if (file.stale && !(await window.api.confirmStaleSave(relPath))) return

    try {
      const written = await window.api.writeFile(relPath, file.draft)

      // Recording the mtime the write produced is what stops the watcher's
      // rescan from reading this file straight back in as though someone else
      // had touched it. The rescan itself is what refreshes the sidebar.
      set((state) => ({
        open: {
          ...state.open,
          [relPath]: {
            saved: written.content,
            draft: written.content,
            mtimeMs: written.mtimeMs,
          },
        },
        outlines: {
          ...state.outlines,
          [relPath]: parseOutline(written.content),
        },
      }))

      // The buffer is the file now. Clearing immediately rather than leaving it
      // to the next flush, because quitting in between would leave a draft that
      // reopens as unsaved work the user has already saved.
      forgetDraft(relPath)

      // And there is nothing left to compare: what is on disk is what is in the
      // buffer, which would be an empty diff sitting where the editor was.
      get().stopComparing(relPath)
    } catch (error) {
      // Kept on the file as well as logged, because this is the one failure the
      // editor has a bar for — see `SaveErrorBar`.
      set((state) => {
        const current = state.open[relPath]
        if (!current) return state

        return {
          open: {
            ...state.open,
            [relPath]: { ...current, saveError: messageOf(error) },
          },
        }
      })
      logFailure("save", error)
    }
  },

  /**
   * Panel visibility, remembered like the panel widths beside it — someone who
   * uses Remote Connect uses it repeatedly, and reopening the same panel every
   * launch is a small tax on exactly the people who use the feature.
   */
  setPanel(panel) {
    localStorage.setItem(PANEL_KEY, panel ?? "")
    set({ panel })
  },

  setBottom(bottom) {
    localStorage.setItem(BOTTOM_KEY, bottom ?? "")
    set({ bottom })
  },

  setRadar(radar) {
    localStorage.setItem(RADAR_KEY, String(radar))
    set({ radar })
  },

  setProfiles(profiles) {
    localStorage.setItem(PROFILES_KEY, String(profiles))
    set({ profiles })
  },

  setVariablesView(patch) {
    set({ variablesView: { ...get().variablesView, ...patch } })
  },

  setRadarPinned(radarPinned) {
    set({ radarPinned })
  },

  async clearLog() {
    // Main first: clearing only the mirror would refill it from the backlog on
    // the next reload, which looks exactly like the button not working.
    await window.api.clearLog()
    set({ log: [] })
  },

  /**
   * Which copy a tab is showing — and, going local, a claim to own it again.
   *
   * Mirroring and the local view are mutually exclusive by construction rather
   * than by anyone remembering to check: a mirrored file is not really yours,
   * it is a replica the host overwrites on every save, so asking to see your
   * own copy is asking for that to stop. Enforced here rather than at the
   * button, because there is more than one way back to your own copy and only
   * one of them is a button.
   *
   * Set directly rather than through `setMirroring`, whose off path is this and
   * nothing more — the work in that action is all on the arming side.
   */
  setViewMode(relPath, mode) {
    set((state) => ({
      viewMode: { ...state.viewMode, [relPath]: mode },
      mirroring:
        mode === "local"
          ? { ...state.mirroring, [relPath]: false }
          : state.mirroring,
    }))
  },

  async ensureRemoteContent(relPath) {
    if (get().remoteContent[relPath] !== undefined) return

    try {
      const content = await fetchRemote(relPath)
      set((state) => holdRemote(state, relPath, content))
    } catch (error) {
      logFailure("fetch", error)
    }
  },

  /**
   * The host saved something. Whatever we are showing has to catch up, and
   * whatever is mirrored has to land on disk.
   *
   * Driven by the hash rather than by a subscription the host maintains: the
   * manifest already says what moved, so asking for content only when a file we
   * care about actually changed costs one round trip and no extra protocol.
   */
  async followRemoteChanges(before) {
    const state = get()
    if (state.remote.phase !== "connected") return

    // A file the host has stopped sharing takes everything derived from it with
    // it. Leaving the content behind would strand a tab in the remote view of a
    // file nobody is offering any more — and the connection bar, which is the
    // way back out, hides itself for exactly that file.
    const shared = new Set(state.remote.files.map((entry) => entry.relPath))
    const dropped = Object.keys(state.remoteContent).filter(
      (relPath) => !shared.has(relPath)
    )

    if (dropped.length)
      set((current) => ({
        remoteContent: without(current.remoteContent, dropped),
        remoteOutlines: without(current.remoteOutlines, dropped),
        viewMode: without(current.viewMode, dropped),
        mirroring: without(current.mirroring, dropped),
      }))

    const previous = new Map(before.map((entry) => [entry.relPath, entry.hash]))

    const moved = state.remote.files.filter(
      (entry) => previous.get(entry.relPath) !== entry.hash
    )

    for (const entry of moved) {
      const showing = state.remoteContent[entry.relPath] !== undefined
      const mirrored = state.mirroring[entry.relPath]
      if (!showing && !mirrored) continue

      let content: string
      try {
        content = await fetchRemote(entry.relPath)
      } catch {
        continue
      }

      set((current) => holdRemote(current, entry.relPath, content))

      if (mirrored) await writeMirrored(set, get, entry.relPath, content)
    }
  },

  /**
   * Arms a file to follow the host onto disk.
   *
   * While it is on the local pane is read-only, so there is never a local edit
   * competing with an incoming one — which is why turning it off needs no
   * reconciling, and why it cannot be turned on over unsaved changes in the
   * first place.
   */
  async compareWithDisk(relPath) {
    try {
      const file = await window.api.readFile(relPath)
      set((state) => ({
        comparing: { ...state.comparing, [relPath]: file.content },
      }))
    } catch (error) {
      logFailure("compare", error)
    }
  },

  stopComparing(relPath) {
    set((state) => {
      if (!(relPath in state.comparing)) return state

      const comparing = { ...state.comparing }
      delete comparing[relPath]
      return { comparing }
    })
  },

  async setMirroring(relPath, on) {
    const file = get().open[relPath]
    if (on && file && file.draft !== file.saved) return

    set((state) => ({ mirroring: { ...state.mirroring, [relPath]: on } }))
    if (!on) return

    try {
      const content =
        get().remoteContent[relPath] ?? (await fetchRemote(relPath))

      set((state) => holdRemote(state, relPath, content))
      await writeMirrored(set, get, relPath, content)
    } catch (error) {
      set((state) => ({ mirroring: { ...state.mirroring, [relPath]: false } }))
      logFailure("mirror", error)
    }
  },

  /**
   * Opens the picker with the profile you are looking at already ticked.
   *
   * Pre-ticking is not sharing: nothing leaves this machine until Start, and the
   * list is right there to be changed. It is a guess at the answer, and the file
   * open in front of you is overwhelmingly the one you are about to show
   * somebody — which keeps the common case at two clicks, the same as it was
   * before there was anything to choose.
   */
  beginHosting() {
    const { activePath, files, workspace } = get()
    const available = files.map((file) => file.relPath)

    // What this folder was shared with last, minus anything since deleted. It
    // beats the active profile because it is an answer somebody gave, where the
    // open file is only ever a guess at one.
    const remembered = workspace ? loadShared(workspace.root, available) : []

    const known = activePath && available.includes(activePath)

    set({
      panel: "remote",
      hostError: null,
      hostDraft: remembered.length ? remembered : known ? [activePath] : [],
    })
  },

  async cancelHosting() {
    // Backing out *during* the wait is a different act from backing out before
    // it: there is a socket in flight to drop, and what the picker should show
    // afterwards is what it was showing — the attempt is what is being
    // abandoned, not the selection behind it.
    if (get().hostOpening) {
      set({ hostOpening: false })
      await window.api.remoteDisconnect()
      return
    }

    // Nothing is written here. Ticking boxes and then backing out is a
    // selection decided against, and remembering it would offer it back.
    set({ hostDraft: null, hostError: null })
  },

  setHostDraft(paths) {
    set({ hostDraft: paths })
  },

  /**
   * Hands the selection to main, and keeps it until a session actually exists.
   *
   * The draft is *not* cleared here. Clearing it on the way out closes the
   * picker the instant the button is pressed — before the relay has answered —
   * so the panel drops back to "Not connected" and sits there, and if the call
   * fails it stays there with the selection gone and nothing said. Which is
   * indistinguishable, from the outside, from the app having fallen over.
   *
   * It is cleared where the session appears instead: `phase: "hosting"` in the
   * event handler. Until then the picker stays on screen with its ticks intact,
   * which is also the right place to come back to if this never arrives.
   */
  async startHosting() {
    const { hostDraft: paths, workspace } = get()
    // Guarded rather than trusted to the disabled button: this is the call that
    // mints a code, and a session sharing nothing is one nobody can use.
    if (!paths?.length) return

    set({ hostOpening: true, hostError: null })

    try {
      await window.api.remoteHost(paths)
    } catch (error) {
      // Reported in the panel rather than left as an unhandled rejection in a
      // console nobody has open. The picker is still there, still ticked, so
      // this reads as "that did not work" rather than as the panel resetting.
      set({
        hostOpening: false,
        hostError:
          error instanceof Error ? error.message : "Could not open a session.",
      })
      return
    }

    // Written once the selection has actually been handed over, which is what
    // makes it the answer to "what did I share last time" rather than "what did
    // I last look at in the picker".
    if (workspace) saveShared(workspace.root, paths)
  },

  async setShared(paths) {
    const { remote, workspace } = get()
    if (remote.phase !== "hosting") return

    await window.api.remoteShared(paths)
    if (workspace) saveShared(workspace.root, paths)
  },

  async joinSession(code) {
    // The panel has a whole view for connecting, naming the code, with the
    // way out of it. See `RemoteConnectPanel`.
    set({ panel: "remote" })
    await window.api.remoteJoin(code)
    set({ localManifest: await window.api.localManifest() })
  },

  /**
   * Ends the session, and puts a host back where they were.
   *
   * A host who stops is usually about to start again with a different list, so
   * they come back to the picker, ticked with what they were sharing a moment
   * ago. The alternative is landing on "Host a session / Connect with a code" —
   * a screen with nothing on it — and clicking through it to reach the list
   * they were just looking at.
   *
   * The live list under the code means stopping is not actually *required* to
   * change what is shared. It is still what people reach for, and a habit that
   * costs two extra clicks is not one worth training out of somebody.
   *
   * Only a host. A guest has no selection to return to, so leaving one really
   * is leaving, and they get the front page.
   */
  async leaveSession() {
    const { remote, hostDraft } = get()

    // Also the way out of the Opening view, where the draft is already what we
    // want and is therefore left alone.
    set({
      hostOpening: false,
      hostError: null,
      hostDraft: remote.phase === "hosting" ? remote.shared : hostDraft,
    })

    await window.api.remoteDisconnect()
    set({ localManifest: [] })
  },

  /**
   * The remote copy, written straight over the local one.
   *
   * Deliberately immediate: this is the download action, and asking twice about
   * a profile the user has no local changes to would be noise. The single case
   * that can destroy work — a tab with unsaved edits — is the single case that
   * stops to ask.
   */
  async takeRemote(relPath) {
    const state = get()
    const open = state.open[relPath]

    if (open && open.draft !== open.saved) {
      const proceed = await window.api.confirmOverwrite(relPath)
      if (!proceed) return
    }

    try {
      const content = await fetchRemote(relPath)
      const written = await window.api.writeFile(relPath, content)

      // An open tab has to follow the file, and the buffer is clean afterwards
      // either way: the user either had no changes, or agreed to lose them.
      if (get().open[relPath])
        adopt(set, relPath, written.content, written.mtimeMs)
    } catch (error) {
      logFailure("take", error)
    }
  },

  /**
   * Picking a profile out of your own list, which says which copy you meant.
   *
   * Separate from `openFile` on purpose: that one is also how a tab click, a
   * Ctrl+Tab and an outline jump reach a file, and none of those are a
   * statement about *which* copy — each tab keeps whichever view you left it
   * in. Only choosing it from the list of your own profiles says "mine", and
   * that is also what makes it the way back out of the host's copy.
   */
  async openLocal(relPath) {
    await get().openFile(relPath)
    get().setViewMode(relPath, "local")
  },

  /**
   * Reading rather than taking, which is why this opens a diff and never writes.
   *
   * A file only the host has still opens as a diff, against an empty buffer — so
   * the whole thing reads as incoming and the same Take that merges one line
   * also creates the file. One mechanism instead of a special case for "new".
   */
  async openRemote(relPath) {
    const state = get()
    const status = remoteStatuses(state.remote, state.localManifest).get(
      relPath
    )

    // Nothing to compare against — including a profile only we have, which the
    // remote list does not show but the sidebar still opens.
    if (status === undefined) {
      await get().openFile(relPath)
      get().setViewMode(relPath, "local")
      return
    }

    await get().ensureRemoteContent(relPath)
    if (get().remoteContent[relPath] === undefined) return

    if (status === "remote-only") {
      set((current) => ({
        ...commit(
          withTab(current.groups, current.focusedGroup, relPath),
          current.focusedGroup
        ),
        open: current.open[relPath]
          ? current.open
          : {
              ...current.open,
              // Nothing on disk yet, and an empty buffer is the honest starting
              // point: clean, so closing asks nothing, and dirty the moment a
              // Take puts something in it.
              [relPath]: { saved: "", draft: "", mtimeMs: 0 },
            },
        outlines: { ...current.outlines, [relPath]: [] },
      }))

      modelFor(relPath, "")
    } else {
      await get().openFile(relPath)
    }

    get().setViewMode(relPath, "remote")
  },
}))

/**
 * The host's copy of a file, and the outline that goes with it.
 *
 * One function so the two cannot be written apart. Parsed once on arrival
 * rather than on each render of the two things that read it — their content
 * only moves when the host saves.
 */
function holdRemote(
  state: State,
  relPath: string,
  content: string
): Partial<State> {
  return {
    remoteContent: { ...state.remoteContent, [relPath]: content },
    remoteOutlines: {
      ...state.remoteOutlines,
      [relPath]: parseOutline(content),
    },
  }
}

/** A copy of `record` with `keys` gone. */
function without<T>(
  record: Record<string, T>,
  keys: string[]
): Record<string, T> {
  const next = { ...record }
  for (const key of keys) delete next[key]
  return next
}

/**
 * A mirrored file landing on disk.
 *
 * This is the one path where somebody else's edit becomes a write without a
 * keystroke here, so it goes through the same `writeFile` as Ctrl+S — one place
 * that validates a path, one place that touches the workspace.
 */
async function writeMirrored(
  set: (partial: (state: State) => Partial<State>) => void,
  get: () => State,
  relPath: string,
  content: string
): Promise<void> {
  const written = await window.api.writeFile(relPath, content)
  if (get().open[relPath]) adopt(set, relPath, written.content, written.mtimeMs)
}

/** Replaces an open buffer and the model behind it, leaving it clean. */
function adopt(
  set: (partial: (state: State) => Partial<State>) => void,
  relPath: string,
  content: string,
  mtimeMs: number
): void {
  const model = existingModel(relPath)
  if (model && model.getValue() !== content) model.setValue(content)

  set((state) => ({
    open: {
      ...state.open,
      [relPath]: { saved: content, draft: content, mtimeMs },
    },
    outlines: { ...state.outlines, [relPath]: parseOutline(content) },
  }))
}

/**
 * How each file compares, across the union of both sides.
 *
 * Derived rather than stored: both inputs already change on their own schedule —
 * the host's manifest over the network, ours from the watcher — and a third copy
 * of the answer would only be a way for them to disagree.
 */
export function remoteStatuses(
  remote: RemoteState,
  localManifest: ManifestEntry[]
): Map<string, FileStatus> {
  const statuses = new Map<string, FileStatus>()
  if (remote.phase !== "connected") return statuses

  const local = new Map(
    localManifest.map((entry) => [entry.relPath, entry.hash])
  )

  for (const entry of remote.files) {
    const ours = local.get(entry.relPath)
    statuses.set(
      entry.relPath,
      ours === undefined
        ? "remote-only"
        : ours === entry.hash
          ? "identical"
          : "modified"
    )
  }

  // Files only we have are not added: the host cannot receive them, so a row
  // for one would carry no action.
  return statuses
}

/**
 * Keeps the simulator's watch set in step with what is open.
 *
 * A subscription rather than a line inside `openFile`, `closeFile` and
 * `setDraft`: that is three call sites today and four the next time a tab can
 * change, and a watch set one edit behind does not look like a missing call —
 * it looks like the simulator being slow, which is a much worse bug to chase.
 *
 * Debounced, because `setDraft` fires per keystroke and rebuilding the set
 * means re-scanning every open profile. Cheap per run, not cheap sixty times a
 * second.
 *
 * **120 ms, not 300.** A `get:` line that has just been typed has a value
 * waiting for it — main holds every `L:` the module has ever reported, so the
 * only thing between the line existing and the line having a number is this
 * timer plus a 16 ms flush. At 300 ms that was a third of a second of nothing
 * next to values that otherwise track a moving control, which reads as the new
 * line being broken rather than as the editor being careful.
 *
 * It used to be defended on a second ground — that re-sending the set rebuilds
 * the `A:` data definition and "every value would blink" — and that stopped
 * being true when main gained a value store. `setWatch` changes which values
 * are *sent*, not which are *held*, so a definition rebuild costs one frame of
 * `A:` staleness and nothing visible.
 */
let watchTimer: ReturnType<typeof setTimeout> | undefined
let lastOpen: State["open"] | null = null
let lastTabs: State["tabs"] | null = null
let lastWatchKey = ""

/**
 * Sends the union of what the editor and the interface are showing.
 *
 * **A union, because the watch set is a replace.** The `get:` lines in the open
 * tabs are one half; chips rendered in panels are the other, and either sending
 * alone would silently darken the other's values. See `var-watch.ts`.
 *
 * A UI-held name carries no units of its own — a chip renders a value, not a
 * unit. For `L:` that is exactly right, since the module reports raw and the
 * store keeps it raw. For `A:` it is not: SimConnect needs a unit to build the
 * data definition and rejects the datum without one, which would leave the chip
 * silently blank forever rather than failing. `Number` is the general-purpose
 * unit and covers all but a handful — of the corpus lines that name a unit at
 * all, 99.7% are `Number`, `Bool`, `Percent` or `Enum`.
 *
 * Where the editor already asks for the same name, that entry wins: it is the
 * more specific request, and two entries for one name would have the sim answer
 * twice.
 */
function sendWatchSet(state: State): void {
  const texts = state.tabs
    .map((relPath) => state.open[relPath]?.draft)
    .filter((text): text is string => text !== undefined)

  const watch = watchSetFor(texts)
  const named = new Set(watch.map((entry) => entry.name))

  for (const name of watchedByUi()) {
    if (named.has(name)) continue
    watch.push({ name, units: watchUnitsOf(name) })
  }

  // Re-sending an identical set would clear and rebuild the `A:` data
  // definition in the sim for no reason. Still worth skipping, just no longer
  // for the reason the old comment gave.
  const key = watch
    .map((entry) => `${entry.name} :: ${entry.units}`)
    .join(" | ")
  if (key === lastWatchKey) return
  lastWatchKey = key

  void window.api.watchSimVars(watch)
}

function scheduleWatchSet(): void {
  clearTimeout(watchTimer)
  watchTimer = setTimeout(() => sendWatchSet(useStore.getState()), 120)
}

useStore.subscribe((state) => {
  // Identity checks first: this runs on every state change, including each
  // batch of log entries, and most of them cannot have moved a `get:` line.
  if (state.open === lastOpen && state.tabs === lastTabs) return
  lastOpen = state.open
  lastTabs = state.tabs

  scheduleWatchSet()
})

// Debounced through the same timer as the editor's half, so a list rendering
// thirty chips at once sends one message rather than thirty.
onWatchedByUiChange(scheduleWatchSet)

export function isDirty(state: State, relPath: string | null): boolean {
  if (!relPath) return false
  const file = state.open[relPath]
  return !!file && file.draft !== file.saved
}
