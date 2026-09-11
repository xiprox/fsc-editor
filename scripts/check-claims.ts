/**
 * Greps every source-backed fact's anchors against an FS Copilot checkout.
 *
 * The facts table (src/shared/lang/facts.ts) states what FS Copilot does,
 * once, and the diagnostics, hovers and docs cite it. A fact read from source
 * carries anchors — a file and a verbatim one-line snippet — and this asserts
 * each snippet is still in its file. A miss means FS Copilot changed under a
 * claim: read around where the anchor used to be, then fix the fact or the
 * anchor. It cannot say a fact is *true*, only that the code it was read from
 * is still there to be read.
 *
 * A maintainer script rather than a test for the reason `check:format` is
 * one: the checkout lives outside the repository.
 *
 * Usage: npm run check:claims [path to FS Copilot's src folder]
 */

import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { FACTS, factOf, type FactId } from "../src/shared/lang/facts.ts"

const root =
  process.argv[2] ?? process.env.FSCE_FSCOPILOT_SOURCE ?? join(homedir(), "dev/fsc/src")

if (!existsSync(root)) {
  console.error(
    `No FS Copilot source at ${root}. Pass its src folder as an argument, or set FSCE_FSCOPILOT_SOURCE.`
  )
  process.exit(1)
}

const files = new Map<string, string | null>()

function contentOf(file: string): string | null {
  if (!files.has(file)) {
    const path = join(root, file)
    files.set(file, existsSync(path) ? readFileSync(path, "utf8") : null)
  }
  return files.get(file) ?? null
}

let checked = 0
const missing: string[] = []

for (const id of Object.keys(FACTS) as FactId[]) {
  for (const { file, anchor } of factOf(id).anchors ?? []) {
    checked += 1
    const content = contentOf(file)

    if (content === null) missing.push(`${id} — ${file} is not in the checkout`)
    else if (!content.includes(anchor))
      missing.push(`${id} — not in ${file}: ${anchor}`)
  }
}

console.log(`${checked} anchors checked against ${root}`)

if (missing.length) {
  console.error(`\n${missing.length} not found:\n`)
  for (const line of missing) console.error(`  ${line}`)
  process.exit(1)
}

console.log("every anchor found")
