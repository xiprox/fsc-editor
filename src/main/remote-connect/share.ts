/**
 * What a host has chosen to share, and the only place that answers whether a
 * given path is in it.
 *
 * Split out of `session.ts` because it is the enforcement point rather than a
 * detail of the socket: three separate things ask it the same question — the
 * manifest that lists files, the responder that serves their contents, and the
 * presence that names where the host is looking — and the whole guarantee of
 * the feature is that all three get the same answer. One module with one
 * comparison rule is what makes that true by construction rather than by three
 * call sites remembering to agree.
 */

/**
 * Paths keyed by a normalized form, with the host's own spelling as the value.
 *
 * The lookup side of this is a security check against a string chosen by
 * whoever holds the code, and both ends of a session are Windows installs.
 * `Modules/A320.yaml`, `modules\a320.yaml` and `modules/a320.yaml` are one file
 * to the filesystem and three strings to a `Set`, so comparing raw strings
 * would let "not shared" be defeated by the shift key. Matching on the
 * filesystem's terms is the point of the indirection; the values keep the
 * original spelling, which is what the manifest and the panel display.
 */
const shared = new Map<string, string>()

/** The filesystem's idea of whether two relative paths name the same file. */
export function shareKey(relPath: string): string {
  return relPath.replace(/\\/g, "/").toLowerCase()
}

/**
 * Replaces the selection wholesale.
 *
 * There is no add or remove. The renderer always knows the full set — it is
 * rendering it as checkboxes — and a set assembled here out of deltas is one
 * that can drift from the boxes that produced it, with no way to notice.
 */
export function selectShared(paths: string[]): void {
  shared.clear()
  for (const relPath of paths) shared.set(shareKey(relPath), relPath)
}

export function clearShared(): void {
  shared.clear()
}

/** Everything the session is willing to talk about, in the host's spelling. */
export function sharedPaths(): string[] {
  return [...shared.values()]
}

export function isShared(relPath: string): boolean {
  return shared.has(shareKey(relPath))
}

/**
 * Drops selected paths that no longer exist, given everything that does.
 *
 * A deleted profile has to leave the selection and not just the manifest. Kept,
 * it would go on counting towards "Sharing 3 profiles" — and would silently
 * start sharing again if a file of that name ever came back, which is a
 * decision the host would have made weeks ago about a different file.
 */
export function pruneShared(present: string[]): void {
  const keys = new Set(present.map(shareKey))
  for (const key of shared.keys()) if (!keys.has(key)) shared.delete(key)
}
