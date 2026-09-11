import { useEffect, useRef, useState } from "react"

import { ChevronRight } from "lucide-react"

import { nodesAtLine, type OutlineNode } from "@shared/profile"

import { ConnectionBar } from "@/components/remote-connect/connection-bar"
import {
  flushPendingReveal,
  forgetGroup,
  registerEditingEditor,
  registerEditor,
  saveFile,
} from "@/lib/editor-bridge"
import { groupById } from "@/lib/groups"
import {
  modelFor,
  monaco,
  pruneModels,
  rememberViewState,
  diskModelFor,
  relPathOf,
  remoteModelFor,
  setupMonaco,
  viewStateFor,
} from "@/lib/monaco-setup"
import {
  applyMonacoTheme,
  MONACO_THEME,
  watchThemeChanges,
} from "@/lib/monaco-theme"
import { acceptDrops } from "@/lib/editor-drop"
import { installTraceHighlight } from "@/lib/trace-highlight"
import { monacoOptionsFor, usePrefs } from "@/lib/prefs"
import { EditorEmpty } from "@/components/editor-empty"
import { installPanelPicker } from "@/components/panel-picker/widget"
import { installRunSetter } from "@/components/run-setter/widget"
import { SaveErrorBar } from "@/components/save-error-bar"
import { StaleBar } from "@/components/stale-bar"
import { useDiff } from "@/lib/use-diff"
import { cn } from "@/lib/utils"
import { setCaret } from "@/lib/caret"
import { useStore } from "@/store"

type Editor = monaco.editor.IStandaloneCodeEditor
type DiffEditor = monaco.editor.IStandaloneDiffEditor

/**
 * Names the section that has scrolled off the top, the way VS Code's sticky
 * scroll does. It follows the viewport rather than the caret: once you scroll
 * away from the caret to read something else, a caret-based header would be
 * describing a part of the file you cannot see.
 */
function StickyHeader({
  editor,
  outline,
}: {
  editor: Editor | null
  /**
   * The outline of whatever that editor is showing — which in the remote view
   * is the host's file, not ours. Passed in rather than looked up by path,
   * because the two views show two different documents under one name and a
   * header naming our sections over their text would be worse than none.
   */
  outline: OutlineNode[] | undefined
}) {
  const [trail, setTrail] = useState<OutlineNode[]>([])

  useEffect(() => {
    if (!editor) {
      setTrail([])
      return
    }

    const update = () => {
      const visible = editor.getVisibleRanges()[0]
      if (!visible) {
        setTrail([])
        return
      }

      // Blocks are skipped: "shared" is not a section, and YAML's own folding
      // already covers it.
      const sections = (outline ?? []).flatMap((node) =>
        node.kind === "block" ? node.children : [node]
      )

      // Suppress a heading that is on screen, so the title is not shown twice.
      setTrail(
        nodesAtLine(sections, visible.startLineNumber).filter(
          (node) => node.line < visible.startLineNumber
        )
      )
    }

    update()
    const subscription = editor.onDidScrollChange(update)
    return () => subscription.dispose()
  }, [editor, outline])

  if (!trail.length) return null

  return (
    <div className="absolute top-0 right-0 left-0 z-10 flex h-6 items-center gap-1 border-b border-border bg-background px-2 text-xs text-muted-foreground select-none">
      {trail.map((node, index) => (
        <span key={node.line} className="flex items-center gap-1">
          {index > 0 && <ChevronRight className="size-3 opacity-60" />}
          <span className={index === trail.length - 1 ? "text-foreground" : ""}>
            {node.title}
          </span>
        </span>
      ))}
    </div>
  )
}

/**
 * The gutter's own column, between the line numbers and the text.
 *
 * Monaco's default is 10, which is enough for a column that only ever held
 * space. It holds the run-setter button now, and 10 px leaves a glyph touching
 * both edges with nothing to aim at. 20 is what VS Code gives its own gutter
 * controls, and moves nothing relative to anything else: every line shifts by
 * the same ten pixels, so the indentation the file describes is still the
 * indentation on screen.
 *
 * Named here because the diff has to be told it explicitly — the two editors
 * are kept in step by hand, and a file that jumped sideways when you switched
 * views would be worse than either width.
 */
const LINE_DECORATIONS_WIDTH = 20

