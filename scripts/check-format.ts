/**
 * Runs the formatter over every profile it can find and checks that it changed
 * nothing that matters.
 *
 * The formatter rewrites files people distribute to each other, so the bar is
 * that a save can never alter what FS Copilot loads. Two properties are
 * asserted per file:
 *
 *   1. Semantic identity — parsing before and after yields the same document.
 *      A real YAML parser is used here as an oracle only; the formatter itself
 *      never parses.
 *   2. Idempotence — formatting twice equals formatting once.
 *
 * Both now live in `checks/format.ts`, which `npm test` also runs over the
 * committed corpus. What is left here is the folder walk and the report — the
 * parts that need somebody else's folder.
 *
 * Usage: npm run check:format [path to a Definitions folder]
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

// The assertions themselves live beside the corpus tests, so that `npm test`
// and this script cannot form two opinions about what a safe save is. This
// file is the folder walk and the report. See docs/pipeline/03-checks.md.
import { checkFormat } from "./checks/format.ts"

const DEFAULT_ROOTS = [
  process.env.FSCE_WORKSPACE,
  join(homedir(), "dev/fscopilot/bin/FSCopilot/Definitions"),
  join(homedir(), "dev/fscopilot/profiles"),
].filter((path): path is string => !!path)

const roots = process.argv.slice(2).length
  ? process.argv.slice(2)
  : DEFAULT_ROOTS.filter((path) => {
      try {
        return statSync(path).isDirectory()
      } catch {
        return false
      }
    })

function collect(dir: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...collect(path))
    else if (/\.ya?ml$/i.test(entry.name)) found.push(path)
  }

  return found
}

const files = roots.flatMap(collect)
if (!files.length) {
  console.error("No profiles found. Pass a Definitions folder as an argument.")
  process.exit(1)
}

let failures = 0
let unparseable = 0

for (const file of files) {
  const result = checkFormat(readFileSync(file, "utf8"))

  if (result.unparseable) unparseable += 1

  for (const problem of result.problems) {
    console.error(`${problem.message.toUpperCase().padEnd(16)}${file}`)
    failures += 1
  }
}

const summary = `${files.length} profiles, ${failures} failures${
  unparseable ? `, ${unparseable} already invalid` : ""
}`

if (failures) {
  console.error(`\n${summary}`)
  process.exit(1)
}

console.log(summary)
