import { ClipboardCopy } from "lucide-react"
import { useEffect } from "react"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { copy } from "@/lib/clipboard"
import { formatValue } from "@/lib/live-decorations"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useVarValue } from "@/lib/use-var-value"
import { cn } from "@/lib/utils"
import { retainVar } from "@/lib/var-watch"

/**
 * One variable, drawn the way the editor draws it, with its live value.
 *
 * ## Why it is a component and not a formatted string
 *
 * A variable name turns up in the Activity list, the Variables panel and the
 * Log detail, and in every one of them the useful questions are the same: what
 * is it called, what is it reading right now, and can I get it into the file.
 * Written out as text it answers the first only, and each panel grows its own
 * half of the rest.
 *
 * ## The colours are not a match, they are the same colours
 *
 * `monaco-theme.ts` does not hold a palette — it reads the resolved
 * `--syntax-*` custom properties off the document and builds the editor theme
 * from them. Using the same properties here means a chip cannot drift from the
 * editor when the palette is tuned, because there is only one palette.
 *
 * ## Its own subscription, but not its own message
 *
 * Mounting retains the name in `var-watch.ts`, which counts holders and lets
 * the store send **one** union of what the editor and the interface are
 * showing. Thirty chips are one message, and two chips showing the same
 * variable do not unsubscribe each other.
 *
 * ## `live={false}`, for a list too long to be worth watching
 *
 * The union above is cheap in messages and not free in everything else: main
 * scans the watch list per arriving value, and the whole watched set crosses
 * IPC on every batch. A caller rendering two hundred rows of search results is
 * asking for a dictionary, not a cockpit, and can say so — the chip then reads
 * as the name it always was and asks the simulator for nothing.
 *
 * It suppresses the *reading* as well as the subscription, deliberately. A
 * handful of the names in a long list are usually watched anyway because an
 * open file mentions them, and showing values on those few would put live
 * numbers on a list the panel is simultaneously explaining has none.
 *
 * ## The tooltip is the documentation, or there is no tooltip
 *
 * `doc` is what the SDK says this variable is. Where there is none the chip
 * renders bare rather than falling back to something generic: a tooltip that
 * appears on every chip and says the same thing on all of them teaches the
 * reader to ignore tooltips, which costs the ones that had something to say.
 */
export function VarChip({
  name,
  className,
  live = true,
  retain = true,
  doc,
}: {
  name: string
  className?: string
  live?: boolean
  /**
   * Whether this chip is what keeps the name watched.
   *
   * True for the ordinary case — a handful of chips whose lifetime is the same
   * as their caller's interest. False where the caller holds the subscription
   * itself: a virtualized list mounts and unmounts rows as it scrolls, and a
   * watch set that follows the scrollbar is a watch set rebuilt for no reason.
   * See `useRetainedVars`.
   */
  retain?: boolean
  /** The SDK's description. No description, no tooltip. */
  doc?: string
}) {
  useEffect(
    () => (live && retain ? retainVar(name) : undefined),
    [name, live, retain]
  )

  const watched = useVarValue(name)
  const value = live ? watched : undefined
  const [prefix, bare] = split(name)

  const face = (
    <>
      {prefix && (
        <span className="shrink-0 font-bold text-[var(--syntax-prefix)]">
          {prefix}
        </span>
      )}
      <span className="truncate text-[var(--syntax-var)]">{bare}</span>

      {/*
        No value, no box. A variable the simulator has not reported is not
        reading zero, and in a candidate list a zero is a completely plausible
        reading — the placeholder would be indistinguishable from an answer.
      */}
      {value !== undefined && (
        <span className="shrink-0 text-[var(--sim-value)]">
          {formatValue(value, "")}
        </span>
      )}
    </>
  )

  /*
   * The tooltip's trigger, when there is one, is the same element as the
   * menu's: Base UI composes the two through `render`, so the chip stays one
   * span in the DOM rather than a span inside a span inside a div.
   */
  const menu = (
    <ContextMenu>
      <ContextMenuTrigger
        render={doc ? <TooltipTrigger render={<span />} /> : <span />}
        /*
         * Draggable, and that is the whole of it on this side.
         *
         * The editor's half is in `editor-pane.tsx`, and this side deliberately
         * knows nothing about it: a chip that imported monaco could only ever live
         * next to one, and the places it is most wanted — the Radar list, the
         * Variables panel, the Log detail — are not next to one. All that crosses
         * is `text/plain`.
         *
         * The bare namespaced name, because that is the thing being dragged. A
         * whole `get:` line is a different gesture and can have its own modifier
         * if it turns out to be wanted.
         */
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData("text/plain", name)
          event.dataTransfer.effectAllowed = "copy"
        }}
        className={cn(
          // Lifts on hover rather than lighting up: the chip is a label that
          // happens to be interactive, and a row of them is often a list to read
          // rather than a set of things to press. One step of the same muted
          // tone, so it reads as "this responds" without competing with the row
          // highlight underneath it.
          "inline-flex max-w-full items-baseline gap-1 rounded-sm bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] leading-tight hover:bg-muted",
          className
        )}
      >
        {face}
      </ContextMenuTrigger>

      {/*
        The drag's other half, for when the file is not the destination: a
        search box, a message to the other pilot, a line of RPN in another
        window. The same bare name the drag carries, for the same reason.

        Without the prefix, for the places that spell the namespace some other
        way or not at all — the SDK docs, a forum search, a `(L:…)` being typed
        by hand around it. Offered only when there is a prefix to take off.

        The value is the one on the chip, formatted the same way, read at the
        moment of the click. Offered only when the chip shows one, on the same
        rule as the box: no reading is not a reading of zero.
      */}
      <ContextMenuContent>
        <ContextMenuItem onClick={() => void copy(name)}>
          <ClipboardCopy />
          Copy name
        </ContextMenuItem>
        {prefix && (
          <ContextMenuItem onClick={() => void copy(bare)}>
            <ClipboardCopy />
            Copy name without prefix
          </ContextMenuItem>
        )}
        {value !== undefined && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => void copy(formatValue(value, ""))}>
              <ClipboardCopy />
              Copy value
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )

  if (!doc) return menu

  return (
    <Tooltip>
      {menu}
      <TooltipContent side="top" className="max-w-72">
        {doc}
      </TooltipContent>
    </Tooltip>
  )
}

/** `L:Foo` -> `["L:", "Foo"]`. A name with no namespace keeps all of itself. */
function split(name: string): [string, string] {
  const at = name.indexOf(":")
  return at > 0 ? [name.slice(0, at + 1), name.slice(at + 1)] : ["", name]
}
