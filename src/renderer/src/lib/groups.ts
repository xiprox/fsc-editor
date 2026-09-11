/**
 * Editor groups — the split panes, and the arithmetic that keeps them coherent.
 *
 * A group is a tab strip and the pane under it. The window holds a flat list of
 * them along one axis, rather than the recursive grid VS Code builds: the group
 * is the unit either way, so a nested layout later is a change to how these are
 * arranged and not to what they are.
 *
 * Everything here is pure, and deliberately so. The store keeps two mirrors of
 * this list — the union of every group's tabs, and the focused group's active
 * file — and the whole reason those mirrors can be trusted is that the rules
 * producing them live in one file with tests, rather than being spelled out
 * again at each of the six call sites that open a tab.
 */

export interface EditorGroup {
  id: string
  /** Open files in tab order, which the user can rearrange. */
  tabs: string[]
  /**
   * The tab this group is showing.
   *
   * Per group rather than per window: the whole point of a split is that two
   * files are on screen at once, and a single active path could only ever
   * describe one of them.
   */
  active: string | null
  /**
   * How much of the row this pane takes, as a fraction of the whole.
   *
   * On the group rather than in a parallel array beside it, and that is the
   * point: a separate list of sizes has to be kept the same length as the list
   * of panes by whoever changes either, and it was not. Held in component state
   * against a global `localStorage` key, it desynced twice over — sizes were
   * matched to the pane *count* rather than to the panes, so they were read at
   * the first render (when the layout is still one blank pane), rejected for
   * the wrong length, and reset to even by the time the real layout arrived.
   * Sizes never survived a launch. Riding here, a size cannot outlive its pane,
   * cannot be applied to a different one, and is saved and restored by the same
   * code that saves and restores the layout — per workspace, like everything
   * else about a folder's tabs.
   *
   * `normalize` keeps these summing to 1, so nothing that changes the panes has
   * to do the arithmetic.
   */
  share: number
}

/**
 * Which way the groups are laid out.
 *
 * One axis for the whole window. Splitting the other way re-orients all of
 * them, which is exactly right for the two-pane case that is nearly all of the
 * use, and predictable rather than broken for more — the alternative is the
 * nested tree, and that is a layout to grow into rather than to open with.
 */
export type GroupOrientation = "row" | "column"

/** Where a split puts the new group, relative to the one it came from. */
export type SplitSide = "before" | "after"

let counter = 0

export function createGroup(
  tabs: string[] = [],
  active: string | null = null,
  share = 1
): EditorGroup {
  counter += 1
  return { id: `group-${counter}`, tabs, active, share }
}

export function groupById(
  groups: EditorGroup[],
  id: string
): EditorGroup | undefined {
  return groups.find((group) => group.id === id)
}

/**
 * Every open file, once, in the order the groups first mention them.
 *
 * This is what the rest of the app means by "the open tabs" — the drafts to
 * flush, the buffers to check against a rescan, the `get:` lines to watch, the
 * models it is safe to free. None of those cares which pane a file is showing
 * in, and all of them break if a file open in two panes is counted twice.
 */
export function unionTabs(groups: EditorGroup[]): string[] {
  const seen = new Set<string>()
  const tabs: string[] = []

  for (const group of groups)
    for (const tab of group.tabs)
      if (!seen.has(tab)) {
        seen.add(tab)
        tabs.push(tab)
      }

  return tabs
}

/** How many groups are showing a file — 0 once the last one lets it go. */
export function openCount(groups: EditorGroup[], relPath: string): number {
  return groups.filter((group) => group.tabs.includes(relPath)).length
}

function replace(
  groups: EditorGroup[],
  id: string,
  change: (group: EditorGroup) => EditorGroup
): EditorGroup[] {
  return groups.map((group) => (group.id === id ? change(group) : group))
}

/**
 * Opens a file in a group, or brings it forward if it is already there.
 *
 * `index` places it, for a tab dragged into the middle of another strip;
 * without one it goes on the end, which is where opening a file puts it.
 */
export function withTab(
  groups: EditorGroup[],
  id: string,
  relPath: string,
  index?: number
): EditorGroup[] {
  return replace(groups, id, (group) => {
    if (group.tabs.includes(relPath)) return { ...group, active: relPath }

    const tabs = [...group.tabs]
    tabs.splice(index ?? tabs.length, 0, relPath)
    return { ...group, tabs, active: relPath }
  })
}

/**
 * The tab that takes over when the active one goes: whichever slid into the
 * gap, or the new last one. The same rule the single strip has always used.
 */
function nextActive(group: EditorGroup, relPath: string): string | null {
  if (group.active !== relPath) return group.active

  const index = group.tabs.indexOf(relPath)
  const tabs = group.tabs.filter((tab) => tab !== relPath)
  return tabs[Math.min(index, tabs.length - 1)] ?? null
}

/** Closes a tab in one group, leaving any other group showing it alone. */
export function withoutTab(
  groups: EditorGroup[],
  id: string,
  relPath: string
): EditorGroup[] {
  return replace(groups, id, (group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => tab !== relPath),
    active: nextActive(group, relPath),
  }))
}

/**
 * Closes a tab everywhere.
 *
 * For a file that has stopped existing — deleted, or renamed out from under a
 * buffer — where leaving it open in the pane that did not ask is not a choice
 * anyone made.
 */
