/**
 * Which files are part of the aircraft that is loaded.
 *
 * The run button asks one question — is this file the loaded aircraft's
 * profile — and `profileKey` answers it. A panel list needs a wider one,
 * because panels get written into modules: `modules/a220-displays.yaml` is
 * never anybody's profile, and it is exactly where a `pointer:` block for the
 * A220 ends up once it is worth sharing between variants. So the question here
 * is whether the file is the loaded aircraft's profile *or anything that
 * profile includes*, to any depth.
 *
 * ## Kept, not computed on demand
 *
 * The answer is wanted synchronously, on every cursor move, and getting it
 * means reading files. So the reach is worked out when something it depends on
 * changes — the aircraft, or the folder's listing, whose mtimes move on every
 * save — and kept as a set. An unsaved edit to an `include:` line is therefore
 * not seen until it is saved, which is also when FS Copilot would see it.
 *
 * Open files are read from their models and the rest through main, so an
 * include of a file nobody has opened still counts.
 */

import { existingModel } from "@/lib/monaco-setup"
import { useStore } from "@/store"
import { includePaths, profileKey, scanLines } from "@shared/profile"

/** Lowercased, because the filesystem these name is case-insensitive. */
let reach = new Set<string>()
let computedFor = ""
const listeners = new Set<() => void>()

/** Include chains are short; this only exists to end a cycle. */
const MAX_FILES = 64

async function textOf(relPath: string): Promise<string | null> {
  const model = existingModel(relPath)
  if (model) return model.getValue()

  try {
    return (await window.api.readFile(relPath)).content
  } catch {
    // A missing include is skipped by FS Copilot too.
    return null
  }
}

async function recompute(): Promise<void> {
  const { sim, files } = useStore.getState()
  const aircraft =
    sim.phase === "live" ? (sim.aircraft?.toLowerCase() ?? null) : null

  const signature = `${aircraft}|${files
    .map((file) => `${file.relPath}:${file.mtimeMs}`)
    .join(",")}`
  if (signature === computedFor) return
  computedFor = signature

  const next = new Set<string>()
  const root = aircraft
    ? files.find((file) => profileKey(file.relPath) === aircraft)
    : undefined

  const known = new Map(
    files.map((file) => [file.relPath.toLowerCase(), file.relPath])
  )
  const queue = root ? [root.relPath] : []

  while (queue.length && next.size < MAX_FILES) {
    const relPath = queue.shift()!
    if (next.has(relPath.toLowerCase())) continue
    next.add(relPath.toLowerCase())

    const text = await textOf(relPath)
    if (text === null) continue

    for (const path of includePaths(scanLines(text))) {
      const actual = known.get(path.toLowerCase())
      if (actual && !next.has(actual.toLowerCase())) queue.push(actual)
    }
  }

  // Superseded while reading: a newer run owns the answer.
  if (computedFor !== signature) return

  reach = next
  for (const listener of listeners) listener()
}

/** Whether the file is the loaded aircraft's profile or something it includes. */
export function inLoadedAircraft(relPath: string | null): boolean {
  return relPath !== null && reach.has(relPath.toLowerCase())
}

/** Starts keeping the reach current. Called by whoever first needs it. */
export function watchReach(listener: () => void): () => void {
  listeners.add(listener)

  const stop =
    listeners.size === 1
      ? useStore.subscribe((state, previous) => {
          if (state.sim !== previous.sim || state.files !== previous.files)
            void recompute()
        })
      : null
  if (stop) stopWatching = stop

  void recompute()

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      stopWatching?.()
      stopWatching = null
    }
  }
}

let stopWatching: (() => void) | null = null
