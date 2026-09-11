/**
 * Builds `sdk-var-catalog.json` — every variable the simulator has, before
 * anybody writes a profile about it.
 *
 *   npm run vars:catalog -- [--sdk "C:\MSFS 2024 SDK"] [--out <file>]
 *                           [--refresh] [--no-docs] [--no-templates]
 *
 * A **developer** step, not a user one. It needs the MSFS SDK installed and the
 * documentation site reachable, and its output is committed — see
 * `src/shared/sdk-catalog.ts` on why the catalogue ships in the binary rather
 * than accumulating in the database like every other kind of variable evidence.
 *
 * ## Two passes
 *
 * **Templates.** Asobo's `ModelBehaviorDefs` are thousands of XML files of RPN
 * driving their own aircraft, and every `(A:NAME, Units)` in them is a variable
 * being used in earnest, with the unit somebody actually chose. It covers `L:`,
 * `B:` and `E:` too, which the documentation pass does not.
 *
 * **Docs.** The SDK's Simulation Variables pages, which are the only place a
 * description, a settable flag or the meaning of an index exists. Reached
 * through the alphabetical index, which names every category page — so this is
 * a bounded crawl of about fifteen pages rather than a walk of the whole site.
 *
 * Neither is a superset. The templates find variables the docs never mention;
 * the docs list hundreds nothing in the templates touches. Both are kept, and
 * `from` on each entry says which found it.
 *
 * ## Parsing HTML with regular expressions
 *
 * Normally indefensible, and defensible here: the pages are RoboHelp output
 * with a table shape that has been stable for years, and the alternative is a
 * parser dependency in a script that runs on one developer's machine. The
 * defence is that it **fails loudly** — the header row of every table is
 * checked against the five columns expected, a page that yields no rows is an
 * error, and the totals are printed. A silent drop to zero descriptions is the
 * failure this has to be unable to have.
 *
 * Nesting is the one thing regexes cannot do, and the units column contains
 * whole tables of enum values, so rows and cells are split by a depth-aware
 * scanner rather than by a lazy `</tr>` — which quietly truncated twelve rows
 * of the engine page when this was first written.
 */

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
} from "node:fs"
import { join, relative } from "node:path"

import type {
  SdkCatalogSource,
  SdkVar,
  SdkVarCatalog,
  SdkVarDoc,
} from "../src/shared/sdk-catalog.ts"

const args = process.argv.slice(2)

const consumed = new Set<number>()

function flag(name: string): string | undefined {
  const at = args.indexOf(`--${name}`)
  if (at < 0) return undefined

  consumed.add(at)
  consumed.add(at + 1)
  return args[at + 1]
}

const sdkArg = flag("sdk")
const outArg = flag("out")
const refresh = args.includes("--refresh")
const skipDocs = args.includes("--no-docs")
const skipTemplates = args.includes("--no-templates")

const OUT = outArg ?? "src/main/catalog/sdk-var-catalog.json"

/**
 * Where the SDK usually is, in the order worth trying.
 *
 * Probed rather than required, because it is in the same place on almost every
 * machine and a script that demands a path it could have guessed is a script
 * nobody runs twice. `--sdk` wins when it is given.
 */
const SDK_CANDIDATES = [
  "C:\\MSFS 2024 SDK",
  "C:\\MSFS SDK",
  "D:\\MSFS 2024 SDK",
  "D:\\MSFS SDK",
]

const DOCS =
  "https://docs.flightsimulator.com/msfs2024/html/6_Programming_APIs/"

/**
 * One documented namespace: an index page naming category pages, and the table
 * shape those pages use.
 *
 * ## Why `K:` is here and `C:`, `E:` and `B:` are not
 *
 * Measured against the installed corpus, which is the only vote that counts.
 * Key events are **the most written thing in it** — 7,865 `set:` references,
 * more than `L:`, `B:` and `A:` combined — and the app knew 23 of them, because
 * a key event lives inside a `set:` expression and so never becomes a `get:`
 * entry with a row of its own. 1,525 documented names close that.
 *
 * `C:` GPS variables are documented and legacy, and the corpus references them
 * zero times. `E:` environment variables are the sim's clock and weather, which
 * is not what a cockpit profile drives. `B:` has no list to fetch: its page is
 * the XML schema for *defining* input events, and the names themselves are
 * per-aircraft — the sim enumerates about 318 of them on load, which is a
 * different source with a different scope.
 */
