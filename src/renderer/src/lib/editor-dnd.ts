import { useEffect, useState } from "react"

import type { GroupOrientation } from "./groups"

/**
 * What can be dragged into an editor group, and how a drop reads it.
 *
 * Two payloads, both under private MIME types and neither of them `text/plain`.
 * That is the whole design constraint: the editor already accepts a plain-text
 * drop and inserts it at the pointer — that is how a variable chip gets into a
 * file — so a tab or a sidebar row carrying its path as text would be dropped
 * *into* the document as the literal string `modules/fuel.yaml` rather than
 * opened. A type Monaco has never heard of cannot be mistaken for text.
 */

/** A tab being carried out of one strip. */
const TAB = "application/x-fsc-tab"
/** A file being carried out of the Profiles sidebar. */
const FILE = "application/x-fsc-file"

interface TabDrag {
  relPath: string
  /** The group it came from, so a drop knows whether this is a move. */
  group: string
}

export function setTabDrag(data: DataTransfer, drag: TabDrag): void {
  data.setData(TAB, JSON.stringify(drag))
  data.effectAllowed = "move"
}

export function setFileDrag(data: DataTransfer, relPath: string): void {
  data.setData(FILE, relPath)
  data.effectAllowed = "copy"
}

/**
 * What is being dragged, or null.
 *
 * Readable on `drop` only. During `dragover` the browser hides payloads —
 * `types` is all there is — which is why the drop zones decide whether to light
 * up from `carriesEditorDrag` and what to do from this.
 */
export function readEditorDrag(data: DataTransfer | null): TabDrag | null {
  if (!data) return null

  const tab = data.getData(TAB)
  if (tab) {
    try {
      const parsed = JSON.parse(tab) as Partial<TabDrag>
      if (typeof parsed.relPath === "string" && typeof parsed.group === "string")
        return { relPath: parsed.relPath, group: parsed.group }
    } catch {
      return null
    }
  }

  const file = data.getData(FILE)
  // A file from the sidebar has no group of its own: dropping it is always an
  // open, never a move, and `group: ""` is what says so.
  return file ? { relPath: file, group: "" } : null
}

/** Whether a drag is one of ours, which is all `dragover` is allowed to know. */
export function carriesEditorDrag(data: DataTransfer | null): boolean {
  return !!data && (data.types.includes(TAB) || data.types.includes(FILE))
}

/**
 * Where in a pane a drop landed.
 *
 * `before` and `after` open a new group on that side; `center` opens into the
 * group that was dropped on. The bands run along the layout axis only — a drop
 * on the top edge of a row of panes is not a request to re-orient the window,
 * it is a drop that missed, and treating it as `center` is the reading that
 * loses nothing.
 */
export type DropZone = "before" | "center" | "after"

/**
 * A quarter of the pane at each end.
 *
 * The ratio already guarantees a middle — two quarters leave half the pane
 * meaning "open here" — so the only thing left to protect is the narrow pane,
 * where a quarter is a few pixels. There was a 160px *cap* here as well, which
 * had it backwards: on a real window it made each edge about a thirteenth of
 * the pane, so a drop aimed at the side landed in the middle and opened a tab
 * instead of splitting. That reads as the drag having done nothing.
 */
const BAND_RATIO = 0.25
const BAND_MIN = 48
/** Never let the two bands eat the middle, however narrow the pane. */
const BAND_MAX_RATIO = 0.4

export function dropZoneAt(
  rect: DOMRect,
  point: { clientX: number; clientY: number },
  orientation: GroupOrientation
): DropZone {
  const row = orientation === "row"
  const start = row ? rect.left : rect.top
  const size = row ? rect.width : rect.height
  const at = (row ? point.clientX : point.clientY) - start

  const band = Math.min(
    Math.max(size * BAND_RATIO, BAND_MIN),
    size * BAND_MAX_RATIO
  )

  if (at < band) return "before"
  if (at > size - band) return "after"
  return "center"
}

/**
 * Whether a drag is in flight anywhere in the window.
 *
 * `dragstart` and `dragend` fire on the element the drag began on, which for a
 * tab and for a sidebar row is in this document.
 *
 * **`drop` must not end it, and this was a real bug.** Listening for `drop` in
 * the capture phase on `window` puts this ahead of React, whose own listeners
 * sit on the root container — so the flag went false, the pane's drop overlay
 * unmounted, and React then dispatched the drop into a subtree that was being
 * torn down. The handler never ran. Dropping a file on a pane did nothing at
 * all, intermittently enough to look like the drag had failed to start.
 *
 * `dragend` is enough on its own: it fires on the source after every drag,
 * dropped or cancelled, and it fires *after* `drop` has been handled.
 */
export function useDragging(): boolean {
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const start = (event: DragEvent) => {
      if (carriesEditorDrag(event.dataTransfer)) setDragging(true)
    }
    const stop = () => setDragging(false)

    window.addEventListener("dragstart", start)
    // Captured, so a handler that stops propagation cannot strand the overlay
    // in its dragging state.
    window.addEventListener("dragend", stop, true)
    // And `drop` as well, but **bubbling**, which is the whole distinction.
    // React's listeners sit on the root container, so a bubbling listener on
    // `window` is guaranteed to run after the drop has been handled, where a
    // capturing one runs before it and pulls the target out of the tree.
    //
    // Both are needed. `dragend` alone looked sufficient — it is specified to
    // fire after every drag — but a source element that re-renders during the
    // drag can swallow it, and then the flag never clears: the overlay stays
    // live over the whole pane and the editor underneath stops taking clicks.
    window.addEventListener("drop", stop)
    // The self-heal. If a drag ever ends without either event arriving, the
    // overlay is live over a pane nobody is dragging onto, and the editor under
    // it has quietly stopped taking clicks — the worst way this can fail. A
    // pointer going down is proof there is no drag in flight, and clears it at
    // a cost of at most the one click that noticed.
    window.addEventListener("pointerdown", stop, true)

    return () => {
      window.removeEventListener("dragstart", start)
      window.removeEventListener("dragend", stop, true)
      window.removeEventListener("drop", stop)
      window.removeEventListener("pointerdown", stop, true)
    }
  }, [])

  return dragging
}
