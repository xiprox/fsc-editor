import { useMemo } from "react"

import { ArrowLeftToLine, FileText, Radio } from "lucide-react"

import { nodesAtLine, parseOutline } from "@shared/profile"
import type { FileStatus } from "@shared/remote-connect"

import { Button } from "@/components/ui/button"
import { Toggle } from "@/components/ui/toggle"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { DiffSession } from "@/lib/use-diff"
import { remoteStatuses, useStore } from "@/store"

/**
 * The state of one file's relationship with the host, above the editor.
 *
 * Present for the whole session rather than only while you are reading their
 * copy, so what this file's relationship with the host *is* never becomes
 * something you have to go elsewhere to ask. What changes between the two views
 * is what the bar is for: on your own copy there is exactly one thing to do —
 * go and look at theirs — so that is the only control there is, and being the
 * only one it cannot be lost among others. On theirs, everything that acts on
 * the session.
 *
 * Its height never changes and its controls never move between slots. There are
 * no animations here to paper over a reflow, so a bar that grew a button when
 * the host started typing would shove the editor down mid-keystroke — which is
 * exactly the moment you are least willing to be moved.
 */
export function ConnectionBar({
  relPath,
  diff,
}: {
  relPath: string
  diff: DiffSession
}) {
  const remote = useStore((state) => state.remote)
  const presence = useStore((state) => state.presence)
  const remoteContent = useStore((state) => state.remoteContent[relPath])
  const viewMode = useStore((state) => state.viewMode[relPath] ?? "local")
  const mirroring = useStore((state) => !!state.mirroring[relPath])
  const open = useStore((state) => state.open[relPath])
  const setMirroring = useStore((state) => state.setMirroring)
  const setViewMode = useStore((state) => state.setViewMode)
  const openRemote = useStore((state) => state.openRemote)
  const localManifest = useStore((state) => state.localManifest)

  // Knowable from the two manifests, so the local view can say how your copy
  // stands without fetching a byte of the host's.
  const status = useMemo(
    () => remoteStatuses(remote, localManifest).get(relPath),
    [remote, localManifest, relPath]
  )

  // The host's line number refers to the host's file, so it is resolved against
  // the host's outline. Using ours would name a section from a different
  // document whenever the two have drifted — which is precisely when someone is
  // watching this label.
  const hostFile = presence?.activeFile ?? null
  const hostLine = presence?.activeLine ?? 1

  const where = useMemo(() => {
    if (!remoteContent || hostFile !== relPath) return null

    const outline = parseOutline(remoteContent)
    const trail = nodesAtLine(
      outline.flatMap((node) =>
        node.kind === "block" ? node.children : [node]
      ),
      hostLine
    )

    return trail.length ? trail.map((node) => node.title).join(" › ") : null
  }, [remoteContent, hostFile, hostLine, relPath])

  if (remote.phase !== "connected") return null
  if (!remote.files.some((file) => file.relPath === relPath)) return null

  const dirty = !!open && open.draft !== open.saved
  // Turning mirroring *on* would overwrite unsaved work; turning it off never
  // touches the file, so it stays available.
  const blocked = dirty && !mirroring
  const showing = viewMode === "remote"
  const count = diff.changes.length
  const selected = diff.selected.length

  return (
    <div className="flex h-8 shrink-0 items-center gap-1 border-b border-remote-border bg-remote-surface ps-2 pe-1 text-[11.5px] text-remote-foreground">
      <span className="min-w-0 flex-1 truncate">
        <State
          count={count}
          showing={showing}
          status={status}
          mirroring={mirroring}
          hostEditing={!!presence?.dirty.includes(relPath)}
          where={where}
        />
      </span>

      {showing ? (
        <>
          {/*
            Fixed slots from here on. Buttons are disabled rather than removed
            so the row never reflows as the diff changes underneath it.
          */}
          <Action
            onClick={diff.takeSelected}
            disabled={mirroring || selected === 0}
            icon={<ArrowLeftToLine />}
            label={selected > 1 ? `Take ${selected}` : "Take"}
            tip="Take the selected changes — written straight to your file"
          />

          <Action
            onClick={diff.takeAll}
            disabled={mirroring || count === 0}
            icon={<ArrowLeftToLine />}
            label="Take all"
            tip="Take every change — written straight to your file"
          />

          {/*
            `solid` rather than the tinted `outline` its neighbours wear. This
            is the one control here that keeps acting after you stop looking at
            it — a mirrored file rewrites itself every time the host saves — so
            it gets the loudest state the palette has, and the row still does
            not move when it lands.
          */}
          <Tooltip>
            <TooltipTrigger
              render={
                <Toggle
                  variant="solid"
                  size="xs"
                  tone="remote"
                  pressed={mirroring}
                  aria-disabled={blocked}
                  onClick={() => {
                    if (!blocked) void setMirroring(relPath, !mirroring)
                  }}
                >
                  <span
                    aria-hidden
                    className="size-1.5 shrink-0 rounded-full bg-[color-mix(in_oklab,var(--tone-foreground)_40%,transparent)] group-aria-pressed/toggle:bg-[var(--tone-on)]"
                  />
                  Mirror
                </Toggle>
              }
            />
            <TooltipContent side="top" align="end" className="max-w-64">
              {blocked
                ? "Save or undo your changes first — mirroring would overwrite them."
                : "Follow the host: this file is rewritten every time they save, and is read-only here."}
            </TooltipContent>
          </Tooltip>

          <Action
            onClick={() => setViewMode(relPath, "local")}
            icon={<FileText />}
            label="View local"
            tip="Back to your own copy"
          />
        </>
      ) : (
        // Entering the remote view has to fetch the host's copy first, which is
        // what `openRemote` does. Setting the mode alone would leave the view
        // with nothing to show and the button looking broken.
        <Action
          onClick={() => void openRemote(relPath)}
          icon={<Radio />}
          label="View remote"
          tip="Read the host's copy of this profile"
        />
      )}
    </div>
  )
}

