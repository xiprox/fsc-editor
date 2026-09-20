import { useEffect, useRef, useState } from "react"

import {
  Check,
  FolderOpen,
  Loader2,
  Plane,
  RotateCw,
  SearchX,
} from "lucide-react"

import type { WorkspaceCandidate } from "@shared/types"

import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { CAPTION_INSET } from "@/lib/title-bar"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

const SOURCE_LABEL: Record<WorkspaceCandidate["source"], string> = {
  process: "Running right now",
  shortcut: "From a shortcut on this PC",
  registry: "From the list of installed programs",
  index: "From the Windows Search index",
  folder: "Found by scanning this PC",
}

/**
 * The install directory when there is one, since that is the folder people know
 * the name of. A bare pile of profiles has only itself to show.
 */
function displayPath(candidate: WorkspaceCandidate): string {
  return candidate.installRoot ?? candidate.root
}

function Candidate({
  candidate,
  selected,
  onSelect,
}: {
  candidate: WorkspaceCandidate
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left",
        selected
          ? "border-primary/50 bg-accent/60"
          : "border-border hover:bg-accent/30"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border"
        )}
      >
        {selected && <Check className="size-2.5" />}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs">
          {displayPath(candidate)}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {SOURCE_LABEL[candidate.source]}
        </span>
      </span>
    </button>
  )
}

/**
 * First run, and every run after one where the folder went missing.
 *
 * The app used to open on a sentence asking you to start FS Copilot and come
 * back — an instruction that only makes sense to someone who already knows the
 * folder is found by looking at the process list. So detection does the looking
 * instead: the running program if it is running, and the places an archive gets
 * unpacked to if it is not. Picking the folder by hand is still here, but it is
 * now the fallback rather than the plan.
 *
 * Results stream in over a search that can run for a while, which sets the two
 * rules this screen is built around. The list only ever *appends*: a row that
 * moved under the pointer as something new arrived would be a way to click the
 * wrong folder. And nothing is selected until somebody selects it, so the
 * button that commits a choice cannot be reached by a mistimed click.
 */
