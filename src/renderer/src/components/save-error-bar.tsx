import { RotateCw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useStore } from "@/store"

/**
 * The strip that appears when a save was refused.
 *
 * The most urgent thing this strip can say, and the only one of its bars that
 * reports rather than asks: `ConnectionBar` describes a session and `StaleBar`
 * asks whether replacing the file is all right, while this says that what is in
 * the editor is not on disk and the app could not put it there. So it takes the
 * `destructive` palette, which exists for exactly the distinction — amber asks,
 * red reports — and `StaleBar` yields to it. The two genuinely co-occur: saving
 * a stale file asks its own question first, and the write can still fail after
 * the answer, which used to leave the reason in a footer line nobody was
 * looking at.
 *
 * **One line, and Retry is the only control.** Reload has no business here — it
 * would replace the buffer with the file, which is to say it would discard
 * exactly the work that just failed to save. The sentence puts the reason before
 * the culprit (`… — another program has it open, most likely FS Copilot`) so
 * that a narrow pane truncates the guess rather than the fact.
 *
 * There is no dismiss, for `StaleBar`'s reason: the bar goes when the thing it
 * describes goes. A save that works clears it, and so does anything that
 * replaces the buffer wholesale — a reload, or taking the host's copy.
 */
export function SaveErrorBar({ relPath }: { relPath: string }) {
  const message = useStore((state) => state.open[relPath]?.saveError)
  const save = useStore((state) => state.save)

  if (!message) return null

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-destructive-border bg-destructive-surface pr-1 pl-2 text-[12px] text-destructive-foreground">
      <TriangleAlert className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{message}</span>

      {/*
        Retrying is the whole resolution, so it is the whole bar. `tone` is what
        puts it in the palette around it — the same arrangement `StaleBar` uses,
        and the reason neither bar dresses its own buttons.
      */}
      <Button
        variant="ghost"
        size="sm"
        tone="destructive"
        className="ml-auto"
        onClick={() => void save(relPath)}
      >
        <RotateCw />
        Retry
      </Button>
    </div>
  )
}
