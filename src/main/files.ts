import { constants as fsConstants } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import type { FileContent, ProfileFile } from "@shared/types"

import { isYaml, resolveEntryInside, resolveInside, toRelPath } from "./paths"

const MAX_DEPTH = 4

/**
 * Every profile under the workspace, including module subfolders — an edit to
 * `modules/fuel.yaml` matters as much as one to the aircraft profile that
 * includes it.
 */
export async function listFiles(root: string): Promise<ProfileFile[]> {
  const found: ProfileFile[] = []

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return

    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const full = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        await walk(full, depth + 1)
        continue
      }

      if (!entry.isFile() || !isYaml(entry.name)) continue

      const stat = await fs.stat(full)
      const relPath = toRelPath(root, full)

      found.push({
        relPath,
        name: entry.name,
        dir: path.dirname(relPath) === "." ? "" : path.dirname(relPath),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      })
    }
  }

  await walk(root, 0)

  return found.sort(compareProfiles)
}

/**
 * Top-level profiles first, then module folders, alphabetical within each.
 *
 * Exported because it is not only the sidebar's order: it is the order the
 * corpus is folded in, which decides which twelve profiles a variable lists and
 * which comment becomes its documentation. Restating it as a SQL `ORDER BY`
 * looked equivalent and was not — SQLite's default collation sorts every
 * uppercase letter before every lowercase one, so `PMDG 737-600.yaml` came
 * before `bksq-aircraft-baronpro.yaml` where `localeCompare` puts it after.
 */
export function compareProfiles(
  a: Pick<ProfileFile, "dir" | "name">,
  b: Pick<ProfileFile, "dir" | "name">
): number {
  if (a.dir !== b.dir) return a.dir.localeCompare(b.dir)
  return a.name.localeCompare(b.name)
}

/**
 * The characters Windows will not have in a filename, named so that typing one
 * gets a sentence rather than an `EINVAL`. Not the whole rule — reserved names
 * and trailing dots are still the filesystem's to refuse, and it does, into
 * the same log.
 */
