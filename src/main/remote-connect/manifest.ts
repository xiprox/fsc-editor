import crypto from "node:crypto"
import fs from "node:fs/promises"

import type { ManifestEntry } from "@shared/remote-connect"
import type { ProfileFile } from "@shared/types"

import { resolveInside } from "../paths"

/**
 * Line endings folded to `\n` before anything looks at the content.
 *
 * The two ends of a session are separate Windows installs with their own
 * checkout and editor habits, so one writing CRLF where the other writes LF is
 * the common case rather than an odd one. Hashing raw bytes would report every
 * file as differing on that alone, which would make the comparison the whole
 * feature is built on say nothing at all.
 *
 * A bare carriage return counts too, and not for the sake of 1990s Macs: a
 * single stray `\r` left behind by a bad merge or an old editor is invisible in
 * every view of the file and would otherwise mark it permanently modified, with
 * a diff that appears to show two identical documents. `\r\n?` catches both.
 *
 * Only comparison is normalized. What gets written to disk keeps whatever the
 * file already used.
 */
export function normalizeNewlines(content: string): string {
  return content.replace(/\r\n?/g, "\n")
}

export function hashContent(content: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizeNewlines(content), "utf8")
    .digest("hex")
}

/**
 * Hashes survive between scans, keyed by what a scan can see without opening
 * the file. The watcher fires on every save, and re-reading the whole workspace
 * each time to tell one changed profile from fifty unchanged ones is work worth
 * skipping.
 */
interface CacheEntry {
  size: number
  mtimeMs: number
  hash: string
}

const cache = new Map<string, CacheEntry>()

export function forgetHashes(): void {
  cache.clear()
}

/** The host's view of its own workspace: every profile, with no contents. */
export async function buildManifest(
  root: string,
  files: ProfileFile[]
): Promise<ManifestEntry[]> {
  const entries = await Promise.all(
    files.map(async (file): Promise<ManifestEntry | null> => {
      const cached = cache.get(file.relPath)

      if (cached && cached.size === file.size && cached.mtimeMs === file.mtimeMs)
        return { ...file, hash: cached.hash }

      try {
        const content = await fs.readFile(resolveInside(root, file.relPath), "utf8")
        const hash = hashContent(content)

        cache.set(file.relPath, {
          size: file.size,
          mtimeMs: file.mtimeMs,
          hash,
        })

        return { relPath: file.relPath, size: file.size, mtimeMs: file.mtimeMs, hash }
      } catch {
        // Unreadable right now — being written, or locked by FS Copilot. Left
        // out of this manifest rather than announced with a hash we did not
        // compute; the next save produces another one.
        return null
      }
    })
  )

  // Files that dropped out entirely, so a workspace that shrinks does not leave
  // its hashes behind to be matched against.
  const present = new Set(files.map((file) => file.relPath))
  for (const relPath of cache.keys())
    if (!present.has(relPath)) cache.delete(relPath)

  return entries.filter((entry): entry is ManifestEntry => entry !== null)
}

export interface ManifestDelta {
  changed: ManifestEntry[]
  removed: string[]
}

/**
 * What moved between two manifests.
 *
 * Sent instead of the whole list because a debug session is a long run of
 * one-file saves, and describing one changed profile costs a fraction of
 * re-announcing sixty unchanged ones.
 */
export function diffManifests(
  before: ManifestEntry[],
  after: ManifestEntry[]
): ManifestDelta {
  const previous = new Map(before.map((entry) => [entry.relPath, entry]))

  const changed = after.filter((entry) => previous.get(entry.relPath)?.hash !== entry.hash)

  const current = new Set(after.map((entry) => entry.relPath))
  const removed = before
    .map((entry) => entry.relPath)
    .filter((relPath) => !current.has(relPath))

  return { changed, removed }
}
