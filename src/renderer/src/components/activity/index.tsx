import { useCallback, useEffect, useState } from "react"

import { Circle, Crosshair, Eraser } from "lucide-react"

import { MARK_BEFORE_MS, type Finding } from "@shared/activity"
import type { Hotkeys } from "@shared/types"

import { ToggleRailButton } from "@/components/rail"
import { Splitter } from "@/components/splitter"
import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { usePanelWidth } from "@/lib/panel-width"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"
import { VarChip } from "@/components/var-chip"
import { radarBlock } from "./blocked"
import { RadarEmpty } from "./empty"
import { HotkeyButton } from "./hotkeys"

export function ActivityRailButton() {
  const open = useStore((state) => state.radar)
  const setRadar = useStore((state) => state.setRadar)

  return (
    <ToggleRailButton
      open={open}
      onToggle={() => setRadar(!open)}
      label="Radar"
      active="border-radar-border bg-radar-surface text-radar-foreground"
      tone="radar"
    />
  )
}

/**
 * What the simulator did, and what it plausibly means.
 *
 * Two halves, because they answer different questions: the captures are a list
 * you scan, the candidates an answer you read. They were side by side while
 * Radar was the bottom panel and had the editor's width to spend. Stacked now,
 * because Radar lives under the side panel — a side-panel column cannot hold
 * two columns, and the detail table is the half that suffers from narrowing,
 * being a variable name against three short numbers.
 *
 * The detail half keeps its space when nothing is selected — 07-activity asks
 * for that, and the reason is that a panel which reflows when you click is a
 * panel you lose your place in. It is also the half carrying the remembered
 * size, so what a drag sets is the thing being read rather than the thing
 * left over.
 *
 * Findings are pulled rather than pushed. They are a *view* over main's raw
 * event ring, cheap to recompute and expensive to stream at 15 Hz, so main says
 * only that something changed and this asks if it is open.
 */
