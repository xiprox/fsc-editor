/**
 * Merges a profile's `include:` tree into a single file, turning each included
 * file into a section.
 *
 * Shared modules under `modules/` stay as includes — they are maintained
 * separately and shared across many aircraft. Everything else is inlined,
 * because those files are the per-aircraft concerns the format exists to
 * organize.
 *
 * Usage: npm run merge:profile -- <profile.yaml> [--out <path>]
 */

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { parse } from "yaml"

import { formatProfile, renderHeading } from "../src/shared/profile/index.ts"
import { sameEntries } from "./entry-compare.ts"

const TOP_LEVEL_KEY = /^([A-Za-z_][\w-]*):[ \t]*$/
const INCLUDE_ITEM = /^\s*-\s*(\S+)\s*$/

/** Titles that word-splitting alone would get wrong. */
const TITLES: Record<string, string> = {
  bendix_rdr1150xl: "Bendix RDR-1150XL",
  kfc_150: "KFC 150",
  glasstap: "Glass Tap",
  tpm: "TPM",
}

function titleFor(path: string): string {
  const stem = path.replace(/^.*\//, "").replace(/\.ya?ml$/i, "")
  if (TITLES[stem]) return TITLES[stem]

  return stem
    .split(/[_-]/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
}

interface Split {
  /** Comments above the first block — the file's own documentation. */
  prose: string[]
  blocks: Map<string, string[]>
}

function split(text: string): Split {
  const blocks = new Map<string, string[]>()
  const prose: string[] = []
  let current: string[] | null = null

  for (const line of text.split(/\r?\n/)) {
    const key = TOP_LEVEL_KEY.exec(line)
    if (key) {
      current = blocks.get(key[1]) ?? []
      blocks.set(key[1], current)
      continue
    }

    if (current) current.push(line)
    else prose.push(line)
  }

  return { prose, blocks }
}

/**
 * Reads a source, repairing a truncated trailing entry if that is all that
 * stands between it and being parseable. Reports whatever it removed.
 */
function readRepaired(path: string): { text: string; dropped: string[] } {
  let text = readFileSync(path, "utf8")
  const dropped: string[] = []

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      parse(text)
      return { text, dropped }
    } catch (error) {
      const lines = text.split(/\r?\n/)
      while (lines.length && lines[lines.length - 1].trim() === "") lines.pop()
      if (!lines.length) throw error

      dropped.push(lines.pop()!)
      text = lines.join("\n") + "\n"
    }
  }

  throw new Error(`${path} is not parseable`)
}

function trimBlank(lines: string[]): string[] {
  const copy = [...lines]
  while (copy.length && copy[0].trim() === "") copy.shift()
  while (copy.length && copy[copy.length - 1].trim() === "") copy.pop()
  return copy
}

const [profilePath, ...rest] = process.argv.slice(2)
if (!profilePath) {
  console.error("Usage: merge-profile <profile.yaml> [--out <path>]")
  process.exit(1)
}

const outIndex = rest.indexOf("--out")
const outPath = outIndex === -1 ? null : rest[outIndex + 1]

const root = resolve(profilePath)
const definitionsDir = dirname(root)

const rootSplit = split(readRepaired(root).text)

const keptIncludes: string[] = []
const inlined: string[] = []

for (const line of rootSplit.blocks.get("include") ?? []) {
  const item = INCLUDE_ITEM.exec(line)
  if (!item) continue

  if (item[1].startsWith("modules/")) keptIncludes.push(item[1])
  else inlined.push(item[1])
}

/** Block name -> the sections that contribute entries to it, in include order. */
const sections = new Map<string, Array<{ title: string; lines: string[] }>>()

const addSection = (block: string, title: string, lines: string[]) => {
  const body = trimBlank(lines)
  if (!body.length) return

  const existing = sections.get(block) ?? []
  existing.push({ title, lines: body })
  sections.set(block, existing)
}