export function withoutTabEverywhere(
  groups: EditorGroup[],
  relPath: string
): EditorGroup[] {
  return groups.map((group) => ({
    ...group,
    tabs: group.tabs.filter((tab) => tab !== relPath),
    active: nextActive(group, relPath),
  }))
}

/** The same tab under a new name, in every group holding it. */
export function renamedTab(
  groups: EditorGroup[],
  from: string,
  to: string
): EditorGroup[] {
  return groups.map((group) => ({
    ...group,
    tabs: group.tabs.map((tab) => (tab === from ? to : tab)),
    active: group.active === from ? to : group.active,
  }))
}

/** Reorders within one strip. */
export function moveWithin(
  groups: EditorGroup[],
  id: string,
  from: number,
  to: number
): EditorGroup[] {
  return replace(groups, id, (group) => {
    if (from === to || !group.tabs[from] || !group.tabs[to]) return group

    const tabs = [...group.tabs]
    tabs.splice(to, 0, ...tabs.splice(from, 1))
    return { ...group, tabs }
  })
}

/**
 * Drags a tab from one strip into another.
 *
 * The file lands active in the group it arrives at, because a tab you have just
 * carried somewhere is the one you want to look at there.
 */
export function moveBetween(
  groups: EditorGroup[],
  relPath: string,
  from: string,
  to: string,
  index?: number
): EditorGroup[] {
  if (from === to) return groups

  return withTab(withoutTab(groups, from, relPath), to, relPath, index)
}

/**
 * Splits a group, handing the new one a file.
 *
 * The new group starts with the one file rather than a copy of the strip: a
 * split is opened to put two documents side by side, and duplicating eight tabs
 * to do it would leave seven of them to close.
 */
export function splitGroup(
  groups: EditorGroup[],
  id: string,
  relPath: string | null,
  side: SplitSide = "after"
): { groups: EditorGroup[]; group: EditorGroup } {
  const at = groups.findIndex((candidate) => candidate.id === id)
  const source = at === -1 ? undefined : groups[at]

  // The new pane comes out of the one it was split from, not out of everyone
  // else. Splitting the right-hand pane of a lopsided row should leave the
  // left-hand one exactly where it was.
  const share = (source?.share ?? 1) / 2
  const group = createGroup(relPath ? [relPath] : [], relPath, share)

  const next = groups.map((candidate) =>
    candidate.id === id ? { ...candidate, share } : candidate
  )

  next.splice(
    at === -1 ? next.length : at + (side === "after" ? 1 : 0),
    0,
    group
  )

  return { groups: next, group }
}

/**
 * Shares back to summing to 1, in proportion.
 *
 * A pane that closes hands its room to the others in the ratio they already
 * stood in, which is what makes closing one of three panes look like the two
 * survivors growing rather than like the row being redealt.
 */
function rebalance(groups: EditorGroup[]): EditorGroup[] {
  const total = groups.reduce((sum, group) => sum + group.share, 0)

  // Nothing to go on — a restored layout with no sizes, or one whose numbers
  // did not survive whatever wrote them. An even row is the honest answer.
  if (!Number.isFinite(total) || total <= 0)
    return groups.map((group) => ({ ...group, share: 1 / groups.length }))

  return groups.map((group) => ({ ...group, share: group.share / total }))
}

/**
 * The invariants, applied in one place after any change above.
 *
 * An empty group closes itself — closing the last tab in a split is how people
 * unsplit, and a pane left behind showing nothing is a pane to then close by
 * hand. The exception is the final group, which stays whether or not it holds
 * anything: there is always somewhere for the next file to open, and "no groups
 * at all" is a state nothing else in the app is written for.
 *
 * Focus follows a closed group to its neighbour rather than to the first in the
 * list, so unsplitting leaves you next to what you were looking at.
 */
export function normalize(
  groups: EditorGroup[],
  focusedGroup: string
): { groups: EditorGroup[]; focusedGroup: string } {
  const index = groups.findIndex((group) => group.id === focusedGroup)
  const kept = groups.filter((group) => group.tabs.length)

  if (!kept.length) {
    const survivor = groups[index === -1 ? 0 : index] ?? groups[0] ?? createGroup()
    return {
      groups: [{ ...survivor, tabs: [], active: null, share: 1 }],
      focusedGroup: survivor.id,
    }
  }

  const balanced = rebalance(kept)

  if (balanced.some((group) => group.id === focusedGroup))
    return { groups: balanced, focusedGroup }

  // The neighbour on the side the closed group was, clamped to the list.
  const neighbour = balanced[Math.min(Math.max(index, 0), balanced.length - 1)]
  return { groups: balanced, focusedGroup: neighbour.id }
}

/**
 * A divider dragged: room moves between two neighbours and nowhere else.
 *
 * Clamped so neither of the pair can be squeezed below `min` of the room the
 * two of them share. Everything beyond the pair keeps its size, which is what
 * makes dragging one divider in a three-pane row a local act.
 */
export function resizeAt(
  groups: EditorGroup[],
  index: number,
  delta: number,
  min: number
): EditorGroup[] {
  const before = groups[index]
  const after = groups[index + 1]
  if (!before || !after) return groups

  const room = before.share + after.share
  const next = Math.min(
    Math.max(before.share + delta, min * room),
    room - min * room
  )

  return groups.map((group, at) =>
    at === index
      ? { ...group, share: next }
      : at === index + 1
        ? { ...group, share: room - next }
        : group
  )
}