function State({
  count,
  showing,
  status,
  mirroring,
  hostEditing,
  where,
}: {
  count: number
  showing: boolean
  status: FileStatus | undefined
  mirroring: boolean
  hostEditing: boolean
  where: string | null
}) {
  // Outranks everything, in either view. A mirrored file rewrites itself every
  // time the host saves, and a mode where that went unsaid would be a file
  // changing under you with nothing on screen accounting for it.
  if (mirroring)
    return (
      <span className="font-medium text-remote">
        Mirroring — this file follows the host, and is read-only here
      </span>
    )

  // What your copy is, and how it stands. Both halves come off the manifests,
  // so this is true from the moment you connect rather than from whenever you
  // last went and looked — which is the point of saying it here at all.
  if (!showing) {
    if (status === "remote-only")
      return (
        <span className="opacity-70">
          Not on your machine — only the host has this
        </span>
      )

    return (
      // No opacity on the wrapper: it would cap the emphasis below it, since a
      // child cannot be more opaque than the parent it sits in.
      <span>
        <span className="opacity-70">Your local copy — </span>
        {status === "modified" ? (
          <span className="text-remote-changed">differs from the host</span>
        ) : (
          <span className="opacity-70">identical to the host</span>
        )}
      </span>
    )
  }

  // The host having unsaved work outranks the change count, because it is the
  // reason the count is about to be wrong.
  if (hostEditing)
    return (
      <span>
        Host is editing
        {where ? <span className="opacity-70"> · {where}</span> : null}
      </span>
    )

  if (count === 0)
    return <span className="opacity-70">Identical to the host</span>

  return (
    <span>
      Host's copy — {count} {count === 1 ? "change" : "changes"}
    </span>
  )
}

/**
 * One control in the bar, with the sentence that says what it will do.
 *
 * `aria-disabled` rather than `disabled`, and the click is guarded instead of
 * blocked, because a disabled button that cannot be hovered cannot explain
 * itself — and "why is Take greyed out?" is the question this row is most
 * likely to be asked. The tip is the answer, and it stays reachable.
 */
function Action({
  onClick,
  disabled,
  icon,
  label,
  tip,
}: {
  onClick: () => void
  disabled?: boolean
  icon: React.ReactNode
  label: string
  tip: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            tone="remote"
            aria-disabled={disabled}
            onClick={() => {
              if (!disabled) onClick()
            }}
          >
            {icon}
            {label}
          </Button>
        }
      />
      <TooltipContent side="top" align="end" className="max-w-64">
        {tip}
      </TooltipContent>
    </Tooltip>
  )
}
