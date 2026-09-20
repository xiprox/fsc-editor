import { useState } from "react"

import { AlertTriangle, FolderOpen, FolderSearch } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useStore } from "@/store"

/**
 * The folder profiles are read from, shown and changeable.
 *
 * Deliberately *not* the streaming detection the first-run screen does — that
 * earns its complexity when there is no folder at all. Here there is a working
 * one, and "point somewhere else" is a native picker away. The whole change
 * flows through the store's `chooseWorkspace`, which already flushes drafts
 * and re-enters cleanly; this component adds no persistence of its own.
 */
export function WorkspaceGroup() {
  const workspace = useStore((state) => state.workspace)
  const chooseWorkspace = useStore((state) => state.chooseWorkspace)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Settings only opens from the workbench, which only exists over a
  // workspace — this is a type guard, not a reachable state.
  if (!workspace) return null

  const browse = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const pick = await chooseWorkspace()
    setBusy(false)

    // The same sentence setup shows for the same refusal — see `browse` there.
    if (!pick.ok && pick.reason === "no-profiles")
      setError(
        `There is nothing to edit in ${pick.path} — an empty folder works too, if you are starting a profile from scratch.`
      )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">Profiles are read from</span>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void window.api.revealFile(".")}
          >
            <FolderSearch />
            Open in File Explorer
          </Button>
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => void browse()}
          >
            <FolderOpen />
            Change
          </Button>
        </div>
      </div>

      {/* The same box the sim dialog proposes its folder in — one way to show
          a path the app is acting on. */}
      <div className="rounded-md border border-border bg-muted/40 px-2 py-1.5">
        <p className="font-mono text-[11px] break-all">{workspace.root}</p>
        <p className="text-[10px] text-muted-foreground">
          {workspace.installRoot
            ? "Inside your FS Copilot install"
            : "A plain folder of profiles"}
        </p>
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      <p className="text-[11px] text-muted-foreground">
        Switching folders reopens the editor there. Nothing is lost — each
        folder remembers its own tabs and unsaved drafts.
      </p>
    </div>
  )
}
