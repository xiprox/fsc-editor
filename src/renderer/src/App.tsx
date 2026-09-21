import { useEffect, useState } from "react"

import { FilePlus2, Settings } from "lucide-react"

import { EditorGrid } from "@/components/editor-grid"
import { FileTree } from "@/components/file-tree"
import { FscLaunch } from "@/components/fsc-launch"
import { PanelHeader } from "@/components/panel-header"
import { Rail } from "@/components/rail"
import {
  RemoteChip,
  RemoteConnectPanel,
  RemoteRailButton,
} from "@/components/remote-connect"
import { ActivityPanel, ActivityRailButton } from "@/components/activity"
import { IssuesPanel, IssuesRailButton } from "@/components/issues"
import { TracePanel, TraceRailButton } from "@/components/trace"
import { CurrentAircraft } from "@/components/current-aircraft"
import { LogFooterButton, LogPanel } from "@/components/log"
import { ReportButton } from "@/components/report"
import {
  VariablesPanel,
  VariablesRailButton,
} from "@/components/variables"
import { SettingsDialog } from "@/components/settings/settings-dialog"
import { Setup } from "@/components/setup"
import { SimChip } from "@/components/sim"
import { Splitter } from "@/components/splitter"
import { UpdateButton } from "@/components/update-button"
import { Button } from "@/components/ui/button"
import { usePanelWidth } from "@/lib/panel-width"
import { CAPTION_INSET, watchTitleBar } from "@/lib/title-bar"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

const SIDEBAR = {
  side: "left",
  min: 190,
  max: 460,
  initial: 264,
} as const
const SIDEBAR_KEY = "sidebar-width"

/*
  Wide enough that the Variables filter row — the aircraft toggle plus every
  namespace chip — lands on one line. At 300 the last chip wrapped to a row of
  its own, which reads as a second group of filters rather than the tail of the
  first one.

  The minimum is Radar's second header row: Auto-capture, its three segments
  and Capture measure 301px with their gaps and padding. At the old 264 the
  label was pushed out past the panel's left edge.
*/
const PANEL = {
  side: "right",
  min: 304,
  max: 520,
  initial: 336,
} as const
const PANEL_KEY = "side-panel-width"

const BOTTOM = {
  side: "bottom",
  min: 120,
  max: 620,
  initial: 260,
} as const
const BOTTOM_KEY = "bottom-panel-height"

/*
  Radar's share of the side column. The same shape as BOTTOM, and for the same
  reason — it is a height dragged from below, and the panel above it gives up
  what it takes.

  `initial` is measured rather than picked. Radar spends two header rows and an
  inner divider on chrome, its captures list runs at 44px a row, and its detail
  half opens at 140 — so this is the height at which four captures are visible
  without dragging anything. At 300 the list was 42px, which is one row, and a
  list you have to scroll to see the second item in is a list you will not read.

  `min` is a floor rather than a useful size: down there the detail half has
  taken what it can and the list is at its own one-row minimum.
*/
const RADAR = {
  side: "bottom",
  min: 180,
  max: 620,
  initial: 384,
} as const
const RADAR_KEY = "radar-panel-height"

/**
 * Who wins the corner between the side column and the bottom slot.
 *
 * Both want the bottom-trailing square of the workbench, and which should get
 * it depends on how much is in the side column:
 *
 * - **One panel there** — the bottom slot runs the full width and stops at the
 *   rail, shortening the side column. A lone panel has height to spare, and a
 *   diagnostics panel is read across, so the width is worth more where it is.
 * - **Two panels there** — the side column runs full height and the bottom slot
 *   ends at its edge, spanning only the editor. Two panels stacked are already
 *   short, and taking a third of what is left for a slot neither of them is
 *   about would leave all three too small to read.
 *
 * Expressed as areas on one grid rather than as two tree shapes, so that
 * switching between them moves no element to a new parent. Every arrangement
 * names the same items; only where they sit changes.
 */
function workbenchAreas({
  side,
  bottom,
  full,
}: {
  side: boolean
  bottom: boolean
  /** The side column takes the full height — two panels are stacked in it. */
  full: boolean
}): string {
  if (!side) return bottom ? '"editor" "hsplit" "bottom"' : '"editor"'
  if (!bottom) return '"editor vsplit side"'

  return full
    ? '"editor vsplit side" "hsplit vsplit side" "bottom vsplit side"'
    : '"editor vsplit side" "hsplit hsplit hsplit" "bottom bottom bottom"'
}

