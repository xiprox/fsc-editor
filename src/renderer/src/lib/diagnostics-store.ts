/**
 * The diagnostics store — one authority, several consumers.
 *
 * The shape 18-language-core pins: analysis runs over **open models only**
 * (the corpus is other people's work; `lang:sweep` keeps the all-files
 * view), results are held per model, and every consumer reads the same
 * truth — editor markers today, the Issues panel and its counts when they
 * land, quick fixes through the code-action provider below. Nothing
 * renders from a private analysis of its own.
 *
 * Re-analysis triggers: a model's content changed (debounced a keystroke's
 * width), a model opened, or the variable index arrived/refreshed — the
 * index *is* the rule context (catalogue parameters ride the entries), so
 * new evidence means new verdicts.
 */

import * as monaco from "monaco-editor"

import type { RuleContext } from "@shared/lang"

import { aircraftEvidence } from "./aircraft-evidence"
import { analyzeProfile, type FileDiagnostic } from "./profile-diagnostics"
import { useStore } from "../store"
import { entryFor } from "./var-index-store"
import { whyCard } from "./why-card"

export const DIAGNOSTICS_OWNER = "fsc-lang"

const DEBOUNCE_MS = 300

const byModel = new Map<string, FileDiagnostic[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

/**
 * Which file a model holds — `monaco-setup`'s `relPathOf`, handed in by
 * `attachDiagnostics` rather than imported, because `monaco-setup` imports this
 * file. Null until attached, which keeps aircraft evidence off.
 */
let pathOf: (model: monaco.editor.ITextModel) => string | null = () => null

/**
 * Consumers beyond the markers — the Issues panel and its rail count. One
 * notification for any change anywhere; listeners re-read what they show
 * through `diagnosticsFor`, which is cheaper than describing what moved.
 */
const listeners = new Set<() => void>()

export function onDiagnosticsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The rule context for one file, straight off the variable index the renderer
 * holds. Per file because the aircraft half is: evidence about the loaded
 * aircraft goes only to that aircraft's profile — see `aircraft-evidence.ts`.
 */
/**
 * Evidence that lives somewhere this file cannot import from.
 *
 * `panel-evidence.ts` needs to know which files belong to the loaded
 * aircraft, that needs `monaco-setup`, and `monaco-setup` imports this file —
 * the same knot `pathOf` is handed in to avoid. So a source registers itself
 * rather than being reached for, and an app where none has is simply an app
 * whose rules see no such evidence.
 */
type EvidenceSource = (relPath: string | null) => Partial<RuleContext>
const sources: EvidenceSource[] = []

export function provideEvidence(source: EvidenceSource): void {
  sources.push(source)
}

function context(relPath: string | null): RuleContext {
  return {
    ...Object.assign({}, ...sources.map((source) => source(relPath))),
    keyEventParams: (event) =>
      entryFor(`K:${event}`)?.sdk?.doc?.parameters ?? null,
    simVarSettable: (name) => entryFor(name)?.sdk?.doc?.settable ?? null,
    ...aircraftEvidence(relPath),
    // `include:` paths resolve from the workspace root, which is exactly
    // what `relPath` is. Before the first listing arrives this is empty,
    // and an empty listing is *not* evidence — null keeps the rules quiet
    // rather than reporting every include as missing.
    workspaceFiles: () => {
      const files = useStore.getState().files
      return files.length ? files.map((file) => file.relPath) : null
    },
  }
}

const SEVERITY: Record<FileDiagnostic["severity"], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
}

function publish(model: monaco.editor.ITextModel): void {
  const diagnostics = analyzeProfile(model.getValue(), context(pathOf(model)))
  byModel.set(model.uri.toString(), diagnostics)

  monaco.editor.setModelMarkers(
    model,
    DIAGNOSTICS_OWNER,
    diagnostics.map((diagnostic) => ({
      severity: SEVERITY[diagnostic.severity],
      message: diagnostic.message,
      startLineNumber: diagnostic.start.lineNumber,
      startColumn: diagnostic.start.column,
      endLineNumber: diagnostic.end.lineNumber,
      endColumn: diagnostic.end.column,
      source: "fsc",
      code: diagnostic.ruleId,
    }))
  )

  for (const listener of listeners) listener()
}

