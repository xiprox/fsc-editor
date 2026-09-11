/**
 * The profiles this folder was last shared with, so hosting the same pair of
 * files twice does not mean picking them twice.
 *
 * Remembering was deliberately left out to begin with, on the grounds that a
 * selection recalled weeks later is one you no longer remember making. What
 * makes it safe is the order the picker already imposes: the list is on screen,
 * with its ticks visible, *before* a code exists, and Start is what shares
 * anything. A remembered selection is a filled-in form, not a decision already
 * taken — you cannot share it without looking at it first.
 *
 * Only what was actually shared is kept. Ticking boxes and then cancelling
 * leaves nothing behind, because that is a selection you decided against.
 *
 * Per workspace root, and in `localStorage` beside the open tabs, for the same
 * reason: one folder of profiles has nothing to say about another's, and losing
 * this costs a few clicks rather than the setup screen.
 */

/** Windows paths differ only in case between one run and the next. */
const keyFor = (root: string) => `shared:${root.toLowerCase()}`

/**
 * What was last shared from this folder, filtered to what is still there.
 *
 * `available` is passed in rather than read here so that a profile deleted
 * since the last session simply does not come back, without this module
 * needing to know what a profile is.
 */
export function loadShared(root: string, available: string[]): string[] {
  const stored = localStorage.getItem(keyFor(root))
  if (!stored) return []

  try {
    const parsed = JSON.parse(stored) as unknown
    if (!Array.isArray(parsed)) return []

    const present = new Set(available)

    return parsed.filter(
      (relPath): relPath is string =>
        typeof relPath === "string" && present.has(relPath)
    )
  } catch {
    return []
  }
}

export function saveShared(root: string, paths: string[]): void {
  localStorage.setItem(keyFor(root), JSON.stringify(paths))
}