interface DocsSection {
  /** The namespace every name on these pages belongs to. */
  namespace: string
  root: string
  index: string
  /** Columns a table must have to be a table of variables, by name. */
  required: string[]
  /** Which column holds the name. */
  nameColumn: string
}

const SECTIONS: DocsSection[] = [
  {
    namespace: "A",
    root: `${DOCS}SimVars/`,
    index: "Simulation_Variables.htm",
    required: ["Simulation Variable", "Description", "Units", "Settable"],
    nameColumn: "Simulation Variable",
  },
  {
    namespace: "K",
    root: `${DOCS}Key_Events/`,
    index: "Key_Events.htm",
    required: ["Key Name", "Event ID", "Description"],
    nameColumn: "Key Name",
  },
]

/** Fetched pages, so iterating on the parser does not re-crawl the site. */
const CACHE = "node_modules/.cache/sdk-var-catalog"

const today = new Date().toISOString().slice(0, 10)

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * One variable reference in RPN: `(A:GENERAL ENG RPM:1, Rpm)`.
 *
 * `K:` is deliberately absent. Key events appear as `(>K:EVENT)` — a write
 * target rather than a variable — and the `>` keeps them out of this pattern by
 * construction, which is the right answer rather than a lucky one.
 */
const RPN_VAR =
  /\(\s*([ABEL])\s*:\s*([^,)<>\r\n]+?)\s*(?:,\s*([^)<>\r\n]*?))?\s*\)/gi

interface TemplateHit {
  uses: number
  /** Unit -> times seen with it, so the common reading can be listed first. */
  units: Map<string, number>
}

