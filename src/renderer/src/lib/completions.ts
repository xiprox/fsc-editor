import * as monaco from "monaco-editor"

import {
  complete,
  completionIndex,
  completionSlot,
  detailOf,
  documentFacts,
  type CompletionIndex,
  type CompletionSlot,
  type DocumentFacts,
  type Offer,
} from "@shared/completion"
import { corpusFiles } from "@shared/evidence"
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
  renderHeading,
  splitPrefix,
  scanLines,
  type ScanState,
  slotAt,
  expressionAt,
  injectedGlobals,
  offsetIn,
} from "@shared/profile"
import type { ProfileFile, VarEntry, VarIndex } from "@shared/types"

import {
  javaScriptCompletions,
  resolveJavaScript,
  type Resolvable,
} from "./js-bridge"
import { BLOCK_DOCS, ENTRY_KEY_DOCS, type EntryDocKey } from "./key-docs"
import { setTemplates } from "./set-templates"
import { entryFor, setVarIndexStore } from "./var-index-store"

/**
 * The Monaco side of completion.
 *
 * Every decision about variable names — where the caret is, what the file
 * says, what to offer and in which order — is made headless in
 * `@shared/completion` and measured by `npm run check:completion`; see
 * docs/sim-vars/19-completion.md. What is here maps those offers onto items,
 * and completes the line structure around them: keys, headings, `include:`
 * paths, whole-setter templates, and JavaScript through the service.
 */

let completion: CompletionIndex = completionIndex(null)
let profileFiles: ProfileFile[] = []

/** Which workspace file a model holds — given by monaco-setup, which owns the URIs. */
let pathOf: (model: monaco.editor.ITextModel) => string | null = () => null

