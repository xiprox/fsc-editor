import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { SearchInput } from "@/components/ui/search-input"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

/**
 * Profiles in a folder before profiles at the root, then alphabetically.
 *
 * The same rule `sortNodes` uses in the file tree — folders first, the way a
 * file explorer does it — reached without building a tree. Sorting the paths as
 * plain strings would interleave the two, putting `a320.yaml` above `modules/`
 * and `throttle.yaml` below it, so the same folder appears in two places
 * depending on its neighbours' initials, and neither this list nor the sidebar
 * would agree about where anything lives.
 */
function byFolderThenName(a: string, b: string): number {
  const depth = (relPath: string) => (relPath.includes("/") ? 0 : 1)

  return depth(a) - depth(b) || a.localeCompare(b)
}

/**
 * The list of your own profiles, with a tick against each one you are sharing.
 *
 * One component for both sides of the session's life — the picker you meet
 * before there is a code, and the live list under the code afterwards. They are
 * the same list answering the same question, and the only thing that differs is
 * what happens on a tick: before, it edits a draft nobody has seen; after, it
 * sends a manifest delta. Written twice they would drift, and the second copy
 * is the one you would forget to fix.
 *
 * Flat paths rather than the sidebar's tree. There is nothing to navigate here
 * — every row is a row you might tick — and folder chrome would put an expand
 * arrow between you and the checkbox. Alphabetical sorting groups `modules/`
 * together anyway, which is as much structure as this needs.
 */
export function ProfilePicker({
  selected,
  onChange,
  disabled,
  className,
}: {
  selected: string[]
  onChange: (paths: string[]) => void
  /** Shown, and readable, but not answering — see `Selecting`. */
  disabled?: boolean
  className?: string
}) {
  const files = useStore((state) => state.files)
  const [query, setQuery] = useState("")

  const paths = useMemo(
    () => files.map((file) => file.relPath).sort(byFolderThenName),
    [files]
  )

  const ticked = useMemo(() => new Set(selected), [selected])

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return paths

    return paths.filter((relPath) => relPath.toLowerCase().includes(needle))
  }, [paths, query])

  const all = paths.length > 0 && selected.length === paths.length

  const toggle = (relPath: string, on: boolean) =>
    onChange(
      on ? [...selected, relPath] : selected.filter((path) => path !== relPath)
    )

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/*
        Hidden below a handful of profiles, where scanning the list is faster
        than reaching for a filter — and where an empty search box would be the
        widest thing on screen, describing a problem nobody has.
      */}
      {paths.length > 8 && (
        <div className="shrink-0 px-3 pb-2">
          <SearchInput
            value={query}
            onValueChange={setQuery}
            placeholder="Filter profiles…"
            aria-label="Filter profiles"
            disabled={disabled}
          />
        </div>
      )}

      <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            {paths.length
              ? "Nothing matches that filter."
              : "No profiles in this folder."}
          </p>
        )}

        {shown.map((relPath) => (
          // A label rather than a row with a checkbox in it: the whole width is
          // the hit target, which is what makes ticking six of forty bearable,
          // and it comes with the keyboard behaviour already attached.
          <label
            key={relPath}
            className={cn(
              "flex items-center gap-2 px-3 py-1",
              disabled
                ? "cursor-default opacity-60"
                : "cursor-pointer hover:bg-accent"
            )}
          >
            <Checkbox
              checked={ticked.has(relPath)}
              onCheckedChange={(on) => toggle(relPath, on)}
              disabled={disabled}
              className="size-3.5"
            />
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[12.5px]",
                ticked.has(relPath)
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              {relPath}
            </span>
          </label>
        ))}
      </div>

      <div className="flex shrink-0 items-center gap-2 px-3 pt-2 text-[11.5px]">
        <span className="text-muted-foreground tabular-nums">
          {selected.length} of {paths.length} selected
        </span>

        {/*
          One control in one slot, naming what it will do rather than what is
          true. It swaps under the cursor, so a second click undoes the first —
          which is survivable precisely because neither direction destroys
          anything: before a session nothing has been sent, and during one a
          tick is a delta away from coming back.
        */}
        <Button
          variant="quiet"
          size="xs"
          className="-mr-2 ml-auto"
          disabled={disabled || paths.length === 0}
          onClick={() => onChange(all ? [] : paths)}
        >
          {all ? "Select none" : "Select all"}
        </Button>
      </div>
    </div>
  )
}
