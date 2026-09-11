import { useMemo, useSyncExternalStore } from "react"

import { changesInRange, takeChanges } from "./diff-hunks"
import { saveFile } from "./editor-bridge"
import { monaco } from "./monaco-setup"

type DiffEditor = monaco.editor.IStandaloneDiffEditor
type Change = monaco.editor.ILineChange

interface Snapshot {
  /** Every difference between our file and the host's. */
  changes: Change[]
  /** Those covered by the current selection in our pane. */
  selected: Change[]
}

export interface DiffSession extends Snapshot {
  takeAll: () => void
  takeSelected: () => void
}

const NOTHING: Snapshot = { changes: [], selected: [] }

/**
 * The diff as an external store rather than as mirrored React state.
 *
 * Monaco owns the diff and recomputes it whenever either side moves, so this
 * reads from the editor and caches the answer between its events. Keeping a
 * second copy in `useState` would mean a render pass where the buttons describe
 * a diff the editor has already replaced — most visibly while the host is
 * saving repeatedly during a debug session.
 */
function createDiffStore(editor: DiffEditor | null, enabled: boolean) {
  let snapshot: Snapshot = NOTHING
  const listeners = new Set<() => void>()

  /**
   * `getSnapshot` has to return the same object until something actually moves,
   * so the new one is built here and nowhere else.
   */
  const recompute = () => {
    if (!editor || !enabled) {
      snapshot = NOTHING
      return
    }

    const changes = editor.getLineChanges() ?? []
    const selection = editor.getModifiedEditor().getSelection()

    // A caret counts as picking out the one change it is sitting in. Requiring
    // a dragged selection instead left the button permanently dead for anyone
    // who did not already know it wanted one, which is a button that has not
    // been offered so much as hidden.
    const selected = selection
      ? changesInRange(
          changes,
          selection.startLineNumber,
          selection.endLineNumber
        )
      : []

    snapshot = { changes, selected }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)

      const announce = () => {
        recompute()
        for (const each of listeners) each()
      }

      // Read once on the way in: the diff may already be computed by the time
      // anything subscribes, and no further event is owed to us.
      recompute()

      const shown = editor?.getModifiedEditor()
      const updated = editor?.onDidUpdateDiff(announce)
      const moved = shown?.onDidChangeCursorSelection(announce)

      return () => {
        listeners.delete(listener)
        updated?.dispose()
        moved?.dispose()
      }
    },

    getSnapshot: () => snapshot,
  }
}

export function useDiff(
  editor: DiffEditor | null,
  enabled: boolean
): DiffSession {
  const store = useMemo(() => createDiffStore(editor, enabled), [editor, enabled])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot)

  /**
   * Taking lands on disk, not just in the buffer.
   *
   * The same verb in the panel's file list already wrote straight through, and
   * two things called Take that differ only in whether you still owe a Ctrl+S
   * is the kind of distinction nobody holds while reading someone else's
   * profile. Undo still reaches back through it — the edit is on the stack, and
   * undoing leaves the buffer dirty against what was written, which the next
   * save settles.
   */
  const take = (which: Change[]) => {
    const models = editor?.getModel()
    if (!models || !which.length) return

    takeChanges(models.original, models.modified, which)
    void saveFile()
  }

  return {
    ...snapshot,
    takeAll: () => take(snapshot.changes),
    takeSelected: () => take(snapshot.selected),
  }
}
