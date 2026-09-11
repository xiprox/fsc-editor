import { Fragment, useEffect, useRef, useState } from "react"

import { EditorPane } from "@/components/editor-pane"
import { EditorTabs } from "@/components/editor-tabs"
import { Splitter } from "@/components/splitter"
import {
  carriesEditorDrag,
  dropZoneAt,
  readEditorDrag,
  useDragging,
  type DropZone,
} from "@/lib/editor-dnd"
import type { EditorGroup, GroupOrientation } from "@/lib/groups"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

/**
 * The drag on a divider, translated into the store.
 *
 * No state of its own and nothing in `localStorage`: the sizes live on the
 * groups, so they are saved and restored by whatever saves and restores the
 * layout, and there is no second copy to fall out of step with how many panes
 * there are. What is left here is the arithmetic of turning pointer travel into
 * a fraction of the row, which is a question about this element's geometry and
 * belongs nowhere else.
 */
function useDividers(
  orientation: GroupOrientation,
  container: React.RefObject<HTMLElement | null>
) {
  const resizeGroups = useStore((state) => state.resizeGroups)
  const drag = useRef<{ index: number; total: number; at: number } | null>(null)

  return (index: number) => ({
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      const box = container.current?.getBoundingClientRect()
      if (!box) return

      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = {
        index,
        total: orientation === "row" ? box.width : box.height,
        at: orientation === "row" ? event.clientX : event.clientY,
      }
    },

    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      const state = drag.current
      if (!state || !state.total) return

      const now = orientation === "row" ? event.clientX : event.clientY
      resizeGroups(state.index, (now - state.at) / state.total)

      // Re-anchored each move, so the next delta is measured from where the
      // divider actually got to. A share that hit its floor has stopped
      // travelling, and an anchor left at the pointer would bank the overshoot
      // and make the divider lag on the way back.
      drag.current = { ...state, at: now }
    },

    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      event.currentTarget.releasePointerCapture(event.pointerId)
      drag.current = null
    },
  })
}

/**
 * Where a drop would land, drawn over the pane it is aimed at.
 *
 * Always mounted, and inert until there is something to drop. Mounting it on
 * `dragstart` and unmounting it when the drag ended was the obvious way round
 * and the wrong one: the thing that ends a drag is the drop, so the overlay
 * was being removed by the same event it existed to handle. It is `active`
 * that changes now, and all that turns on is whether the pane can be hit —
 * so a drop always reaches a live element, and an idle pane still passes every
 * click straight through to the editor underneath.
 */
function DropZones({
  group,
  orientation,
  active,
}: {
  group: string
  orientation: GroupOrientation
  active: boolean
}) {
  const [zone, setZone] = useState<DropZone | null>(null)
  const host = useRef<HTMLDivElement>(null)

  const openFile = useStore((state) => state.openFile)
  const splitEditor = useStore((state) => state.splitEditor)
  const moveTabToGroup = useStore((state) => state.moveTabToGroup)

  const onDrop = (event: React.DragEvent): void => {
    const drag = readEditorDrag(event.dataTransfer)
    const box = host.current?.getBoundingClientRect()
    setZone(null)
    if (!drag || !box) return

    event.preventDefault()
    event.stopPropagation()

    // Measured from the drop itself rather than read back from the highlight.
    // The highlight is state, so it is a render behind — and a drop that lands
    // before React has painted the zone it is over would otherwise do nothing
    // at all. What the pointer is on is a fact the event already carries.
    const where = dropZoneAt(box, event, orientation)

    if (where === "center") {
      // Into this pane. From the sidebar that is an open; from another pane it
      // is a move, because a tab dragged somewhere has left where it was.
      if (drag.group && drag.group !== group)
        moveTabToGroup(drag.relPath, drag.group, group)
      else void openFile(drag.relPath, { group })
      return
    }

    splitEditor({
      from: group,
      relPath: drag.relPath,
      side: where === "before" ? "before" : "after",
      // A file from the sidebar is copied into the new pane; a tab is carried
      // into it, and leaves the strip it came from.
      move: drag.group || undefined,
    })
  }

  const row = orientation === "row"

  return (
    <div
      ref={host}
      // Both, and both must accept: Chromium decides an element is a drop
      // target from `dragenter`, and keeps it as one only while `dragover`
      // goes on accepting. Preventing default on just one of them leaves a
      // pane that lights up and then refuses the drop.
      onDragEnter={(event) => {
        if (carriesEditorDrag(event.dataTransfer)) event.preventDefault()
      }}
      onDragOver={(event) => {
        if (!carriesEditorDrag(event.dataTransfer)) return

        event.preventDefault()

        // Said explicitly rather than left to the default derived from
        // `effectAllowed`. It is what the cursor shows — a file from the
        // sidebar is copied into the pane, a tab is carried into it — and a
        // drag left at `none` is one the browser will not let go of.
        event.dataTransfer.dropEffect = event.dataTransfer.types.includes(
          "application/x-fsc-tab"
        )
          ? "move"
          : "copy"

        const box = host.current?.getBoundingClientRect()
        if (box) setZone(dropZoneAt(box, event, orientation))
      }}
      // Leaving the pane clears the highlight; so does the drop itself. Both,
      // because a drag can end anywhere and a pane left lit afterwards reads as
      // a pane that is still waiting for something.
      onDragLeave={(event) => {
        if (!host.current?.contains(event.relatedTarget as Node | null))
          setZone(null)
      }}
      onDrop={onDrop}
      className={cn(
        "absolute inset-0 z-20",
        !active && "pointer-events-none"
      )}
    >
      {active && zone && (
        <div
          // Inert, so the pointer only ever meets the overlay. As a live target
          // it took the `dragover`s itself and every crossing between it and
          // the overlay raised a `dragleave`, which is a highlight that flickers
          // while you are still choosing where to let go.
          className={cn(
            "pointer-events-none absolute bg-ring/20 ring-1 ring-ring ring-inset",
            zone === "center" && "inset-0",
            zone === "before" &&
              (row ? "inset-y-0 left-0 w-1/2" : "inset-x-0 top-0 h-1/2"),
            zone === "after" &&
              (row ? "inset-y-0 right-0 w-1/2" : "inset-x-0 bottom-0 h-1/2")
          )}
        />
      )}
    </div>
  )
}

