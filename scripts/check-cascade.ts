/**
 * Checks that a change to the shared control primitives did not quietly change
 * what renders.
 *
 * Moving a fragment out of a component and into an `@utility` in `index.css`
 * looks like a pure refactor and is not one. Tailwind emits every custom
 * utility *ahead of* its own, so the moment a fragment moves, it stops
 * competing on equal terms with the classes the component still writes beside
 * it — and whichever of the two used to win may now lose. Nothing in the diff
 * says so. Two real behaviour changes were found this way, both in code that
 * had been read several times:
 *
 *   - `Button`'s `destructive` variant sets a focus border and ring that the
 *     base focus ring had always overridden, so they had never been visible.
 *   - `Checkbox`'s `aria-invalid:aria-checked:border-primary` was beaten in
 *     dark mode by the base invalid border.
 *
 * So this compiles the stylesheet twice — once as it is now, once as it was at
 * a git ref — and compares the resolved cascade for every control.
 *
 * Two declarations only *compete* when all three of these hold. Anything else
 * can be reordered freely, because the cascade picks a winner without
 * consulting document order:
 *
 *   1. same property,
 *   2. same subject — `.x` and `.x svg` style different elements,
 *   3. same specificity.
 *
 * Within a competing group, order is the whole answer, so a reordering there is
 * a real visual difference.
 *
 * **What is compared is a set of realistic elements, not every class in the
 * file at once.** A `cva` has a base string plus variants, and no element ever
 * carries two sizes — so throwing every class into one bucket invents fights
 * that cannot happen. It reported `control-md`'s icon padding "losing" to
 * `control-lg`'s, which is not a thing that occurs on any button. Each variant
 * string is therefore paired with the base string, which is what an element
 * actually wears, and a difference has to show up in one of those pairings to
 * count.
 *
 * This is a maintainer sweep rather than a test for the same reason
 * `check:format` is: it shells out to git and compiles the whole stylesheet,
 * which is not what `vitest` is for. It needs no corpus, though — it only reads
 * this repository.
 *
 * Usage: npm run check:cascade [git ref, default HEAD]
 */

import { execFileSync } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { compile } from "tailwindcss"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const RENDERER = join(ROOT, "src", "renderer", "src")
const UI = join(RENDERER, "components", "ui")
const CSS = "src/renderer/src/index.css"

/** Cannot occur in a selector, so it is safe to split a composite key on. */
const SEP = "\t"

const ref = process.argv[2] ?? "HEAD"

/** Resolve a stylesheet `@import`, including package subpath exports. */
async function loadStylesheet(id: string, base: string) {
  let path: string
  if (id.startsWith(".")) path = resolve(base, id)
  else {
    const parts = id.split("/")
    const name = id.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]
    const sub = "." + (id.length > name.length ? id.slice(name.length) : "")
    const dir = join(ROOT, "node_modules", name)
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    const entry = pkg.exports?.[sub] ?? pkg.exports?.[sub + ".css"]
    let target =
      typeof entry === "string" ? entry : (entry?.style ?? entry?.default ?? null)
    if (!target && sub === ".") target = pkg.style ?? pkg.main
    if (!target) target = sub === "." ? "index.css" : sub
    path = resolve(dir, target)
    if (statSync(path, { throwIfNoEntry: false })?.isDirectory())
      path = join(path, "index.css")
  }
  return { path, base: dirname(path), content: readFileSync(path, "utf8") }
}

function atRef(path: string): string | null {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    })
  } catch {
    return null
  }
}

/**
 * The class strings in a file, each kept separate — a `cva` base and one
 * variant are worn together, two variants of the same axis never are.
 */
