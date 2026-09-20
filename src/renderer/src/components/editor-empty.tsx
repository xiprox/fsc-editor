import {
  FileCode2,
  FilePlus2,
  FolderSearch,
  Plane,
  RefreshCw,
} from "lucide-react"

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
 * the aircraft — the one thing the app knows that the list does not say — and,
 * when the folder is empty, a profile to start and the rescan that a list
 * nobody is looking at is currently hiding.
 *
 * **Starting a profile and starting the aircraft's profile are one slot**, and
 * that is what keeps the count at two. They are the same act; the aircraft
 * version merely arrives with the name already filled in, which is strictly
 * better whenever there is an aircraft to name it after. Offering both would be
 * offering the worse one beside the better one. When there is no aircraft —
 * the sim is not running, which is the ordinary state of a profile editor — the
 * generic one takes the slot, and that case used to have nothing in it at all:
 * the folder was empty, the sim was off, and the state's own advice was to go
 * and load an aeroplane.
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

/** The workspace itself is empty, which is a different sentence. */
function NoProfiles() {
  return (
    <Empty className="h-full gap-3 p-4">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon">
          <FolderSearch />
        </EmptyMedia>
        {/* The same title the Profiles panel shows, because on a blank
            workspace both are on screen answering the same question. */}
        <EmptyTitle className="text-[13px]">No profiles yet</EmptyTitle>
        {/*
          No "and rescan" on the end of that second clause, though there is a
          Rescan button under it. The workspace is watched, so a profile
          dropped into the folder appears on its own — instructing a rescan
          would teach that it does not, which is the same thing the Profiles
          header's own rescan button was teaching before it came out. The
          button stays as the recovery path for a watcher that died; a control
          the copy does not narrate is the normal case here.
        */}
        <EmptyDescription className="text-[11.5px]/relaxed">
          There is nothing in the workspace to edit — start one here, or drop a
          profile into the folder.
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
 *
 * `rescan` marks the empty-workspace state, and it is the flag for both of the
 * things that state adds: the rescan itself, and the fall back to naming a
 * profile by hand when there is no aircraft to name one after. In the ordinary
 * state — a list, nothing opened from it yet — neither belongs. The profiles
 * are right there, so there is nothing to start and nothing to rescan for.
 */
function Actions({ rescan }: { rescan?: boolean }) {
  const busy = useStore((state) => state.busy)
  const refresh = useStore((state) => state.refresh)
  const openLocal = useStore((state) => state.openLocal)
  const createProfile = useStore((state) => state.createProfile)
  const startNamingProfile = useStore((state) => state.startNamingProfile)

  const { aircraft, relPath } = useAircraftProfile()

  if (!aircraft && !rescan) return null

  return (
    <EmptyContent>
      {aircraft ? (
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
      ) : (
        /*
          The field it opens is in the Profiles panel, not here. A name belongs
          beside the list it is about to appear in, and this pane is about to
          fill with the file rather than with the question.
        */
        <Button variant="outline" size="sm" onClick={startNamingProfile}>
          <FilePlus2 data-icon="inline-start" />
          New profile
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
