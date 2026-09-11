/**
 * Where the caret is, for the panels that follow it.
 *
 * Distinct from the store's `activeLine`, which is the first *visible* line
 * and drives the sidebar's highlight. The two look interchangeable and are
 * not: scrolling moves one and never the other, and the Trace panel was built
 * against `activeLine` first and reported line 1 for every entry in the file.
 *
 * Module state with an emitter rather than store state, for the same reason
 * `sim-values.ts` is: this changes on every cursor move, and a zustand write
 * per keystroke would re-render everything subscribed to the store rather than
 * the one panel that asked.
 */

import * as monaco from "monaco-editor"

export interface Caret {
  /** The file the caret is in, as a workspace-relative path. */
  path: string
  /** 1-based line. */
  line: number
}

let caret: Caret | null = null

const changed = new monaco.Emitter<void>()

/** Fires when the caret moves to a different line, or to another file. */
export const onDidChangeCaret = changed.event

/**
 * The current caret, or null when no editor has one.
 *
 * The object identity is stable until the line or the file changes, which is
 * what `useSyncExternalStore` needs — returning a fresh object each call would
 * re-render on every unrelated event.
 */
export function caretNow(): Caret | null {
  return caret
}

/** Reported by the focused editor group. */
export function setCaret(next: Caret | null): void {
  if (next === null) {
    if (caret === null) return
    caret = null
    changed.fire()
    return
  }

  if (caret && caret.path === next.path && caret.line === next.line) return

  caret = next
  changed.fire()
}
