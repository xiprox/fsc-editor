import * as monaco from "monaco-editor"
// Explicit .js: monaco-editor's exports map is a literal "./*" passthrough, so
// extensionless deep imports do not resolve.
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker.js?worker"
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker.js?worker"
import {
  expressionAt,
  formatProfile,
  offsetIn,
  openAfter,
  parseOutline,
  scanLines,
} from "@shared/profile"

import { registerCompletions } from "./completions"
import { javaScriptHover, javaScriptSignatureHelp } from "./js-bridge"
import { profileHover } from "./profile-hover"
import { startLiveDecorations } from "./live-decorations"
import { attachDiagnostics } from "./diagnostics-store"
import { profileTokens } from "./profile-tokens"

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment
  }
}

let ready = false

/**
 * Workers are bundled locally and resolved through Vite's `?worker` imports.
 * The usual CDN loader would leave the editor dead in a packaged app and under
 * the production CSP.
 */
export function setupMonaco(): void {
  if (ready) return
  ready = true

  window.MonacoEnvironment = {
    getWorker(_workerId, label) {
      // Drives completions inside `set:` expressions. See ./js-bridge.
      if (label === "javascript" || label === "typescript") return new TsWorker()
      return new EditorWorker()
    },
  }

  configureJavaScript()

  /*
   * There is no YAML language service here, and that is deliberate.
   *
   * monaco-yaml used to supply two things — hovers on a key, and
   * `additionalProperties: false` — and has supplied neither since
   * monaco-editor 0.53 changed `createWebWorker`'s options. Its worker never
   * started, every request came back *Missing requestHandler*, and the
   * failure was silent because Monaco drops a provider's rejection. The
   * latest release still calls the old signature.
   *
   * Both jobs are now ours, where the rest of the format's knowledge already
   * lives: `key-docs.ts` holds the prose, `profileHover` renders it, and
   * `key-unknown` in lang/ reports an unrecognised key with the blast radius
   * it actually has. Nothing was lost in the move — it had all been dead for
   * three monaco releases.
   *
   * The `yaml` language id stays: monaco-editor registers it itself, and
   * every provider below is bound to it.
   */

  // Replaces Monaco's generic YAML tokenizer. Everything else — completions,
  // folding, hovers — stays bound to the `yaml` language id.
  monaco.languages.setTokensProvider("yaml", profileTokens)

  configureLanguage()
  registerIndentation()
  registerCompletions()
  registerFolding()
  registerFormatter()
  registerExpressionHelp()
  startLiveDecorations()
  attachDiagnostics(relPathOf)
}

/**
 * Hover and signature help inside a `set:` expression.
 *
 * Both are the same question the completion provider asks — which expression,
 * at which offset — so both go through the same extraction and mapping.
 */
function registerExpressionHelp(): monaco.IDisposable[] {
  const locate = (model: monaco.editor.ITextModel, position: monaco.Position) => {
    const expression = expressionAt(scanLines(model.getValue()), position.lineNumber)
    if (!expression?.javascript) return null

    const offset = offsetIn(expression, position.lineNumber, position.column)
    return offset === null ? null : { expression, offset }
  }

  return [
    monaco.languages.registerHoverProvider("yaml", {
      async provideHover(model, position) {
        const at = locate(model, position)
        if (!at) return null

        const contents = await javaScriptHover(at.expression, at.offset)
        return contents ? { contents } : null
      },
    }),

    // The profile's own hover, beside the JavaScript one — Monaco shows
    // both, so `value` keeps its TS card and a ref gets this one.
    monaco.languages.registerHoverProvider("yaml", {
      provideHover(model, position) {
        return profileHover(model, position)
      },
    }),

    monaco.languages.registerSignatureHelpProvider("yaml", {
      signatureHelpTriggerCharacters: ["(", ","],

      async provideSignatureHelp(model, position) {
        const at = locate(model, position)
        if (!at) return null

        const value = await javaScriptSignatureHelp(at.expression, at.offset)
        return value ? { value, dispose: () => {} } : null
      },
    }),
  ]
}

/**
 * The JavaScript service, aimed at Jint rather than at a browser.
 *
 * `lib` is set explicitly to leave out `dom`, which is the default and would
 * otherwise offer `document`, `window`, `fetch`, `setTimeout` and `console` —
 * none of which exist. FS Copilot builds the engine with nothing on it but two
 * values:
 *
 *     new Engine().SetValue("value", value).SetValue("current", current)
 *
 * so the global surface really is the language built-ins and those two names,
 * which is a smaller and more honest target than most embedded-JS setups get.
 *
 * es2023 matches Jint 4.4.1, which implements ES2015 through most of ES2025.
 * What it lacks is narrow and irrelevant to a one-expression `set:` value:
 * generators, iterator helpers, `RegExp.escape` and the `/v` regex flag.
 *
 * Diagnostics stay off. The shadow model is never displayed, so its squiggles
 * would go nowhere, and computing them on every keystroke buys nothing.
 */
