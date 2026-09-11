/**
 * Mirrors a real Definitions folder into `corpus/profiles/`.
 *
 * The corpus is committed so that the assertions the sweeps make — a save never
 * alters what FS Copilot loads, the highlighter never throws, the grammar and
 * the formatter agree about columns — can run on a fresh clone, in CI, over
 * real files rather than over the handful of shapes somebody thought to invent.
 * See docs/pipeline/03-checks.md.
 *
 * It comes from two places, because a working Definitions folder is assembled
 * from two:
 *
 *   profiles  ~/dev/fsc/profiles/definitions   the community profiles
 *   modules   ~/Documents/Definitions/modules  the shared module profiles
 *
 * **Bytes are copied, not text.** Line endings are what is being tested:
 * `formatProfile` branches on whether the file contains a CRLF and writes back
 * whichever it found, so a corpus normalised to LF would exercise the branch
 * nobody has and skip the branch everybody has. `.gitattributes` marks
 * `corpus/** -text` for the same reason — without it, git stores LF, hands back
 * CRLF on Windows and LF on a Linux runner, and the check with the strictest
 * contract in the repository would be running against files git rewrote.
 *
 * Running this produces a reviewable diff: which profiles arrived, which
 * changed, which are gone. Refreshing the corpus is a moment to look at it,
 * which is the other reason this is a script rather than a one-off copy.
 *
 * Usage: npm run corpus:sync
 *
 * Override the sources with FSCE_CORPUS_PROFILES and FSCE_CORPUS_MODULES.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join, relative } from "node:path"

const root = join(import.meta.dirname, "..")
const target = join(root, "corpus", "profiles")

const PROFILES =
  process.env.FSCE_CORPUS_PROFILES ?? join(homedir(), "dev/fsc/profiles/definitions")
const MODULES =
  process.env.FSCE_CORPUS_MODULES ?? join(homedir(), "Documents/Definitions/modules")

/** What FS Copilot reads. Both spellings occur in the wild. */
function isProfile(name: string): boolean {
  const lower = name.toLowerCase()
  return lower.endsWith(".yaml") || lower.endsWith(".yml")
}

function profilesIn(dir: string): string[] {
  if (!existsSync(dir)) {
    console.error(`missing source: ${dir}`)
    process.exit(1)
  }

  return readdirSync(dir)
    .filter((name) => isProfile(name) && statSync(join(dir, name)).isFile())
    .sort()
}

interface Change {
  kind: "added" | "changed" | "removed"
  path: string
}

const changes: Change[] = []

/** Byte-for-byte, and only when the bytes differ — so mtimes stay honest. */
function copy(from: string, to: string, shown: string): void {
  const bytes = readFileSync(from)

  if (!existsSync(to)) {
    writeFileSync(to, bytes)
    changes.push({ kind: "added", path: shown })
    return
  }

  if (!readFileSync(to).equals(bytes)) {
    writeFileSync(to, bytes)
    changes.push({ kind: "changed", path: shown })
  }
}

function sync(source: string, destination: string, prefix: string): Set<string> {
  mkdirSync(destination, { recursive: true })

  const kept = new Set<string>()

  for (const name of profilesIn(source)) {
    kept.add(name)
    copy(join(source, name), join(destination, name), prefix + name)
  }

  // A profile that left the source leaves the corpus, so the mirror stays a
  // mirror and the diff shows the removal.
  for (const name of readdirSync(destination)) {
    const path = join(destination, name)
    if (!statSync(path).isFile() || !isProfile(name)) continue
    if (kept.has(name)) continue

    rmSync(path)
    changes.push({ kind: "removed", path: prefix + name })
  }

  return kept
}

const profiles = sync(PROFILES, target, "")
const modules = sync(MODULES, join(target, "modules"), "modules/")

const crlf: string[] = []
const lf: string[] = []

for (const name of [...profiles].map((n) => join(target, n))) {
  ;(readFileSync(name, "utf8").includes("\r\n") ? crlf : lf).push(name)
}

console.log(`profiles  ${profiles.size}`)
console.log(`modules   ${modules.size}`)
console.log(`endings   ${crlf.length} CRLF, ${lf.length} LF (profiles only)`)

if (changes.length === 0) {
  console.log("\nno change.")
} else {
  console.log("")
  for (const change of changes) console.log(`  ${change.kind.padEnd(8)}${change.path}`)
  console.log(`\n${changes.length} change(s) — review the diff before committing.`)
}

console.log(`\nfrom ${relative(root, PROFILES) || PROFILES}`)
console.log(`     ${relative(root, MODULES) || MODULES}`)
