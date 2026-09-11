import * as monaco from "monaco-editor"

import {
  BLOCKS,
  blocksIn,
  expectedIndent,
  CONTINUATION_INDENT,
  CONTINUATION_KEYS,
  ENTRY_INDENT,
  ENTRY_KEY,
  isEntryBlock,
  initialState,
  type Line,
  plainValue,
  renderHeading,
  splitPrefix,
  scanLines,
  type ScanState,
  slotAt,
  expressionAt,
  injectedGlobals,
  offsetIn,
} from "@shared/profile"

import { javaScriptCompletions, resolveJavaScript } from "./js-bridge"
import type { ProfileFile, VarEntry, VarIndex } from "@shared/types"
import { UNITS, canonicalUnit } from "@shared/units"
import { collectRefs, documentedParams } from "@shared/lang"
import { parseVar } from "@shared/vars"
import { kEventSnippet, writeOffer } from "./set-completions"
import { BLOCK_DOCS, ENTRY_KEY_DOCS, type EntryDocKey } from "./key-docs"
import { setTemplates } from "./set-templates"
import { setVarIndexStore } from "./var-index-store"

/**
 * Completions sourced from the profiles already installed next to FS Copilot.
 * Every suggestion carries its provenance — which profiles use the variable and
 * how they write it — because knowing that six aircraft drive a variable
 * through the same `set:` expression is the actual answer most of the time.
 */

let index: VarIndex | null = null
let profileFiles: ProfileFile[] = []

/**
 * Names written to by `set:` expressions in the corpus, and how often.
 *
 * These are not the same population as the `get:` variables. Plenty of events
 * are only ever written — `K:2:ELECTRICAL_BUS_TO_CIRCUIT_CONNECTION_TOGGLE`
 * appears in a dozen profiles and is nobody's `get:` — so a write target
 * completed only from the variable index would be missing exactly the names
 * that are hardest to remember.
 */
const writeTargets = new Map<string, number>()

/** How many corpus entries write this exact name. Hover cites it too. */
export function writeTargetCount(name: string): number {
  return writeTargets.get(name) ?? 0
}

export function setVarIndex(next: VarIndex | null): void {
  index = next
  setVarIndexStore(next)

  writeTargets.clear()
  for (const entry of next?.entries ?? [])
    for (const sample of entry.corpus?.samples ?? []) {
      if (!sample.set) continue

      // The language core, not a regex: `collectRefs` descends into the
      // string and hole interiors where JS setters keep their references,
      // and knows a write from a read — a grouped `(value)` never counted.
      for (const found of collectRefs(sample.set)) {
        if (found.access !== "write") continue
        const target = found.ref.full.trim()
        if (target)
          writeTargets.set(target, (writeTargets.get(target) ?? 0) + 1)
      }
    }
}

export function setProfileFiles(next: ProfileFile[]): void {
  profileFiles = next
}

/**
 * The document, classified, reused across the keystrokes of one edit.
 *
 * Every completion needs the block and block-scalar state the caret sits in,
 * which is a whole-file question. Scanning is one regex pass per line and the
 * files are small, but Monaco asks on every keystroke, so the result is held
 * until the model actually changes.
 */
const scanned = new WeakMap<
  monaco.editor.ITextModel,
  { version: number; lines: Line[] }
>()

export function linesOf(model: monaco.editor.ITextModel): Line[] {
  const version = model.getVersionId()
  const cached = scanned.get(model)
  if (cached?.version === version) return cached.lines

  const lines = scanLines(model.getValue())
  scanned.set(model, { version, lines })
  return lines
}

/** The state before a line: which block it is in, whether it is in a scalar. */
function contextAt(
  model: monaco.editor.ITextModel,
  lineNumber: number
): ScanState {
  return linesOf(model)[lineNumber - 1]?.context ?? initialState()
}

function rangeFor(
  position: monaco.Position,
  prefixLength: number,
  typedLength: number
): monaco.IRange {
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: prefixLength + 1,
    endColumn: prefixLength + typedLength + 1,
  }
}

/** How the corpus splits this variable across the two blocks. */
function blockSummary(entry: VarEntry): string {
  const parts: string[] = []
  if (entry.corpus?.sharedCount)
    parts.push(`shared ×${entry.corpus.sharedCount}`)
  if (entry.corpus?.masterCount)
    parts.push(`master ×${entry.corpus.masterCount}`)
  return parts.join(" · ")
}

