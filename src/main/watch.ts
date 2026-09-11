import fs from "node:fs"
import path from "node:path"

import type { ProfileFile } from "@shared/types"

import { listFiles } from "./files"
import { isYaml } from "./paths"

const DEBOUNCE_MS = 200

export interface Watcher {
  close(): void
}

/**
 * Whether an event names something that could have changed the profile list.
 *
 * Only a name that carries an extension can be ruled out, and only when that
 * extension is not ours. Windows reports folder-level changes by folder name —
 * `modules`, with no extension — and reports nothing at all when it cannot say
 * what moved, and both of those are real news about the tree. Extension-less
 * names are therefore kept rather than filtered, which costs an occasional
 * needless rescan and never costs a missed one.
 */
function worthRescanning(filename: string | Buffer | null): boolean {
  if (typeof filename !== "string") return true

  const extension = path.extname(filename)
  return extension === "" || isYaml(filename)
}

/**
 * Watches the workspace and hands back the whole file list rather than a diff.
 *
 * The list is what every consumer already wants — the sidebar renders it, the
 * remote manifest is derived from it — and at ~60 files rebuilding it costs
 * less than describing what moved. Callers spot what changed by comparing
 * `mtimeMs`, which is also what stops a save from reloading the buffer it just
 * wrote: `writeFile` returns the mtime it produced, and that is the mtime that
 * comes back here.
 *
 * FS Copilot reads these files while the sim runs and people edit them in other
 * editors, so the folder moving underneath us is the normal case, not an edge
 * one.
 */
export function watchWorkspace(
  root: string,
  onChange: (files: ProfileFile[]) => void
): Watcher {
  let timer: ReturnType<typeof setTimeout> | undefined
  let closed = false

  const rescan = (): void => {
    timer = undefined

    void listFiles(root)
      .then((files) => {
        if (!closed) onChange(files)
      })
      .catch(() => {
        // A rescan that loses a race with the filesystem — the folder is being
        // moved, a file vanished between readdir and stat — leaves the last
        // good list in place rather than blanking the sidebar. The next event
        // rescans anyway.
      })
  }

  // Windows fires several events for one save, and an editor that writes
  // through a temp file looks like a create, a delete and a rename. Letting the
  // burst settle means one rescan per actual edit.
  const schedule = (): void => {
    clearTimeout(timer)
    timer = setTimeout(rescan, DEBOUNCE_MS)
  }

  const watcher = fs.watch(root, { recursive: true }, (_event, filename) => {
    if (worthRescanning(filename)) schedule()
  })

  // Losing the watcher costs liveness, not correctness: the header's rescan
  // button still works, so this stays quiet rather than taking the app down.
  watcher.on("error", () => {})

  return {
    close() {
      closed = true
      clearTimeout(timer)
      watcher.close()
    },
  }
}
