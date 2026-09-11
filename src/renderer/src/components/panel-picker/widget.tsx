/**
 * The Pick button on an empty panel item, and the popover it opens.
 *
 *     pointer:
 *       - |[Pick]
 *
 * ## The button is in the text this time, and that is fine
 *
 * The run button moved to the margin because injected text takes horizontal
 * space, and a button in front of a key pushed that line's code out of line
 * with its neighbours. Here the button is *after* the caret on a line with
 * nothing else on it — there is no code to push. It reads as part of the item
 * being written, which is what it is.
 *
 * ## Only on the line the caret is on
 *
 * An empty item is a line somebody is in the middle of. The button is drawn
 * when the caret is on one, in a block that takes panels, and nowhere else —
 * so it is an offer made at the moment of writing, not a badge on every
 * unfinished line in the file.
 *
 * ## When there is a button at all
 *
 * The simulator is live, an aircraft is loaded, and this file is that
 * aircraft's profile *or something it includes* — see `profile-reach.ts` for
 * why the run button's narrower rule is wrong here. It does not ask for the
 * sim module: the panels are read from the simulator's own debugger, which is
 * there with or without it. Like the run button it disappears rather than
 * going grey, for the same reason.
 *
 * ## One session, one lifetime
 *
 * The same shape as `run-setter/widget.tsx`, on purpose: everything the open
 * popover owns is made in `open` and undone in `close`, in reverse.
 */

import * as monaco from "monaco-editor"
import { createRoot, type Root } from "react-dom/client"

import { relPathOf } from "@/lib/monaco-setup"
// For what it registers, not for anything it exports: the `panel-missing`
// diagnostic's evidence. Here because this file is loaded with every editor,
// and is already the other thing in the app that reads the cockpit.
import "@/lib/panel-evidence"
import { inLoadedAircraft, watchReach } from "@/lib/profile-reach"
import { useStore } from "@/store"
import {
  pickSiteAt,
  pickedItems,
  scanLines,
  type Line,
  type PickSite,
} from "@shared/profile"

import { PanelPickerPanel } from "./panel"
import "./panel-picker.css"

/** Styled in `panel-picker.css`, and the thing a click is tested against. */
const CLASS = "fsc-panel-pick"

const WIDGET_ID = "fsc.panel-picker"

/**
 * The shortcut is in the label because there is nowhere else to learn it: the
 * button exists for as long as the caret is on the line, which is no time to
 * go looking through a keybindings list.
 */
const LABEL = "Pick (Ctrl + Space)"

const SITE_CONTEXT = "fscPanelPickSite"

/** Room left below the popover for the list to arrive into. */
const SLACK_PX = 24

function pickableNow(relPath: string | null): boolean {
  const { sim } = useStore.getState()
  if (sim.phase !== "live" || !sim.aircraft) return false

  return inLoadedAircraft(relPath)
}