/**
 * What Monaco silently adds to that column to make room for folding chevrons —
 * `lineDecorationsWidth += 16` when folding is on, which it is in the plain
 * editor and can never be in a diff, since the diff editor hard-codes
 * `folding: false` onto both of its halves.
 *
 * Left alone, that is a sixteen-pixel step in where the text begins every time
 * you cross between your copy and the host's. The same file, jumping sideways,
 * because one of the two panes has a feature the other cannot have.
 */
const FOLDING_MARGIN_WIDTH = 16

/** Shared by both editors, so the two views cannot drift in feel. */
const EDITOR_OPTIONS = {
  theme: MONACO_THEME,
  automaticLayout: true,
  fontSize: 13,
  lineHeight: 1.6,
  // Monaco measures the face itself, so it takes a literal rather than a
  // custom property. `--font-editor` in index.css is the same stack, for the
  // interface text that quotes the file — the two are meant to match.
  fontFamily:
    "'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier New', monospace",
  minimap: { enabled: false },
  // Monaco's default, restored. It buys two things: the last line can be
  // scrolled up to where it is comfortable to read rather than being pinned to
  // the bottom edge, and there is somewhere to put a widget that has to sit
  // *below* a line — the run-setter popover goes under its entry so the `get:`
  // line's live value stays visible above it, and the final entry in a file
  // would otherwise have no room underneath at all.
  scrollBeyondLastLine: true,
  renderLineHighlight: "line",
  smoothScrolling: true,
  tabSize: 2,
  insertSpaces: true,
  // Enter asks the grammar where the next line goes, through the on-type
  // formatting provider in monaco-setup. Without this the provider is
  // never called and Monaco just copies the previous line's indentation.
  formatOnType: true,
  padding: { top: 12, bottom: 24 },
  // Explicit on both sides, because the diff has to match it by hand.
  lineDecorationsWidth: LINE_DECORATIONS_WIDTH,
  scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
  // Comments included, so typing "#" offers the section headings.
  quickSuggestions: { other: true, comments: true, strings: true },
  suggestSelection: "first",
  wordBasedSuggestions: "off",
  stickyScroll: { enabled: false },
} as const satisfies monaco.editor.IStandaloneEditorConstructionOptions

/**
 * One editor group: the three Monaco instances, and whichever of them the file
 * in front of you wants.
 *
 * Everything here used to be the window's only editor and is now one of
 * several, which is why `group` is threaded through rather than read from the
 * store: the pane has to be able to say *which* pane it is to the bridge, to
 * the view-state store and to the focus tracking, and "the active one" is
 * exactly the answer that stops being available once there are two.
 */