export function Setup() {
  const adoptWorkspace = useStore((state) => state.adoptWorkspace)
  const chooseWorkspace = useStore((state) => state.chooseWorkspace)

  const [candidates, setCandidates] = useState<WorkspaceCandidate[]>([])
  const [searching, setSearching] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /**
   * Which search is ours.
   *
   * A run that has been called off still finishes, and its `done` arrives after
   * the replacement has already started — in development React mounts this
   * effect twice, which produces exactly that. Without this, the abandoned
   * run's goodbye settles the screen: the indicator vanishes on the first frame
   * and "not found" shows while the real search is still going.
   */
  const runId = useRef(0)

  // Only the second and later searches touch state: the first one is what the
  // initial state already describes.
  const searchAgain = () => {
    setSearching(true)
    void window.api.startDetect(++runId.current)
  }

  useEffect(() => {
    const off = window.api.onDetectEvent((event) => {
      if (event.runId !== runId.current) return

      if (event.kind === "done") {
        setSearching(false)
        return
      }

      setCandidates((current) =>
        current.some(
          (existing) =>
            existing.root.toLowerCase() === event.candidate.root.toLowerCase()
        )
          ? current
          : [...current, event.candidate]
      )
    })

    void window.api.startDetect(++runId.current)

    // Picking a folder unmounts this screen, and a folder walk left running
    // behind it would spend the next while reading every disk for nobody.
    return () => {
      off()
      void window.api.stopDetect()
    }
  }, [])

  const use = async () => {
    const candidate = candidates.find((entry) => entry.root === selected)
    if (!candidate) return

    setBusy(true)
    const taken = await adoptWorkspace(candidate.root)
    setBusy(false)

    // Offered a moment ago, gone now — a sim that was uninstalled or a drive
    // that was unplugged between the search and the click.
    if (!taken) {
      setError(`${displayPath(candidate)} is no longer there.`)
      setCandidates((current) =>
        current.filter((entry) => entry.root !== candidate.root)
      )
      setSelected(null)
    }
  }

  const browse = async () => {
    setBusy(true)
    const pick = await chooseWorkspace()
    setBusy(false)

    if (pick.ok || pick.reason === "canceled") return

    // Only reachable now for a folder that holds files and none of them is a
    // profile — an empty one is accepted. So the sentence has to say that,
    // otherwise somebody who came here to start from scratch reads a refusal
    // for the thing they were about to try next.
    setError(
      `There is nothing to edit in ${pick.path} — an empty folder works too, if you are starting a profile from scratch.`
    )
  }

  const found = candidates.length > 0

  return (
    <div className="flex h-svh flex-col overflow-hidden bg-background text-foreground">
      {/*
        The same title bar as the workbench, and it has to be: this screen is
        the whole window on first run, so without a drag region there would be
        no way to move the window at all.

        `ThemeToggle` sits at the trailing end because this screen has nowhere
        else to put one — no status bar, and no Settings, which needs a
        workspace before it exists. It was out while `FORCED_THEME` in
        `theme-provider.tsx` was pinned, which made `setTheme` a no-op and
        would have left a button here that visibly did nothing.
      */}
      <header
        className="drag-region flex h-11 shrink-0 items-center gap-3 ps-3"
        style={{ paddingInlineEnd: CAPTION_INSET }}
      >
        <span className="text-[13px] font-medium">FSC Editor</span>
        <span className="no-drag ms-auto">
          <ThemeToggle />
        </span>
      </header>

      <div className="scrollbar-overlay flex min-h-0 flex-1 justify-center overflow-y-auto px-8 pb-10">
        <div className="my-auto w-full max-w-md space-y-5">
          <div className="space-y-2">
            <div className="text-muted-foreground/60">Hello.</div>
            <div className="text-base font-medium">
              Where is your{" "}
              <span className="inline-flex flex-row items-center gap-1 text-sky-500">
                FS Copilot <Plane className="size-5" />
              </span>{" "}
              ?
            </div>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Point the app at your FS Copilot folder — the one with{" "}
              <span className="font-mono">Definitions</span> inside it.
            </p>
          </div>

          {/*
            One steady line for the whole search, however much is happening
            behind it, and it stays put while results appear underneath — the
            question it answers is "is this still going?", and an indicator that
            moved or vanished the moment something turned up answered "no".
          */}
          {searching && (
            <div className="flex items-center gap-2 px-0.5 text-[13px] text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              <span className="flex-1">Searching your PC…</span>
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => void window.api.stopDetect()}
              >
                Stop
              </Button>
            </div>
          )}

          {!searching && !found && (
            <div className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2.5 text-[13px] text-muted-foreground">
              <SearchX className="mt-0.5 size-4 shrink-0" />
              <span>
                FS Copilot was not found on this PC. Start it and search again, or choose the folder yourself.
              </span>
            </div>
          )}

          {found && (
            <div className="space-y-1.5">
              {candidates.map((candidate) => (
                <Candidate
                  key={candidate.root}
                  candidate={candidate}
                  selected={candidate.root === selected}
                  onSelect={() => setSelected(candidate.root)}
                />
              ))}
            </div>
          )}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2">
            {found && (
              <Button
                size="lg"
                disabled={busy || !selected}
                onClick={() => void use()}
              >
                Use this folder
              </Button>
            )}

            <Button
              variant={found ? "outline" : "default"}
              size="lg"
              disabled={busy}
              onClick={() => void browse()}
            >
              <FolderOpen data-icon="inline-start" />
              {found ? "Choose a different folder…" : "Choose a folder…"}
            </Button>

            {/*
              Stopping keeps whatever it found, so this is the way back rather
              than a way to undo — which is what makes Stop safe to press.
            */}
            {!searching && (
              <Button
                variant="ghost"
                size="sm"
                className="self-center text-muted-foreground"
                onClick={searchAgain}
              >
                <RotateCw data-icon="inline-start" />
                Search again
              </Button>
            )}
          </div>

          {/*
            Both halves of the same point, and the reason it is worth the space:
            somebody who does not have FS Copilot needs to know where to get it,
            and somebody who was sent one profile file needs to know they do not
            have to.
          */}
          <div className="space-y-1.5 text-xs leading-normal text-pretty text-muted-foreground/70">
            You don&rsquo;t need FS Copilot to use this app — any folder of
            <span className="font-mono"> *.yaml</span> profiles works, and an
            empty one works too if you are starting a profile from scratch.
            Choosing the FSC folder also lets you launch, restart and stop it
            from the title bar.
          </div>
        </div>
      </div>
    </div>
  )
}