export function installPanelPicker(
  editor: monaco.editor.IStandaloneCodeEditor
): monaco.IDisposable {
  const button = editor.createDecorationsCollection()

  /** The parse, kept against the model version it belongs to. */
  let parsed: { version: number; lines: Line[] } | null = null
  /** Where the button is drawn right now, if it is. */
  let site: PickSite | null = null

  let session: {
    site: PickSite
    node: HTMLElement
    root: Root
    widget: monaco.editor.IContentWidget
    listeners: monaco.IDisposable[]
  } | null = null

  function linesOf(model: monaco.editor.ITextModel): Line[] {
    const version = model.getVersionId()
    if (parsed?.version !== version)
      parsed = { version, lines: scanLines(model.getValue()) }

    return parsed.lines
  }

  // ---- the button -------------------------------------------------------

  /**
   * True exactly while the button is drawn, so the shortcut it advertises is
   * bound when it is on screen and is Monaco's own Ctrl+Space everywhere else.
   */
  const onSite = editor.createContextKey<boolean>(SITE_CONTEXT, false)

  function repaint(): void {
    const model = editor.getModel()
    const position = editor.getPosition()

    site =
      model && position && pickableNow(relPathOf(model))
        ? pickSiteAt(linesOf(model), position.lineNumber)
        : null

    onSite.set(site !== null)
    if (!model || !site) return button.clear()

    const column = model.getLineMaxColumn(site.line)
    button.set([
      {
        range: new monaco.Range(site.line, column, site.line, column),
        options: {
          showIfCollapsed: true,
          after: {
            content: LABEL,
            inlineClassName: CLASS,
            // The caret does not stop inside it: it is a control, not text.
            cursorStops: monaco.editor.InjectedTextCursorStops.None,
          },
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      },
    ])
  }

  // ---- placement --------------------------------------------------------

  /** Scrolls by exactly as much as the popover needs, and no more. */
  function place(): void {
    if (!session) return

    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight)
    const lineTop = editor.getTopForLineNumber(session.site.line)
    const scrollTop = editor.getScrollTop()

    const bottom = lineTop + lineHeight + session.node.offsetHeight + SLACK_PX
    const deficit = bottom - (scrollTop + editor.getLayoutInfo().height)
    if (deficit <= 0) return

    // Never so far that the item itself leaves the top.
    editor.setScrollTop(Math.min(scrollTop + deficit, lineTop))
  }

  function anchorVisible(line: number): boolean {
    const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight)
    const lineTop = editor.getTopForLineNumber(line)
    const scrollTop = editor.getScrollTop()

    return (
      lineTop + lineHeight > scrollTop &&
      lineTop < scrollTop + editor.getLayoutInfo().height
    )
  }

  // ---- the session ------------------------------------------------------

  function close(): void {
    if (!session) return

    const { node, root, widget, listeners } = session
    session = null

    for (const listener of listeners) listener.dispose()
    editor.removeContentWidget(widget)

    // Deferred: `close` runs from inside a React event handler, and unmounting
    // a root synchronously from one is a warning and a half-torn tree.
    queueMicrotask(() => root.unmount())
    node.remove()
  }

  /**
   * Replaces the empty item with one item per chosen panel.
   *
   * One edit between two undo stops, so a single undo takes the whole pick
   * back and leaves the empty item — and the button — where they were.
   */
  function add(target: PickSite, items: string[]): void {
    const model = editor.getModel()
    close()
    if (!model) return

    // The file may have moved under the popover; the line is only ours while
    // it is still the empty item it was opened on.
    const still = pickSiteAt(linesOf(model), target.line)
    if (!still || still.spec.block !== target.spec.block) return

    const text = pickedItems(items, still.taken)
    if (!text) return editor.focus()

    const range = new monaco.Range(
      target.line,
      1,
      target.line,
      model.getLineMaxColumn(target.line)
    )
    const last = target.line + text.split("\n").length - 1

    editor.pushUndoStop()
    editor.executeEdits("fsc.panel-picker", [{ range, text }], () => [
      new monaco.Selection(
        last,
        model.getLineMaxColumn(last),
        last,
        model.getLineMaxColumn(last)
      ),
    ])
    editor.pushUndoStop()
    editor.focus()
  }

  function open(target: PickSite): void {
    close()

    const node = document.createElement("div")
    node.className = "fsc-panel-picker-widget"

    // Inside a scrollable editor: without these a wheel over the list scrolls
    // the file under it, and a click in it moves the caret off the item.
    node.addEventListener("wheel", (event) => event.stopPropagation())
    node.addEventListener("mousedown", (event) => event.stopPropagation())

    const model = editor.getModel()
    const widget: monaco.editor.IContentWidget = {
      getId: () => WIDGET_ID,
      getDomNode: () => node,
      getPosition: () => ({
        position: {
          lineNumber: target.line,
          column: model?.getLineFirstNonWhitespaceColumn(target.line) || 1,
        },
        preference: [monaco.editor.ContentWidgetPositionPreference.BELOW],
      }),
    }

    editor.addContentWidget(widget)

    const root = createRoot(node)

    session = {
      site: target,
      node,
      root,
      widget,
      listeners: [
        editor.onDidScrollChange(() => {
          if (session && !anchorVisible(session.site.line)) close()
        }),
        editor.onDidLayoutChange(() => place()),
      ],
    }

    root.render(
      <PanelPickerPanel
        spec={target.spec}
        taken={target.taken}
        onAdd={(items) => add(target, items)}
        onClose={() => {
          close()
          editor.focus()
        }}
        onResize={place}
      />
    )

    requestAnimationFrame(place)
  }

  // ---- what opens and closes it ----------------------------------------

  const clicks = editor.onMouseDown((event) => {
    // `element` is the DOM node under the pointer, and injected text is a span
    // wearing its `inlineClassName` — so the click is ours when it says so.
    if (!event.target.element?.classList.contains(CLASS) || !site) return

    event.event.preventDefault()
    event.event.stopPropagation()

    if (session?.site.line === site.line) close()
    else open(site)
  })

  // The button's shortcut. An action rather than a key listener so that it is
  // in the command palette under a name, and so the `precondition` hands
  // Ctrl+Space back to Monaco wherever there is no button.
  //
  // Ctrl+Space because it is already the key for "what can go here", and on
  // this line the answer is a cockpit rather than a list of words. Taking it
  // only while the button is drawn also means suggest is never triggered on an
  // empty panel item, where all it had to say was "No suggestions".
  const shortcut = editor.addAction({
    id: "fsc.panel-picker.open",
    label: "Pick Cockpit Panels",
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space],
    precondition: SITE_CONTEXT,
    run: () => {
      if (!site) return

      if (session?.site.line === site.line) close()
      else open(site)
    },
  })

  const keys = editor.onKeyDown((event) => {
    if (event.keyCode !== monaco.KeyCode.Escape || !session) return

    event.preventDefault()
    event.stopPropagation()
    close()
  })

  const cursor = editor.onDidChangeCursorPosition(() => repaint())

  const content = editor.onDidChangeModelContent(() => {
    repaint()
    if (!session) return

    // Typed into, deleted, or pushed down by an edit above: the line the
    // popover hangs from is no longer the empty item it was opened on.
    const model = editor.getModel()
    const still = model ? pickSiteAt(linesOf(model), session.site.line) : null
    if (!still || still.spec.block !== session.site.spec.block) close()
  })

  const models = editor.onDidChangeModel(() => {
    parsed = null
    close()
    repaint()
  })

  /** Clicking anywhere else closes it — including elsewhere in the editor. */
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

  // The sim connecting, the aircraft changing, the file joining or leaving the
  // loaded aircraft's includes: each changes whether there is a button.
  const gate = (): void => {
    repaint()
    if (!pickableNow(relPathOf(editor.getModel()))) close()
  }
  const store = useStore.subscribe((state, previous) => {
    if (state.sim !== previous.sim) gate()
  })
  const reach = watchReach(gate)

  repaint()

  return {
    dispose: () => {
      close()
      clicks.dispose()
      shortcut.dispose()
      keys.dispose()
      cursor.dispose()
      content.dispose()
      models.dispose()
      document.removeEventListener("mousedown", outside, true)
      store()
      reach()
      button.clear()
    },
  }
}
