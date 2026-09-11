import { FileCode2, FolderSearch, Plane, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { useAircraftProfile } from "@/lib/aircraft-profile"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

/**
 * The editor with no file in it — the first thing this app shows anybody.
 *
 * Two states, because "pick a profile from the list" is advice and not a state:
 * said to somebody whose list is empty it is worse than nothing, since the
 * thing it points at is the other blank half of the same window. So a folder
 * with no profiles is answered where the question is being asked, and the
 * ordinary state — a list, nothing opened from it yet — is an invitation.
 *
 * **At most two actions, and neither is a menu item in disguise.** Profiles are
 * opened by clicking them and there is no keystroke to teach, so a row of
 * buttons repeating the sidebar would be furniture. What is offered instead is
 * the aircraft — the one thing the app knows that the list does not say, and
 * the only way to make a profile at all — and, when the folder is empty, the
 * rescan that a list nobody is looking at is currently hiding.
 *
 * **Panel metrics, not the component's defaults.** The shadcn sizes are page
 * sizes; every empty state in this app says what it says at 13 px over 11.5,
 * and this one is not exempt for having more room around it. A pane that
 * announces itself in a larger type than the panels beside it reads as a
 * different app, and the middle of the window is where that shows most.
 */
export function EditorEmpty() {
  const hasFiles = useStore((state) => state.files.length > 0)

  return hasFiles ? <NothingOpen /> : <NoProfiles />
}

/** Profiles exist and none is open — the invitation. */
function NothingOpen() {
  return (
    <Empty className="h-full gap-3 p-4">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon">
          <FileCode2 />
        </EmptyMedia>
        <EmptyTitle className="text-[13px]">No profile open</EmptyTitle>
        <EmptyDescription className="text-[11.5px]/relaxed">
          Choose one from Profiles on the left and it opens in a tab here.
        </EmptyDescription>
      </EmptyHeader>

      <Actions />
    </Empty>
  )
}

/** The folder itself is empty, which is a different sentence. */
function NoProfiles() {
  return (
    <Empty className="h-full gap-3 p-4">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon">
          <FolderSearch />
        </EmptyMedia>
        <EmptyTitle className="text-[13px]">
          No profiles in this folder
        </EmptyTitle>
        <EmptyDescription className="text-[11.5px]/relaxed">
          Nothing here to edit yet. Add a profile to the folder and rescan, or
          start one for the aircraft in the sim.
        </EmptyDescription>
      </EmptyHeader>

      <Actions rescan />
    </Empty>
  )
}

/**
 * Whatever there is to press, in one block.
 *
 * One `EmptyContent` rather than one per button: the component's job is to hold
 * the row under the text, and two of them would put the state's own `gap-6`
 * between two controls that belong together.
 *
 * The aircraft button is absent when no aircraft is loaded, which includes the
 * sim not running — a disabled control teaching a feature by being unusable is
 * the nag the aircraft row under Profiles is careful not to be. When there is
 * nothing to press at all the block goes with it, so the state does not end in
 * six pixels of empty gap.
 */
function Actions({ rescan }: { rescan?: boolean }) {
  const busy = useStore((state) => state.busy)
  const refresh = useStore((state) => state.refresh)
  const openLocal = useStore((state) => state.openLocal)
  const createProfile = useStore((state) => state.createProfile)

  const { aircraft, relPath } = useAircraftProfile()

  if (!aircraft && !rescan) return null

  return (
    <EmptyContent>
      {aircraft && (
        <Button
          tone="sim"
          variant="outline"
          size="sm"
          onClick={() =>
            void (relPath ? openLocal(relPath) : createProfile(aircraft))
          }
        >
          <Plane data-icon="inline-start" />
          {relPath ? "Open profile for" : "Create profile for"}
          {/*
            Its own span so the name can be cut without taking the verb with
            it: aircraft titles run long, and the half of the label that says
            what the button does is the half that has to survive a narrow
            editor.
          */}
          <span className="max-w-64 truncate" title={aircraft}>
            {aircraft}
          </span>
        </Button>
      )}

      {rescan && (
        <Button
          variant="quiet"
          size="sm"
          disabled={busy}
          onClick={() => void refresh()}
        >
          <RefreshCw
            data-icon="inline-start"
            className={cn(busy && "animate-spin")}
          />
          Rescan
        </Button>
      )}
    </EmptyContent>
  )
}