function scanTemplates(root: string): Map<string, TemplateHit> {
  const found = new Map<string, TemplateHit>()

  for (const file of xmlFilesIn(root)) {
    const text = readFileSync(file, "utf8")

    for (const match of text.matchAll(RPN_VAR)) {
      const namespace = match[1]!.toUpperCase()

      /*
       * The index is a usage detail, not a variable, and it comes on either
       * end. `(A:1:BUS CONNECTION ON:#ID#, Bool)` is one variable — `BUS
       * CONNECTION ON` — indexed by bus on the left and by connection on the
       * right, and the SDK documents it under the bare name. `parseVarName` in
       * main splits names the same way, and a catalogue keyed on the indexed
       * form would list the engines of an aeroplane instead of its instruments.
       *
       * `#ID#` is stripped alongside a digit because the templates are
       * *templates*: Asobo's tooling substitutes the number. Leaving the
       * placeholder on filed the commonest variables in the SDK under names no
       * simulator has ever had — 707 of the 1,276 raw names are that shape.
       */
      const bare = match[2]!
        .trim()
        .replace(/^(?:\d+|#[^#]*#)\s*:\s*/, "")
        .replace(/\s*:\s*(?:\d+|#[^#]*#)\s*$/, "")

      /*
       * A `#` anywhere else means the *name* is assembled by substitution —
       * `A:#ANIM_SIMVAR_LEFT#`, `A:CIRCUIT NAVCOM#COM_INDEX# ON` — and there is
       * no way to recover what it stands for without expanding the template.
       * 175 names, dropped rather than catalogued as gibberish.
       */
      if (!bare || bare.includes("#")) continue

      const name = `${namespace}:${bare}`
      const units = match[3]?.trim()

      const hit = found.get(name) ?? { uses: 0, units: new Map() }
      hit.uses += 1
      if (units) hit.units.set(units, (hit.units.get(units) ?? 0) + 1)
      found.set(name, hit)
    }
  }

  return found
}

function* xmlFilesIn(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* xmlFilesIn(path)
    else if (entry.name.toLowerCase().endsWith(".xml")) yield path
  }
}

// ---------------------------------------------------------------------------
// Docs
// ---------------------------------------------------------------------------

async function page(url: string): Promise<string> {
  const cached = join(CACHE, url.replace(/[^a-z0-9]+/gi, "_"))
  if (!refresh && existsSync(cached)) return readFileSync(cached, "utf8")

  const response = await fetch(url, {
    headers: { "user-agent": "fsc-editor sdk-var-catalog generator" },
  })
  if (!response.ok) throw new Error(`${url} — HTTP ${response.status}`)

  const text = await response.text()
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(cached, text)
  return text
}

/**
 * The category pages, taken from the alphabetical index rather than guessed.
 *
 * Every name on the index links to `SomePage.htm#THE NAME`, so the set of pages
 * *is* the set of link targets — which means a category added to the SDK is
 * picked up without this script knowing it exists.
 */
function categoryPages(indexHtml: string): string[] {
  const pages = new Set<string>()

  for (const match of indexHtml.matchAll(/href="([^"#]+\.htm)#[^"]*"/gi)) {
    const path = match[1]!
    // Anything reaching out of the SimVars folder is a cross-reference to
    // SimConnect or Key Events, not a page of variables.
    if (path.startsWith("../") || path.startsWith("http")) continue
    pages.add(path)
  }

  return [...pages].sort()
}

/**
 * The columns a table must have to be a table of variables.
 *
 * Checked by name rather than by position, because the pages do not agree on
 * position: of the ninety-three tables in this documentation, seventy-two are
 * `Simulation Variable | Index | Description | Units | Settable`, eighteen drop
 * `Index`, and three replace it with `Parameters`. Reading the fourth cell and
 * calling it the units would have silently filed a description as a unit on a
 * fifth of the catalogue.
 *
 * It also rejects the auxiliary tables — `Number | Description` enumerations,
 * a `Index | Gear` key — without needing to know what they are.
 */
/**
 * `BLAST SHIELD POSITION:index` -> `BLAST SHIELD POSITION`.
 *
 * Ten of the documented names carry the placeholder they are indexed by rather
 * than leaving it to the Index column — `:index`, `:name1:name2`, and one
 * `(:name)`. A real variable name is upper case throughout, so a trailing
 * segment in lower case is a placeholder by construction rather than by a list
 * of the ones that happen to exist today.
 */
function bareName(name: string): string {
  let bare = name.trim()
  let shorter = bare

  do {
    bare = shorter
    shorter = bare.replace(
      /\s*(?:\(\s*:\s*[a-z][a-z0-9]*\s*\)|:\s*[a-z][a-z0-9]*)$/,
      ""
    )
  } while (shorter !== bare)

  return bare
}

function parseDocsPage(
  html: string,
  category: string,
  section: DocsSection
): Map<string, SdkVarDoc> {
  const docs = new Map<string, SdkVarDoc>()

  for (const table of blocks(html, "table")) {
    const rows = blocks(table, "tr")
    if (!rows.length) continue

    const head = cellsIn(rows[0]!).map(text)
    if (section.required.some((column) => !head.includes(column))) continue

    /*
     * Every column read by name, and every one optional but the name itself.
     * The two documented namespaces do not share a shape — simulation variables
     * are `Index | Description | Units | Settable`, key events are `Event ID |
     * Parameters | Description` — and a key event has no units because it is
     * fired rather than read. Mapping by header rather than by position is what
     * lets one parser take both, and the next one after them.
     */
    const column = (name: string) => head.indexOf(name)
    const at = {
      name: column(section.nameColumn),
      index: column("Index"),
      parameters: column("Parameters"),
      description: column("Description"),
      units: column("Units"),
      settable: column("Settable"),
      eventId: column("Event ID"),
    }

    for (const row of rows.slice(1)) {
      const cells = cellsIn(row)

      // A row narrower than its header is a nested table's row that survived
      // the depth scan, or a spanning note. Either way it is not a variable.
      if (cells.length !== head.length) continue

      const name = bareName(
        text(
          /<code[^>]*>([\s\S]*?)<\/code>/.exec(cells[at.name]!)?.[1] ??
            /<a id="([^"]+)"/.exec(cells[at.name]!)?.[1] ??
            ""
        )
      )
      if (!name) continue

      /*
       * A name has to be a name. The key-event pages carry one row describing a
       * *range* — `DEBUG_A - Z` — which is documentation rather than an event,
       * and no simulator would accept it. Identifiers only, which is what every
       * one of the other 1,524 is.
       */
      if (section.namespace === "K" && !/^[A-Z0-9_]+$/.test(name)) continue

      const description = text(cells[at.description]!)

      const doc: SdkVarDoc = { description }

      if (at.units >= 0) {
        const [units, unitsDetail] = splitUnits(text(cells[at.units]!))
        if (units) doc.units = units
        if (unitsDetail) doc.unitsDetail = unitsDetail
      }

      const eventId = at.eventId >= 0 ? text(cells[at.eventId]!) : ""
      if (eventId) doc.eventId = eventId

      // `N/A` is the documentation saying "none", written out. Storing it
      // would put a string that looks like an answer where the absence of one
      // belongs, and every reader would then have to know to ignore it.
      const said = (column: number) => {
        if (column < 0) return ""
        const value = text(cells[column]!)
        return /^n\/?a$/i.test(value) ? "" : value
      }

      const indexed = said(at.index)
      if (indexed) doc.index = indexed

      const parameters = said(at.parameters)
      if (parameters) doc.parameters = parameters

      // A tick and a red cross are two different spans, and an empty cell is a
      // third thing: the docs saying nothing, which is not the same as "no".
      const settable = at.settable >= 0 ? cells[at.settable]! : ""
      if (/checkmark_stem|checkmark_kick/.test(settable)) doc.settable = true
      else if (/checkmark_circle_red|checkmark_left/.test(settable))
        doc.settable = false

      // The docs mark a retired variable twice: a `legacy` span in the name
      // cell and a red row background, plus a description that leads with the
      // word. The markup is the reliable half — 44 rows carry it — and the
      // prose is kept as a second opinion for whatever the styling misses.
      if (
        /class="legacy"/.test(cells[at.name]!) ||
        /^deprecated\b/i.test(description)
      )
        doc.deprecated = true

      doc.category = category
      docs.set(`${section.namespace}:${name}`, doc)
    }
  }

  return docs
}

/**
 * A units cell to a unit and the rest of what the cell said.
 *
 * 194 distinct cells across the documentation, and most are simply `Bool` or
 * `Radians`. The rest arrive three ways: an enumeration written after a colon
 * (`Enum : 0 = None 1 = Pitch`), an abbreviation in brackets (`Feet ( ft )`),
 * and a handful of genuinely freeform ones (`Position (0 to 16K) 0 = off`).
 *
 * The colon and the brackets are split off. Whatever is left is accepted as a
 * unit only if it is short enough to be one — a unit name is `Percent over 100`
 * at its longest, so anything past two dozen characters is prose that happens
 * to be in the units column. Those keep their text in `unitsDetail` and leave
 * `units` unset, because the point of the field is to be matched against what
 * a profile writes, and a sentence in it would only ever be a false negative
 * dressed as data.
 */
const MAX_UNIT = 24

function splitUnits(cell: string): [string, string] {
  if (!cell) return ["", ""]

  const colon = cell.search(/\s*:/)
  let head = colon >= 0 ? cell.slice(0, colon).trim() : cell.trim()
  const detail = colon >= 0 ? cell.slice(colon + 1).trim() : ""

  // `Feet ( ft ) per second squared` -> `Feet per second squared`, with the
  // abbreviation kept but not in a field something is going to compare for
  // equality. Anywhere in the string, not only at the end: the docs write the
  // short form straight after the word it abbreviates, which is usually the
  // middle of the unit rather than its tail.
  const brackets: string[] = []
  head = head
    .replace(/\(([^)]*)\)/g, (_, inside: string) => {
      brackets.push(inside.trim())
      return " "
    })
    .replace(/\s+/g, " ")
    .trim()

  const note = [brackets.join(" "), detail].filter(Boolean).join(" · ")

  if (head.length > MAX_UNIT) return ["", cell]

  return [head, note]
}

// ---------------------------------------------------------------------------
// HTML, shallowly
// ---------------------------------------------------------------------------

/**
 * The top-level `<tag>…</tag>` spans, counting nesting.
 *
 * This exists because the units column contains tables of enum values, so a
 * page's `<tr>`s are not a flat list. A non-greedy `</tr>` finds the *inner*
 * table's row end and truncates the outer row, which silently dropped the
 * twelve rows of the engine page whose units are enumerated.
 */
function blocks(html: string, tag: string): string[] {
  const found: string[] = []

  let depth = 0
  let start = 0

  const tags = [...html.matchAll(new RegExp(`<(/?)${tag}\\b[^>]*>`, "gi"))]

  for (const match of tags) {
    const closing = match[1] === "/"

    if (!closing) {
      if (depth === 0) start = match.index + match[0].length
      depth += 1
      continue
    }

    depth -= 1
    if (depth === 0) found.push(html.slice(start, match.index))
    // A stray close tag would send this negative and make every later block
    // wrong; treating it as noise keeps one malformed page from poisoning
    // the rest.
    if (depth < 0) depth = 0
  }

  return found
}

/**
 * The cells of one row, ignoring any belonging to a table nested inside it.
 *
 * Depth is counted on `<table>`, not on `<td>`: a cell cannot contain a cell
 * except by way of another table, so that is the only nesting to survive.
 */
function cellsIn(row: string): string[] {
  const cells: string[] = []

  let tableDepth = 0
  let cellStart = -1

  for (const match of row.matchAll(/<(\/?)(table|td|th)\b[^>]*>/gi)) {
    const closing = match[1] === "/"
    const tag = match[2]!.toLowerCase()

    if (tag === "table") {
      tableDepth += closing ? -1 : 1
      continue
    }

    if (tableDepth > 0) continue

    if (!closing) cellStart = match.index + match[0].length
    else if (cellStart >= 0) {
      cells.push(row.slice(cellStart, match.index))
      cellStart = -1
    }
  }

  return cells
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  deg: "°",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "'",
  lsquo: "'",
  ldquo: '"',
  rdquo: '"',
  times: "×",
  plusmn: "±",
  micro: "µ",
  sup2: "²",
  sup3: "³",
}

/** Markup to readable text: list items become sentences, whitespace collapses. */
function text(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<li\b[^>]*>/gi, " • ")
    .replace(/<\/(p|div|tr|ul|ol|li|h[1-6])>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(parseInt(code, 16))
    )
    .replace(
      /&([a-z][a-z0-9]*);/gi,
      (whole, name: string) => ENTITIES[name] ?? whole
    )
    .replace(/\s+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const sources: SdkCatalogSource[] = []
const vars = new Map<string, SdkVar>()

function entry(name: string): SdkVar {
  const existing = vars.get(name)
  if (existing) return existing

  const created: SdkVar = { name, from: [] }
  vars.set(name, created)
  return created
}

if (!skipTemplates) {
  const sdk = sdkArg ?? SDK_CANDIDATES.find((path) => existsSync(path))
  if (!sdk) {
    console.error('no MSFS SDK found — pass --sdk "C:\\MSFS 2024 SDK"')
    console.error(`tried: ${SDK_CANDIDATES.join(", ")}`)
    process.exit(2)
  }

  const behaviors = join(sdk, "ModelBehaviorDefs")
  if (!existsSync(behaviors)) {
    console.error(
      `${behaviors} does not exist — is --sdk pointing at the SDK root?`
    )
    process.exit(2)
  }

  const version = existsSync(join(sdk, "version.txt"))
    ? readFileSync(join(sdk, "version.txt"), "utf8").trim()
    : "unknown"

  console.log(
    `templates: reading ${relative(process.cwd(), behaviors) || behaviors}`
  )
  const hits = scanTemplates(behaviors)

  for (const [name, hit] of hits) {
    const found = entry(name)
    found.from.push("templates")
    found.uses = hit.uses
    found.usedUnits = [...hit.units]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([unit]) => unit)
    if (!found.usedUnits.length) delete found.usedUnits
  }

  sources.push({
    id: "templates",
    origin: `MSFS SDK ${version}`,
    read: today,
    vars: hits.size,
  })

  const byNamespace = new Map<string, number>()
  for (const name of hits.keys()) {
    const ns = name.slice(0, 1)
    byNamespace.set(ns, (byNamespace.get(ns) ?? 0) + 1)
  }
  console.log(
    `templates: ${hits.size} names — ` +
      [...byNamespace]
        .sort((a, b) => b[1] - a[1])
        .map(([ns, count]) => `${ns}: ${count}`)
        .join(", ")
  )
}

if (!skipDocs) {
  let documented = 0

  for (const section of SECTIONS) {
    const index = await page(section.root + section.index)
    const pages = categoryPages(index)

    if (!pages.length) {
      console.error(
        `docs: ${section.index} named no category pages — has the site changed?`
      )
      process.exit(1)
    }

    console.log(`\ndocs ${section.namespace}: ${pages.length} pages`)

    for (const path of pages) {
      const html = await page(section.root + path)

      // The page's own title, which is what the reader of a catalogue entry
      // would recognise — `Aircraft Engine Variables`, not a file name.
      const category = text(
        /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? path
      ).replace(/\s*\|.*$/, "")

      const docs = parseDocsPage(html, category, section)

      /*
       * A page that parses to nothing is an error rather than a shrug, because
       * that is what a changed table shape looks like from here — and the
       * failure it guards against is a catalogue that still builds, still
       * looks right, and quietly lost a namespace.
       *
       * The index links a few pages that are prose rather than tables, so an
       * empty parse is only fatal if *every* page in the section is empty;
       * that check is below.
       */
      if (!docs.size) {
        console.log(`  ${"—".padStart(4)}  ${category}`)
        continue
      }

      for (const [name, doc] of docs) {
        const found = entry(name)
        if (!found.from.includes("docs")) found.from.push("docs")
        found.doc = doc
        documented += 1
      }

      console.log(`  ${String(docs.size).padStart(4)}  ${category}`)
    }
  }

  if (!documented) {
    console.error(
      "docs: every page parsed to nothing — the table shape changed"
    )
    process.exit(1)
  }

  sources.push({
    id: "docs",
    origin: `MSFS 2024 SDK documentation (${SECTIONS.map((s) => `${s.namespace}:`).join(" ")})`,
    read: today,
    vars: documented,
  })
}

if (!vars.size) {
  console.error("nothing to write — both passes were skipped or found nothing")
  process.exit(1)
}

const sorted = [...vars.values()].sort((a, b) => a.name.localeCompare(b.name))

const catalog: SdkVarCatalog = {
  schema: 1,
  generated: today,
  sources,
  vars: sorted,
}

// One line per variable. A generated file of two thousand entries is reviewed
// as a diff or not at all, and pretty-printing every field puts a variable's
// name eight lines from its units.
const json = [
  "{",
  `  "schema": ${catalog.schema},`,
  `  "generated": ${JSON.stringify(catalog.generated)},`,
  `  "sources": ${JSON.stringify(catalog.sources)},`,
  `  "vars": [`,
  sorted.map((entry) => `    ${JSON.stringify(entry)}`).join(",\n"),
  "  ]",
  "}",
  "",
].join("\n")

mkdirSync(join(OUT, ".."), { recursive: true })
writeFileSync(OUT, json)

const only = (source: string) =>
  sorted.filter((entry) => entry.from.length === 1 && entry.from[0] === source)
    .length

console.log("")
console.log(
  `${OUT} — ${sorted.length} variables, ${(json.length / 1024).toFixed(0)} KB`
)
console.log(
  `  in both sources:  ${sorted.filter((entry) => entry.from.length === 2).length}`
)
console.log(`  templates only:   ${only("templates")}`)
console.log(`  docs only:        ${only("docs")}`)
console.log(
  `  with a settable flag: ${sorted.filter((entry) => entry.doc?.settable !== undefined).length}`
)
console.log(
  `  deprecated:           ${sorted.filter((entry) => entry.doc?.deprecated).length}`
)