function configureJavaScript(): void {
  const js = monaco.typescript.javascriptDefaults

  js.setCompilerOptions({
    // The typed `ScriptTarget` enum stops at ES2020 while the bundled compiler
    // ships libs through es2024, so the target is named by enum and the actual
    // surface is chosen by `lib`.
    target: monaco.typescript.ScriptTarget.ESNext,
    lib: ["es2023"],
    allowNonTsExtensions: true,
    allowJs: true,
  })

  js.setDiagnosticsOptions({
    noSemanticValidation: true,
    noSyntaxValidation: true,
    noSuggestionDiagnostics: true,
  })
}

function configureLanguage(): monaco.IDisposable {
  return monaco.languages.setLanguageConfiguration("yaml", {
    comments: { lineComment: "#" },
    brackets: [
      ["{", "}"],
      ["[", "]"],
      ["(", ")"],
    ],
  })
}

/**
 * Where the caret lands after Enter.
 *
 * Monaco's default copies the previous line's indentation, so Enter at the end
 * of `- get: X` leaves the caret under the dash. This used to be three
 * `onEnterRules` emitting `IndentAction.Indent`, which means "one tab stop" —
 * a different question from the one the format answers, and one that lands on
 * the right column only while `tabSize` happens to be 2.
 *
 * Now the grammar is asked directly: `indentAfter` names the column, and it is
 * the same function the formatter uses to place the line on save. The caret
 * cannot end up somewhere the formatter would move it away from.
 */
function registerIndentation(): monaco.IDisposable {
  return monaco.languages.registerOnTypeFormattingEditProvider("yaml", {
    autoFormatTriggerCharacters: ["\n"],

    provideOnTypeFormattingEdits(model, position) {
      const previous = position.lineNumber - 1
      if (previous < 1) return []

      // Only ever adjusts a line that is still blank. Once there is something
      // on it, which column it belongs at is the formatter's call, on save.
      const current = model.getLineContent(position.lineNumber)
      if (current.trim() !== "") return []

      const scanned = scanLines(
        model.getValueInRange({
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: previous,
          endColumn: model.getLineMaxColumn(previous),
        })
      )

      const opening = openAfter(scanned[scanned.length - 1])
      if (!opening) return []

      const text = " ".repeat(opening.indent) + opening.prefix
      if (text === current) return []

      return [
        {
          range: {
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: current.length + 1,
          },
          text,
        },
      ]
    },
  })
}

/**
 * Sections are comments, so YAML's own folding knows nothing about them.
 * Folding a section is what replaces the old one-file-per-concern layout.
 */
function registerFolding(): monaco.IDisposable {
  return monaco.languages.registerFoldingRangeProvider("yaml", {
    provideFoldingRanges(model) {
      const ranges: monaco.languages.FoldingRange[] = []

      const walk = (nodes: ReturnType<typeof parseOutline>) => {
        for (const node of nodes) {
          if (node.kind !== "block" && node.endLine > node.line)
            ranges.push({
              start: node.line,
              end: node.endLine,
              kind: monaco.languages.FoldingRangeKind.Region,
            })

          walk(node.children)
        }
      }

      walk(parseOutline(model.getValue()))
      return ranges
    },
  })
}

function registerFormatter(): monaco.IDisposable {
  return monaco.languages.registerDocumentFormattingEditProvider("yaml", {
    provideDocumentFormattingEdits(model) {
      const formatted = formatProfile(model.getValue())
      if (formatted === model.getValue()) return []

      return [{ range: model.getFullModelRange(), text: formatted }]
    },
  })
}

const MODEL_SCHEME = "file:///definitions/"

/**
 * The host's copy of a file, which is a different document that happens to share
 * a name. Its own scheme keeps `getModel` from handing back one when the other
 * was meant — and keeps the YAML schema and completions working on both sides of
 * a diff, since both are still `yaml`.
 */
const REMOTE_SCHEME = "remote:///definitions/"

/**
 * And a third, for the file as it is on disk right now.
 *
 * Not the remote scheme with a different meaning poured into it: the two are
 * compared for different reasons, by different editors configured almost
 * inversely, and a model under one name serving both would be the first thing
 * to go wrong when either changes.
 */
const DISK_SCHEME = "disk:///definitions/"

function uriFor(relPath: string): monaco.Uri {
  return monaco.Uri.parse(MODEL_SCHEME + relPath)
}

function remoteUriFor(relPath: string): monaco.Uri {
  return monaco.Uri.parse(REMOTE_SCHEME + relPath)
}

function diskUriFor(relPath: string): monaco.Uri {
  return monaco.Uri.parse(DISK_SCHEME + relPath)
}

/**
 * The prefixes as `Uri.toString()` renders them, which is not always what was
 * parsed: only `file:` keeps its empty authority, so `remote:///definitions/`
 * comes back as `remote:/definitions/`. Deriving them through the same
 * functions the models are built with is what keeps that from mattering.
 */
