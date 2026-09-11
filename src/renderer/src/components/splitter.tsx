import type { PanelWidth } from "@/lib/panel-width"
import { cn } from "@/lib/utils"

/**
 * The divider between a panel and the editor.
 *
 * It is drawn as the one-pixel rule the layout wants, but a one-pixel target
 * means aiming for it. The `::after` widens what the pointer can hit to either
 * side while taking no space of its own, so the line stays exactly where it was
 * and the cursor turns a few pixels before you arrive.
 */
export function Splitter({
  handlers,
  orientation = "vertical",
  className,
}: {
  handlers: PanelWidth["handlers"]
  /**
   * `vertical` is a vertical line dividing left from right — the ARIA sense,
   * which is the orientation of the separator itself rather than of the drag.
   */
  orientation?: "vertical" | "horizontal"
  className?: string
}) {
  const horizontal = orientation === "horizontal"

  return (
    <div
      role="separator"
      aria-orientation={orientation}
      className={cn(
        "relative shrink-0 bg-border hover:bg-ring/40",
        horizontal
          ? // Same trick on the other axis: a one-pixel rule, with a hit area
            // that reaches a few pixels either side and takes no space.
            "h-px cursor-row-resize after:absolute after:inset-x-0 after:-top-1 after:-bottom-1 after:content-['']"
          : "w-px cursor-col-resize after:absolute after:inset-y-0 after:-right-1 after:-left-1 after:content-['']",
        className
      )}
      {...handlers}
    />
  )
}
