import type * as monaco from "monaco-editor"

import { useStore } from "@/store"

/**
 * Lets the sidebar drive the editor without either one importing the other's
 * component. Each editor group registers itself on mount.
 */

type Editor = monaco.editor.IStandaloneCodeEditor

interface GroupEditors {
  /**
   * The pane on screen in this group, which is what a jump should scroll.
   *
   * There are three editors per group and only one of them is ever visible, so
   * anything acting on "the editor" has to ask which — and now, with splits,
   * which group as well.
   */
  showing: Editor | null
  /**
   * The pane holding *our* file, which is not always the one on screen.
   *
   * In the remote view you are reading the host's copy while your own sits in
   * the diff's hidden half — still the thing a save writes, and still the thing
   * the formatter has to run over. Saving through the visible editor there
   * would format the host's read-only buffer, which does nothing, and then
   * write your file out unformatted.
   */
  editing: Editor | null
}

/**
 * Keyed by group rather than held as a pair of module globals, which is what
 * this was before splits.
 *
 * Two panes registering into one slot is last-mount-wins, and React runs the
 * outgoing effect's cleanup after the incoming one's body — so a re-render of
 * either pane would have cleared the live instance and left the bridge pointing
 * at nothing. Clearing a slot by id cannot reach another group's.
 */
const groups = new Map<string, GroupEditors>()

function slotFor(id: string): GroupEditors {
  const existing = groups.get(id)
  if (existing) return existing

  const slot: GroupEditors = { showing: null, editing: null }
  groups.set(id, slot)
  return slot
}

export function registerEditor(id: string, instance: Editor | null): void {
  slotFor(id).showing = instance
}

export function registerEditingEditor(
  id: string,
  instance: Editor | null
): void {
  slotFor(id).editing = instance
}

/** Called when a group is closed, so its slot does not outlive its panes. */
export function forgetGroup(id: string): void {
  groups.delete(id)
}

/**
 * The focused group's panes.
 *
 * "The editor" now means "the editor the user is in", and the store is the one
 * that knows which that is — it is told by Monaco's own focus events, so the
 * answer survives clicking between panes without touching a tab.
 */
export function showingEditor(): Editor | null {
  return groups.get(useStore.getState().focusedGroup)?.showing ?? null
}

export function editingEditor(): Editor | null {
  return groups.get(useStore.getState().focusedGroup)?.editing ?? null
}

export function showingEditorIn(id: string): Editor | null {
  return groups.get(id)?.showing ?? null
}

/**
 * The one way a profile reaches disk from the editor.
 *
 * Ctrl+S and taking a change both come through here, so there is a single
 * answer to what a write does: format, then save. Formatting runs through the
 * editor rather than on the way to disk, so the result is what you see, it
 * lands on the undo stack, and the caret survives.
 *
 * Which file that is comes from the focused group. Monaco's keybinding service
 * has no `when` clause and holds one binding per chord however many editors ask
 * for it, so every pane's Ctrl+S arrives here and the question of *whose* file
 * is answered once, at the moment of the save, rather than by whichever
 * instance happened to register last.
 */
export async function saveFile(): Promise<void> {
  const path = useStore.getState().activePath
  if (!path) return

  await editingEditor()?.getAction("editor.action.formatDocument")?.run()
  await useStore.getState().save(path)
}

/** A jump requested for a file that was not open in that group yet. */
let pending: { group: string; file: string; line: number } | null = null

function jumpTo(editor: Editor | null, line: number): void {
  if (!editor) return

  editor.revealLineNearTop(line)
  editor.setPosition({ lineNumber: line, column: 1 })
  editor.focus()
}

/**
 * Scrolls a file to a line, opening it first if it is not up.
 *
 * The jump lands in whichever group is already showing the file, and otherwise
 * in the focused one — the same rule VS Code follows, and the one that keeps a
 * click in the outline from tearing a split apart to show you something already
 * on screen beside it.
 */
export async function revealLine(file: string, line: number): Promise<void> {
  const store = useStore.getState()
  const target = store.groupShowing(file) ?? store.focusedGroup

  if (store.groupActive(target) === file) {
    store.focusGroup(target)
    jumpTo(showingEditorIn(target), line)
    return
  }

  // The model is attached by the editor after React re-renders, so the jump
  // waits for it rather than landing on the outgoing file.
  pending = { group: target, file, line }
  await store.openFile(file, { group: target })
}

/** Called by a group's editor once a file's model is attached. */
export function flushPendingReveal(group: string, file: string): void {
  if (pending?.group !== group || pending.file !== file) return

  const { line } = pending
  pending = null
  jumpTo(showingEditorIn(group), line)
}
