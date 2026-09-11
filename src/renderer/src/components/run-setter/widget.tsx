/**
 * The run button in the editor, and the popover it opens.
 *
 * ## The button is in the margin, not in the text
 *
 * It was injected text — a decoration that puts a *string* in front of the key
 * — and injected text takes horizontal space, so every line with a button had
 * its code pushed right by a glyph. Within one entry that is visible and ugly:
 * the `set:` line carries the button and the `get:` line above it does not, so
 * two lines indented identically in the file stop lining up on screen.
 *
 * `linesDecorationsClassName` draws in the editor's own per-line margin — the
 * column `lineDecorationsWidth` sizes, between the line numbers and the text —
 * which is outside the text flow. Nothing moves.
 *
 * ## Hit-testing is exact, not inferred
 *
 * The plan expected to infer which button was clicked from the mouse position.
 * It does not have to: `IBaseMouseTarget.element` is the actual DOM element
 * under the pointer and carries our class, so a click is ours when the element
 * says so.
 *
 * ## One session, one lifetime
 *
 * Everything the open popover owns — the widget, the React root, the dimming,
 * the listeners that only matter while it is up — is created in `open` and
 * undone in `close`, in the reverse order, with nothing else touching any of
 * it. That is deliberate: the placement and the dimming were patched three
 * times as separate concerns and drifted apart, leaving the editor dimmed with
 * no popover on it more than once.
 */

import * as monaco from "monaco-editor"
import { createRoot, type Root } from "react-dom/client"

import {
  runnableAt,
  runnableEntriesIn,
  type RunnableEntry,
} from "@/lib/run-entries"
import { relPathOf } from "@/lib/monaco-setup"
import { useStore } from "@/store"
import { profileKey } from "@shared/profile"

import { RunSetterPanel } from "./panel"
import "./run-setter.css"

/** Styled in `run-setter.css`, and the thing a click is tested against. */
const CLASS = "fsc-run-setter"

/** On the editor while a popover is open. Dims the margin buttons. */
const DIM = "fsc-run-dim"

/** On the text of every line except the open entry's. */
const DIMMED = "fsc-run-dimmed"

const WIDGET_ID = "fsc.run-setter"

/**
 * Room left below the popover beyond its measured height.
 *
 * The panel grows after it is placed — a calculator rejection, a revert notice,
 * a preview that wraps — and scrolling again for each of those would have the
 * editor creeping under the cursor. One nudge at open, with enough spare for
 * whatever the run has to say afterwards.
 */
const SLACK_PX = 72

/**
 * Every line except the entry being run, as at most two ranges.
 *
 * The dimming used to be the other way round — a marker on the open entry and a
 * CSS `:not(:has(…))` on every line without it — and it did not paint on the
 * first open of a session, only on the ones after. That is a style-invalidation
 * miss on a selector whose subject depends on a descendant Monaco had never
 * rendered before, and it is not worth being clever about: the lines to dim are
 * known here, exactly, so they are named rather than inferred.
 *
 * Two decorations for a file of any size, and Monaco keeps their ranges correct
 * across edits by itself.
 *
 * Line numbers are clamped to the model. `endLine` comes from a parse that can
 * be one keystroke behind the buffer, and `getLineMaxColumn` throws rather than
 * clamping — which, before this, took the whole `open` down with it and left a
 * widget on screen with nothing in it.
 */