export function App() {
  const init = useStore((state) => state.init)
  const initialized = useStore((state) => state.initialized)
  const workspace = useStore((state) => state.workspace)

  useEffect(() => {
    void init()
  }, [init])

  // Above the setup/workbench split, because both screens have the header the
  // caption buttons are drawn into and the theme outlives either one.
  useEffect(() => watchTitleBar(), [])

  // Nothing until the remembered folder has answered. It is a settings file and
  // a stat, so this is a frame or two — and the alternative is every launch
  // opening on the first-run screen before the workbench shoves it aside.
  if (!initialized) return <div className="h-svh bg-background" />

  return workspace ? <Workbench /> : <Setup />
}

function Workbench() {
  const startNamingProfile = useStore((state) => state.startNamingProfile)

  const panel = useStore((state) => state.panel)
  const bottom = useStore((state) => state.bottom)
  const radar = useStore((state) => state.radar)

  const sidebar = usePanelWidth(SIDEBAR_KEY, SIDEBAR)
  const side = usePanelWidth(PANEL_KEY, PANEL)
  const bottomSize = usePanelWidth(BOTTOM_KEY, BOTTOM)
  const radarSize = usePanelWidth(RADAR_KEY, RADAR)

  const sideOpen = panel !== null || radar
  /** Two panels stacked in the side column — see `workbenchAreas`. */
  const fullHeightSide = panel !== null && radar

  const [settingsOpen, setSettingsOpen] = useState(false)

  // Ctrl+, — the shortcut every editor has taught. On the window rather than
  // a Monaco command, so it works from any panel, not only with the editor
  // focused; Monaco binds nothing to it, so nothing is being taken away.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === ",") {
        event.preventDefault()
        setSettingsOpen(true)
      }
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      {/*
        The title bar: the app name, and the FS Copilot launch controls
        centered on the window. The window's minimize/maximize/close are drawn
        into its trailing end by Windows, and the room they need is reserved
        rather than assumed — see CAPTION_INSET. `relative` anchors the
        centered controls, which opt out of the drag region themselves.
      */}
      <header
        className="drag-region relative flex h-11 shrink-0 items-center gap-3 border-b border-border ps-3"
        style={{ paddingInlineEnd: CAPTION_INSET }}
      >
        <span className="text-[13px] font-medium">FSC Editor</span>
        <UpdateButton />
        <FscLaunch />
      </header>

      <div className="flex min-h-0 flex-1">
        {/*
          Same shape as the Remote Connect panel opposite it — header strip,
          then a scrolling body — so the window reads as two panels around an
          editor rather than as a sidebar and a separate thing.
        */}
        <aside
          className="flex shrink-0 flex-col bg-sidebar text-sidebar-foreground"
          style={{ width: sidebar.width }}
        >
          {/*
            Starting a profile is also offered by the two empty states, and it
            has to be here as well: those only exist while the list is empty,
            and the second profile somebody writes is no more findable than the
            first was.

            **There is no rescan here**, and the list does not need one: the
            workspace is watched recursively and every change rebuilds it. What
            a rescan additionally does is rebuild the *variable index*, which
            `applyFiles` deliberately skips on each watcher tick — and that is a
            Variables concern, offered by the Variables panel under the same
            label. Two buttons spelled `Rescan profiles` in one window, one of
            them on a list that keeps itself current, taught that the sidebar
            needed nudging. It does not. `watch.ts` names this button as its
            recovery path if `fs.watch` dies silently; the Variables one and the
            empty editor's both still serve that.
          */}
          <PanelHeader title="Profiles">
            <Button
              className="-me-2"
              variant="ghost"
              size="icon-sm"
              aria-label="New profile"
              onClick={startNamingProfile}
            >
              <FilePlus2 />
            </Button>
          </PanelHeader>
          <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto">
            <FileTree />
          </div>
          <CurrentAircraft />
        </aside>

        <Splitter handlers={sidebar.handlers} />

        {/*
          The editor, the side column and the bottom slot, as a grid rather than
          nested flex rows — because which of the last two wins the corner
          between them is now conditional, and a grid can re-associate the two
          without either changing parents. See `workbenchAreas`.

          Nesting them expressed one arrangement per tree shape, so switching
          arrangements meant moving a subtree, and moving a subtree remounts it.
          That is not an abstract cost here: the Variables panel holds its search
          text and its namespace filters in local state, so opening Radar would
          have cleared the search you opened Radar to check.
        */}
        <div
          className="grid min-h-0 min-w-0 flex-1"
          style={{
            gridTemplateColumns: sideOpen
              ? `minmax(0, 1fr) 1px ${side.width}px`
              : "minmax(0, 1fr)",
            gridTemplateRows: bottom
              ? `minmax(0, 1fr) 1px ${bottomSize.width}px`
              : "minmax(0, 1fr)",
            gridTemplateAreas: workbenchAreas({
              side: sideOpen,
              bottom: bottom !== null,
              full: fullHeightSide,
            }),
          }}
        >
          <main className="flex min-h-0 min-w-0 flex-col [grid-area:editor]">
            <EditorGrid />
          </main>

          {/*
            The side column holds two things stacked, not one. Radar is read
            *against* whichever panel is above it — a candidate in Radar is
            checked in Variables, a variable in Variables is confirmed by
            working the control and watching Radar — so putting them in one
            column is putting them where the eye already travels.

            Either can be open alone, in which case it takes the column and
            there is no divider to drag. The splitter exists only when there
            are two things for it to divide.
          */}
          {sideOpen && (
            <>
              <Splitter
                handlers={side.handlers}
                className="[grid-area:vsplit]"
              />
              <aside className="flex min-h-0 flex-col [grid-area:side]">
                {panel && (
                  <div className="min-h-0 flex-1">
                    {panel === "remote" ? <RemoteConnectPanel /> : <VariablesPanel />}
                  </div>
                )}

                {panel && radar && (
                  <Splitter
                    orientation="horizontal"
                    handlers={radarSize.handlers}
                  />
                )}

                {radar && (
                  <div
                    className={cn(panel ? "shrink-0" : "min-h-0 flex-1")}
                    style={panel ? { height: radarSize.width } : undefined}
                  >
                    <ActivityPanel />
                  </div>
                )}
              </aside>
            </>
          )}

          {bottom && (
            <>
              <Splitter
                orientation="horizontal"
                handlers={bottomSize.handlers}
                className="[grid-area:hsplit]"
              />
              <div className="min-h-0 border-t border-border [grid-area:bottom]">
                {bottom === "log" ? <LogPanel /> : null}
                {bottom === "issues" ? <IssuesPanel /> : null}
                {bottom === "trace" ? <TracePanel /> : null}
              </div>
            </>
          )}
        </div>

        {/*
          Side panels at the top, the bottom slot's buttons pushed to the bottom
          — the alignment points at where the panel actually appears. Log drives
          the same slot but sits in the status bar instead.

          The two groups are two subjects as well as two places. Above: finding
          the variable behind a control. Below: diagnostics — what is wrong with
          the file, and what the app is doing. Radar reads as the first of those
          and now sits with them, under Variables, which is the panel it is used
          against.
        */}
        <Rail
          bottom={
            <>
              <TraceRailButton />
              <IssuesRailButton />
            </>
          }
        >
          <RemoteRailButton />
          <VariablesRailButton />
          <ActivityRailButton />
        </Rail>
      </div>

      {/*
        No trailing padding: Log sits at the end and is a rail button, which
        fills the strip it is in edge to edge. Everything before it is spaced
        by the gap.
      */}
      <footer className="flex h-8 shrink-0 items-center gap-2 border-t border-border ps-1 text-xs text-muted-foreground">
        {/*
          Settings belongs to the app rather than to anything on screen, so it
          sits at the leading edge rather than among the session controls
          opposite — and the sim connection reads as the app's own state too.
        */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Settings"
          title="Settings (Ctrl+,)"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings />
        </Button>
        <SimChip />

        {/*
          A spacer rather than `ms-auto` on the first of the trailing controls:
          RemoteChip is absent without a session, and the margin would leave
          with it.
        */}
        <div className="ms-auto" />
        <RemoteChip />
        {/*
          Beside Log rather than among the settings at the leading edge. What a
          tester does when something goes wrong is look at the log and then send
          it, and the two halves of that sentence should not be at opposite ends
          of the window.
        */}
        <ReportButton />
        {/*
          Radar keeps its rail seat; Log is opened often enough, and from
          anywhere, to be worth a permanent one down here instead.
        */}
        <LogFooterButton />
      </footer>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}

export default App
