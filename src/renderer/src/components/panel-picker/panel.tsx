import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { RefreshCwIcon, SquareMousePointerIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Toggle } from "@/components/ui/toggle"
import { notePanels } from "@/lib/panel-evidence"
import { cn } from "@/lib/utils"
import {
  childState,
  pickRows,
  pickedTexts,
  rowState,
  takesInput,
  togglePick,
  type CockpitPanel,
  type PanelBlockSpec,
  type PanelEvent,
  type PanelScan,
  type PickChild,
  type PickRow,
  type PickState,
  type Picked,
} from "@shared/panels"

/**
 * The panel picker: the loaded cockpit's panels, as items for one block.
 *
 * It knows nothing about `pointer:` or `ignore:`. The block arrives as a
 * `PanelBlockSpec` and every block-shaped decision — which panels are rows,
 * what a row writes, whether a panel can be named alone, the sentence under
 * the title — is the spec's. A block that
 * takes panels later is a spec, and this file does not change.
 *
 * ## It scans when it opens, and never caches
 *
 * A scan of a twenty-panel cockpit takes a tenth of a second, so the list is
 * always the cockpit as it is now. The aircraft changing, a panel powering up
 * and a debugger being closed are all answered by scanning again.
 *
 * ## A tree, where an identifier is shared
 *
 * A panel with its identifier to itself is a row, and writes the identifier.
 * Where several panels share one, the row is a heading with a line under it
 * for each, carrying its full key — and what is written is always those keys,
 * the heading's box being a way to tick them all. Why a shared identifier is
 * never written is in `panels.ts`; the ticking rules are `togglePick`'s; this
 * file only draws them.
 *
 * ## One active line, and it is the one lit in the cockpit
 *
 * The list is driven from the keyboard the moment it opens — up and down move,
 * Space ticks, Enter adds, Escape leaves — and from the mouse the usual way.
 * Both move the same *active* line, and the active line is the one outlined in
 * the simulator. So walking the list with the arrow keys walks the cockpit,
 * which is how "which of these is `KX155B_2`" gets answered.
 *
 * Focus stays on the list throughout. Its lines are not focus stops and the
 * checkboxes are drawn, not operated: a list that hands focus to whichever box
 * was last clicked is a list whose arrow keys stop working after one click.
 *
 * **Pick in cockpit** is the same question asked the other way, and works the
 * way a browser's inspect button does: turn it on, go and click a display, and
 * its line is ticked. While it is on, the panel under the pointer wears the
 * same outline and its line is lit here, so there is never a doubt about
 * whether it is armed. The click is kept from the instrument, and one click
 * ends it. It reaches the live panels only — the simulator sends the others
 * no mouse — which are the ones above the list's one label. The ones below it
 * are dark right now and just as much part of the aircraft; see `takesInput`
 * in panels.ts for why they are listed at all.
 *
 * All of that belongs to a session in main that holds the panels for as long
 * as this component is mounted — `openPanels` on the way in, `closePanels` on
 * the way out — because the simulator gives each panel to one debugger at a
 * time. See `panel-session.ts`.
 *
 * ## A held panel is a row, not an error
 *
 * The simulator allows one debugger per panel. One that something else has
 * open cannot be read, but its title still carries the identifier, and the
 * identifier is all an item is — so the row is there and works. What is lost
 * is said once, above the list, with the process that is holding it and a
 * button that asks it to close.
 */

interface Props {
  spec: PanelBlockSpec
  /** What the block lists already. */
  taken: string[]
  onAdd: (items: string[]) => void
  onClose: () => void
  /** Called after every render that can change the height. */
  onResize: () => void
}

/** How long a closing debugger gets to let go before the list is read again. */
const RELEASE_MS = 600

const FAILURES: Record<Exclude<PanelScan, { ok: true }>["reason"], string> = {
  unreachable:
    "Nothing answered on port 19999 — MSFS hosts its debugger there, and the panels are read from it.",
  "no-panels":
    "No cockpit is loaded — the simulator lists panels only while you are in a flight.",
  failed: "The panels could not be read",
}

