/**
 * The entry the Trace panel is describing, lifted in the editor.
 *
 * The panel names lines — `master · lines 31–33` — and a number is a poor way
 * to find three lines in a file you are scrolling. The lift answers "which
 * entry is this about" without the reader having to look away and count.
 *
 * **Neutral, not a feature colour.** docs/help/trace-panel.md settles that
 * this panel has no hue of its own: its content is already the syntax
 * palette, eleven colours carrying meaning, and a twelfth for the chrome
 * would be the first thing to compete with them. Amber reads as `--warning`
 * and ochre collides with `--syntax-injected` *inside* the panel. So the lift
 * is the foreground at a few percent — present, and not saying anything.
 *
 * **Only while the panel is open**, because it is the panel's own pointer.
 * It follows the caret to the next entry and clears when the panel closes.
 *
 * Installed per editor, the way the run button is: it belongs to the pane
 * showing the file, and the diff pane below is the host's copy of somebody
 * else's document.
 */

import * as monaco from "monaco-editor"

import { useStore } from "@/store"

import { caretNow, onDidChangeCaret } from "./caret"
import { entryAt } from "./entry-trace"
import { relPathOf } from "./monaco-setup"

/** Styled in `index.css`, beside the live-value decoration. */
const CLASS = "fsc-traced-entry"

export function installTraceHighlight(
  editor: monaco.editor.IStandaloneCodeEditor
): monaco.IDisposable {
  const lift = editor.createDecorationsCollection()

  function repaint(): void {
    const model = editor.getModel()
    const caret = caretNow()

    /*
     * Three ways to have nothing to draw, and they are one branch on purpose:
     * the panel is shut, the caret is in another file, or it is not in an
     * entry. The last is the common one — a caret in the header, or between
     * two entries in a block — and the panel says so in words at the same
     * moment.
     */
    if (
      !model ||
      useStore.getState().bottom !== "trace" ||
      !caret ||
      caret.path !== relPathOf(model)
    ) {
      lift.clear()
      return
    }

    const traced = entryAt(model.getValue(), caret.line)
    if (!traced) {
      lift.clear()
      return
    }

    const { get, end } = traced.entry.at

    lift.set([
      {
        range: new monaco.Range(get, 1, end, model.getLineMaxColumn(end)),
        options: {
          isWholeLine: true,
          className: CLASS,
          /*
           * The lift marks lines that exist now. Typing at the end of the
           * last one should not drag it over the next entry — `repaint` runs
           * on the change anyway and works the extent out again.
           */
          stickiness:
            monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      },
    ])
  }

  const caret = onDidChangeCaret(repaint)
  // The extent moves as the entry is edited — a `set: >` gaining a body line
  // is the case that shows, since the lift would stop short of what the panel
  // is already tracing.
  const content = editor.onDidChangeModelContent(repaint)
  const swapped = editor.onDidChangeModel(repaint)
  // Opening and closing the panel is the only store change this cares about,
  // and `repaint` is cheap enough that filtering the rest would be the more
  // expensive half.
  const stopStore = useStore.subscribe(repaint)

  repaint()

  return {
    dispose: () => {
      caret.dispose()
      content.dispose()
      swapped.dispose()
      stopStore()
      lift.clear()
    },
  }
}
