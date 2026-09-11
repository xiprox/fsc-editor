/**
 * The tabs a folder was left with, so reopening the app lands back in the work
 * rather than on an empty pane.
 *
 * Kept per workspace root. The whole value of the list is that the files in it
 * exist, and one folder of profiles has nothing useful to say about the tabs of
 * another — carrying them across a folder switch would restore a set of names
 * that mostly are not there.
 *
 * It lives in `localStorage` beside the panel widths and the theme rather than
 * in the main process's settings file, which is reserved for the single thing
 * that has to survive the renderer's storage being cleared: where the profiles
 * are. Losing which tabs were open costs one click. Losing the folder costs the
 * setup screen all over again.
 */
import type { GroupOrientation } from "./groups"

export interface StoredGroup {
  tabs: string[]
  active: string | null
  /** How much of the row this pane took. Absent for a layout saved before sizes. */
  share?: number
}

export interface OpenTabs {
  /**
   * Every open file, and the one that was forward.
   *
   * Kept alongside `groups` rather than derived from it on read, because this
   * is what a version of the app without splits wrote and what one would read:
   * downgrading loses the arrangement and keeps the work, which is the right
   * way round for a file whose whole job is to not lose your place.
   */
  tabs: string[]
  activePath: string | null
  /** The panes, in layout order. Absent for a session saved before splits. */
  groups?: StoredGroup[]
  /** Which of them had focus, by index. */
  focused?: number
  orientation?: GroupOrientation
}

const EMPTY: OpenTabs = { tabs: [], activePath: null }

function storedGroups(value: unknown): StoredGroup[] | undefined {
  if (!Array.isArray(value)) return undefined

  const groups = value.flatMap((entry) => {
    const group = entry as Partial<StoredGroup>
    if (!Array.isArray(group.tabs)) return []

    const tabs = group.tabs.filter((tab) => typeof tab === "string")
    return [
      {
        tabs,
        active:
          typeof group.active === "string" && tabs.includes(group.active)
            ? group.active
            : (tabs[0] ?? null),
        // Anything unusable is left undefined rather than defaulted here: the
        // group arithmetic rebalances a row whose sizes do not add up, and it
        // is the one place that decides what an even row means.
        share:
          typeof group.share === "number" &&
          Number.isFinite(group.share) &&
          group.share > 0
            ? group.share
            : undefined,
      },
    ]
  })

  return groups.length ? groups : undefined
}

/** Windows paths differ only in case between one run and the next. */
const keyFor = (root: string) => `tabs:${root.toLowerCase()}`

export function loadTabs(root: string): OpenTabs {
  const stored = localStorage.getItem(keyFor(root))
  if (!stored) return EMPTY

  try {
    const parsed = JSON.parse(stored) as Partial<OpenTabs>
    if (!Array.isArray(parsed.tabs)) return EMPTY

    return {
      tabs: parsed.tabs.filter((tab) => typeof tab === "string"),
      activePath:
        typeof parsed.activePath === "string" ? parsed.activePath : null,
      groups: storedGroups(parsed.groups),
      focused:
        typeof parsed.focused === "number" && parsed.focused >= 0
          ? parsed.focused
          : 0,
      orientation: parsed.orientation === "column" ? "column" : "row",
    }
  } catch {
    return EMPTY
  }
}

export function saveTabs(root: string, open: OpenTabs): void {
  localStorage.setItem(keyFor(root), JSON.stringify(open))
}
