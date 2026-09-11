import * as monaco from "monaco-editor"

/**
 * Dropping a variable name into the editor, without Monaco's `$0`.
 *
 * Monaco already accepts a `text/plain` drop — `dropIntoEditor` is on by
 * default — and it very nearly works. What it does with the text is the
 * problem: `dropOrPasteInto/browser/edit.js` escapes it, appends `$0` to mark
 * where the cursor should end up, and applies the whole thing as a *snippet*
 * edit. In VS Code the snippet service consumes that tab stop. In standalone
 * monaco the bulk-edit service ignores `insertAsSnippet`, so the text lands
 * literally and every drop leaves a `$0` behind it.
 *
 * There is no public API to replace the provider — `registerDocumentDropEdit`
 * and friends are not on `editor.api.d.ts` — so the drop is handled before
 * Monaco sees it. Which is a small amount of code and one behaviour we now own
 * rather than inherit.
 *
 * Only `text/plain`, and only when it carries something. A file dragged onto
 * the editor is not text and is left to whatever else wants it.
 */
export function acceptDrops(
  container: HTMLElement,
  editor: monaco.editor.IStandaloneCodeEditor
): () => void {
  const dragover = (event: DragEvent): void => {
    if (!event.dataTransfer?.types.includes("text/plain")) return

    // Both, and in this order: without `preventDefault` the drop never fires,
    // and without stopping propagation Monaco's own controller draws a second
    // insertion caret next to ours.
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = "copy"
  }

  const drop = (event: DragEvent): void => {
    const text = event.dataTransfer?.getData("text/plain")
    if (!text) return

    event.preventDefault()
    event.stopPropagation()

    /*
     * Where the pointer is, not where the cursor was.
     *
     * A drop is aimed: the whole gesture is carrying something to a place. If
     * the position cannot be resolved — the pointer is over the minimap, or the
     * margin — the cursor is the honest fallback rather than a guess at a line.
     */
    const target = editor.getTargetAtClientPoint(event.clientX, event.clientY)
    const at = target?.position ?? editor.getPosition()
    if (!at) return

    const range = new monaco.Range(at.lineNumber, at.column, at.lineNumber, at.column)

    editor.executeEdits("drop", [{ range, text, forceMoveMarkers: true }])

    // Focus and a cursor after the insertion, because the next thing somebody
    // does is type — a drop that leaves focus behind in the panel means
    // clicking back into the editor to carry on.
    editor.focus()
    editor.setPosition({ lineNumber: at.lineNumber, column: at.column + text.length })
  }

  // Captured, so this runs before the controller Monaco attaches to the same
  // subtree rather than racing it.
  container.addEventListener("dragover", dragover, true)
  container.addEventListener("drop", drop, true)

  return () => {
    container.removeEventListener("dragover", dragover, true)
    container.removeEventListener("drop", drop, true)
  }
}
