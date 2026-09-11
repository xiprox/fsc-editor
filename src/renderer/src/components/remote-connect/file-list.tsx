import { useMemo, useState } from "react"

import { ArrowLeftToLine } from "lucide-react"

import type { FileStatus } from "@shared/remote-connect"

import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import { remoteStatuses, useStore } from "@/store"

type Lens = "all" | "changed" | "remote-only"

const LENSES: Array<{ id: Lens; label: string }> = [
  { id: "all", label: "All" },
  { id: "changed", label: "Changed" },
  { id: "remote-only", label: "New" },
]

/**
 * A glyph as well as a colour, in a column of its own.
 *
 * Colour alone would carry the whole meaning, which fails for anyone who cannot
 * separate these hues and reads poorly at a glance regardless. A fixed-width
 * character column also lets the eye run straight down the list, which is what
 * makes fifty rows scannable rather than merely present.
 */
const GLYPH: Record<
  FileStatus,
  { mark: string; className: string; title: string }
> = {
  "remote-only": {
    mark: "+",
    className: "text-remote-added",
    title: "Only the host has this",
  },
  modified: {
    mark: "~",
    className: "text-remote-changed",
    title: "Differs from your copy",
  },
  identical: { mark: "", className: "", title: "Identical" },
}

interface Row {
  relPath: string
  status: FileStatus
}

/**
 * What sorts first. Everything the session gives you something to do about
 * comes before everything it does not, and the new outranks the merely
 * different because it is the one you cannot have seen before.
 */
const RANK: Record<FileStatus, number> = {
  "remote-only": 0,
  modified: 1,
  identical: 2,
}

/**
 * The host's profiles, which is the whole list — a session is one-way, so what
 * they are sharing is the only thing there is to act on.
 *
 * Grouped by status, then alphabetical inside each group. A list ordered like
 * the sidebar would put the two profiles that actually differ on either side of
 * forty that do not, and the whole reason to open this panel is to find those
 * two. It does mean a row moves when its status does — but a status changing is
 * news, and the row arriving at the top is how you hear it.
 */
function rowsFor(statuses: Map<string, FileStatus>): Row[] {
  const rows: Row[] = [...statuses].map(([relPath, status]) => ({
    relPath,
    status,
  }))

  return rows.sort((a, b) => {
    if (a.status !== b.status) return RANK[a.status] - RANK[b.status]
    return a.relPath.localeCompare(b.relPath)
  })
}

export function RemoteFileList() {
  const remote = useStore((state) => state.remote)
  const localManifest = useStore((state) => state.localManifest)
  const takeRemote = useStore((state) => state.takeRemote)
  const openRemote = useStore((state) => state.openRemote)
  const activePath = useStore((state) => state.activePath)

  const [lens, setLens] = useState<Lens>("all")
  const [query, setQuery] = useState("")

  const statuses = useMemo(
    () => remoteStatuses(remote, localManifest),
    [remote, localManifest]
  )

  const rows = useMemo(() => rowsFor(statuses), [statuses])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()

    return rows.filter((row) => {
      if (needle && !row.relPath.toLowerCase().includes(needle)) return false
      if (lens === "changed") return row.status !== "identical"
      if (lens === "remote-only") return row.status === "remote-only"
      return true
    })
  }, [rows, lens, query])

  const differing = rows.filter((row) => row.status !== "identical").length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2 px-3 pb-2">
        <SearchInput
          value={query}
          onValueChange={setQuery}
          placeholder="Filter profiles…"
          aria-label="Filter profiles"
        />

        {/*
          One lens at a time, so these are radio buttons wearing a toggle's
          clothes — clicking the lit one is a no-op rather than a way back to
          "All", because there is always exactly one answer to "what am I
          looking at" and a state with none is not one of them.
        */}
        <div className="flex items-center gap-1">
          {LENSES.map((option) => (
            <Toggle
              key={option.id}
              size="sm"
              tone="remote"
              pressed={lens === option.id}
              onClick={() => setLens(option.id)}
            >
              {option.label}
            </Toggle>
          ))}

          <span className="ml-auto text-[11.5px] text-muted-foreground tabular-nums">
            {differing ? `${differing} of ${rows.length}` : `${rows.length}`}
          </span>
        </div>
      </div>

      <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {rows.length
              ? "Nothing matches that filter."
              : "The host is sharing no profiles."}
          </p>
        )}

        {shown.map((row) => {
          const glyph = GLYPH[row.status]
          const identical = row.status === "identical"
          // Nothing to pull for a file the host does not have, and nothing to
          // change for one that already matches.
          const takeable =
            row.status === "remote-only" || row.status === "modified"

          return (
            <div
              key={row.relPath}
              className={cn(
                "group flex items-center gap-1.5 pr-1 pl-2",
                activePath === row.relPath && "bg-accent"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "w-2.5 shrink-0 text-center font-mono text-[13px]",
                  glyph.className
                )}
              >
                {glyph.mark}
              </span>

              <button
                onClick={() => void openRemote(row.relPath)}
                className={cn(
                  "min-w-0 flex-1 py-1 text-left text-[12.5px]",
                  identical ? "text-muted-foreground" : "text-foreground"
                )}
              >
                <span className="block truncate">{row.relPath}</span>
              </button>

              {takeable && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  tone="remote"
                  onClick={() => void takeRemote(row.relPath)}
                  aria-label={`Take ${row.relPath} from the host`}
                  className="text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-[color:var(--tone-foreground)] focus-visible:opacity-100"
                >
                  <ArrowLeftToLine className="size-3" />
                </Button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