/** `650×768`, or each distinct size when the panels behind a row differ. */
function sizesOf(panels: CockpitPanel[]): string {
  const sizes = new Set(
    panels
      .filter((panel) => !panel.unread)
      .map((panel) => `${panel.width}×${panel.height}`)
  )
  return [...sizes].join(", ")
}

/** A row or one of its children, as the one flat thing the list moves through. */
interface ListLine {
  /** Unique in the list. Two lines can write the same text; see `PickChild`. */
  id: string
  /** The text it writes — or, for a group's heading, the identifier it shows. */
  text: string
  row: PickRow
  child: PickChild | null
  /** The pages an outline can be drawn in: the ones this session holds. */
  pages: number[]
  /** Already in the block, by itself or through its row. */
  locked: boolean
  /** Not taking input right now. Muted, and out of reach of the cockpit. */
  dark: boolean
  /** The first dark row, which the label goes above. */
  startsDark: boolean
}

function linesOf(rows: PickRow[]): ListLine[] {
  const pages = (panels: CockpitPanel[]): number[] =>
    panels.filter((panel) => !panel.unread).map((panel) => panel.page)

  const darkAt = rows.findIndex((row) => row.rank === "plain")

  return rows.flatMap((row, index) => [
    {
      id: row.text,
      text: row.text,
      row,
      child: null,
      pages: pages(row.panels),
      locked: row.taken,
      dark: row.rank === "plain",
      startsDark: index === darkAt,
    },
    ...row.children.map((child) => ({
      id: child.id,
      text: child.text,
      row,
      child,
      pages: pages([child.panel]),
      locked: row.taken || child.taken,
      // By its own panels: a group with one unit live and one swapped out
      // sorts with the live ones, and only the dark child is muted.
      dark: !takesInput(child.panel),
      startsDark: false,
    })),
  ])
}