/** One pane: its strip, its editor, and the drop targets over it. */
function GroupPane({
  group,
  orientation,
}: {
  group: EditorGroup
  orientation: GroupOrientation
}) {
  const dragging = useDragging()
  const focusGroup = useStore((state) => state.focusGroup)

  return (
    <section
      // A click anywhere in the pane claims it, including on the strip and on
      // the empty state — Monaco's own focus event covers the text and nothing
      // else. Capture, so it lands before whatever was actually clicked.
      onFocusCapture={() => focusGroup(group.id)}
      onMouseDownCapture={() => focusGroup(group.id)}
      className="flex min-h-0 min-w-0 flex-col"
      style={{ flex: `${group.share} 1 0` }}
    >
      <EditorTabs group={group.id} />
      <div className="relative min-h-0 flex-1">
        <EditorPane group={group.id} />
        <DropZones
          group={group.id}
          orientation={orientation}
          active={dragging}
        />
      </div>
    </section>
  )
}

/**
 * The editor area: every group, the dividers between them, and the shortcuts
 * that act on whichever one has focus.
 *
 * The keyboard lives here rather than in the strips because there is one
 * window's worth of it. Bound per strip — which is where it was, when there was
 * only ever one — Ctrl+W closed a tab in every pane at once.
 */
export function EditorGrid() {
  const groups = useStore((state) => state.groups)
  const orientation = useStore((state) => state.orientation)
  const container = useRef<HTMLDivElement>(null)
  const handlersFor = useDividers(orientation, container)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey) return

      const state = useStore.getState()
      const group = state.groups.find(
        (candidate) => candidate.id === state.focusedGroup
      )

      // Ctrl+\ splits the focused pane, showing the same file twice — the
      // gesture every editor has taught. Shift re-orients the window instead,
      // which is the whole of "split down" in a flat list of panes.
      if (event.key === "\\") {
        event.preventDefault()
        if (event.shiftKey)
          state.setOrientation(state.orientation === "row" ? "column" : "row")
        else state.splitEditor()
        return
      }

      // Ctrl+1..9 — the pane by position, the way VS Code numbers them.
      const digit = Number(event.key)
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const target = state.groups[digit - 1]
        if (!target) return

        event.preventDefault()
        state.focusGroup(target.id)
        return
      }

      if (!group?.tabs.length) return

      const cycle = (delta: number) => {
        event.preventDefault()
        const index = group.active ? group.tabs.indexOf(group.active) : -1
        const next = (index + delta + group.tabs.length) % group.tabs.length
        void state.openFile(group.tabs[next], { group: group.id })
      }

      if (event.key === "Tab") cycle(event.shiftKey ? -1 : 1)
      else if (event.key === "PageDown") cycle(1)
      else if (event.key === "PageUp") cycle(-1)
      else if (event.key.toLowerCase() === "w" && group.active) {
        event.preventDefault()
        void state.closeFile(group.active, group.id)
      }
    }

    // Capture, so Monaco does not swallow these before they reach us.
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [])

  return (
    <div
      ref={container}
      className={cn(
        "flex min-h-0 min-w-0 flex-1",
        orientation === "row" ? "flex-row" : "flex-col"
      )}
    >
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index > 0 && (
            <Splitter
              orientation={orientation === "row" ? "vertical" : "horizontal"}
              handlers={handlersFor(index - 1)}
              /*
                Above the panes it divides. The divider is a one-pixel rule
                whose hit area is a `::after` reaching a few pixels either
                side, and Monaco's own absolutely-positioned layers paint over
                that — `elementFromPoint` on the divider's own centre returned
                `.overflow-guard`, so the target was the editor rather than the
                handle. The other splitters in the app divide ordinary panels
                and never had to say this; only this one has an editor pressed
                against both of its sides.
              */
              className="z-10"
            />
          )}
          <GroupPane group={group} orientation={orientation} />
        </Fragment>
      ))}
    </div>
  )
}
