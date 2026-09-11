/**
 * Sweeps the language core over every setter in the configured workspace.
 *
 *   npm run lang:sweep
 *
 * The acceptance test 18-language-core names: every `set:` line in the
 * installed profiles must tokenize without error, and the operator table
 * grows until the unknown-word list is short enough to read. Machine-
 * dependent by design — it reads the same workspace the app does — which is
 * why it is a script and not a vitest file.
 *
 * Reported, not enforced: stack end-depths and rule diagnostics are counted
 * and sampled so a human can judge them. Enforcement is the editor's job,
 * one rule at a time, once the numbers here look right.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { scanEntries, setKind } from "../src/shared/profile/index.ts"
import {
  parseRpn,
  simulate,
  type RuleContext,
} from "../src/shared/lang/index.ts"
import { analyzeProfile } from "../src/shared/analysis.ts"
import type { SdkVarCatalog } from "../src/shared/sdk-catalog.ts"

// ------------------------------------------------------------- workspace

function workspaceRoot(): string {
  if (process.env.FSCE_WORKSPACE) return process.env.FSCE_WORKSPACE

  const appData =
    process.env.APPDATA ??
    join(process.env.USERPROFILE ?? "", "AppData/Roaming")
  const settings = JSON.parse(
    readFileSync(join(appData, "fsc-editor/settings.json"), "utf8")
  ) as { workspaceRoot?: string }

  if (!settings.workspaceRoot) throw new Error("no workspace configured")
  return settings.workspaceRoot
}

// -------------------------------------------------------------- catalogue

const catalog = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "../src/main/catalog/sdk-var-catalog.json"),
    "utf8"
  )
) as SdkVarCatalog

const keyParams = new Map<string, string>()
const settable = new Map<string, boolean>()
for (const entry of catalog.vars) {
  if (entry.name.startsWith("K:") && entry.doc?.parameters)
    keyParams.set(entry.name.slice(2), entry.doc.parameters)
  if (entry.name.startsWith("A:") && entry.doc?.settable !== undefined)
    settable.set(entry.name, entry.doc.settable)
}

/**
 * Every profile in the workspace, root-relative and forward-slashed — the
 * shape an `include:` target is written in. One directory deep is enough:
 * every include in the corpus points at `modules/`.
 */
function workspaceListing(root: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      for (const child of readdirSync(join(root, entry.name)))
        out.push(`${entry.name}/${child}`)
    } else out.push(entry.name)
  }
  return out
}

// ---------------------------------------------------- extracting the RPN

/**
 * The RPN texts inside one `set:` value, by the real classification.
 *
 * `prepended` and `literal` kinds are RPN as written. A `javascript`
 * setter's RPN lives in its template literals, `${…}` holes and all —
 * extracted by a scan that respects hole nesting; everything outside them is
 * JavaScript, not this sweep's business. The first sweep skipped the
 * classifier and fed bare JS to the RPN tokenizer, and the entire
 * unknown-word list was JavaScript keywords — the classifier is not
 * optional.
 */
function rpnTextsOf(set: string): string[] {
  if (setKind(set) !== "javascript") return [set]

  const texts: string[] = []
  let at = 0
  while (at < set.length) {
    const open = set.indexOf("`", at)
    if (open === -1) break

    let end = open + 1
    let depth = 0
    while (end < set.length) {
      const c = set[end]!
      if (c === "$" && set[end + 1] === "{") depth += 1
      else if (c === "}" && depth > 0) depth -= 1
      else if (c === "`" && depth === 0) break
      end += 1
    }

    texts.push(set.slice(open + 1, end))
    at = end + 1
  }

  return texts
}

// ------------------------------------------------------------- the sweep

const root = workspaceRoot()
const files = readdirSync(root).filter((name) => /\.ya?ml$/i.test(name))

const listing = workspaceListing(root)
const context: RuleContext = {
  keyEventParams: (event) => keyParams.get(event) ?? null,
  workspaceFiles: () => listing,
  simVarSettable: (name) => settable.get(name) ?? null,
}

let setters = 0
let rpnTexts = 0
let clean = 0
const unknownWords = new Map<string, number>()
const unterminated: string[] = []
const invisibles: string[] = []
const endDepths = new Map<string, number>()
const diagnostics = new Map<string, number>()
const samples: string[] = []

for (const file of files) {
  const text = readFileSync(join(root, file), "utf8")

  for (const entry of scanEntries(file, text)) {
    if (!entry.set) continue
    setters += 1

    const kind = setKind(entry.set)

    for (const rpn of rpnTextsOf(entry.set)) {
      rpnTexts += 1

      const doc = parseRpn(rpn)
      // The kind decides what surrounds the text: a prepended setter's value
      // is on the stack before its first word runs.
      const sim = simulate(doc, kind === "prepended" ? 1 : 0)

      let hadUnknown = false
      for (const node of doc.nodes) {
        if (node.kind === "word" && node.effect === null) {
          hadUnknown = true
          unknownWords.set(
            node.token.text,
            (unknownWords.get(node.token.text) ?? 0) + 1
          )
        }
        if (node.kind === "invisible")
          invisibles.push(`${file}: ${JSON.stringify(rpn.slice(0, 60))}`)
      }

      if (doc.unterminated.length)
        unterminated.push(`${file}: ${JSON.stringify(rpn.slice(0, 60))}`)

      const end =
        doc.nodes.length === 0
          ? "empty"
          : sim.end === null
            ? "unknown"
            : String(sim.end)
      endDepths.set(end, (endDepths.get(end) ?? 0) + 1)

      if (!hadUnknown && !doc.unterminated.length) clean += 1
    }
  }

  // Diagnostics through the shared analyzer — the same judge the editor
  // runs, so these counts are exactly what authors will see as squiggles.
  for (const diagnostic of analyzeProfile(text, context)) {
    diagnostics.set(
      diagnostic.ruleId,
      (diagnostics.get(diagnostic.ruleId) ?? 0) + 1
    )
    if (samples.length < 12)
      samples.push(
        `  [${diagnostic.ruleId}] ${file}:${diagnostic.start.lineNumber}: ${diagnostic.message.slice(0, 90)}`
      )
  }
}

// ---------------------------------------------------------------- report

console.log(`workspace: ${root}`)
console.log(
  `${files.length} profiles, ${setters} setters, ${rpnTexts} RPN texts`
)
console.log(
  `${clean} tokenize clean (${((clean / Math.max(1, rpnTexts)) * 100).toFixed(1)}%)`
)
console.log(
  `${unterminated.length} unterminated, ${invisibles.length} invisible chars`
)

console.log("\nend-of-expression stack depth:")
for (const [depth, count] of [...endDepths].sort((a, b) => b[1] - a[1]))
  console.log(`  ${depth}: ${count}`)

const unknowns = [...unknownWords].sort((a, b) => b[1] - a[1])
console.log(`\nunknown words: ${unknowns.length} distinct`)
for (const [word, count] of unknowns.slice(0, 30))
  console.log(`  ${String(count).padStart(5)}  ${word}`)

console.log("\nrule diagnostics:")
if (diagnostics.size === 0) console.log("  none")
for (const [rule, count] of diagnostics) console.log(`  ${rule}: ${count}`)
if (samples.length) {
  console.log("\nsamples:")
  for (const sample of samples) console.log(sample)
}

if (unterminated.length) {
  console.log("\nunterminated (first 10):")
  for (const line of unterminated.slice(0, 10)) console.log(`  ${line}`)
}
if (invisibles.length) {
  console.log("\ninvisible characters (first 10):")
  for (const line of invisibles.slice(0, 10)) console.log(`  ${line}`)
}