export function PanelPickerPanel({
  spec,
  taken,
  onAdd,
  onClose,
  onResize,
}: Props) {
  const [scan, setScan] = useState<PanelScan | null>(null)
  const [picked, setPicked] = useState<Picked>(new Set())
  const [active, setActive] = useState<string | null>(null)
  const [closing, setClosing] = useState<number | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  /** Inspect mode, as main last reported it — never as this asked for it. */
  const [inspecting, setInspecting] = useState(false)
  /** The page under the pointer in the cockpit, while inspecting. */
  const [pointed, setPointed] = useState<number | null>(null)

  /** Bumped per scan, so an answer that was overtaken is dropped. */
  const run = useRef(0)
  const surface = useRef<HTMLDivElement | null>(null)
  const list = useRef<HTMLUListElement | null>(null)

  const read = useCallback((first: boolean) => {
    const mine = ++run.current
    const asked = first ? window.api.openPanels() : window.api.rescanPanels()

    void asked.then((found) => {
      // The freshest reading of the cockpit there is, so the diagnostics
      // have it too — whether or not this popup is still the one asking.
      notePanels(found)
      if (run.current === mine) setScan(found)
    })
  }, [])

  /**
   * From a button: the list goes back to "reading" first.
   *
   * Focus goes to the surface before the button that was clicked disables
   * itself. A disabled control drops focus to the document, and from there
   * Escape and Enter reach nobody — the popup sat open, holding every panel,
   * with no key that would close it.
   */
  const rescan = useCallback(() => {
    surface.current?.focus()
    setScan(null)
    read(false)
  }, [read])

  // The session is this component's: opened with it, closed with it. `scan`
  // starts null, so there is nothing to reset on the way in.
  useEffect(() => {
    // The ref itself, not its value: the cleanup is meant to bump whatever the
    // counter has reached by then, so a late answer finds it moved on.
    const counter = run
    read(true)

    return () => {
      counter.current++
      void window.api.closePanels()
    }
  }, [read])

  useEffect(() => {
    // After the paint that placed the widget — Monaco takes focus back if this
    // races the click that opened it.
    const frame = requestAnimationFrame(() =>
      (list.current ?? surface.current)?.focus()
    )
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(onResize)

  const rows = useMemo(
    () => (scan?.ok ? pickRows(spec, scan.panels, taken) : []),
    [scan, spec, taken]
  )
  const lines = useMemo(() => linesOf(rows), [rows])

  // The list takes the keyboard as soon as there is one — but only from the
  // surface, which is where focus waits while the cockpit is being read. A
  // button somebody has tabbed to keeps it.
  useEffect(() => {
    if (!lines.length) return

    // Wherever focus is, short of a control in here: the scan can beat the
    // first focus below, and then it is still in the editor.
    const focused = document.activeElement
    const onControl =
      focused !== surface.current && surface.current?.contains(focused)
    if (!onControl) list.current?.focus()
  }, [lines.length])

  // Each panel's outline is named by the most specific line there is for it:
  // its own key under a heading, its row otherwise. The same choice a pick in
  // the cockpit makes, so what the display says is what ticking it writes.
  const labels = useMemo(() => {
    const byPage: Record<number, string> = {}
    // Children follow their heading, so a later line is a more specific one.
    for (const line of lines)
      for (const page of line.pages) byPage[page] = line.text
    return byPage
  }, [lines])
  useEffect(() => {
    void window.api.labelPanels(labels)
  }, [labels])

  // The active line is the one outlined in the cockpit, whichever of the
  // keyboard and the mouse made it active.
  const activeLine = lines.find((line) => line.id === active) ?? null
  const litPages = activeLine?.pages.join(",") ?? ""
  useEffect(() => {
    void window.api.highlightPanels(
      litPages ? litPages.split(",").map(Number) : []
    )
  }, [litPages])

  const bringIntoView = (id: string): void =>
    list.current
      ?.querySelector(`[data-id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "nearest" })

  // What the cockpit says. Kept in a ref'd handler so the subscription is made
  // once, and a click that lands mid-render still finds the current lines.
  const onEvent = useRef<(event: PanelEvent) => void>(() => {})
  useEffect(() => {
    onEvent.current = (event) => {
      if (event.type === "inspect") {
        setInspecting(event.on)
        if (!event.on) setPointed(null)
        return
      }
      if (event.type === "hover") return setPointed(event.page)
      if (event.type === "leave")
        return setPointed((page) => (page === event.page ? null : page))

      // A pick is of *that* panel, so it ticks the most specific line there
      // is for it: its own key where it has one, its identifier where not.
      const hit = [...lines]
        .reverse()
        .find((line) => line.pages.includes(event.page))
      if (!hit) return

      // Back from the cockpit with the keyboard where it is useful: the click
      // on the toggle left focus there, and Enter on a toggle is not "add".
      list.current?.focus()
      setActive(hit.id)
      if (!hit.locked && stateOf(hit, picked) !== "on")
        setPicked(togglePick(rows, picked, hit.row.text, hit.child?.id))
      bringIntoView(hit.id)
    }
  })
  useEffect(
    () => window.api.onPanelEvent((event) => onEvent.current(event)),
    []
  )

  /** Whether the list has anything inspect mode could reach. */
  const reachable = lines.some((line) => line.pages.length > 0 && !line.dark)

  const toggle = (line: ListLine): void => {
    if (!line.locked)
      setPicked(togglePick(rows, picked, line.row.text, line.child?.id))
  }

  // In list order rather than click order, so what is written reads the way
  // the list did.
  const items = pickedTexts(rows, picked)

  /**
   * Enter adds what is ticked — and with nothing ticked, the active line, so
   * that Ctrl+Space, down, Enter is a whole pick.
   */
  /**
   * Adds one line by itself. Through `togglePick`, not by its id: a group's
   * heading is not an item, and adding it means adding what ticking it would
   * have ticked.
   */
  const addLine = (line: ListLine): void => {
    if (line.locked) return

    const texts = pickedTexts(
      rows,
      togglePick(rows, new Set(), line.row.text, line.child?.id)
    )
    if (texts.length) onAdd(texts)
  }

  const submit = (): void => {
    if (items.length) return onAdd(items)
    if (activeLine) addLine(activeLine)
  }

  const move = (step: number | "first" | "last"): void => {
    if (!lines.length) return

    const at = lines.findIndex((line) => line.id === active)
    const to =
      step === "first"
        ? 0
        : step === "last"
          ? lines.length - 1
          : at === -1
            ? step > 0
              ? 0
              : lines.length - 1
            : Math.max(0, Math.min(lines.length - 1, at + step))

    const next = lines[to]!
    setActive(next.id)
    bringIntoView(next.id)
  }

  const closeHolder = (pid: number): void => {
    // The same reason as in `rescan`: this button is about to disable itself.
    surface.current?.focus()
    setClosing(pid)
    setRefusal(null)

    void window.api.closePanelHolder(pid).then((reason) => {
      if (reason) {
        setClosing(null)
        return setRefusal(reason)
      }
      setTimeout(() => {
        setClosing(null)
        rescan()
      }, RELEASE_MS)
    })
  }

  const held = scan?.ok ? scan.skipped.length : 0

  return (
    <div
      ref={surface}
      tabIndex={-1}
      className="fsc-panel-picker-surface w-96 rounded-lg bg-popover p-4 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          return onClose()
        }

        // A focused button owns its own Space and Enter.
        const onList =
          event.target === list.current || event.target === surface.current
        if (!onList) return

        const handled = (): void => {
          event.preventDefault()
          event.stopPropagation()
        }
        if (event.key === "ArrowDown") return (handled(), move(1))
        if (event.key === "ArrowUp") return (handled(), move(-1))
        if (event.key === "Home") return (handled(), move("first"))
        if (event.key === "End") return (handled(), move("last"))
        if (event.key === "Enter") return (handled(), submit())
        if (event.key === " " && activeLine)
          return (handled(), toggle(activeLine))
      }}
    >
      <header className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="font-heading text-sm font-medium">Cockpit panels</h2>
          <p className="text-xs/relaxed text-muted-foreground">
            {spec.summary}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Scan again"
          disabled={scan === null}
          onClick={rescan}
        >
          <RefreshCwIcon className={cn(scan === null && "animate-spin")} />
        </Button>
      </header>

      {scan?.ok && held > 0 && (
        <div className="mt-4 flex flex-col gap-2 rounded-md border border-[color:var(--tone-border)] bg-[var(--tone-surface)] p-2 text-xs/relaxed tone-warning">
          <p className="text-[color:var(--tone-foreground)]">
            {held === 1 ? "1 panel is" : `${held} panels are`} open in{" "}
            {scan.holders.length > 0
              ? scan.holders.map((holder) => holder.name).join(" and ")
              : "another debugger"}{" "}
            — the simulator allows one debugger per panel, so{" "}
            {held === 1 ? "it is" : "they are"} listed by name only.
          </p>
          {scan.holders.map((holder) => (
            <Button
              key={holder.pid}
              size="sm"
              variant="outline"
              tone="warning"
              className="self-start"
              disabled={closing !== null}
              onClick={() => closeHolder(holder.pid)}
            >
              {closing === holder.pid ? "Closing…" : `Close ${holder.name}`}
            </Button>
          ))}
          {refusal && <p className="text-destructive">Failed — {refusal}</p>}
        </div>
      )}

      <div className="mt-4">
        {scan === null ? (
          <p className="text-xs/relaxed text-muted-foreground">
            Reading the cockpit…
          </p>
        ) : !scan.ok ? (
          <p className="text-xs/relaxed text-destructive">
            {FAILURES[scan.reason]}
            {scan.reason === "failed" && ` — ${scan.detail}`}
          </p>
        ) : lines.length === 0 ? (
          <p className="text-xs/relaxed text-muted-foreground">{spec.none}</p>
        ) : (
          <ul
            ref={list}
            role="tree"
            aria-multiselectable
            aria-activedescendant={
              activeLine ? `panel-line-${lines.indexOf(activeLine)}` : undefined
            }
            tabIndex={0}
            className="fsc-panel-picker-list scrollbar-overlay -mx-2 flex max-h-72 flex-col overflow-y-auto"
            // Focus stays here: a click ticks a line without taking the
            // keyboard away from the list it belongs to.
            onMouseDown={(event) => {
              event.preventDefault()
              list.current?.focus()
            }}
            onMouseLeave={() => setActive(null)}
          >
            {lines.map((line, index) => {
              const state = stateOf(line, picked)
              const lit =
                pointed !== null &&
                line.pages.includes(pointed) &&
                // The most specific line for that panel, as a pick would tick.
                (line.child !== null || line.row.children.length === 0)

              return (
                <li key={line.id} role="none">
                  {line.startsDark && (
                    <p className="px-2 pt-2 pb-1 text-xs text-muted-foreground">
                      Not interactive
                    </p>
                  )}
                  <div
                    id={`panel-line-${index}`}
                    role="treeitem"
                    aria-level={line.child ? 2 : 1}
                    aria-checked={state === "some" ? "mixed" : state === "on"}
                    aria-selected={line.id === active}
                    aria-disabled={line.locked}
                    data-id={line.id}
                    data-line={line.text}
                    className={cn(
                      "flex items-start gap-2 rounded-md px-2 py-1 text-xs",
                      line.child && "pl-8",
                      line.locked ? "text-muted-foreground" : "cursor-pointer",
                      (line.dark || line.row.helper) && "text-muted-foreground",
                      line.id === active && "bg-muted",
                      // The panel under the pointer in the cockpit, said here
                      // in the colour it is wearing there.
                      lit &&
                        "bg-[var(--tone-surface)] text-[color:var(--tone-foreground)] tone-sim"
                    )}
                    onMouseMove={() => setActive(line.id)}
                    onClick={() => toggle(line)}
                    /* Add this one and be done, in one gesture. Worked out
                       from the line rather than read from what is ticked: a
                       double click is two clicks, and the second has just
                       unticked what the first ticked. */
                    onDoubleClick={() => addLine(line)}
                  >
                    {/* Drawn, not operated: the line is the control, and the
                        box is how it shows its state. */}
                    <Checkbox
                      tabIndex={-1}
                      aria-hidden
                      className="pointer-events-none"
                      checked={state === "on"}
                      indeterminate={state === "some"}
                      disabled={line.locked}
                    />
                    <span
                      className={cn(
                        "min-w-0 font-mono",
                        // A key's telling part is at its end, so it wraps
                        // rather than losing that to an ellipsis.
                        line.child ? "break-all" : "truncate"
                      )}
                    >
                      {line.text}
                    </span>
                    {!line.child && line.row.panels.length > 1 && (
                      <span className="text-muted-foreground">
                        ×{line.row.panels.length}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-muted-foreground">
                      {line.locked
                        ? "listed"
                        : // A heading says nothing here: the lines under it
                          // each carry their own size.
                          line.child || line.row.children.length === 0
                          ? sizesOf(
                              line.child ? [line.child.panel] : line.row.panels
                            )
                          : null}
                    </span>
                  </div>
                  {!line.child && line.row.note && line.row.rank === "warn" && (
                    <p className="px-2 pb-1 pl-8 text-xs/relaxed text-[color:var(--tone-foreground)] tone-warning">
                      {line.row.note}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        {/* State from main, request to main: the toggle never believes its own
            click, because a pick in the cockpit turns it off from there. */}
        <Toggle
          tone="sim"
          disabled={!reachable}
          pressed={inspecting}
          onPressedChange={(next) => void window.api.inspectPanels(next)}
        >
          <SquareMousePointerIcon />
          {inspecting ? "Click a panel in the sim…" : "Pick in cockpit"}
        </Toggle>
        <Button
          tone="sim"
          disabled={items.length === 0}
          onClick={() => onAdd(items)}
        >
          {items.length === 0
            ? "Add"
            : items.length === 1
              ? "Add 1 item"
              : `Add ${items.length} items`}
        </Button>
      </div>
    </div>
  )
}

function stateOf(line: ListLine, picked: Picked): PickState {
  return line.child
    ? childState(line.row, line.child, picked)
    : rowState(line.row, picked)
}