function classStrings(source: string): string[][] {
  const out: string[][] = []
  for (const match of source.matchAll(/"([^"\n]+)"/g)) {
    const tokens = match[1].split(/\s+/).filter(Boolean)
    // Tell a class string from prose or a prop value. A utility carries a dash,
    // a variant colon, an arbitrary-value bracket or a modifier slash; an
    // aria-label carries none of those. Half the tokens is enough —
    // `flex items-center gap-1` qualifies on two of three, and
    // "Clear the filter" on none of three.
    const utilityish = tokens.filter((t) => /[-:[/]/.test(t)).length
    if (!tokens.length || utilityish * 2 < tokens.length) continue
    const kept = tokens.filter(
      (t) => /^[a-z@[!*&-]/.test(t) && !t.endsWith(",") && !t.includes("/>")
    )
    if (kept.length) out.push(kept)
  }
  return out
}

/**
 * One entry per element worth testing.
 *
 * Inside a `cva(…)` the first string is the base and every later one is a
 * variant, and an element wears the base plus one of them — so those get
 * paired. A string outside any `cva` belongs to whatever component wrote it and
 * stands alone. Pairing across those boundaries is what makes a `SelectItem`
 * appear to fight a `SelectTrigger`, which is not an element that exists.
 */
function combinations(source: string): string[][] {
  const spans: Array<[number, number]> = []
  for (const call of source.matchAll(/\bcva\s*\(/g)) {
    const open = call.index + call[0].length - 1
    let depth = 0
    let i = open
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++
      else if (source[i] === ")" && --depth === 0) break
    }
    spans.push([open, i])
  }

  const literals: Array<{ tokens: string[]; at: number }> = []
  for (const match of source.matchAll(/"([^"\n]+)"/g)) {
    const [tokens] = classStrings(match[0])
    if (tokens?.length) literals.push({ tokens, at: match.index })
  }

  const out: string[][] = []
  for (const [open, close] of spans) {
    const inside = literals.filter((l) => l.at > open && l.at < close)
    if (!inside.length) continue
    const [base, ...variants] = inside
    out.push(base.tokens)
    for (const variant of variants)
      out.push([...new Set([...base.tokens, ...variant.tokens])])
  }
  for (const literal of literals)
    if (!spans.some(([open, close]) => literal.at > open && literal.at < close))
      out.push(literal.tokens)
  return out
}

/** How Tailwind writes a candidate into a selector. */
const escapeClass = (c: string) => "." + c.replace(/([^a-zA-Z0-9_-])/g, "\\$1")

type Row = { context: string; property: string; value: string }

/** Compile once, then fingerprint many candidate sets against it. */
async function compiler(css: string) {
  const built = await compile(css, { base: RENDERER, loadStylesheet })

  return function fingerprint(classes: string[]): Row[] {
    const out = built.build(classes)
    const escaped = classes.map(escapeClass)

    /** Strip the candidate's own class token, leaving the competing context. */
    function contextOf(selector: string): string | null {
      let best: [number, string] | null = null
      for (const token of escaped) {
        const at = selector.indexOf(token)
        if (at === -1) continue
        // `.border` must not match inside `.border-input`.
        const next = selector[at + token.length]
        if (next && /[a-zA-Z0-9_\\-]/.test(next)) continue
        if (!best || token.length > best[1].length) best = [at, token]
      }
      if (!best) return null
      const rest = selector.slice(0, best[0]) + selector.slice(best[0] + best[1].length)
      return rest.trim() || "&"
    }

    const stack: string[] = []
    const rows: Row[] = []
    for (const raw of out.split("\n")) {
      const line = raw.trim()
      if (!line || line.startsWith("/*")) continue
      if (line.endsWith("{")) {
        stack.push(line.slice(0, -1).trim())
        continue
      }
      if (line === "}") {
        stack.pop()
        continue
      }
      const colon = line.indexOf(":")
      if (colon === -1) continue
      const selectors = stack.filter((s) => !s.startsWith("@"))
      // `@layer` gates nothing here; every rule lands in the same one.
      const conditions = stack.filter((s) => s.startsWith("@") && !s.startsWith("@layer"))
      if (!selectors.length) continue
      const contexts = selectors.map(contextOf)
      if (contexts.some((c) => c === null)) continue
      rows.push({
        context: [...conditions, ...contexts].join(" "),
        property: line.slice(0, colon).trim(),
        value: line.slice(colon + 1).replace(/;$/, "").trim(),
      })
    }
    return rows
  }
}

/** What a rule targets, relative to the utility's own class. */
function subject(context: string): string {
  if (context === "&") return "self"
  const bare = context.replace(/@[a-z-]+\s*\([^)]*\)\s*/g, "").trim()
  // A bare element name is a descendant reached into: `.x svg` arrives as "svg".
  if (/^[a-z]+$/.test(bare)) return bare
  const parts = bare.split(/\s+(?![^(]*\))/)
  const tail = parts.length > 1 ? parts[parts.length - 1] : ""
  return tail + (bare.match(/::[a-z-]+/g) ?? []).join("") || "self"
}

/** Class-column specificity; these selectors carry no ids and no bare elements. */
function specificity(context: string): number {
  let rest = context === "&" ? "" : context
  rest = rest.replace(/@[a-z-]+\s*\([^)]*\)\s*/g, "").trim()
  let n = 1 // the utility's own class
  for (const inner of rest.matchAll(/:is\(([^)]*)\)/g))
    n += (inner[1].match(/\./g) ?? []).length
  rest = rest.replace(/:(is|where)\([^)]*\)/g, "")
  n += (rest.match(/\[[^\]]*\]/g) ?? []).length
  rest = rest.replace(/\[[^\]]*\]/g, "")
  rest = rest.replace(/::/g, " ") // pseudo-elements are not the class column
  n += (rest.match(/:[a-z-]+/g) ?? []).length
  n += (rest.match(/\./g) ?? []).length
  return n
}

