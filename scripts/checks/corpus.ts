/**
 * The committed corpus, as bytes.
 *
 * `corpus/profiles/` is a mirror of a real Definitions folder, kept by
 * `npm run corpus:sync`. It exists so that the assertions the sweeps make can
 * run on a fresh clone and in CI, over real files rather than over the handful
 * of shapes somebody thought to invent. See docs/pipeline/03-checks.md.
 *
 * Read as a Buffer and decoded here rather than with `readFileSync(…, "utf8")`
 * at each call site, because the line ending is part of what is under test: 47
 * of these are CRLF, 11 are LF, and some are both within one file. A helper
 * that quietly normalised would remove the only thing several of these files
 * are interesting for.
 */

import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..", "..")

/** Where the mirror lives, and where the golden output sits beside it. */
export const CORPUS = join(root, "corpus", "profiles")
export const GOLDEN = join(root, "corpus", "formatted")

export interface CorpusFile {
  /** Path relative to `corpus/profiles`, with `/` separators. Stable in messages. */
  path: string
  /** Absolute, for reading the golden file's neighbour. */
  absolute: string
  text: string
}

function walk(dir: string, prefix = ""): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...walk(path, `${prefix}${entry.name}/`))
    else if (/\.ya?ml$/i.test(entry.name)) found.push(prefix + entry.name)
  }

  return found
}

/**
 * Every profile in the corpus, sorted, so that a failure list is comparable
 * between runs and between machines.
 */
export function corpusFiles(): CorpusFile[] {
  if (!safeIsDirectory(CORPUS)) {
    throw new Error(
      `No corpus at ${CORPUS}. Run npm run corpus:sync — see docs/pipeline/03-checks.md.`
    )
  }

  return walk(CORPUS)
    .sort()
    .map((path) => {
      const absolute = join(CORPUS, path)
      return { path, absolute, text: readFileSync(absolute).toString("utf8") }
    })
}

function safeIsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** A problem found in one file, reported the same way by every check. */
export interface Problem {
  /** 1-based. 0 when the problem is about the file rather than a line in it. */
  line: number
  message: string
}