function dimAround(
  model: monaco.editor.ITextModel,
  entry: RunnableEntry
): monaco.editor.IModelDeltaDecoration[] {
  const lines = model.getLineCount()
  const first = Math.max(1, Math.min(entry.getLine, lines))
  const last = Math.max(first, Math.min(entry.endLine, lines))

  const ranges: monaco.Range[] = []
  if (first > 1)
    ranges.push(
      new monaco.Range(1, 1, first - 1, model.getLineMaxColumn(first - 1))
    )
  if (last < lines)
    ranges.push(
      new monaco.Range(last + 1, 1, lines, model.getLineMaxColumn(lines))
    )

  return ranges.map((range) => ({
    range,
    options: {
      inlineClassName: DIMMED,
      // The ranges are recomputed on every open, and a dimmed range that grew
      // into text typed at its edge would outlive what it was drawn for.
      stickiness:
        monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  }))
}

/**
 * Whether running anything makes sense right now.
 *
 * Three conditions. The first is the module rather than the connection: a run
 * is `execute_calculator_code` inside the simulator, which only the Link module
 * can reach, so a connected sim with no module installed can do nothing here at
 * all. An *outdated* module counts as no module, because `exec` arrived in
 * protocol 2 and an older one ignores commands it does not recognise — which
 * would be a three-second wait and then silence.
 *
 * The second is the one worth arguing. A run writes into **the aircraft that is
 * loaded**, not into the file that is open — so a button on a PMDG profile
 * while a PA24 is in the sim offers to write PMDG values into a Comanche. That
 * is not a run that failed, it is a run that did something else, and no amount
 * of reading the result afterwards recovers the intent.
 *
 * `profileKey` is the app's existing exact-match rule, the same one
 * `CurrentAircraft` uses to decide which row of Profiles the simulator is
 * asking for. One rule, one place.
 *
 * The buttons disappear rather than going grey. A disabled control invites the
 * click it then refuses, and the app already says why elsewhere — the footer
 * chip for the connection, the aircraft box in Profiles for the aircraft.
 */
function runnableNow(relPath: string | null): boolean {
  const { sim } = useStore.getState()

  if (sim.phase !== "live" || !sim.aircraft || !relPath) return false
  if (!sim.link || sim.link.outdated) return false

  return profileKey(relPath) === sim.aircraft.toLowerCase()
}

export function installRunSetter(
  editor: monaco.editor.IStandaloneCodeEditor
): monaco.IDisposable {
  /** Every runnable entry's button. Redrawn as the file and the sim change. */
  const buttons = editor.createDecorationsCollection()
  /** Everything except the open entry, while there is one. */
  const dimmed = editor.createDecorationsCollection()

  let entries: RunnableEntry[] = []

  /** Everything the open popover owns. Null when there is no popover. */
  let session: {
    entry: RunnableEntry
    node: HTMLElement
    root: Root
    widget: monaco.editor.IContentWidget
    /** Listeners that exist only while it is open. */
    listeners: monaco.IDisposable[]
  } | null = null

  // ---- the buttons ------------------------------------------------------

  function repaint(): void {
    const model = editor.getModel()

    // This editor's own file, not the window's active one. With the editor
    // split, the pane without focus still draws its gutter, and the file it is
    // showing is the only file its buttons could honestly be about.
    if (!model || !runnableNow(relPathOf(model))) {
      entries = []
      buttons.clear()
      return
    }

    entries = runnableEntriesIn(model.getValue())

    buttons.set(
      entries.map((entry) => ({
        // A margin decoration is drawn per line rather than at a column. The
        // column the key starts at is still carried on `entry`, for the popover
        // to hang from.
        range: new monaco.Range(entry.line, 1, entry.line, 1),
        options: {
          // An empty range draws nothing without this.
          showIfCollapsed: true,
          linesDecorationsClassName: CLASS,
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      }))
    )
  }

  // ---- placement --------------------------------------------------------

  /** Where the anchor line sits in scroll coordinates, and how tall a line is. */
  function metrics(entry: RunnableEntry): {
    lineHeight: number
    lineTop: number
    entryTop: number
    scrollTop: number
    viewport: number
  } {
    return {
      lineHeight: editor.getOption(monaco.editor.EditorOption.lineHeight),
      lineTop: editor.getTopForLineNumber(entry.line),
      entryTop: editor.getTopForLineNumber(entry.getLine),
      scrollTop: editor.getScrollTop(),
      viewport: editor.getLayoutInfo().height,
    }
  }

  /**
   * Scrolls by exactly as much as the popover needs, and no more.
   *
   * `revealLineNearTop` was doing this and it threw the line into the top fifth
   * of the editor every time, which moves everything the user was reading for a
   * popover that only needed a few pixels. The deficit is measurable: the
   * bottom of the popover minus the bottom of the viewport.
   *
   * Clamped so the **entry's first line** — the `get:` line, whose live value
   * is the whole point of the arrangement — cannot be scrolled off the top. A
   * popover taller than the viewport is therefore clipped rather than allowed
   * to push the thing it is about out of sight.
   */
  function place(): void {
    if (!session) return

    const { lineHeight, lineTop, entryTop, scrollTop, viewport } = metrics(
      session.entry
    )

    const bottom = lineTop + lineHeight + session.node.offsetHeight + SLACK_PX
    const deficit = bottom - (scrollTop + viewport)
    if (deficit <= 0) return

    editor.setScrollTop(Math.min(scrollTop + deficit, entryTop))
  }

  /** Whether the line the popover hangs from is still on screen at all. */
  function anchorVisible(entry: RunnableEntry): boolean {
    const { lineHeight, lineTop, scrollTop, viewport } = metrics(entry)

    return lineTop + lineHeight > scrollTop && lineTop < scrollTop + viewport
  }

  // ---- the session ------------------------------------------------------

  function close(): void {
    if (!session) return

    const { node, root, widget, listeners } = session
    session = null

    for (const listener of listeners) listener.dispose()
    editor.removeContentWidget(widget)

    // Undimming belongs here and only here, so it cannot be left behind by a
    // path that forgot it.
    dimmed.clear()
    editor.getDomNode()?.classList.remove(DIM)

    // Deferred: `close` runs from inside a React event handler, and unmounting
    // a root synchronously from one is a warning and a half-torn tree.
    queueMicrotask(() => root.unmount())
    node.remove()
  }

  function open(entry: RunnableEntry): void {
    close()

    const node = document.createElement("div")
    node.className = "fsc-run-setter-widget"

    // The editor is a scrollable element and this sits inside it. Without these
    // two, a wheel over the popover scrolls the file underneath it — which
    // moves the popover, and can scroll the very line it is attached to out of
    // view — and a click in it moves the editor's cursor.
    node.addEventListener("wheel", (event) => event.stopPropagation())
    node.addEventListener("mousedown", (event) => event.stopPropagation())

    const widget: monaco.editor.IContentWidget = {
      getId: () => WIDGET_ID,
      getDomNode: () => node,
      getPosition: () => ({
        position: { lineNumber: entry.line, column: entry.column },
        // BELOW and nothing else. With `ABOVE` in this list Monaco would flip
        // the popover over the `get:` line whenever the bottom of the viewport
        // was close, hiding the value the popover exists to let you watch.
        preference: [monaco.editor.ContentWidgetPositionPreference.BELOW],
      }),
    }

    editor.addContentWidget(widget)

    const model = editor.getModel()
    if (model) {
      dimmed.set(dimAround(model, entry))
      editor.getDomNode()?.classList.add(DIM)
    }

    const root = createRoot(node)

    session = {
      entry,
      node,
      root,
      widget,
      listeners: [
        // Scrolled away from: the popover is attached to a line, and a line
        // that is gone takes its popover with it rather than leaving it
        // stranded at the edge of the viewport.
        editor.onDidScrollChange(() => {
          if (session && !anchorVisible(session.entry)) close()
        }),
        // The window changed shape, so the room below may have gone.
        editor.onDidLayoutChange(() => place()),
      ],
    }

    root.render(
      <RunSetterPanel entry={entry} onClose={close} onResize={place} />
    )

    // After the first paint, so there is a height to measure.
    requestAnimationFrame(place)
  }

  // ---- what opens and closes it ----------------------------------------

  const clicks = editor.onMouseDown((event) => {
    const element = event.target.element
    if (!element?.classList.contains(CLASS)) return

    const line = event.target.position?.lineNumber
    const entry = line ? runnableAt(entries, line) : undefined
    if (!entry) return

    // The click is ours: it landed on the button, not on the line.
    event.event.preventDefault()
    event.event.stopPropagation()

    if (session?.entry.line === entry.line) close()
    else open(entry)
  })

  const keys = editor.onKeyDown((event) => {
    if (event.keyCode !== monaco.KeyCode.Escape || !session) return

    event.preventDefault()
    event.stopPropagation()
    close()
  })

  const content = editor.onDidChangeModelContent(() => {
    repaint()
    if (!session) return

    // The line the popover hangs from may not be that entry any more — the
    // whole entry could have been deleted or typed into something else.
    const still = runnableAt(entries, session.entry.line)
    if (!still || still.entry.name !== session.entry.entry.name) close()
  })

  const models = editor.onDidChangeModel(() => {
    close()
    repaint()
  })

  /**
   * Clicking anywhere else closes it — including elsewhere in the editor.
   *
   * In the capture phase so it runs before Monaco's own handling, and skipping
   * clicks on a run button so the button keeps its toggle: the editor's handler
   * above decides whether that click closes this popover or opens another.
   */
  const outside = (event: MouseEvent): void => {
    if (!session) return

    const target = event.target
    if (!(target instanceof Node)) return
    if (session.node.contains(target)) return
    if (target instanceof HTMLElement && target.classList.contains(CLASS))
      return

    close()
  }

  document.addEventListener("mousedown", outside, true)

  // The sim connecting, disconnecting or changing aircraft changes whether
  // there are any buttons at all. Nothing else in the store does, so the two
  // fields are compared rather than repainting on every keystroke elsewhere in
  // the app — `repaint` reparses the whole file.
  const store = useStore.subscribe((state, previous) => {
    if (state.sim === previous.sim && state.groups === previous.groups) return

    repaint()
    if (!runnableNow(relPathOf(editor.getModel()))) close()
  })

  repaint()

  return {
    dispose: () => {
      close()
      clicks.dispose()
      keys.dispose()
      content.dispose()
      models.dispose()
      document.removeEventListener("mousedown", outside, true)
      store()
      buttons.clear()
      dimmed.clear()
    },
  }
}
