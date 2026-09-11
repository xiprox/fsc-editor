import * as monaco from "monaco-editor"

import { type Expression, injectedGlobals } from "@shared/profile"

/**
 * Real JavaScript intelligence inside a `set:` expression.
 *
 * Monaco ships a full TypeScript language service and this app already bundles
 * it, so the work is not analysis — it is handing the service something it can
 * analyse and mapping the answers back.
 *
 * The approach is request-scoped rather than a synced shadow document. Nothing
 * here needs whole-file analysis: a completion is always "this one expression,
 * at this one offset", so a single hidden model is rewritten per request and
 * thrown at the worker. No syncing, no debouncing, no source map across
 * expressions — the mapping is a preamble length plus a per-line indent.
 *
 * `value` and `current` are declared in that preamble rather than through
 * `addExtraLib`, because their type comes from the units on the entry's `get:`
 * and therefore changes from one expression to the next.
 */

const SHADOW = monaco.Uri.parse("file:///fsc/expression.js")

let shadow: monaco.editor.ITextModel | null = null

function shadowModel(): monaco.editor.ITextModel {
  if (!shadow || shadow.isDisposed())
    shadow = monaco.editor.createModel("", "javascript", SHADOW)

  return shadow
}

/**
 * Declarations for the two injected names, plus a function wrapper so a bare
 * `return` parses. JSDoc rather than TypeScript syntax, since the model has to
 * stay JavaScript for the service to treat it as such.
 */
function preambleFor(units: string): string {
  const lines: string[] = []

  for (const global of injectedGlobals(units)) {
    lines.push("/**")
    for (const line of global.doc.split("\n")) lines.push(` * ${line}`.trimEnd())
    lines.push(` * @type {${global.type}}`)
    lines.push(" */")
    lines.push(`var ${global.name};`)
  }

  lines.push("function __expr() {")
  return lines.join("\n") + "\n"
}

/** What the service was asked about, kept so a resolve can restore it. */
interface Loaded {
  /** Whole shadow document, preamble included. */
  text: string
  /** Caret offset within it. */
  offset: number
}

/**
 * Puts the expression in front of the service.
 *
 * Order matters and is easy to get backwards: acquiring the worker proxy is
 * what syncs models to it, so the model has to hold its final content *before*
 * the proxy is asked for. Fetching the proxy first syncs an empty document and
 * every offset then lands past the end of it, which looks exactly like the
 * service having no suggestions.
 */
async function load(loaded: Loaded): Promise<Worker | null> {
  const model = shadowModel()
  if (model.getValue() !== loaded.text) model.setValue(loaded.text)

  return worker()
}

function shadowFor(expression: Expression, offset: number): Loaded {
  const preamble = preambleFor(expression.units)

  return {
    text: `${preamble}${expression.text}\n}\n`,
    offset: preamble.length + offset,
  }
}

type Worker = {
  getCompletionsAtPosition(
    fileName: string,
    position: number
  ): Promise<{ entries?: CompletionEntry[] } | undefined>
  getCompletionEntryDetails(
    fileName: string,
    position: number,
    entry: string
  ): Promise<EntryDetails | undefined>
  getQuickInfoAtPosition(
    fileName: string,
    position: number
  ): Promise<QuickInfo | undefined>
  getSignatureHelpItems(
    fileName: string,
    position: number,
    options: unknown
  ): Promise<SignatureHelp | undefined>
}

interface CompletionEntry {
  name: string
  kind: string
  kindModifiers?: string
  sortText: string
  insertText?: string
}

interface DisplayPart {
  text: string
  kind: string
}

interface EntryDetails {
  displayParts?: DisplayPart[]
  documentation?: DisplayPart[]
  tags?: { name: string; text?: DisplayPart[] }[]
}

interface QuickInfo {
  displayParts?: DisplayPart[]
  documentation?: DisplayPart[]
}

interface SignatureHelp {
  selectedItemIndex: number
  argumentIndex: number
  items: {
    prefixDisplayParts?: DisplayPart[]
    suffixDisplayParts?: DisplayPart[]
    separatorDisplayParts?: DisplayPart[]
    parameters: { displayParts?: DisplayPart[]; documentation?: DisplayPart[] }[]
    documentation?: DisplayPart[]
  }[]
}

async function worker(): Promise<Worker | null> {
  try {
    const get = await monaco.typescript.getJavaScriptWorker()
    return (await get(SHADOW)) as unknown as Worker
  } catch {
    // The service is a convenience; a profile is still editable without it.
    return null
  }
}

function text(parts: DisplayPart[] | undefined): string {
  return (parts ?? []).map((part) => part.text).join("")
}