/**
 * The unit to write when a completion carries one.
 *
 * The commonest reading in the corpus, falling back to what the SDK documents.
 * Units left a variable's identity when the index stopped being one row per
 * `name|units` pair, so there is a list where there used to be a single value —
 * and for the thousands of names no profile has ever read, the documented unit
 * is the only one there has ever been.
 */
function unitFor(entry: VarEntry): string | undefined {
  return entry.corpus?.units[0] ?? entry.sdk?.doc?.units
}

export function documentation(entry: VarEntry): monaco.IMarkdownString {
  const lines: string[] = []

  /*
   * The SDK's own words first, where there are any.
   *
   * A comment somebody left in a profile is the better documentation when it
   * exists — it is about this variable in this aeroplane — but it exists for a
   * small minority, and the catalogue now supplies a description for 3,235
   * names that previously had nothing to say for themselves.
   */
  const described = entry.corpus?.doc ?? entry.sdk?.doc?.description
  if (described) lines.push(described, "")

  if (entry.sdk?.doc?.parameters)
    lines.push(`Parameters: \`${entry.sdk.doc.parameters}\``, "")
  if (entry.sdk?.doc?.index) lines.push(`Index: ${entry.sdk.doc.index}`, "")
  if (entry.sdk?.doc?.deprecated) lines.push("**Deprecated.**", "")

  const corpus = entry.corpus
  if (corpus) {
    const profiles = corpus.fileCount === 1 ? "profile" : "profiles"
    lines.push(
      `Used in ${corpus.fileCount} ${profiles} — ${blockSummary(entry)}`
    )
  } else if (entry.sdk?.doc?.category) {
    lines.push(`_${entry.sdk.doc.category}_`)
  }

  if (!corpus) return { value: lines.join("\n") }

  // Only profiles that adopted the section convention have one of these.
  const headings = [
    ...new Set(corpus.samples.map((sample) => sample.heading).filter(Boolean)),
  ]
  if (headings.length) lines.push("", `Under ${headings.join(", ")}`)

  const withSet = corpus.samples.filter((sample) => sample.set)
  if (withSet.length) {
    lines.push("", "**Written as**", "```yaml")
    for (const sample of withSet) {
      const unit = unitFor(entry)
      lines.push(`- get: ${entry.name}${unit ? `, ${unit}` : ""}`)

      if (sample.scalar)
        lines.push(
          "  set: >",
          ...(sample.set ?? "").split("\n").map((line) => `    ${line}`)
        )
      else lines.push(`  set: ${sample.set}`)

      if (sample.skp) lines.push(`  skp: ${sample.skp}`)
    }
    lines.push("```")
  }

  if (corpus.files.length) {
    lines.push("", `_${corpus.files.slice(0, 6).join(", ")}_`)
  }

  return { value: lines.join("\n") }
}

function variableSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  prefix: string,
  typed: string,
  /** `skp:` takes a bare name; `get:` carries the units with it. */
  withUnits: boolean
): monaco.languages.CompletionList {
  const entries = index?.entries ?? []
  const insert = rangeFor(position, prefix.length, typed.length)

  // A suggestion brings its own units, so accepting one over `A:OLD, Bool`
  // has to take the existing units with it. Replacing only up to the caret
  // leaves them behind and scrambles the line into `A:NEW, Number, Bool`.
  const replace = { ...insert, endColumn: valueEndColumn(model, position) }

  return {
    // The list is long and Monaco filters it as you type, so hand it over whole
    // rather than re-filtering on every keystroke.
    suggestions: entries.map((entry, order) => {
      const unit = unitFor(entry)

      return {
        label: {
          label: entry.name,
          description: unit || undefined,
          // A name with no corpus usage is not a name with zero usage: it is one
          // the SDK knows and this workspace has never written. Saying "0
          // profiles" would read as a verdict on it.
          detail: entry.corpus
            ? `  ${entry.corpus.fileCount} profiles`
            : entry.sdk?.doc?.category
              ? `  ${entry.sdk.doc.category}`
              : "  in sim",
        },
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: withUnits && unit ? `${entry.name}, ${unit}` : entry.name,
        filterText: entry.name,
        // Frequency order, zero-padded so it sorts lexically.
        sortText: String(order).padStart(6, "0"),
        documentation: documentation(entry),
        range: { insert, replace },
      }
    }),
  }
}

