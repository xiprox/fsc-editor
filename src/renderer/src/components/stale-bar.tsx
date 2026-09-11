import { Columns2, RotateCcw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import { useStore } from "@/store"

/**
 * The strip that appears when the file underneath a buffer has moved.
 *
 * A question, not a mode. Being stale ends the moment you save or reload, so
 * this is a bar you resolve and dismiss rather than a place the editor lives in
 * — which is why the comparison it opens is not a third `viewMode` beside the
 * remote view's two.
 *
 * **A live session outranks it.** Remote Connect puts its own bar on this strip
 * and is describing something happening right now, so where both apply the
 * session wins and the amber dot on the tab carries the news alone. The
 * condition is the one `ConnectionBar` hides itself by, read from the same
 * store rather than passed down, so the two cannot drift into both appearing.
 *
 * **A refused save outranks it too**, and for a sharper reason: this asks
 * whether replacing the file is all right, while `SaveErrorBar` reports that the
 * file could not be written at all. Saving a stale file is what produces that
 * pair — the stale question is asked and answered, and then the write fails — so
 * the bar left standing has to be the one describing where the work is, not the
 * one still asking about it.
 */
export function StaleBar({ relPath }: { relPath: string }) {
  const file = useStore((state) => state.open[relPath])
  const remote = useStore((state) => state.remote)
  const comparing = useStore((state) => relPath in state.comparing)
  const compareWithDisk = useStore((state) => state.compareWithDisk)
  const stopComparing = useStore((state) => state.stopComparing)
  const reload = useStore((state) => state.reload)

  /*
   * No dismiss. The bar goes when the thing it describes goes — a save, or a
   * reload — and a warning that can be switched off while still true is one
   * somebody switches off and then overwrites an afternoon of someone else's
   * work with. Compare toggles the view; it does not settle anything, so it
   * does not clear this.
   */

  const inSession =
    remote.phase === "connected" &&
    remote.files.some((each) => each.relPath === relPath)

  if (!file?.stale || file.draft === file.saved || inSession) return null
  if (file.saveError) return null

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-warning-border bg-warning-surface pr-1 pl-2 text-[12px] text-warning-foreground">
      <TriangleAlert className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        Changed on disk since you edited it.
      </span>

      <div className="ml-auto flex shrink-0 items-center gap-1">
        {/*
          A mode, so a `Toggle` — the comparison stays up until it is switched
          off, and the control has to keep saying so. `tone` is what puts it in
          the bar's amber; the bar no longer dresses its own buttons.
        */}
        <Toggle
          size="sm"
          tone="warning"
          pressed={comparing}
          onPressedChange={(next) =>
            next ? void compareWithDisk(relPath) : stopComparing(relPath)
          }
        >
          <Columns2 />
          {comparing ? "Editing" : "Compare"}
        </Toggle>

        {/*
          Reload is the other resolution, and the destructive one — it replaces
          the buffer with the file. Keeping yours needs no button here: that is
          what saving does, and the save asks its own question first.
        */}
        <Button
          variant="ghost"
          size="sm"
          tone="warning"
          onClick={() => void reload(relPath)}
        >
          <RotateCcw />
          Reload
        </Button>
      </div>
    </div>
  )
}