const PREFIXES = [uriFor(""), remoteUriFor(""), diskUriFor("")].map((uri) =>
  uri.toString()
)

/**
 * Which file a model holds.
 *
 * For anything attached to a specific editor rather than to the window — the
 * run-setter gutter, which exists once per pane. Asking the store for the
 * active path there was correct while there was one editor and wrong the moment
 * there were two: the unfocused pane would be judging its own text against the
 * *other* pane's file, and these buttons write to the simulator.
 */
export function relPathOf(
  model: monaco.editor.ITextModel | null
): string | null {
  if (!model) return null

  const uri = model.uri.toString()
  const prefix = PREFIXES.find((candidate) => uri.startsWith(candidate))

  return prefix ? decodeURIComponent(uri.slice(prefix.length)) : null
}

/**
 * The remote side of a diff, updated in place.
 *
 * `setValue` rather than a new model each time: the diff editor holds a
 * reference, and replacing the model under it would drop the scroll position and
 * re-run the diff from scratch every time the host saves.
 */
export function remoteModelFor(
  relPath: string,
  content: string
): monaco.editor.ITextModel {
  const existing = monaco.editor.getModel(remoteUriFor(relPath))
  if (!existing)
    return monaco.editor.createModel(content, "yaml", remoteUriFor(relPath))

  if (existing.getValue() !== content) existing.setValue(content)
  return existing
}

/** The file on disk, as the side of a comparison. Updated in place, as above. */
export function diskModelFor(
  relPath: string,
  content: string
): monaco.editor.ITextModel {
  const existing = monaco.editor.getModel(diskUriFor(relPath))
  if (!existing)
    return monaco.editor.createModel(content, "yaml", diskUriFor(relPath))

  if (existing.getValue() !== content) existing.setValue(content)
  return existing
}

/**
 * Models are keyed by file so undo history survives tab switches.
 *
 * `content` seeds a new model and is ignored for one that already exists: from
 * then on the model is the file, and overwriting it here would silently drop
 * unsaved edits along with the undo stack every time you came back to a tab.
 */
export function modelFor(
  relPath: string,
  content: string
): monaco.editor.ITextModel {
  return existingModel(relPath) ?? monaco.editor.createModel(content, "yaml", uriFor(relPath))
}

/**
 * The model for a file, if one exists, without creating it.
 *
 * For changes arriving from outside the editor — the file moving on disk — where
 * a file nobody has opened has no buffer to update and must not gain one.
 */
export function existingModel(relPath: string): monaco.editor.ITextModel | null {
  return monaco.editor.getModel(uriFor(relPath))
}

/**
 * Scroll position, selection and folds, per file — what makes coming back to a
 * tab feel like returning rather than reopening. Stored beside the models
 * because the two share a lifetime.
 *
 * Per *group* as well as per file, and that is not a detail. The model is
 * shared by every pane showing the file — which is what makes editing on the
 * left appear on the right, with one undo stack — but where you are reading it
 * is not shared at all. A single map here meant two panes on one file yanking
 * each other's scroll on every activation, each restoring the position the
 * other had just left.
 */
const viewStates = new Map<
  string,
  Map<string, monaco.editor.ICodeEditorViewState>
>()

export function rememberViewState(
  group: string,
  relPath: string,
  state: monaco.editor.ICodeEditorViewState | null
): void {
  if (!state) return

  const forGroup = viewStates.get(group) ?? new Map()
  forGroup.set(relPath, state)
  viewStates.set(group, forGroup)
}

export function viewStateFor(
  group: string,
  relPath: string
): monaco.editor.ICodeEditorViewState | null {
  return viewStates.get(group)?.get(relPath) ?? null
}

/** Called when a group closes, so its positions go with it. */
export function forgetGroupViewStates(group: string): void {
  viewStates.delete(group)
}

/**
 * Frees the models of files that are no longer open. Called from the editor
 * rather than the store so that it runs after the closed file's model has been
 * detached and its view state stashed.
 *
 * `openPaths` is the union across every group, never one group's strip. A file
 * closed on the left while the right is still showing it has not stopped being
 * open, and disposing its model here would pull the document out from under the
 * pane that never asked.
 */
export function pruneModels(openPaths: string[]): void {
  const keep = new Set(openPaths)

  for (const forGroup of viewStates.values())
    for (const relPath of [...forGroup.keys()])
      if (!keep.has(relPath)) forGroup.delete(relPath)

  for (const model of monaco.editor.getModels()) {
    const uri = model.uri.toString()

    // Both sides of a closed tab go, or the host's copy would outlive the file
    // it was being compared against.
    const prefix = PREFIXES.find((candidate) => uri.startsWith(candidate))
    if (!prefix) continue

    const relPath = decodeURIComponent(uri.slice(prefix.length))
    if (keep.has(relPath)) continue

    model.dispose()
  }
}

export { monaco }
