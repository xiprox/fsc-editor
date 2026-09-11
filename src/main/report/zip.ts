/**
 * The report folder, zipped.
 *
 * A thin wrapper, and thin on purpose. `yazl` is the whole of the zip
 * knowledge in this app — no CRC tables, no central directory arithmetic —
 * because a hand-rolled writer produces the kind of archive that Windows
 * Explorer opens and everything else refuses, and nobody finds out until a
 * tester's report cannot be read.
 *
 * The one decision made here is what not to compress. A `.gz` entry is already
 * compressed; deflating it again costs seconds on a hundred megabytes and gives
 * the bytes back a fraction of a percent larger.
 */

import fs from "node:fs"
import path from "node:path"

import { ZipFile } from "yazl"

/** Names, relative to `folder`, depth-first and stable. */
function walk(folder: string, base = ""): string[] {
  const out: string[] = []

  for (const entry of fs
    .readdirSync(folder, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = base ? `${base}/${entry.name}` : entry.name

    if (entry.isDirectory())
      out.push(...walk(path.join(folder, entry.name), rel))
    else if (entry.isFile()) out.push(rel)
  }

  return out
}

/**
 * Writes `folder` into `out`, skipping `except`.
 *
 * `except` is the zip itself: it lives in the folder it archives, so that a
 * user has one thing to open and one thing to send rather than two siblings
 * they have to tell apart. Adding it to itself would be a race with a
 * predictable winner.
 */
export function writeZip(
  folder: string,
  out: string,
  except: string
): Promise<void> {
  return new Promise((done, failed) => {
    const zip = new ZipFile()
    const sink = fs.createWriteStream(out)

    sink.on("error", failed)
    sink.on("close", () => done())

    for (const name of walk(folder)) {
      if (name === except) continue

      // Already-compressed entries go in as they are. Everything else is
      // NDJSON and JSON, which deflates by roughly an order of magnitude.
      zip.addFile(path.join(folder, name), name, {
        compress: !name.endsWith(".gz"),
      })
    }

    zip.outputStream.on("error", failed)
    zip.outputStream.pipe(sink)
    zip.end()
  })
}