const ILLEGAL_NAME = /[<>:"/\\|?*]/

/** A profile's own row in the list, built the way `listFiles` builds one. */
async function describe(root: string, full: string): Promise<ProfileFile> {
  const stat = await fs.stat(full)
  const relPath = toRelPath(root, full)
  const dir = path.dirname(relPath)

  return {
    relPath,
    name: path.basename(relPath),
    dir: dir === "." ? "" : dir,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  }
}

/**
 * Whether a workspace-relative path names a folder.
 *
 * Asked of the disk rather than of the caller: the sidebar knows which of its
 * rows is a folder, but the answer decides between opening a folder and
 * selecting a file in Explorer, and getting it wrong would hand a `.yaml` to
 * whatever Windows has associated with it.
 */
export async function isFolder(
  root: string,
  relPath: string
): Promise<boolean> {
  const stat = await fs.stat(resolveEntryInside(root, relPath))
  return stat.isDirectory()
}

async function exists(full: string): Promise<boolean> {
  try {
    await fs.stat(full)
    return true
  } catch {
    return false
  }
}

/**
 * Renames a profile in place. `name` is a bare filename — a rename cannot move
 * a profile between folders, because a profile's folder is what says whether
 * FS Copilot loads it as an aircraft or includes it as a module.
 *
 * The extension is added rather than demanded. `A320neo` is what people type,
 * and a name that lost its `.yaml` would stop being a profile without ever
 * looking wrong in the sidebar.
 */
export async function renameFile(
  root: string,
  relPath: string,
  name: string
): Promise<ProfileFile> {
  const from = resolveInside(root, relPath)
  const trimmed = name.trim()

  if (!trimmed) throw new Error("A profile needs a name.")
  if (ILLEGAL_NAME.test(trimmed))
    throw new Error(`A profile name cannot contain < > : " / \\ | ? *`)

  const dir = path.dirname(relPath)
  const filename = isYaml(trimmed) ? trimmed : `${trimmed}.yaml`
  const to = resolveInside(
    root,
    dir === "." || dir === "" ? filename : `${dir}/${filename}`
  )

  if (to === from) return describe(root, from)

  // Changing only the case of a name is a rename Windows performs happily and
  // that this check would otherwise refuse, having found the file it is about
  // to move standing in its own way.
  const sameFile = from.toLowerCase() === to.toLowerCase()
  if (!sameFile && (await exists(to)))
    throw new Error(`${filename} already exists.`)

  await fs.rename(from, to)

  return describe(root, to)
}

/**
 * Explorer's naming, because Explorer is a click away on the same row: the
 * first copy is `<name> - Copy`, and the ones after it are numbered.
 *
 * Pure, and exported, because the numbering is the only part worth testing and
 * the folder it will land in is not.
 */
export function copyName(name: string, taken: Set<string>): string {
  const extension = path.extname(name)
  const stem = name.slice(0, name.length - extension.length)
  const lower = new Set([...taken].map((entry) => entry.toLowerCase()))

  for (let n = 1; ; n++) {
    const suffix = n === 1 ? " - Copy" : ` - Copy (${n})`
    const candidate = `${stem}${suffix}${extension}`

    if (!lower.has(candidate.toLowerCase())) return candidate
  }
}

/** Copies a profile beside itself, under the first free `- Copy` name. */
export async function duplicateFile(
  root: string,
  relPath: string
): Promise<ProfileFile> {
  const from = resolveInside(root, relPath)
  const dir = path.dirname(from)
  const taken = new Set(await fs.readdir(dir))
  const to = path.join(dir, copyName(path.basename(from), taken))

  // `copyFile` with `EXCL` rather than a plain copy: the name was chosen from a
  // listing taken a moment ago, and losing that race should fail loudly rather
  // than land on top of a profile that appeared in between.
  await fs.copyFile(from, to, fsConstants.COPYFILE_EXCL)

  return describe(root, to)
}

export async function readFile(
  root: string,
  relPath: string
): Promise<FileContent> {
  const full = resolveInside(root, relPath)
  const [content, stat] = await Promise.all([
    fs.readFile(full, "utf8"),
    fs.stat(full),
  ])

  return { relPath, content, mtimeMs: stat.mtimeMs }
}

/**
 * Why a save did not happen, in a sentence.
 *
 * The one failure in this file with somewhere to be read — the bar above the
 * editor — so the one that cannot hand a reader an `EPERM` and leave them to
 * work out what it wants from them. The codes are the ones a profile actually
 * meets: FS Copilot holding the file open while the sim runs, a full disk, a
 * folder that refuses writes.
 *
 * `EBUSY` and `EPERM` do not say *which* program has the file, so neither does
 * this — but FS Copilot is the one the user has open, and naming the likely
 * culprit is the difference between a message they can act on and a riddle.
 *
 * The name, not the path: it is the filename in the tab they just pressed
 * Ctrl+S in.
 *
 * Exported for the same reason `copyName` is: the mapping from a code to a
 * sentence is the part worth testing, and provoking a locked file on a real disk
 * to get at it is not.
 */
export function saveRefused(name: string, error: unknown): Error {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : null

  if (code === "EBUSY" || code === "EPERM" || code === "EACCES")
    return new Error(
      `Could not save ${name} — another program has it open, most likely FS Copilot.`
    )

  if (code === "ENOSPC")
    return new Error(`Could not save ${name} — the disk is full.`)

  if (code === "EROFS")
    return new Error(`Could not save ${name} — the disk is read-only.`)

  // A code nobody has met yet still names the file and says where the refusal
  // came from. With no code at all the original text goes through as-is rather
  // than a sentence pretending to know more than it does — this is the branch
  // that has to keep a debug report worth reading.
  if (code)
    return new Error(`Could not save ${name} — Windows reported ${code}.`)

  return new Error(
    `Could not save ${name} — ${error instanceof Error ? error.message : String(error)}`
  )
}

export async function writeFile(
  root: string,
  relPath: string,
  content: string
): Promise<FileContent> {
  const full = resolveInside(root, relPath)

  try {
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, content, "utf8")

    const stat = await fs.stat(full)
    return { relPath, content, mtimeMs: stat.mtimeMs }
  } catch (error) {
    throw saveRefused(path.basename(relPath), error)
  }
}