/**
 * Every competing group in one element, as an ordered sequence. Repeats of a
 * declaration already present cannot change the answer, so only distinct ones
 * are kept.
 */
function groups(rows: Row[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const row of rows) {
    const key = [row.property, subject(row.context), specificity(row.context)].join(SEP)
    const list = out.get(key) ?? []
    const entry = `${row.context} -> ${row.value}`
    if (!list.includes(entry)) list.push(entry)
    out.set(key, list)
  }
  return out
}

/** All sequences a component can produce, one per element it can render as. */
function sequences(
  fingerprint: (classes: string[]) => Row[],
  source: string
): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const combination of combinations(source)) {
    for (const [key, list] of groups(fingerprint(combination))) {
      const set = out.get(key) ?? new Set<string>()
      set.add(list.join("  THEN  "))
      out.set(key, set)
    }
  }
  return out
}

const components = readdirSync(UI)
  .filter((f) => f.endsWith(".tsx"))
  .sort()

const newCss = readFileSync(join(ROOT, CSS), "utf8")
const oldCss = atRef(CSS)
if (oldCss === null) {
  console.error(`cannot read ${CSS} at ${ref}`)
  process.exit(2)
}

const fingerprintOld = await compiler(oldCss)
const fingerprintNew = await compiler(newCss)

let reordered = 0
let differed = 0
const skipped: string[] = []

for (const file of components) {
  const path = `src/renderer/src/components/ui/${file}`
  const oldSource = atRef(path)
  if (oldSource === null) {
    skipped.push(`${file} (not present at ${ref})`)
    continue
  }
  const newSource = readFileSync(join(UI, file), "utf8")

  const before = sequences(fingerprintOld, oldSource)
  const after = sequences(fingerprintNew, newSource)

  const notes: string[] = []
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const a = before.get(key) ?? new Set<string>()
    const b = after.get(key) ?? new Set<string>()
    const gone = [...a].filter((x) => !b.has(x))
    const added = [...b].filter((x) => !a.has(x))
    if (!gone.length && !added.length) continue

    const [property, subj, spec] = key.split(SEP)
    const where = `${property} (on ${subj}, specificity ${spec})`

    // Same declarations in a different order is a precedence change. Anything
    // else is a declaration that arrived or left.
    const sameDeclarations =
      gone.length === added.length &&
      gone.every((g) =>
        added.some((x) => x.split("  THEN  ").sort().join() === g.split("  THEN  ").sort().join())
      )
    if (sameDeclarations) {
      reordered += gone.length
      notes.push(
        `  REORDERED ${where}\n` +
          gone.map((g, i) => `    ${ref}:  ${g}\n    now:  ${added[i]}`).join("\n")
      )
    } else {
      // Within a group every declaration has the same specificity, so the last
      // one is the one that renders. If that is unchanged on both sides, what
      // moved was a declaration that never won anything — a base value the
      // variant already covered — and nothing looks different.
      const winner = (s: string) => s.split("  THEN  ").at(-1)
      const shadowOnly =
        gone.length > 0 &&
        added.length > 0 &&
        gone.every((g) => added.some((x) => winner(x) === winner(g)))
      const kind = shadowOnly
        ? "SHADOWED"
        : gone.length && added.length
          ? "CHANGED"
          : added.length
            ? "ADDED"
            : "REMOVED"
      notes.push(
        `  ${kind} ${where}` +
          (shadowOnly ? " — winner unchanged, a shadowed declaration went away" : "") +
          "\n" +
          [...gone.map((x) => `    - ${x}`), ...added.map((x) => `    + ${x}`)].join("\n")
      )
    }
  }

  if (notes.length) {
    differed++
    console.log(`\n${file}`)
    console.log(notes.join("\n"))
  }
}

console.log("")
for (const note of skipped) console.log(`skipped ${note}`)
console.log(
  `${components.length - skipped.length} component(s) compared against ${ref}: ` +
    `${differed} with differences, ${reordered} reordering(s).`
)
if (reordered)
  console.log(
    "\nA reordering means two declarations that compete for the same property,\n" +
      "on the same element, at the same specificity, swapped places. That is a\n" +
      "visual change. Decide it deliberately — do not assume it is a no-op."
  )
process.exit(reordered ? 1 : 0)