/**
 * Names for an open `(>` … target.
 *
 * Two sources, ranked with the proven write targets first: what the corpus
 * actually writes to, then every `get:` variable, since anything readable can
 * generally be written. The namespace is part of the typed text, so `(>K:` is
 * already filtering to `K:` names by the time Monaco scores the list.
 */
function writeTargetSuggestions(
  position: monaco.Position,
  prefix: string,
  typed: string
): monaco.languages.CompletionList {
  const range = rangeFor(position, prefix.length, typed.length)
  const suggestions: monaco.languages.CompletionItem[] = []
  const seen = new Set<string>()

  /*
   * A full-shape snippet replaces from the `(` — the operands go *before*
   * the paren the user already typed, so the range must reach back over it.
   * `prefix` ends just past `(>`; the paren is its last `(` by construction
   * of the slot.
   */
  const paren = prefix.lastIndexOf("(")
  const snippetRange: monaco.IRange | null =
    paren === -1
      ? null
      : {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: paren + 1,
          endColumn: prefix.length + typed.length + 1,
        }

  /*
   * The catalogue's parameter docs, keyed by bare event name, so a corpus
   * item can be *upgraded*: the corpus knows `K:2:KOHLSMAN_SET` is popular,
   * the catalogue knows what its two operands mean, and the item that ships
   * is both — evidence-ranked, inserting the whole calling shape. Without
   * this join the two sources compete and dedupe silently drops whichever
   * came second, which on the first live test was the snippet.
   */
  const kParameters = new Map<string, string>()
  for (const entry of index?.entries ?? []) {
    const parameters = entry.sdk?.doc?.parameters
    if (!parameters || !entry.name.startsWith("K:")) continue
    if (documentedParams(parameters) < 2) continue
    kParameters.set(entry.name.slice(2), parameters)
  }

  const ranked = [...writeTargets].sort((a, b) => b[1] - a[1])

  for (const [name, count] of ranked) {
    seen.add(name)

    const parsed = parseVar(name)
    const parameters =
      parsed.ns === "K" ? kParameters.get(parsed.name) : undefined

    if (parameters && snippetRange) {
      const insert = `K:${documentedParams(parameters)}:${parsed.name}`
      if (seen.has(insert)) continue
      seen.add(insert)

      suggestions.push({
        label: insert,
        kind: monaco.languages.CompletionItemKind.Event,
        insertText: kEventSnippet(parsed.name, parameters),
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail: `written by ${count} ${count === 1 ? "entry" : "entries"} — operands: ${parameters.trim()}`,
        filterText: prefix.slice(paren) + name,
        sortText: `0${String(suggestions.length).padStart(5, "0")}`,
        range: snippetRange,
      })
      continue
    }

    suggestions.push({
      label: name,
      kind: monaco.languages.CompletionItemKind.Event,
      insertText: name,
      detail: `written by ${count} ${count === 1 ? "entry" : "entries"}`,
      sortText: `0${String(suggestions.length).padStart(5, "0")}`,
      range,
    })
  }

  // What the aircraft has actually enumerated, so an offer can check a name
  // it is about to invent — the `B:` `_Set` case.
  const known = new Set((index?.entries ?? []).map((entry) => entry.name))

  for (const entry of index?.entries ?? []) {
    if (seen.has(entry.name)) continue
    seen.add(entry.name)

    // The descriptor table and catalogue decide whether this name belongs
    // in write position at all, and as what text — see set-completions.ts.
    const offer = writeOffer(entry, (name) => known.has(name))
    if (offer === null) continue
    if (seen.has(offer.insert)) continue
    seen.add(offer.insert)

    const detail =
      offer.note ??
      (entry.corpus
        ? `read by ${entry.corpus.fileCount} profiles`
        : (entry.sdk?.doc?.description ?? "in sim"))

    if (offer.snippet && snippetRange) {
      // The whole calling shape: `${1:index} ${2:value} (>K:2:EVENT` — the
      // editor making sure the `:2` and its operands cannot be missed.
      suggestions.push({
        label: offer.insert,
        kind: monaco.languages.CompletionItemKind.Event,
        insertText: offer.snippet,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        detail,
        documentation: documentation(entry),
        // Monaco filters on the text the range covers, and this range
        // reaches back over the `(>` — so the filter text must too.
        filterText: prefix.slice(paren) + entry.name,
        sortText: `1${String(suggestions.length).padStart(5, "0")}`,
        range: snippetRange,
      })
      continue
    }

    suggestions.push({
      label: offer.insert,
      kind: monaco.languages.CompletionItemKind.Variable,
      insertText: offer.insert,
      detail,
      documentation: documentation(entry),
      filterText: entry.name,
      sortText: `1${String(suggestions.length).padStart(5, "0")}`,
      range,
    })
  }

  return { suggestions }
}

