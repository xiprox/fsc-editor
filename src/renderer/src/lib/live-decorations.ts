/**
 * Live values, rendered as injected text on the `get:` line they belong to.
 *
 * ## Why not inlay hints
 *
 * They were inlay hints, and inlay hints update once and then stop.
 *
 * `InlayHintsController` subscribes to a provider's `onDidChangeInlayHints`
 * from *inside* its scheduler callback, into a store it replaces at the top of
 * every run — and `MutableDisposable`'s setter disposes what it replaces.
 * Re-subscribing is guarded by a `watchedProviders` Set that lives for the whole
 * session and is never cleared. So run 1 subscribes, the first value schedules
 * run 2, and run 2 disposes the subscription and declines to make a new one
 * because the provider is already in the Set. Nothing is listening after that:
 * hints freeze at whatever run 2 drew and move again only on a scroll or a
 * keystroke.
 *
 * That is a Monaco bug and there are ways to provoke it into rebuilding the
 * session, but all of them are indirect — poking a registry to make a scheduler
 * re-arm a listener it should never have dropped. Owning the rendering is fewer
 * moving parts than owning a workaround, and it puts the update rate under our
 * control, which is the actual requirement: somebody moving a control by hand
 * in walkaround should see the number follow their hand.
 *
 * ## What it costs to own it
 *
 * Two things, and both are cheap:
 *
 * - **Parsing.** `getLinesIn` walks the whole file, 0.23 ms on `pa24-250.yaml`.
 *   Cached against `getVersionId`, so an idle file is parsed once however many
 *   values arrive.
 * - **Repainting.** Every model is offered every update, so the guard is a
 *   signature of what would be drawn. Editors showing a file with none of the
 *   changed variables in it do nothing at all, which is the common case with
 *   several tabs open. An edit always repaints the model it changed, which
 *   costs one repaint per keystroke.
 */

import * as monaco from "monaco-editor"

import { noteHintsRequested, onDidChangeSimValues, simValue } from "./sim-values"
import { getLinesIn, type WatchLine } from "./watch-set"

/** The class the injected text carries. Styled in `index.css`. */
export const CLASS = "fsc-live-value"

interface ModelState {
  /** The decorations we own on this model. Never touches anyone else's. */
  ids: string[]
  /**
   * Model version the cached parse belongs to, or -1 for "never parsed" —
   * which `apply` counts as an edit, so a model is always drawn the first time.
   */
  version: number
  lines: WatchLine[]
  /**
   * What is currently drawn, flattened.
   *
   * The whole point of it is to answer "would this repaint change anything?"
   * without building decorations. A value arriving is news for one model and
   * noise for every other one open.
   *
   * It records what is drawn and not where, so it only answers for value
   * updates. An edit can carry a decoration onto another line while it keeps
   * showing the same thing — see the stickiness in `apply`.
   */
  drawn: string
}

const states = new WeakMap<monaco.editor.ITextModel, ModelState>()

function stateFor(model: monaco.editor.ITextModel): ModelState {
  let state = states.get(model)
  if (!state) {
    state = { ids: [], version: -1, lines: [], drawn: "" }
    states.set(model, state)
  }

  return state
}

/**
 * Everything arrives as a double, so `Bool` needs saying rather than showing
 * `1.000`. Trailing zeros go too — a switch position reading `1` is the point,
 * and `1.000000` is noise dressed as precision.
 */
export function formatValue(value: number, units: string): string {
  if (/^bool$/i.test(units)) return value ? "true" : "false"
  if (Number.isInteger(value)) return String(value)

  return Number(value.toFixed(3)).toString()
}

/**
 * Redraws one model, if anything it shows has changed.
 *
 * A variable with no value gets no decoration at all rather than a placeholder.
 * Most of the corpus is `L:`, which needs the module, so a dash on nine lines
 * out of ten would read as "broken" rather than as "not connected yet".
 */
function apply(model: monaco.editor.ITextModel): void {
  if (model.isDisposed()) return

  const state = stateFor(model)

  const version = model.getVersionId()
  const edited = state.version !== version
  if (edited) {
    state.lines = getLinesIn(model.getValue())
    state.version = version
  }

  const next: monaco.editor.IModelDeltaDecoration[] = []
  let drawn = ""

  for (const { line, watch } of state.lines) {
    const value = simValue(watch.name)
    if (!value) continue

    const text = formatValue(value.value, value.units)
    drawn += `${line}${text}`

    const column = model.getLineMaxColumn(line)

    next.push({
      range: new monaco.Range(line, column, line, column),
      options: {
        // Without this the decoration draws nothing at all. Its range is empty
        // by construction — a zero-width anchor at the end of the line — and an
        // empty range is skipped unless it says otherwise. Monaco's own inlay
        // hints set it for the same reason, computed as `range.isEmpty()`;
        // ours is always empty, so it is always true.
        showIfCollapsed: true,
        after: {
          // The value and nothing else. It had a `▸` in front, the same shape
          // and blue as the run button in the margin — which, for an entry
          // with no `set:`, is on this same line. Two triangles at either end
          // of one line, and only one of them does anything. The chip's tint
          // is what says it is not part of the file.
          content: text,
          inlineClassName: CLASS,
          // The class adds padding and a margin, which move the glyphs after
          // it. Saying so is what keeps the cursor landing where it looks.
          inlineClassNameAffectsLetterSpacing: true,
        },
        // Matching Monaco's inlay hints rather than reasoning about it from
        // first principles: injected text at a line end wants to stay attached
        // to that end as the line grows.
        //
        // A newline grows it too. Enter at the end of a `get:` line stretches
        // the range over the line break, and the value draws at the start of
        // the new line instead.
        stickiness: monaco.editor.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
      },
    })
  }

  // After an edit, the value may be unchanged while the box has moved, so an
  // edit always redraws. Only a value update can be skipped. Without this, the
  // box stayed on the new line until some other value's line number shifted.
  if (!edited && drawn === state.drawn) return

  state.drawn = drawn
  noteHintsRequested()
  state.ids = model.deltaDecorations(state.ids, next)
}

function applyAll(): void {
  for (const model of monaco.editor.getModels()) apply(model)
}

/**
 * Starts drawing live values, and keeps drawing them.
 *
 * Content changes are handled as well as value changes, because a `get:` line
 * that has just been typed should pick up a value it already has rather than
 * waiting for the variable to move — which, for most switches, is never.
 */
export function startLiveDecorations(): monaco.IDisposable {
  const perModel = new Map<string, monaco.IDisposable>()

  const attach = (model: monaco.editor.ITextModel): void => {
    const key = model.uri.toString()
    perModel.get(key)?.dispose()

    const content = model.onDidChangeContent(() => apply(model))
    const gone = model.onWillDispose(() => {
      content.dispose()
      gone.dispose()
      perModel.delete(key)
    })

    perModel.set(key, {
      dispose: () => {
        content.dispose()
        gone.dispose()
      },
    })

    apply(model)
  }

  // Models that already exist, then every one made afterwards. In practice
  // `setupMonaco` runs before the first file is opened, but a function that
  // depends on being called early is a function that breaks when it is not.
  for (const model of monaco.editor.getModels()) attach(model)
  const created = monaco.editor.onDidCreateModel(attach)

  const changed = onDidChangeSimValues(applyAll)

  return {
    dispose: () => {
      created.dispose()
      changed.dispose()
      for (const one of perModel.values()) one.dispose()
      perModel.clear()

      for (const model of monaco.editor.getModels()) {
        if (model.isDisposed()) continue
        const state = states.get(model)
        if (state) state.ids = model.deltaDecorations(state.ids, [])
      }
    },
  }
}