/** TypeScript's completion kinds, in Monaco's vocabulary. */
const KINDS: Record<string, monaco.languages.CompletionItemKind> = {
  const: monaco.languages.CompletionItemKind.Constant,
  let: monaco.languages.CompletionItemKind.Variable,
  var: monaco.languages.CompletionItemKind.Variable,
  "local var": monaco.languages.CompletionItemKind.Variable,
  parameter: monaco.languages.CompletionItemKind.Variable,
  function: monaco.languages.CompletionItemKind.Function,
  "local function": monaco.languages.CompletionItemKind.Function,
  method: monaco.languages.CompletionItemKind.Method,
  getter: monaco.languages.CompletionItemKind.Property,
  setter: monaco.languages.CompletionItemKind.Property,
  property: monaco.languages.CompletionItemKind.Property,
  class: monaco.languages.CompletionItemKind.Class,
  interface: monaco.languages.CompletionItemKind.Interface,
  type: monaco.languages.CompletionItemKind.Class,
  enum: monaco.languages.CompletionItemKind.Enum,
  "enum member": monaco.languages.CompletionItemKind.EnumMember,
  keyword: monaco.languages.CompletionItemKind.Keyword,
  module: monaco.languages.CompletionItemKind.Module,
  primitive: monaco.languages.CompletionItemKind.Keyword,
}

/**
 * Carried on an item so a resolve can put the service back in the same state.
 *
 * The whole shadow document rather than just the offset, because by the time
 * the user focuses a suggestion another request may have loaded a different
 * expression. All items from one request share the one string.
 */
export interface Resolvable {
  __js?: { loaded: Loaded; name: string }
}

/**
 * Completions from the JavaScript service, in the profile model's coordinates.
 *
 * `range` comes from the profile model's own word, not from the shadow: the
 * two agree because the text at the caret is identical in both, and taking it
 * from the visible model keeps the replacement honest.
 */
export async function javaScriptCompletions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  expression: Expression,
  offset: number
): Promise<monaco.languages.CompletionItem[]> {
  const loaded = shadowFor(expression, offset)
  const proxy = await load(loaded)
  if (!proxy) return []

  const completions = await proxy.getCompletionsAtPosition(
    SHADOW.toString(),
    loaded.offset
  )
  if (!completions?.entries?.length) return []

  const word = model.getWordUntilPosition(position)
  const range: monaco.IRange = {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: position.column,
  }

  return completions.entries.map((entry) => {
    const item: monaco.languages.CompletionItem & Resolvable = {
      label: entry.name,
      kind: KINDS[entry.kind] ?? monaco.languages.CompletionItemKind.Property,
      insertText: entry.insertText ?? entry.name,
      // Behind the profile's own suggestions, which are the specific ones.
      sortText: `9${entry.sortText}`,
      range,
    }

    item.__js = { loaded, name: entry.name }
    return item
  })
}

/** Signature and JSDoc for one completion, fetched only when it is focused. */
export async function resolveJavaScript(
  item: monaco.languages.CompletionItem & Resolvable
): Promise<monaco.languages.CompletionItem> {
  if (!item.__js) return item

  const proxy = await load(item.__js.loaded)
  if (!proxy) return item

  const details = await proxy.getCompletionEntryDetails(
    SHADOW.toString(),
    item.__js.loaded.offset,
    item.__js.name
  )
  if (!details) return item

  item.detail = text(details.displayParts)

  const documentation = text(details.documentation)
  if (documentation) item.documentation = { value: documentation }

  return item
}

export async function javaScriptHover(
  expression: Expression,
  offset: number
): Promise<monaco.IMarkdownString[] | null> {
  const loaded = shadowFor(expression, offset)
  const proxy = await load(loaded)
  if (!proxy) return null

  const info = await proxy.getQuickInfoAtPosition(
    SHADOW.toString(),
    loaded.offset
  )
  if (!info) return null

  const signature = text(info.displayParts)
  const documentation = text(info.documentation)
  if (!signature && !documentation) return null

  const contents: monaco.IMarkdownString[] = []
  if (signature) contents.push({ value: "```javascript\n" + signature + "\n```" })
  if (documentation) contents.push({ value: documentation })

  return contents
}

export async function javaScriptSignatureHelp(
  expression: Expression,
  offset: number
): Promise<monaco.languages.SignatureHelp | null> {
  const loaded = shadowFor(expression, offset)
  const proxy = await load(loaded)
  if (!proxy) return null

  const help = await proxy.getSignatureHelpItems(
    SHADOW.toString(),
    loaded.offset,
    {}
  )
  if (!help?.items?.length) return null

  return {
    activeSignature: help.selectedItemIndex,
    activeParameter: help.argumentIndex,
    signatures: help.items.map((item) => {
      const parameters = item.parameters.map((parameter) => ({
        label: text(parameter.displayParts),
        documentation: { value: text(parameter.documentation) },
      }))

      const label =
        text(item.prefixDisplayParts) +
        parameters.map((parameter) => parameter.label).join(
          text(item.separatorDisplayParts) || ", "
        ) +
        text(item.suffixDisplayParts)

      return {
        label,
        parameters,
        documentation: { value: text(item.documentation) },
      }
    }),
  }
}