export function EditorPane({ group }: { group: string }) {
  const container = useRef<HTMLDivElement>(null)
  const diffContainer = useRef<HTMLDivElement>(null)
  const compareContainer = useRef<HTMLDivElement>(null)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [diffEditor, setDiffEditor] = useState<DiffEditor | null>(null)
  const [compareEditor, setCompareEditor] = useState<DiffEditor | null>(null)

  // This group's file, not the window's. The store's `activePath` is the
  // focused group's, which is the right answer for the sidebar and the wrong
  // one for a pane that does not have focus.
  const activePath = useStore(
    (state) => groupById(state.groups, group)?.active ?? null
  )
  // The union across every group, because this is what frees models — a file
  // closed here but still up next door has not stopped being open.
  const tabs = useStore((state) => state.tabs)
  const mirroring = useStore((state) =>
    activePath ? !!state.mirroring[activePath] : false
  )
  const remoteText = useStore((state) =>
    activePath ? state.remoteContent[activePath] : undefined
  )

  // A diff needs both halves. Until the host's copy arrives there is nothing to
  // compare against, so the plain editor stays up rather than flashing an empty
  // pane on the way.
  const showDiff = useStore(
    (state) =>
      !!activePath &&
      state.viewMode[activePath] === "remote" &&
      state.remoteContent[activePath] !== undefined
  )

  const diff = useDiff(diffEditor, showDiff && !mirroring)

  /**
   * Settings → Editor, applied to every instance that exists.
   *
   * `updateOptions` on the three editors rather than options at creation,
   * because creation happens once and the preferences can change while all
   * three are alive. The diff editors propagate editor options to both of
   * their panes, which is what keeps the remote view and the comparison in
   * the same type size as the plain editor — the "cannot drift in feel" rule
   * `EDITOR_OPTIONS` states, extended to values the user picks.
   */
  const editorPrefs = usePrefs((state) => state.editor)
  useEffect(() => {
    const options = monacoOptionsFor(editorPrefs)
    editor?.updateOptions(options)
    diffEditor?.updateOptions(options)
    compareEditor?.updateOptions(options)
  }, [editorPrefs, editor, diffEditor, compareEditor])

  /**
   * The file on disk, when this tab is comparing itself against it.
   *
   * A separate flag from `showDiff` and a separate editor below, because the
   * remote view and this one want almost inverted editors — that one shows the
   * host's copy with ours hidden behind it, this one shows *ours* with the
   * file as a reference. Folding them into one instance would mean every option
   * in either becoming a conditional.
   */
  const compareText = useStore((state) =>
    activePath ? state.comparing[activePath] : undefined
  )
  const showCompare = compareText !== undefined && !showDiff

  const localOutline = useStore((state) =>
    activePath ? state.outlines[activePath] : undefined
  )
  const remoteOutline = useStore((state) =>
    activePath ? state.remoteOutlines[activePath] : undefined
  )

  // Created once; the model is swapped per file so undo history is preserved.
  useEffect(() => {
    if (!container.current) return

    setupMonaco()
    applyMonacoTheme()

    const instance = monaco.editor.create(container.current, EDITOR_OPTIONS)

    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveLocal)

    // Scrolling is what moves you between sections, so the highlight follows
    // viewport. Cursor moves are included because they can scroll the view
    // without a scroll event of their own arriving first.
    const track = () => reportActiveLine(group, instance)
    const scroll = instance.onDidScrollChange(track)
    const cursor = instance.onDidChangeCursorPosition(track)

    const stopDropping = acceptDrops(container.current, instance)

    // The run button in front of every entry, and the popover it opens. Only
    // on this editor: the diff below is the host's copy of a file, and running
    // a setter from a view of somebody else's document is a different question
    // from running one from your own.
    const stopRunSetter = installRunSetter(instance)

    // The Pick button on an empty `pointer:` or `ignore:` item. On this editor
    // only, for the run button's reason: it writes into the file it is on.
    const stopPanelPicker = installPanelPicker(instance)

    // The lift under the entry the Trace panel is describing. Same reasoning
    // again: it points at the file this pane is showing.
    const stopTraceHighlight = installTraceHighlight(instance)

    const stopWatchingTheme = watchThemeChanges()

    // Which editor the sidebar drives is decided below, by whichever one is on
    // screen, rather than here — this one is not always it.
    setEditor(instance)

    return () => {
      scroll.dispose()
      cursor.dispose()
      stopDropping()
      stopRunSetter.dispose()
      stopPanelPicker.dispose()
      stopTraceHighlight.dispose()
      stopWatchingTheme()
      instance.dispose()
      setEditor(null)
    }
    // `group` never changes for a mounted pane — the grid keys panes by it — but
    // it is read by the trackers above, so it is declared rather than assumed.
  }, [group])

  // The diff, created once and kept. Both editors stay mounted and the hidden
  // one is only hidden, so switching views costs a `layout()` rather than a
  // teardown — and each keeps its own scroll position while it waits.
  useEffect(() => {
    if (!diffContainer.current) return

    setupMonaco()

    const instance = monaco.editor.createDiffEditor(diffContainer.current, {
      ...EDITOR_OPTIONS,
      // One pane, and it shows the host's copy — this is the *remote* view of a
      // file rather than a two-document comparison. Monaco renders the
      // `modified` side in a single-pane diff and hides the other, so the
      // host's file is the modified one and ours is the original, sitting
      // behind it holding the edits a take lands in.
      //
      renderSideBySide: false,
      // One column of line numbers, and it is the host's. A single-pane diff
      // otherwise keeps the original editor alive at the width of its margin
      // purely to run a second gutter of *our* numbering alongside theirs,
      // which is two answers to "what line is this" for one column of text.
      // `compactMode` is the flag that suppresses it — its only other effects
      // are to force the single pane we already asked for, and to tune folding
      // of unchanged regions, which is off.
      compactMode: true,
      // The folding margin, paid for by hand. The diff cannot have folding, so
      // it cannot earn the width Monaco grants for it — claiming the same width
      // here is what puts the numbers and the first character of every line at
      // the same place in both views.
      lineDecorationsWidth: LINE_DECORATIONS_WIDTH + FOLDING_MARGIN_WIDTH,
      originalEditable: true,
      readOnly: true,
      // Monaco's own per-hunk buttons only ever edit the `modified` side, which
      // here is the host's copy — the wrong direction entirely. Off, so nothing
      // offers to write to a file that is not ours. Taking is the connection
      // bar's job, and the panel's file list for a whole profile.
      renderGutterMenu: false,
      renderOverviewRuler: false,
    })

    // The pane on screen is the host's, so it is the one that reports where you
    // are reading and the one Ctrl+S is bound on — though the save itself goes
    // through the hidden half, which is where our file lives.
    const shown = instance.getModifiedEditor()

    shown.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveLocal)

    const track = () => reportActiveLine(group, shown)
    const scroll = shown.onDidScrollChange(track)
    const cursor = shown.onDidChangeCursorPosition(track)

    setDiffEditor(instance)

    return () => {
      scroll.dispose()
      cursor.dispose()
      instance.dispose()
      setDiffEditor(null)
    }
  }, [group])

  /**
   * The comparison editor, built the first time one is asked for and kept.
   *
   * Lazy where the remote diff is eager, because the two are asked for at very
   * different rates: a session puts you in the remote view constantly, while a
   * file going stale underneath you is a thing that happens now and then. There
   * is no reason for every launch to pay for a third Monaco instance that most
   * of them never show.
   */
  useEffect(() => {
    if (!showCompare || compareEditor || !compareContainer.current) return

    setupMonaco()

    const instance = monaco.editor.createDiffEditor(compareContainer.current, {
      ...EDITOR_OPTIONS,
      // Two panes, always: this is a comparison, and the question being asked
      // is what changed on one side against the other. Monaco would otherwise
      // collapse to a single inline pane once the column gets narrow, which
      // answers a different question — the two copies stop sitting next to
      // each other exactly when the editor is hardest to read.
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      // Ours is the `modified` side, and it is the same model the plain editor
      // holds — so edits made here reach the store through the subscription
      // that is already watching it, and the undo stack is one stack.
      originalEditable: false,
      readOnly: false,
      // Left on, unlike the remote view, and for the reason it is off there:
      // Monaco's per-hunk buttons write into `modified`, which there is the
      // host's copy and here is our own buffer. Reverting a hunk to what the
      // file says is an edit the user could make by typing.
      renderGutterMenu: true,
      renderOverviewRuler: false,
      lineDecorationsWidth: LINE_DECORATIONS_WIDTH + FOLDING_MARGIN_WIDTH,
    })

    const shown = instance.getModifiedEditor()
    shown.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveLocal)

    setCompareEditor(instance)
  }, [showCompare, compareEditor])

  // Disposed with the pane rather than with the effect above, which reruns.
  useEffect(() => () => compareEditor?.dispose(), [compareEditor])

  /**
   * Both halves of the comparison: the file on the left, the buffer on the
   * right. Ours has to be the live model rather than a copy of its text, or
   * typing in this view would go nowhere the store can see.
   */
  useEffect(() => {
    if (!compareEditor) return

    if (!showCompare || !activePath || compareText === undefined) {
      compareEditor.setModel(null)
      return
    }

    const draft = useStore.getState().open[activePath]?.draft ?? ""

    compareEditor.setModel({
      original: diskModelFor(activePath, compareText),
      modified: modelFor(activePath, draft),
    })

    compareEditor.layout()
    if (useStore.getState().focusedGroup === group)
      compareEditor.getModifiedEditor().focus()
  }, [group, compareEditor, activePath, showCompare, compareText])

  /**
   * The sidebar drives whichever editor is on screen.
   *
   * Clicking a section has to land in the pane the file is actually showing in,
   * or jumping to a heading would silently scroll an editor nobody can see.
   */
  useEffect(() => {
    const showing =
      showDiff && diffEditor
        ? diffEditor.getModifiedEditor()
        : showCompare && compareEditor
          ? compareEditor.getModifiedEditor()
          : editor

    registerEditor(group, showing)
    return () => registerEditor(group, null)
  }, [group, editor, diffEditor, showDiff, compareEditor, showCompare])

  /**
   * Which pane the user is in, which is what "the editor" means everywhere
   * else — Ctrl+S, the Issues list, what a peer is told you are reading.
   *
   * Monaco's own focus event rather than a click handler on the container: the
   * caret can move between panes by keyboard, by a jump from the sidebar, or
   * by a click that lands on a widget rather than on the text, and all three
   * are the same fact.
   */
  useEffect(() => {
    const focus = useStore.getState().focusGroup
    const instances = [
      editor,
      diffEditor?.getModifiedEditor(),
      diffEditor?.getOriginalEditor(),
      compareEditor?.getModifiedEditor(),
      compareEditor?.getOriginalEditor(),
    ]

    const subscriptions = instances.flatMap((instance) =>
      instance ? [instance.onDidFocusEditorText(() => focus(group))] : []
    )

    return () => {
      for (const subscription of subscriptions) subscription.dispose()
    }
  }, [group, editor, diffEditor, compareEditor])

  // The bridge's slot for this group, freed when the group itself goes. Its own
  // effect with no dependencies, so it runs on unmount and not on every
  // re-registration above.
  useEffect(() => () => forgetGroup(group), [group])

  /**
   * Saving, which follows our file rather than the view.
   *
   * In the remote view the visible pane is the host's, and it is read-only —
   * formatting it would do nothing and saving from it would write our file out
   * unformatted. Our copy is the diff's hidden original, and that is what a
   * save has to run through.
   */
  useEffect(() => {
    registerEditingEditor(
      group,
      showDiff && diffEditor ? diffEditor.getOriginalEditor() : editor
    )
    return () => registerEditingEditor(group, null)
  }, [group, editor, diffEditor, showDiff])

  /**
   * Draft tracking, kept apart from which editor is on screen.
   *
   * Both views share one model, so this follows the *file* rather than the view.
   * Tying it to the visible editor would drop the subscription every time the
   * diff opened, and edits made in the diff would never reach the store.
   */
  useEffect(() => {
    if (!activePath) return

    const file = useStore.getState().open[activePath]
    if (!file) return

    // Seeded from the draft, not from disk. They are the same string for every
    // file that was opened by reading one, and differ only for a buffer that
    // starts out dirty — a new profile, which has no disk copy to seed from.
    // `modelFor` ignores this argument once the model exists, so nothing that
    // already had a buffer is affected either way.
    const model = modelFor(activePath, file.draft)
    const subscription = model.onDidChangeContent(() => {
      useStore.getState().setDraft(activePath, model.getValue())
    })

    return () => subscription.dispose()
  }, [activePath])

  useEffect(() => {
    if (!editor) return

    if (!activePath || showDiff) {
      editor.setModel(null)
      return
    }

    const file = useStore.getState().open[activePath]
    if (!file) return

    editor.setModel(modelFor(activePath, file.saved))

    // Where this file was left *in this pane*: scroll offset, selection and
    // folds. Restored before any pending jump, which is a deliberate move and
    // outranks it.
    const view = viewStateFor(group, activePath)
    if (view) editor.restoreViewState(view)

    editor.layout()

    // Only the pane the user is in takes the caret. Two panes both focusing on
    // mount is a restore that ends wherever the render order happened to put
    // it, and a click in one pane that changes the other's tab — which the
    // sidebar can do — must not pull focus out from under the click.
    if (useStore.getState().focusedGroup === group) editor.focus()

    flushPendingReveal(group, activePath)
    reportActiveLine(group, editor)

    return () => {
      rememberViewState(group, activePath, editor.saveViewState())
    }
  }, [group, editor, activePath, showDiff])

  useEffect(() => {
    if (!diffEditor) return

    if (!activePath || !showDiff || remoteText === undefined) {
      diffEditor.setModel(null)
      return
    }

    const file = useStore.getState().open[activePath]
    if (!file) return

    diffEditor.setModel({
      original: modelFor(activePath, file.saved),
      modified: remoteModelFor(activePath, remoteText),
    })

    diffEditor.layout()
    if (useStore.getState().focusedGroup === group)
      diffEditor.getModifiedEditor().focus()
  }, [group, diffEditor, activePath, showDiff, remoteText])

  // Mirroring means the host owns this file, so our side stops accepting edits
  // rather than letting one be typed and silently overwritten on the next save.
  useEffect(() => {
    diffEditor?.updateOptions({ originalEditable: !mirroring })
  }, [diffEditor, mirroring])

  // Closing a tab has to free its model, and this is the first point at which
  // that is safe: effect cleanups run before effect bodies, so the file being
  // closed has already handed back its view state above.
  useEffect(() => {
    pruneModels(tabs)
  }, [tabs])

  return (
    <div className="flex h-full w-full flex-col">
      {activePath && <ConnectionBar relPath={activePath} diff={diff} />}
      {/*
        Below the session's bar and above stale's slot, which is the order of
        how much each one is asking of you: the session is context, a refused
        save is the reason you cannot leave, and being stale is a question that
        waits. `SaveErrorBar` and `StaleBar` never both appear — the suppression
        is in `StaleBar`, read from the same store, so the two cannot drift into
        showing at once.
      */}
      {activePath && <SaveErrorBar relPath={activePath} />}
      {activePath && <StaleBar relPath={activePath} />}

      <div className="relative min-h-0 flex-1">
        <div
          ref={container}
          className={cn(
            "absolute inset-0",
            (showDiff || showCompare) && "hidden"
          )}
        />

        {/*
          Ringed in the warning colour for the same reason the remote view is
          ringed in the session's: a pane showing two documents should not be
          mistakable for the one you were typing in.
        */}
        <div
          ref={compareContainer}
          className={cn(
            "absolute inset-0 ring-1 ring-warning-border ring-inset",
            !showCompare && "hidden"
          )}
        />
        {/*
          Ringed in the session's colour, so the remote view is legible as a
          different place before you have read a word of the bar above it —
          which is the whole reason it is a mode rather than a toggle.
        */}
        <div
          ref={diffContainer}
          className={cn(
            "absolute inset-0 ring-1 ring-remote-border ring-inset",
            !showDiff && "hidden"
          )}
        />

        {/*
          One header, following whichever pane is up. The remote view is a
          reading mode for someone else's eight-hundred-line profile, which is
          exactly where knowing which section you are in matters most.
        */}
        <StickyHeader
          editor={
            showDiff && diffEditor
              ? diffEditor.getModifiedEditor()
              : showCompare && compareEditor
                ? compareEditor.getModifiedEditor()
                : editor
          }
          outline={showDiff ? remoteOutline : localOutline}
        />

        {/*
          Over the editor rather than instead of it: the instance underneath is
          created once and holds no model here, and unmounting it to say there
          is nothing open would mean rebuilding Monaco on the first click. It
          is opaque for the same reason — an empty editor's background is
          Monaco's, and two shades of "nothing" is one too many.
        */}
        {!activePath && (
          <div className="absolute inset-0 bg-background">
            <EditorEmpty />
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Publishes the first visible line, which is what the outline highlights.
 *
 * Only from the focused group. There is one highlight in the sidebar and it
 * belongs to the file the sidebar is pointing at, so a pane you are not in
 * scrolling itself — a jump landing there, a layout pass — must not move it.
 */
function reportActiveLine(group: string, editor: Editor): void {
  if (useStore.getState().focusedGroup !== group) return

  const visible = editor.getVisibleRanges()[0]
  if (visible) useStore.getState().setActiveLine(visible.startLineNumber)

  /*
   * And the caret, which is a different fact from the visible line however
   * much the two names sound alike: scrolling moves one and never the other.
   * Both are reported from here because both are only true of the focused
   * group, and that check is already made above.
   */
  const position = editor.getPosition()
  const path = relPathOf(editor.getModel())
  setCaret(position && path ? { path, line: position.lineNumber } : null)
}

/**
 * Ctrl+S, from either editor.
 *
 * Deliberately not bound to the instance it was registered on. `addCommand`
 * puts its keybinding in Monaco's *global* service with no `when` clause, so
 * two editors asking for Ctrl+S leave only the second one live — and it would
 * be the one holding no model, formatting nothing, whichever pane you were
 * actually typing in. Both bindings therefore route through `saveFile`, which
 * asks the bridge which pane holds our copy.
 */
function saveLocal(): void {
  void saveFile()
}