export function ActivityPanel() {
  const sim = useStore((state) => state.sim)

  const [findings, setFindings] = useState<Finding[]>([])
  const [hotkeys, setHotkeys] = useState<Hotkeys | null>(null)

  /**
   * Which capture is being read. Selection only.
   *
   * Everything about *whether* a capture happens lives in main — see
   * `activity-history.ts`. The panel used to hold that as a filter and the list
   * kept growing behind it, which is a lesson worth keeping in a comment: a
   * renderer can decide what to look at, and must not be the thing deciding
   * what exists.
   */
  const [pinned, setPinned] = useState<number | null>(null)
  const [armed, setArmed] = useState(true)

  const detail = usePanelWidth("radar.detail", {
    side: "bottom",
    min: 96,
    max: 520,
    initial: 140,
  })

  const refresh = useCallback(async () => {
    const [next, isArmed] = await Promise.all([
      window.api.activityFindings(),
      window.api.activityArmed(),
    ])

    setFindings(next)
    setArmed(isArmed)
  }, [])

  useEffect(() => {
    // Every write here lands after an IPC round trip, so nothing cascades
    // within the render the rule is about. Same shape, and the same reason, as
    // the mount effect in `remote-connect/code-input.tsx`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
    void window.api.markHotkey().then(setHotkeys)

    return window.api.onActivity(() => void refresh())
  }, [refresh])

  // Newest first: the thing you just did is the thing you are asking about.
  const rows = [...findings].reverse()
  const finding = rows.find((row) => row.anchor.t === pinned) ?? rows[0]

  /**
   * Why Radar cannot work, or null when it can — see `radarBlock`.
   *
   * Read once and used twice, by the two controls and by the empty state, so
   * that what the panel says and what its buttons allow cannot disagree.
   * Notably it does *not* gate the list: a capture taken before the sim went
   * away is still a finding, and a session ending is not a reason to take an
   * answer off the screen.
   */
  const block = radarBlock(sim)

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      {/*
        Two rows, where every other panel header is one.

        Radar's header was laid out for the bottom slot, which had the editor's
        width to spend. In the side column it is 336px by default and 264 at the
        narrowest, and the row measured about 372 — so the Capture button was
        clipped by the rail and the capture count wrapped under the title.

        The controls moved to a row of their own rather than shedding a label.
        Auto-capture being as legible as Capture is a decision with a reason
        attached, below, and "Auto-capture" is the widest thing in the header;
        dropping it to an icon would have paid for the fit out of the one thing
        the header had already argued it needed. The split also keeps the shape
        the one row had — housekeeping trailing the title, the two that do the
        work at the edge — with a line break through the middle of it.

        Not responsive. The column can be dragged wide enough for one row, but a
        header that reassembles itself mid-drag is a box that moves, and the
        second row costs 32px once rather than surprising anybody.
      */}
      <header className="flex shrink-0 flex-col">
        <div className="flex h-9 items-center gap-2 ps-3 pe-1.5">
          <span className="text-[12.5px] font-medium">Radar</span>
          {/*
          A count when there is something to count, and otherwise nothing.
          "watching" used to sit here and was almost never seen, because the
          list was derived from the ring and a connected simulator filled it
          within seconds. Captures made the empty list the ordinary state, and
          the word did not survive being looked at: the Auto-capture button
          already says whether anything is being watched *for*, and the list
          below says what to do about it.

          `not connected` used to take its place on an empty list and is gone
          for the same reason — `RadarEmpty` is holding the whole panel open
          under it, saying that at a size somebody can read.
        */}
          {rows.length > 0 && (
            <span className="text-[11px] text-muted-foreground">
              {rows.length} {rows.length === 1 ? "capture" : "captures"}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Clear entries"
                    disabled={rows.length === 0}
                    onClick={() => {
                      setPinned(null)
                      void window.api.clearActivity()
                    }}
                  >
                    <Eraser />
                  </Button>
                }
              />
              <TooltipContent side="top" className="max-w-64">
                Clear the list. The values behind it are kept, so what ranks
                next is ranked the same way.
              </TooltipContent>
            </Tooltip>
            <HotkeyButton hotkeys={hotkeys} onChange={setHotkeys} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-3 pb-2">
          {/*
            The two that do the work sit at the edge, where a hand goes for them
            without reading. Everything above and to their left is housekeeping.

            Auto-capture is as prominent as Capture because it is a *mode*: the
            others do a thing and it is over, this changes what the panel does
            next, and a mode nobody notices is one that makes the panel look
            broken when the list stops moving. Armed, it wears the feature's own
            green — outlined and faintly tinted, the same way remote-connect
            wears its violet. Disarmed it is a plain grey outline,
            because the green is what *armed* means and spending it on both
            states would leave the panel unable to say which one it is in.

            The rules that used to be spelled out here — keep the colour under
            the pointer, and never let the lit state move the label — are
            `Toggle`'s now, and every mode in the app gets them. The ring this
            button used to grow is gone with them: every toggle carries its
            border in every state, so being armed recolours a line that was
            already there and nothing is drawn outside the box.
          */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  size="xs"
                  tone="radar"
                  className="ml-1"
                  disabled={block !== null}
                  pressed={armed}
                  onPressedChange={(next) => void window.api.armActivity(next)}
                >
                  <Crosshair
                    className={cn(!armed && "text-muted-foreground")}
                  />
                  Auto-capture
                </Toggle>
              }
            />
            <TooltipContent side="top" align="end" className="max-w-64">
              Attempt to auto-capture an interaction event (e.g. switch flip or
              button press).
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="xs"
                  disabled={block !== null}
                  onClick={() => void window.api.addMark()}
                >
                  <Circle />
                  Capture
                </Button>
              }
            />
            <TooltipContent side="top" align="end" className="max-w-64">
              Capture the past {MARK_BEFORE_MS / 1000} seconds of events.
            </TooltipContent>
          </Tooltip>
        </div>
      </header>

      {/*
        Nothing captured means no columns. The two of them exist to be compared
        — a list you scan and an answer you read — and a pair of empty boxes
        with a line of grey in one of them is a layout describing furniture
        rather than a panel saying anything. So the split appears with the first
        capture and takes its remembered width with it; until then the whole
        panel is one surface, which is the only place there is room to say what
        Radar is for.
      */}
      {rows.length === 0 ? (
        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto border-t border-border">
          <RadarEmpty
            block={block}
            armed={armed}
            hotkey={hotkeys?.capture.accelerator}
          />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col border-t border-border">
          {/*
            `min-h-11` is one capture row. Radar can be dragged shorter than its
            two halves want, and without a floor here the list was the half that
            lost — at Radar's own minimum it reached zero and the captures were
            gone, leaving a detail pane for a capture that could no longer be
            changed. One row is the least that keeps the list a list.
          */}
          <ul className="scrollbar-overlay min-h-11 flex-1 overflow-y-auto text-[11px]">
            {rows.map((row) => (
              <li key={row.anchor.t}>
                <button
                  onClick={() => setPinned(row.anchor.t)}
                  className={cn(
                    "flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-accent/50",
                    finding?.anchor.t === row.anchor.t && "bg-accent"
                  )}
                >
                  {/*
                    The name first and the time under it, both because that is
                    the order they are wanted in — you look for *what* and only
                    then for *when* — and because a timestamp is fourteen
                    monospaced characters of pure precision, which at the front
                    of a row reads as the most important thing on it.
                  */}
                  <span
                    className={cn(
                      "w-full truncate font-mono",
                      row.anchor.kind === "mark" && "text-radar-foreground"
                    )}
                  >
                    {label(row.anchor)}
                  </span>
                  <span className="flex w-full items-baseline gap-1.5 font-mono text-[10px] text-muted-foreground/70">
                    {stamp(row.anchor.t)}
                    {row.anchor.repeats > 1 && (
                      <span className="ml-auto">×{row.anchor.repeats}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <Splitter orientation="horizontal" handlers={detail.handlers} />

          {/*
            Keeps its height whether or not anything is selected.

            Allowed to shrink, though, rather than pinned with `shrink-0`: the
            height is what a drag asked for, and Radar's own height can be
            dragged to less than that height plus the list above it. Pinned, the
            difference left the panel through the bottom edge and drew over the
            slot below. Shrinking, this half absorbs the squeeze down to the
            list's one-row floor above — a scrollbar here costs nothing, where
            rows that are not there cannot be clicked.
          */}
          <div
            className="scrollbar-overlay min-h-0 overflow-y-auto"
            style={{ height: detail.width }}
          >
            {finding ? <Candidates finding={finding} /> : null}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * What moved, best first. One list.
 *
 * It used to be two, headed "Moved with it" and "Followed", on the argument
 * that the variable a control *is* and the things it *caused* are different
 * answers and should not interleave. The argument is sound and the boundary is
 * not: the module samples at 15 Hz, so a control and its own effects routinely
 * arrive together, and the tier has since been caught mislabelling twice — a
 * whole marking session as "followed", and a switch reporting 2 ms early as a
 * consequence of itself.
 *
 * So the distinction is a marker on a row now rather than a heading over a
 * section. Same information, without a layout that presents a hint as a
 * finding, and the ranking gets to be the one order in the list.
 *
 * Each row is a `VarChip`, which means every candidate carries its live value
 * and updates as the cockpit moves. That is what the list is *for*: narrow it
 * to a handful, then work the control and watch which one answers.
 */
function Candidates({ finding }: { finding: Finding }) {
  const rows = flatten(finding.candidates)

  if (!finding.candidates.length) {
    return (
      <p className="px-3 py-2.5 text-[11px] text-muted-foreground">
        No results.
      </p>
    )
  }

  return (
    <div className="py-2">
      {rows.map((row) => (
        <div
          key={row.name}
          className={cn(
            "flex items-baseline gap-2 px-3 py-0.5 font-mono text-[11px]",
            // An alias sits directly under the candidate it moves with, dimmed
            // and indented. Adjacent rather than hidden behind a count: the
            // aircraft keeps several names for one lever, any of them is a
            // usable answer, and which one somebody writes into their profile
            // is their choice to make from what they can see.
            row.alias && "opacity-60"
          )}
        >
          <span className="w-12 shrink-0 text-right text-muted-foreground/70">
            {row.alias
              ? ""
              : `${row.offset >= 0 ? "+" : ""}${Math.round(row.offset)}ms`}
          </span>

          {/*
            `min-w-0` is what lets the chip's own truncation happen. It carries
            `max-w-full` and a truncating name already, but a flex item will not
            shrink under its content without this, so the names ran out through
            the column's trailing edge and under the rail — 48px of overflow on
            `A:KOHLSMAN SETTING HG EX1` at the narrowest column. Unnoticed while
            Radar had the editor's width; the side column is where it shows.
          */}
          <VarChip
            name={row.name}
            className={cn("min-w-0", row.alias && "ml-3")}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * The candidates flattened, with each group's members kept together.
 *
 * One list, ranked, because the ranking is the thing this feature *is* — the
 * two headed groups it replaced split that ranking in half and then implied the
 * split was an answer. A row and the aliases that move with it stay adjacent so
 * a group still reads as one fact.
 */
function flatten(candidates: Finding["candidates"]) {
  return candidates.flatMap((candidate) => [
    {
      name: candidate.name,
      offset: candidate.offset,
      tier: candidate.tier,
      alias: false,
    },
    ...candidate.aliases.map((name) => ({
      name,
      offset: candidate.offset,
      tier: candidate.tier,
      alias: true,
    })),
  ])
}

/**
 * What an anchor is called on screen.
 *
 * **`mark` in the code, "Manual Capture" in the UI**, and the split is
 * deliberate rather than an oversight. A mark is named after what it is to the
 * program — a point on a timeline — which means nothing to somebody who has not
 * read the program. "Manual Capture" says both what it is and what made it, in
 * a list where every other row was made automatically.
 *
 * It stays out of the data for two reasons. `capture` already means the NDJSON
 * recording of a session everywhere in main — `capture.ts`, `CAPTURE_DIR`,
 * `npm run sim:sandbox` — so renaming the concept would make "the capture"
 * ambiguous in the two places it most needs to be exact. And the anchor's name
 * is the key promiscuity counts by, so it is a value the ranking depends on,
 * not a caption.
 */
function label(anchor: Finding["anchor"]): string {
  return anchor.kind === "mark" ? "Manual Capture" : anchor.name
}

/** `13:04:24.812` — the same format the Log panel uses, for the same reason. */
function stamp(t: number): string {
  const at = new Date(t)
  return `${at.toTimeString().slice(0, 8)}.${String(at.getMilliseconds()).padStart(3, "0")}`
}