/**
 * The column a value ends at — end of line, or where a trailing comment
 * starts, which belongs to the author rather than to the value.
 */
function valueEndColumn(
  model: monaco.editor.ITextModel,
  position: monaco.Position
): number {
  const text = model.getLineContent(position.lineNumber)
  const comment = /\s#/.exec(text)
  const end = comment
    ? comment.index + 1
    : model.getLineMaxColumn(position.lineNumber)

  return Math.max(end, position.column)
}

/**
 * Units for the part after the comma. SimConnect matches these
 * case-insensitively, so the list exists to keep a profile internally
 * consistent rather than to make it work.
 */
function unitSuggestions(
  position: monaco.Position,
  prefix: string,
  typed: string
): monaco.languages.CompletionList {
  const range = rangeFor(position, prefix.length, typed.length)
  const suggested = canonicalUnit(typed)

  // How often each unit appears in the corpus, so the common ones sort first.
  const frequency = new Map<string, number>()
  for (const entry of index?.entries ?? [])
    for (const unit of entry.corpus?.units ?? [])
      frequency.set(
        unit,
        (frequency.get(unit) ?? 0) + (entry.corpus?.count ?? 0)
      )

  const ranked = [...UNITS].sort(
    (a, b) => (frequency.get(b) ?? 0) - (frequency.get(a) ?? 0)
  )

  return {
    suggestions: ranked.map((unit, order) => ({
      label: unit,
      kind: monaco.languages.CompletionItemKind.Unit,
      insertText: unit,
      detail:
        suggested === unit && typed.trim() && typed.trim() !== unit
          ? `canonical spelling of "${typed.trim()}"`
          : frequency.get(unit)
            ? `${frequency.get(unit)} uses`
            : undefined,
      sortText: `${suggested === unit ? "0" : "1"}${String(order).padStart(3, "0")}`,
      range,
    })),
  }
}

/**
 * The keys the entry around a line already has.
 *
 * An entry is one mapping, so each key may appear once — a second `set:` is a
 * duplicate key, which YAML rejects and FS Copilot silently resolves by taking
 * the last one. Offering a key that is already there is offering a bug.
 */
function keysInEntry(lines: Line[], lineNumber: number): Set<string> {
  const keys = new Set<string>()

  // Up to the start of this entry, which carries a key of its own.
  for (let index = lineNumber - 2; index >= 0; index--) {
    const line = lines[index]
    if (line.kind === "blockKey") break
    if (line.kind === "continuation") keys.add(line.key)
    if (line.kind === "entry") {
      keys.add(line.key)
      break
    }
  }

  // Down to the next entry, since a key can already exist below the caret.
  for (let index = lineNumber; index < lines.length; index++) {
    const line = lines[index]
    if (line.kind === "blockKey" || line.kind === "entry") break
    if (line.kind === "continuation") keys.add(line.key)
  }

  return keys
}

/** Looks upwards for the `get:` this `set:` belongs to. */
function variableAbove(lines: Line[], lineNumber: number): string | null {
  for (let index = lineNumber - 2; index >= 0; index--) {
    const line = lines[index]
    if (line.kind === "blockKey") break

    if (line.kind === "entry")
      return line.key === ENTRY_KEY
        ? plainValue(line.value).split(",")[0].trim()
        : null
  }

  return null
}

/**
 * The shapes a `set:` value can take, rendered from the headless table in
 * `set-templates.ts` — which is where they are decided and tested. The
 * kind FS Copilot will assign each one rides in the detail column, so the
 * menu teaches the vocabulary as it completes.
 */