function schedule(model: monaco.editor.ITextModel): void {
  const key = model.uri.toString()
  clearTimeout(timers.get(key))
  timers.set(
    key,
    setTimeout(() => publish(model), DEBOUNCE_MS)
  )
}

/** Diagnostics for one model, for the panel and the code-action provider. */
const EMPTY: FileDiagnostic[] = []

export function diagnosticsFor(
  model: monaco.editor.ITextModel
): FileDiagnostic[] {
  // The shared EMPTY keeps the snapshot referentially stable — a fresh []
  // per call would make useSyncExternalStore re-render forever.
  return byModel.get(model.uri.toString()) ?? EMPTY
}

/** The index changed, so every verdict might have. */
export function refreshAllDiagnostics(): void {
  for (const model of monaco.editor.getModels()) {
    if (model.getLanguageId() === "yaml") publish(model)
  }
}

/**
 * Watches models for their lifetime. Called once from setup, with the
 * model-to-file mapping — see `pathOf`.
 */
export function attachDiagnostics(
  relPathOf: (model: monaco.editor.ITextModel) => string | null
): monaco.IDisposable {
  pathOf = relPathOf
  const disposables: monaco.IDisposable[] = []

  const track = (model: monaco.editor.ITextModel): void => {
    if (model.getLanguageId() !== "yaml") return
    publish(model)
    disposables.push(model.onDidChangeContent(() => schedule(model)))
  }

  for (const model of monaco.editor.getModels()) track(model)
  disposables.push(monaco.editor.onDidCreateModel(track))
  disposables.push(
    monaco.editor.onWillDisposeModel((model) => {
      byModel.delete(model.uri.toString())
      clearTimeout(timers.get(model.uri.toString()))
      for (const listener of listeners) listener()
    })
  )

  disposables.push(
    monaco.languages.registerCodeActionProvider("yaml", {
      provideCodeActions(model, range) {
        const actions: monaco.languages.CodeAction[] = []

        for (const diagnostic of diagnosticsFor(model)) {
          if (!diagnostic.fix) continue
          // Offered when the invoked range touches the diagnostic's.
          if (
            diagnostic.end.lineNumber < range.startLineNumber ||
            diagnostic.start.lineNumber > range.endLineNumber
          )
            continue

          actions.push({
            title: diagnostic.fix.title,
            kind: "quickfix",
            diagnostics: [],
            edit: {
              edits: diagnostic.fix.edits.map((edit) => ({
                resource: model.uri,
                versionId: model.getVersionId(),
                textEdit: {
                  range: {
                    startLineNumber: edit.start.lineNumber,
                    startColumn: edit.start.column,
                    endLineNumber: edit.end.lineNumber,
                    endColumn: edit.end.column,
                  },
                  text: edit.newText,
                },
              })),
            },
          })
        }

        return { actions, dispose: () => {} }
      },
    })
  )

  /*
   * The Why section, under the marker's own text. Registered here rather
   * than in `profile-hover` because it answers for diagnostics, and this is
   * the one place that holds them — a second lookup elsewhere would be a
   * second opinion about which diagnostic the cursor is on.
   */
  disposables.push(
    monaco.languages.registerHoverProvider("yaml", {
      provideHover(model, position) {
        const contents: monaco.IMarkdownString[] = []

        for (const diagnostic of diagnosticsFor(model)) {
          const range = new monaco.Range(
            diagnostic.start.lineNumber,
            diagnostic.start.column,
            diagnostic.end.lineNumber,
            diagnostic.end.column
          )
          if (!range.containsPosition(position)) continue

          const card = whyCard(diagnostic)
          if (card) contents.push({ value: card })
        }

        return contents.length ? { contents } : null
      },
    })
  )

  return {
    dispose: () => {
      for (const disposable of disposables) disposable.dispose()
    },
  }
}
