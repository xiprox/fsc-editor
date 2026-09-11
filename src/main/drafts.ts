import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import type { RestoredDraft } from "@shared/types"

import { resolveInside } from "./paths"
import { hashContent } from "./remote-connect/manifest"

/**
 * Unsaved edits, kept where losing them is hard.
 *
 * The whole point of this store is that a profile you were part way through
 * survives quitting, crashing and being distracted for a week. That single
 * requirement decides the shape, and it decides it against the obvious
 * alternatives:
 *
 * - **Not `localStorage`.** `lib/session.ts` is right that renderer storage is
 *   the place for things that cost one click to lose. Unsaved work is not that,
 *   and a cleared browser store should not eat it.
 * - **Not the database.** `vars.db` is next door and would be less code, with
 *   no index to drift. But text inside a SQLite blob cannot be rescued by hand:
 *   if the app will not start, the work is gone. A draft is a real `.yaml` here
 *   for exactly that reason — the recovery story is "open the folder".
 * - **Not one JSON of everything.** YAML escaped into JSON strings is
 *   unreadable, which defeats the point above, and a single blob means a crash
 *   mid-write loses every draft rather than one.
 *
 * So: a folder per workspace, the drafts mirrored inside it under their own
 * relative paths, and a small index carrying metadata only.
 *
 *     <userData>/drafts/<hash of root>/
 *       index.json          { root, files: { "pa24-250.yaml": {…} } }
 *       pa24-250.yaml       the draft, verbatim
 *       modules/lights.yaml
 *
 * ## Why the base is a hash and not a copy
 *
 * A draft has to remember what it was edited *from*, or reopening it cannot
 * tell "nothing happened while I was away" from "someone else changed this
 * file". But that is the only question the base answers — the diff worth
 * showing is the draft against the file as it *is*, not as it was — so a hash
 * is enough, and storing a second copy of every file would be storing it for
 * nothing.
 */

/** One draft as it sits in the index. Content lives beside it, in a file. */
interface IndexEntry {
  baseHash: string
  updatedAt: number
}

interface DraftIndex {
  /** The workspace this folder belongs to, for a human reading it. */
  root: string
  files: Record<string, IndexEntry>
}

const EMPTY = (root: string): DraftIndex => ({ root, files: {} })

/**
 * The folder for a workspace.
 *
 * Hashed rather than sanitized: roots are absolute Windows paths, full of
 * characters a directory name cannot hold, and any escaping scheme good enough
 * to survive them is worse to read than a hash. `index.json` carries the real
 * root back. Lower-cased first for the same reason `lib/session.ts` does it —
 * the same folder arrives spelled differently between runs.
 */
function folderFor(userData: string, root: string): string {
  const id = crypto
    .createHash("sha256")
    .update(root.toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 16)

  return path.join(userData, "drafts", id)
}

async function readIndex(folder: string, root: string): Promise<DraftIndex> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(folder, "index.json"), "utf8")
    ) as Partial<DraftIndex>

    return parsed.files && typeof parsed.files === "object"
      ? { root, files: parsed.files }
      : EMPTY(root)
  } catch {
    return EMPTY(root)
  }
}

async function writeIndex(folder: string, index: DraftIndex): Promise<void> {
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(
    path.join(folder, "index.json"),
    JSON.stringify(index, null, 2),
    "utf8"
  )
}

/**
 * Every write, in order.
 *
 * Saving a draft is read-modify-write on one shared index, and the renderer
 * debounces per file rather than globally — so two files going quiet together
 * produce two saves that would otherwise interleave and lose one of the
 * entries. A chain is enough: these are milliseconds of work, and the
 * alternative is a lock file for a problem one process has with itself.
 */
let queue: Promise<unknown> = Promise.resolve()

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => undefined)
  return next
}

/** Records a draft, replacing any earlier one for the same file. */
export function saveDraft(
  userData: string,
  root: string,
  relPath: string,
  text: string,
  base: string
): Promise<void> {
  return serialize(async () => {
    const folder = folderFor(userData, root)
    const file = resolveInside(folder, relPath)

    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, text, "utf8")

    const index = await readIndex(folder, root)
    index.files[relPath] = {
      baseHash: hashContent(base),
      updatedAt: Date.now(),
    }
    await writeIndex(folder, index)
  })
}

/** Forgets a draft — it was saved, or discarded, or is no longer ours. */
export function clearDraft(
  userData: string,
  root: string,
  relPath: string
): Promise<void> {
  return serialize(async () => {
    const folder = folderFor(userData, root)
    const index = await readIndex(folder, root)

    if (!(relPath in index.files)) return

    delete index.files[relPath]
    await writeIndex(folder, index)
    await fs.rm(resolveInside(folder, relPath), { force: true })
  })
}

/**
 * The drafts for a workspace, each already reconciled against the file as it is
 * now.
 *
 * Reconciled *here* rather than in the renderer because this is where the base
 * hash lives, and shipping it out only to be compared elsewhere would put half
 * of one decision on each side of the process boundary. What the renderer gets
 * back is an answer: here is the text, here is the file it has to sit against,
 * and here is whether the ground moved.
 *
 * A draft that now matches its file is not a draft at all — somebody saved the
 * same text from somewhere else — so it is dropped and forgotten rather than
 * restored as a tab that is dirty in name only.
 */
export function loadDrafts(
  userData: string,
  root: string
): Promise<RestoredDraft[]> {
  return serialize(async () => {
    const folder = folderFor(userData, root)
    const index = await readIndex(folder, root)
    const restored: RestoredDraft[] = []
    const kept: Record<string, IndexEntry> = {}

    for (const [relPath, entry] of Object.entries(index.files)) {
      const text = await read(resolveInside(folder, relPath))

      // The index named a file that is not there. Nothing to restore and
      // nothing to keep pointing at.
      if (text === null) continue

      const disk = await stat(resolveInside(root, relPath))

      if (disk && hashContent(disk.content) === hashContent(text)) {
        await fs.rm(resolveInside(folder, relPath), { force: true })
        continue
      }

      kept[relPath] = entry
      restored.push({
        relPath,
        text,
        disk,
        stale: disk !== null && hashContent(disk.content) !== entry.baseHash,
      })
    }

    if (Object.keys(kept).length !== Object.keys(index.files).length)
      await writeIndex(folder, { root, files: kept })

    return restored
  })
}

async function read(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8")
  } catch {
    return null
  }
}

async function stat(
  file: string
): Promise<{ content: string; mtimeMs: number } | null> {
  try {
    const [content, stats] = await Promise.all([
      fs.readFile(file, "utf8"),
      fs.stat(file),
    ])

    return { content, mtimeMs: stats.mtimeMs }
  } catch {
    return null
  }
}