function setTemplateItems(
  position: monaco.Position,
  prefix: string,
  typed: string,
  variable: string | null
): monaco.languages.CompletionItem[] {
  const range = rangeFor(position, prefix.length, typed.length)
  const event = variable ? splitPrefix(variable).rest : "EVENT"

  return setTemplates(event).map((template, order) => ({
    label: template.label,
    detail: template.kind,
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertText: template.insertText,
    insertTextRules:
      monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    documentation: { value: template.documentation },
    sortText: `1${String(order).padStart(2, "0")}`,
    range,
  }))
}

function setSuggestions(
  lines: Line[],
  position: monaco.Position,
  prefix: string,
  typed: string
): monaco.languages.CompletionList {
  const name = variableAbove(lines, position.lineNumber)
  const range = rangeFor(position, prefix.length, typed.length)

  const seen = new Set<string>()
  const suggestions: monaco.languages.CompletionItem[] = []

  // What other profiles actually write for this variable comes first.
  for (const entry of (index?.entries ?? []).filter((e) => e.name === name))
    for (const sample of entry.corpus?.samples ?? []) {
      if (!sample.set || seen.has(sample.set)) continue
      seen.add(sample.set)

      // Indentation is relative: Monaco prepends the current line's indent to
      // every line after the first, so the body needs only its offset from the
      // key it hangs under.
      const body = sample.set.split("\n")
      const insertText = sample.scalar
        ? [">", ...body.map((line) => `  ${line}`)].join("\n")
        : sample.set

      suggestions.push({
        label: sample.scalar ? `> ${body[0]} …` : sample.set,
        kind: monaco.languages.CompletionItemKind.Value,
        insertText,
        insertTextRules: sample.scalar
          ? monaco.languages.CompletionItemInsertTextRule.KeepWhitespace
          : undefined,
        detail: sample.file,
        documentation: {
          value: `How \`${name}\` is written in \`${sample.file}\`.`,
        },
        sortText: `0${String(suggestions.length).padStart(3, "0")}`,
        range,
      })
    }

  suggestions.push(...setTemplateItems(position, prefix, typed, name))
  return { suggestions }
}

/**
 * Everything the JavaScript service contributes, merged behind our own.
 *
 * `value` and `current` are emitted here rather than left to the service, so
 * they sort to the top — they are the reason a `set:` expression exists. Their
 * text and type come from `injectedGlobals`, which is also what the service
 * reads, so the two can never describe them differently.
 */
async function withJavaScript(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  lines: Line[],
  own: monaco.languages.CompletionList,
  typed: string
): Promise<monaco.languages.CompletionList> {
  const expression = expressionAt(lines, position.lineNumber)

  // Only where FS Copilot would actually run Jint. Offering JavaScript inside
  // `(>K:GEAR_TOGGLE)` would be describing a language that is not being used.
  if (!expression?.javascript) return own

  const offset = offsetIn(expression, position.lineNumber, position.column)
  if (offset === null) return own

  // Mid-member the profile's own suggestions are noise: nothing in the corpus
  // completes `Math.`.
  const member = /\.\s*[\w$]*$/.test(typed)
  const suggestions = member ? [] : [...own.suggestions]

  const range = rangeFor(position, position.column - 1, 0)
  const injected = new Set<string>()

  if (!member)
    for (const global of injectedGlobals(expression.units)) {
      injected.add(global.name)
      suggestions.push({
        label: global.name,
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: global.name,
        detail: global.type,
        documentation: { value: global.doc },
        sortText: `0${global.name}`,
        range: {
          ...range,
          startColumn: model.getWordUntilPosition(position).startColumn,
        },
      })
    }

  const fromService = await javaScriptCompletions(
    model,
    position,
    expression,
    offset
  )

  for (const item of fromService)
    if (!injected.has(String(item.label))) suggestions.push(item)

  return { suggestions }
}

/** Other profiles that can be included. Root-level profiles are aircraft
 * profiles, not modules, so only subdirectories are offered. */
function includeSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position
): monaco.languages.CompletionList {
  return lineSuggestions(
    model,
    position,
    profileFiles
      .filter((file) => file.dir !== "")
      .map((file) => ({
        label: file.relPath,
        render: `${" ".repeat(ENTRY_INDENT)}- ${file.relPath}`,
      }))
  )
}