export function setVarIndex(next: VarIndex | null): void {
  completion = completionIndex(next)
  setVarIndexStore(next)
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

const documents = new WeakMap<
  monaco.editor.ITextModel,
  { version: number; facts: DocumentFacts }
>()

/** What the buffer says — entries, and every name it uses where — per version. */
export function documentOf(model: monaco.editor.ITextModel): DocumentFacts {
  const version = model.getVersionId()
  const cached = documents.get(model)
  if (cached?.version === version) return cached.facts

  const facts = documentFacts(linesOf(model), pathOf(model))
  documents.set(model, { version, facts })
  return facts
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

/* -------------------------------------------------------------------------- */
/* Names                                                                       */
/* -------------------------------------------------------------------------- */

/** How the corpus splits this variable across the two blocks. */
function blockSummary(entry: VarEntry): string {
  const parts: string[] = []
  if (entry.corpus?.get?.shared)
    parts.push(`shared ×${entry.corpus.get.shared}`)
  if (entry.corpus?.get?.master)
    parts.push(`master ×${entry.corpus.get.master}`)
  return parts.join(" · ")
}

/**
 * Everything known about a variable, for the panel beside the list.
 *
 * Built when an item is focused, never for the list: Monaco reads it for the
 * one item on screen, and building it for nineteen thousand per keystroke was
 * the cost of the list the old provider returned.
 */
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
  const used = corpusFiles(corpus)
  if (corpus) {
    const profiles = used.length === 1 ? "profile" : "profiles"
    const blocks = blockSummary(entry)
    lines.push(
      `Used in ${used.length} ${profiles}${blocks ? ` — ${blocks}` : ""}`
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
      const unit = corpus.units[0] ?? entry.sdk?.doc?.units
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

  if (used.length) {
    lines.push("", `_${used.slice(0, 6).join(", ")}_`)
  }

  return { value: lines.join("\n") }
}

/** An item from an offer, resolved to its documentation only when focused. */
type NameItem = monaco.languages.CompletionItem &
  Resolvable & { __offer?: Offer }

const KINDS: Record<Offer["kind"], monaco.languages.CompletionItemKind> = {
  variable: monaco.languages.CompletionItemKind.Variable,
  event: monaco.languages.CompletionItemKind.Event,
  unit: monaco.languages.CompletionItemKind.Unit,
}

/**
 * The offers at a slot, as items.
 *
 * **One range per list.** Monaco scores each item against the text from its
 * range's start to the caret, so items with different starts are scored
 * against different words — a `K:` calling shape that reached back over `(>`
 * outscored everything else whatever order it was given. So a reference's
 * whole list reaches back over its `(`, and every filter text begins with
 * what was typed there; the scores are comparable and the order is ours.
 *
 * **Plain ranges.** A range with separate insert and replace ends replaces to
 * the end only on Shift+Enter; a plain range always does. So accepting a
 * name replaces the old one on Enter.
 */
function nameItems(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  slot: CompletionSlot
): monaco.languages.CompletionList {
  const offers = complete(slot, documentOf(model), completion)
  const line = position.lineNumber
  const range = (start: number, end: number): monaco.IRange => ({
    startLineNumber: line,
    endLineNumber: line,
    startColumn: start + 1,
    endColumn: end + 1,
  })
  const sortText = (order: number) => String(order).padStart(6, "0")

  if (slot.kind === "units")
    return {
      suggestions: offers.map((offer, order): NameItem => ({
        label: { label: offer.label, detail: detailLine(offer) },
        kind: KINDS.unit,
        // One space after the comma, as the formatter writes it.
        insertText: ` ${offer.text}`,
        filterText: offer.text,
        sortText: sortText(order),
        range: range(slot.start, slot.end),
      })),
    }

  const cover = slot.cover
  const lead = cover?.text ?? ""
  const start = cover ? cover.start : slot.start
  // An open reference is closed, or the tokenizer reads it to the end of the
  // line and everything after it is garbled.
  const close = cover && !slot.closed ? ")" : ""

  // On a `get:` line the value is the name and its unit. A name that brings a
  // unit replaces both; one that does not leaves the author's unit alone.
  const text = model.getLineContent(line)
  const comma = text.indexOf(",", slot.start)
  const nameEnd = comma !== -1 && comma < slot.end ? comma : slot.end

  return {
    suggestions: offers.map((offer, order): NameItem => {
      const calling = offer.snippet !== undefined && slot.position === "write"
      const snippet = calling || offer.template !== undefined
      const name = offer.template ?? offer.text
      let insertText = calling ? offer.snippet! : `${lead}${name}`
      let end = slot.end

      if (slot.position === "get") {
        if (offer.units) insertText = `${name}, ${offer.units}`
        else end = nameEnd
      }

      return {
        label: {
          label: offer.label,
          ...(slot.position === "get" && offer.units
            ? { description: offer.units }
            : {}),
          detail: detailLine(offer),
        },
        kind: KINDS[offer.kind],
        // A control's name is half done: the reference closes with its suffix.
        insertText: offer.next ? insertText : insertText + close,
        ...(snippet
          ? {
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            }
          : {}),
        filterText: `${lead}${offer.text}`,
        sortText: sortText(order),
        range: range(start, end),
        // Asks again at the caret once inserted — for the suffix.
        ...(offer.next
          ? { command: { id: "editor.action.triggerSuggest", title: "" } }
          : {}),
        __offer: offer,
      }
    }),
    // With controls in the list, a typed underscore has to reach the
    // suffixes, so Monaco asks again on each keystroke rather than filtering
    // what it has. A `B:` list runs to hundreds, so asking is cheap.
    incomplete: offers.some((offer) => offer.next),
  }
}

/** The evidence, as the dimmed text beside a label. */
function detailLine(offer: Offer): string | undefined {
  const detail = detailOf(offer.evidence)
  return detail ? `  ${detail}` : undefined
}

/**
 * Documentation for whichever item is focused, and only that one.
 *
 * One provider serves items of two origins, so it dispatches on which one
 * made the item: the JavaScript service's go back to it; ours are built from
 * the offer's variable.
 */
async function resolveItem(
  item: monaco.languages.CompletionItem
): Promise<monaco.languages.CompletionItem> {
  const named = item as NameItem
  if (named.__js) return resolveJavaScript(named)

  const entry = named.__offer?.entry
  if (entry && !named.documentation) named.documentation = documentation(entry)
  return named
}

/* -------------------------------------------------------------------------- */
/* Line structure                                                              */
/* -------------------------------------------------------------------------- */

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

/**
 * Whole setters for a `set:` value: what other profiles write for this entry's
 * variable, then the templates.
 *
 * Looked up by identity, so `get: A:LIGHT BEACON:1` finds what profiles write
 * for `A:LIGHT BEACON` — the raw `get:` text never matched an indexed name.
 */
function setSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  prefix: string,
  typed: string
): monaco.languages.CompletionList {
  const name = documentOf(model).entryAt(position.lineNumber)?.name ?? null
  const range = rangeFor(position, prefix.length, typed.length)

  const seen = new Set<string>()
  const suggestions: monaco.languages.CompletionItem[] = []

  // What other profiles actually write for this variable comes first.
  const entry = name ? entryFor(name) : undefined
  for (const sample of entry?.corpus?.samples ?? []) {
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
  // A plain range, so Enter replaces to its end. With separate insert and
  // replace ends, the rest of the line went only on Shift+Enter, and
  // accepting over an existing key left its remains after the caret.
  const wholeLine: monaco.IRange = {
    startLineNumber: lineNumber,
    endLineNumber: lineNumber,
    startColumn: 1,
    endColumn: model.getLineMaxColumn(lineNumber),
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
      range: wholeLine,
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
 * A variable name or unit anywhere — a `get:`, a `skp:`, a reference inside a
 * setter — is the core's: `completionSlot` finds it and `complete` decides it.
 * Everything else is line structure, found by `slotAt` against the same
 * grammar the formatter reads.
 *
 * The trigger characters are the ones that open something: `(` a read, `>` a
 * write, `:` a name after its key or namespace, `,` a unit. Letters are not
 * among them — quick suggest already fires on every word character, so a
 * letter here never acted as a trigger.
 */
export const profileCompletions: monaco.languages.CompletionItemProvider = {
  triggerCharacters: [":", " ", ",", "#", "-", "(", ">"],

  resolveCompletionItem: resolveItem,

  async provideCompletionItems(model, position) {
    const lines = linesOf(model)

    const named = completionSlot(
      lines,
      position.lineNumber,
      position.column - 1
    )
    if (named) return nameItems(model, position, named)

    const text = model
      .getLineContent(position.lineNumber)
      .slice(0, position.column - 1)
    const context = contextAt(model, position.lineNumber)
    const slot = slotAt(text, context)
    if (!slot) return NOTHING

    const { prefix, typed } = slot

    switch (slot.kind) {
      // Handled above: every name and unit is the core's.
      case "variable":
      case "skipTarget":
      case "units":
        return NOTHING

      case "setValue": {
        const own = setSuggestions(model, position, prefix, typed)
        return withJavaScript(model, position, lines, own, typed)
      }

      case "comment":
        return commentSuggestions(position, prefix, typed, context)

      // Inside a block scalar, outside every reference, the language is
      // JavaScript and nothing else, so the injected names are all this
      // contributes; the rest is the service.
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

/**
 * Registers the provider. `relPathOf` says which workspace file a model holds,
 * which decides whose saved copy the corpus leaves out and whether the
 * aircraft in the sim applies — monaco-setup owns the URIs, so it passes it.
 */
export function registerCompletions(
  relPathOf: (model: monaco.editor.ITextModel) => string | null
): monaco.IDisposable {
  pathOf = relPathOf
  return monaco.languages.registerCompletionItemProvider(
    "yaml",
    profileCompletions
  )
}
