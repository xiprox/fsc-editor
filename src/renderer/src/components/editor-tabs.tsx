import { useEffect, useRef } from "react"

import { X } from "lucide-react"

import {
  carriesEditorDrag,
  readEditorDrag,
  setTabDrag,
} from "@/lib/editor-dnd"
import { groupById } from "@/lib/groups"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

interface TabLabel {
  name: string
  /** Parent folder, shown only when another open tab has the same name. */
  hint?: string
}

/** What an amber dot means, for the tab that is wearing one. */
const STALE = "Changed on disk since you edited it. Saving replaces it."

/**
 * `modules/fuel.yaml` and a top-level `fuel.yaml` are different files with the
 * same name, so both tabs say where they came from — and only then, since the
 * folder is noise the rest of the time.
 */
function labelsFor(tabs: string[]): TabLabel[] {
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1)

  const counts = new Map<string, number>()
  for (const tab of tabs) {
    const name = nameOf(tab)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  return tabs.map((tab) => {
    const name = nameOf(tab)
    const cut = tab.lastIndexOf("/")

    return (counts.get(name) ?? 0) > 1 && cut !== -1
      ? { name, hint: tab.slice(0, cut) }
      : { name }
  })
}

/**
 * The open files in one group. Tabs sit on the strip's bottom edge and the
 * active one is cut out of it — same surface as the editor below, its border
 * stopping where the file begins — so the tab reads as the top of the document
 * rather than as a button that happens to be selected.
 *
 * The keyboard shortcuts that used to live here — Ctrl+Tab, Ctrl+W — moved to
 * the grid. There is one window and one set of them, and a listener bound per
 * strip meant Ctrl+W closing a tab in every pane at once.
 */
export function EditorTabs({ group }: { group: string }) {
  const tabs = useStore((state) => groupById(state.groups, group)?.tabs)
  const activePath = useStore(
    (state) => groupById(state.groups, group)?.active ?? null
  )
  const focused = useStore((state) => state.focusedGroup === group)
  const open = useStore((state) => state.open)
  const openFile = useStore((state) => state.openFile)
  const closeFile = useStore((state) => state.closeFile)
  const moveTab = useStore((state) => state.moveTab)
  const moveTabToGroup = useStore((state) => state.moveTabToGroup)

  const strip = useRef<HTMLDivElement>(null)
  const dragged = useRef<string | null>(null)

  // A tab reached by keyboard, or one pushed off the end by another opening,
  // has to bring itself into view.
  useEffect(() => {
    strip.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [activePath, tabs])

  if (!tabs?.length) return null

  const labels = labelsFor(tabs)

  /** A tab dropped on the strip itself, past the end of the row. */
  const onDropInStrip = (event: React.DragEvent, index?: number) => {
    const drag = readEditorDrag(event.dataTransfer)
    if (!drag) return

    event.preventDefault()

    if (drag.group && drag.group !== group)
      moveTabToGroup(drag.relPath, drag.group, group, index)
    else if (!drag.group) void openFile(drag.relPath, { group })
  }

  return (
    <div
      ref={strip}
      role="tablist"
      aria-label="Open profiles"
      onDragOver={(event) => {
        // Accepting the drop is what makes the strip a target for a tab carried
        // from another pane, or a file carried from the sidebar. Reordering
        // within this strip is handled per tab, on `dragEnter`, where the index
        // is known. The payload itself is unreadable until the drop, so this
        // asks only whether the drag is one of ours.
        if (carriesEditorDrag(event.dataTransfer)) event.preventDefault()
      }}
      onDrop={(event) => onDropInStrip(event)}
      /*
        The wheel scrolls the strip sideways. It has no scrollbar to drag, and
        a mouse wheel only turns vertically, so with more tabs than width the
        ones past the edge could be reached only by opening them. A trackpad's
        own sideways movement still arrives as `deltaX` and is left alone.
      */
      onWheel={(event) => {
        if (event.deltaX === 0 && event.deltaY !== 0)
          event.currentTarget.scrollLeft += event.deltaY
      }}
      className={cn(
        "flex h-9 shrink-0 scrollbar-none items-end overflow-x-auto border-b bg-sidebar",
        // Which pane the next file opens into, said quietly. The active tab is
        // already cut out of the strip; this is the same statement one level up,
        // and it has to be legible without being a second selection highlight.
        !focused && "opacity-70"
      )}
    >
      {tabs.map((path, index) => {
        const file = open[path]
        const dirty = !!file && file.draft !== file.saved
        const stale = dirty && !!file.stale
        const isActive = path === activePath
        const label = labels[index]

        return (
          <button
            role="tab"
            aria-selected={isActive}
            data-active={isActive}
            title={stale ? STALE : undefined}
            draggable
            onClick={() => void openFile(path, { group })}
            onMouseDown={(event) => {
              // Keeps middle click from arming the autoscroll cursor.
              if (event.button === 1) event.preventDefault()
            }}
            onAuxClick={(event) => {
              if (event.button === 1) void closeFile(path, group)
            }}
            onDragStart={(event) => {
              dragged.current = path
              // The payload is what lets this tab land in another pane. The ref
              // still carries the reorder within this one, which needs no
              // payload because it never leaves the component.
              setTabDrag(event.dataTransfer, { relPath: path, group })
            }}
            onDragEnter={() => {
              // Reordered as the pointer passes, so the row itself is the
              // preview and there is no separate insertion marker to read.
              const from = tabs.indexOf(dragged.current ?? "")
              if (from !== -1 && from !== index) moveTab(group, from, index)
            }}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.stopPropagation()
              onDropInStrip(event, index)
            }}
            onDragEnd={() => {
              dragged.current = null
            }}
            className={cn(
              "group relative flex h-9 shrink-0 items-center gap-2 border-r py-0 pr-2 pl-3 text-[12.5px]",
              isActive
                ? "max-w-55 bg-background text-foreground"
                : "max-w-55 text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <span className="min-w-0 truncate-trim">
              {label.hint && <span className="opacity-55">{label.hint}/</span>}
              {label.name}
            </span>

            <span
              role="button"
              aria-label={`Close ${label.name}`}
              onClick={(event) => {
                event.stopPropagation()
                void closeFile(path, group)
              }}
              className="relative flex size-4 shrink-0 items-center justify-center rounded-sm hover:bg-foreground/10"
            >
              {/*
                One slot, two jobs: the dot says the file is unsaved and gives
                way to the close control on hover, so the tab never changes
                width and a clean file still has somewhere to click.
              */}
              {/*
                Amber for a buffer whose file moved underneath it, which is the
                colour anomalies wear everywhere else in this app. It rides the
                dot rather than adding a second mark: the tab must not change
                width, and "unsaved" and "unsaved over something new" are the
                same fact at two strengths.
              */}
              {dirty && (
                <span
                  className={cn(
                    "size-1.5 rounded-full group-hover:opacity-0",
                    stale
                      ? "bg-amber-600 dark:bg-amber-400"
                      : "bg-foreground/60"
                  )}
                />
              )}
              <X className="absolute size-3 opacity-0 group-hover:opacity-100" />
            </span>
          </button>
        )
      })}
    </div>
  )
}