/**
 * Completions that own their whole line.
 *
 * Inserting a fragment at the caret assumes the rest of the line is already
 * correct, which it never is while you are typing it — a lone `-` produces
 * `-get`, a caret left under the dash produces a `set:` at the wrong column.
 * Rather than patching each of those, `render` returns the canonical line and
 * it replaces everything: whatever shape the line was in, what lands is what
 * the formatter would have written anyway.
 *
 * `prefix` is still needed for filtering. Monaco scores the text between the
 * range start and the caret, which is now the whole typed prefix, so the
 * filter text has to carry that prefix too.
 */
function lineSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  entries: Array<{ label: string; render: string; documentation?: string }>
): monaco.languages.CompletionList {
  const lineNumber = position.lineNumber
  const spanToCaret = {
    startLineNumber: lineNumber,
    endLineNumber: lineNumber,
    startColumn: 1,
    endColumn: position.column,
  }

  return {
    suggestions: entries.map(({ label, render, documentation }, order) => ({
      label,
      kind: monaco.languages.CompletionItemKind.Property,
      insertText: render,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      filterText: filterTextFor(render),
      documentation: documentation ? { value: documentation } : undefined,
      sortText: `${order}`,
      // Insert replaces up to the caret; replace takes the rest of the line
      // too, so accepting over an existing key does not leave its remains.
      range: {
        insert: spanToCaret,
        replace: {
          ...spanToCaret,
          endColumn: model.getLineMaxColumn(lineNumber),
        },
      },
    })),
  }
}

/**
 * What Monaco scores the typed text against.
 *
 * The range starts at column 1, so the word Monaco filters with is the whole
 * line up to the caret — but it skips that word's leading whitespace before
 * scoring, and then compares against `filterText` verbatim. Carrying the
 * indentation in here therefore misaligns the two: typing `- ` scores `- `
 * against `  - get` and matches only weakly, which is why a lone dash used to
 * offer nothing while `g` worked.
 *
 * Trimmed, the two line up exactly.
 */
function filterTextFor(render: string): string {
  return render
    .split("\n")[0]
    .replace(/\$\{?\d+(?::[^}]*\})?/g, "")
    .trimStart()
    .trimEnd()
}

const INDENT = " ".repeat(ENTRY_INDENT)

/**
 * Keyed by `BlockName` rather than listed, so a block added to the grammar
 * fails the build here until someone says what it is.
 */
/**
 * Rendered as whole lines, so they arrive already formatted.
 *
 * A block already in the file is not offered again: a second `shared:` is a
 * duplicate key, which YAML rejects outright and FS Copilot then fails to load
 * with nothing but "No profile available" to show for it.
 */
function topLevelKeys(present: Set<string>) {
  return BLOCKS.filter((name) => !present.has(name)).map((name) => ({
    label: name,
    render: isEntryBlock(name)
      ? `${name}:\n${INDENT}- ${ENTRY_KEY}: $0`
      : `${name}:\n${INDENT}- $0`,
    documentation: BLOCK_DOCS[name].summary,
  }))
}

/** `- get:` opens an entry; `set:` and `skp:` continue one. */
function entryKey(label: string) {
  return {
    label,
    render:
      label === ENTRY_KEY
        ? `${INDENT}- ${ENTRY_KEY}: $0`
        : `${" ".repeat(CONTINUATION_INDENT)}${label}: $0`,
    documentation: ENTRY_KEY_DOCS[label as EntryDocKey].summary,
  }
}

/**
 * Comment-level completions: the section headings and the header keys.
 *
 * This is what makes the format practical to write — the rules are padded to a
 * fixed width and the box-drawing characters are not on anyone's keyboard.
 */