// The root's own entries come first, under a section of their own.
const ROOT_SECTION = process.env.ROOT_SECTION ?? "General"
for (const [block, lines] of rootSplit.blocks)
  if (block !== "include") addSection(block, ROOT_SECTION, lines)

const notes: string[] = []

for (const include of inlined) {
  const path = join(definitionsDir, ...include.split("/"))
  const { text, dropped } = readRepaired(path)

  for (const line of dropped)
    notes.push(`${include}: dropped unparseable trailing line ${line.trim()}`)

  const parts = split(text)
  const prose = trimBlank(parts.prose)

  let first = true
  for (const [block, lines] of parts.blocks) {
    if (block === "include") {
      for (const line of lines) {
        const item = INCLUDE_ITEM.exec(line)
        if (item && !keptIncludes.includes(item[1])) keptIncludes.push(item[1])
      }
      continue
    }

    // The file's own documentation rides along with its first block, indented
    // to the column it now lives at.
    const documented =
      first && prose.length
        ? [...prose.map((line) => (line.trim() ? `  ${line.trimEnd()}` : "")), "", ...lines]
        : lines

    addSection(block, titleFor(include), documented)
    first = false
  }
}

const out: string[] = []

for (const line of trimBlank(rootSplit.prose)) out.push(line)
if (out.length) out.push("")

// Provenance, so the file says what it is. No `Updated:` key: FS Copilot
// compares it against the published date to offer updates, and a merge is not
// a new version of the profile.
out.push(
  `# Merged from ${root.replace(/^.*[\\/]/, "")} and its ${inlined.length} includes.`,
  "# Each section below was one of those files.",
  ""
)

if (keptIncludes.length) {
  out.push("include:")
  for (const include of keptIncludes) out.push(`  - ${include}`)
  out.push("")
}

// master before shared, matching how the source profiles read.
const order = ["master", "shared"]
const blockNames = [
  ...order.filter((name) => sections.has(name)),
  ...[...sections.keys()].filter((name) => !order.includes(name)),
]

for (const block of blockNames) {
  out.push(`${block}:`)

  for (const section of sections.get(block)!) {
    out.push(`  ${renderHeading(1, section.title, 2)}`)
    out.push(...section.lines)
    out.push("")
  }

  while (out.length && out[out.length - 1] === "") out.pop()
  out.push("")
}

const merged = formatProfile(out.join("\n"))
const target = outPath ? resolve(outPath) : root.replace(/\.ya?ml$/i, ".merged.yaml")
writeFileSync(target, merged, "utf8")

// Verification: the merged document must hold exactly the entries the include
// tree held, in the same order. `sameEntries` ignores the formatter's
// case-only unit rewrite and nothing else.
const expected: Record<string, unknown[]> = {}
const collect = (text: string) => {
  const doc = parse(text) as Record<string, unknown[]> | null
  if (!doc) return
  for (const [key, value] of Object.entries(doc)) {
    if (key === "include" || !Array.isArray(value)) continue
    expected[key] = [...(expected[key] ?? []), ...value]
  }
}

collect(readRepaired(root).text)
for (const include of inlined)
  collect(readRepaired(join(definitionsDir, ...include.split("/"))).text)

const actual = parse(merged) as Record<string, unknown[]>
let failures = 0

for (const block of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
  if (block === "include") continue

  if (sameEntries(expected[block] ?? [], actual[block] ?? [])) continue

  console.error(
    `MISMATCH in ${block}: ${(expected[block] ?? []).length} entries before, ${
      (actual[block] ?? []).length
    } after`
  )
  failures += 1
}

const mergedIncludes = JSON.stringify(actual.include ?? [])
if (mergedIncludes !== JSON.stringify(keptIncludes)) {
  console.error("MISMATCH in include")
  failures += 1
}

for (const note of notes) console.log(`note: ${note}`)
console.log(
  `${target}\n${inlined.length} files inlined, ${keptIncludes.length} includes kept, ${
    Object.values(actual).filter(Array.isArray).flat().length
  } entries`
)

if (failures) process.exit(1)