function commentSuggestions(
  position: monaco.Position,
  indent: string,
  typed: string,
  context: ScanState
): monaco.languages.CompletionList {
  // A heading belongs at the column of the entries it labels, whatever column
  // the "#" was typed at. Writing it where the caret happens to be and letting
  // the next save move it is the formatter cleaning up after the editor.
  const column = expectedIndent("heading", context) ?? indent.length
  const pad = " ".repeat(column)

  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    // From column 1, so the snippet owns the indentation as well as the "#".
    startColumn: 1,
    endColumn: indent.length + typed.length + 1,
  }

  const heading = (level: 1 | 2, label: string, detail: string) => {
    // Sized against the column it will occupy, so the rule still ends where
    // the formatter would end it.
    const rendered = pad + renderHeading(level, "TITLE", column)
    const [before, after] = rendered.split("TITLE")

    return {
      label,
      detail,
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertText: `${before}\${1:TITLE}${after}`,
      insertTextRules:
        monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      documentation: { value: `\`\`\`yaml\n${rendered}\n\`\`\`` },
      // Monaco skips the word's leading whitespace before scoring, so the
      // filter text starts at the "#" the range also starts before.
      filterText: `# ${label}`,
      sortText: `0${level}`,
      range,
    }
  }

  const suggestions: monaco.languages.CompletionItem[] = [
    heading(1, "Section heading", "level 1"),
    heading(2, "Subsection heading", "level 2"),
  ]

  if (context.inHeader) {
    const today = new Date().toISOString().slice(0, 10)
    const keys: Array<[string, string]> = [
      // The exact spelling FS Copilot's regex requires; "Last Updated" is
      // silently ignored and leaves the profile with no date.
      ["Updated:", `# Updated: \${1:${today}}`],
      ["Author:", "# Author: ${1:name}"],
      ["Version:", "# Version: ${1:0.0.1}"],
    ]

    for (const [label, insertText] of keys)
      suggestions.push({
        label,
        detail: "profile header",
        kind: monaco.languages.CompletionItemKind.Property,
        insertText,
        insertTextRules:
          monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        filterText: `# ${label}`,
        sortText: `1${label}`,
        range,
      })
  }

  return { suggestions }
}

const NOTHING: monaco.languages.CompletionList = { suggestions: [] }

/**
 * Exported so it can be exercised without driving the editor UI.
 *
 * Every branch here is a rendering decision. Working out *where the caret is*
 * happens once, in `slotAt`, against the same grammar the formatter reads.
 */
export const profileCompletions: monaco.languages.CompletionItemProvider = {
  triggerCharacters: [":", " ", ",", "#", "-", "L", "A", "K", "H", "B"],

  resolveCompletionItem: resolveJavaScript,

  async provideCompletionItems(model, position) {
    const text = model
      .getLineContent(position.lineNumber)
      .slice(0, position.column - 1)

    const lines = linesOf(model)
    const context = contextAt(model, position.lineNumber)
    const slot = slotAt(text, context)
    if (!slot) return NOTHING

    const { prefix, typed } = slot

    switch (slot.kind) {
      case "variable":
        return variableSuggestions(model, position, prefix, typed, true)

      // `skp:` names the variable whose next change is suppressed, so it takes
      // a bare name — no units, and none of the write expressions `set:` uses.
      case "skipTarget":
        return variableSuggestions(model, position, prefix, typed, false)

      case "units":
        return unitSuggestions(position, prefix, typed)

      case "writeTarget":
        return writeTargetSuggestions(position, prefix, typed)

      case "setValue": {
        const own = setSuggestions(lines, position, prefix, typed)
        return withJavaScript(model, position, lines, own, typed)
      }

      case "comment":
        return commentSuggestions(position, prefix, typed, context)

      // Inside a block scalar the language is JavaScript and nothing else, so
      // the injected names are all this contributes; the rest is the service.
      case "expression":
        return withJavaScript(model, position, lines, NOTHING, typed)

      // Root-level profiles are aircraft profiles rather than modules, so only
      // `include:` has anything to offer here; `ignore:` names are the user's.
      case "sequenceItem":
        return context.block === "include"
          ? includeSuggestions(model, position)
          : NOTHING

      // An entry opens with its required key and nothing else.
      case "entryKey":
        return lineSuggestions(model, position, [entryKey(ENTRY_KEY)])

      case "continuationKey": {
        const present = keysInEntry(lines, position.lineNumber)
        return lineSuggestions(
          model,
          position,
          CONTINUATION_KEYS.filter((key) => !present.has(key)).map(entryKey)
        )
      }

      case "topLevelKey":
        return lineSuggestions(model, position, topLevelKeys(blocksIn(lines)))
    }
  },
}

export function registerCompletions(): monaco.IDisposable {
  return monaco.languages.registerCompletionItemProvider(
    "yaml",
    profileCompletions
  )
}
