// Types only — this module does no Monaco work of its own, which is what lets
// the line arithmetic below be exercised without an editor.
import type * as monaco from "monaco-editor"

type Change = monaco.editor.ILineChange
type Model = monaco.editor.ITextModel

/**
 * Turning Monaco's diff into edits that pull the host's version into ours.
 *
 * Two sides, and they are not symmetric. The host's copy is the diff's
 * `modified` and is the pane you look at, so a line number on screen and a
 * selection you drag are both *its* lines — that is what `changesInRange`
 * answers in. Our file is the `original`, hidden behind it, and is the side a
 * take actually writes to. Edits go one way and coordinates come the other,
 * which is why every function here says which it means.
 *
 * Taking a change is therefore an edit to the `original` side — the opposite
 * direction from the one Monaco's own hunk buttons go, which is why they are
 * turned off and this module exists.
 *
 * Monaco describes a change as two line ranges and encodes "there is nothing on
 * this side" as an end line of 0 rather than as an empty range. Normalizing
 * both sides to a half-open `[start, endExclusive)` span up front is what
 * collapses insertions, deletions and replacements back into one shape — and a
 * whole-line span is also what carries the newline along with the lines, which
 * is the detail that otherwise leaves a blank line behind or welds two entries
 * onto the same one.
 */

interface Span {
  start: number
  /** One past the last line, so an empty span is `start === endExclusive`. */
  endExclusive: number
}

function spanOf(startLine: number, endLine: number): Span {
  // An end line of 0 means this side has no lines. `startLine` is then the line
  // the change sits *after*, so the empty span belongs on the one following it.
  return endLine === 0
    ? { start: startLine + 1, endExclusive: startLine + 1 }
    : { start: startLine, endExclusive: endLine + 1 }
}

/** Our side of a change, which is the diff's `original`. */
function ours(change: Change): Span {
  return spanOf(change.originalStartLineNumber, change.originalEndLineNumber)
}

/** The host's side of a change, which is the diff's `modified`. */
function theirs(change: Change): Span {
  return spanOf(change.modifiedStartLineNumber, change.modifiedEndLineNumber)
}

/** A whole-line range, which past the last line the model clamps for us. */
function rangeOf(span: Span): monaco.IRange {
  return {
    startLineNumber: span.start,
    startColumn: 1,
    endLineNumber: span.endExclusive,
    endColumn: 1,
  }
}

/**
 * The line a change sits on *in the host's file*, which is where it is read.
 *
 * A change with no lines of the host's — entries we have and they do not, which
 * the single-pane view puts in a removed-code block — answers with the line it
 * follows, since that is the only line a selection has to reach for.
 */
function anchorLine(change: Change): number {
  const span = theirs(change)
  return span.start === span.endExclusive
    ? Math.max(span.start - 1, 1)
    : span.start
}

/** Changes touching the given line range in the host's file. */
export function changesInRange(
  changes: Change[],
  startLine: number,
  endLine: number
): Change[] {
  return changes.filter((change) => {
    const span = theirs(change)

    if (span.start === span.endExclusive) {
      const at = anchorLine(change)
      return at >= startLine && at <= endLine
    }

    return span.start <= endLine && span.endExclusive - 1 >= startLine
  })
}

/**
 * Pulls the given changes into our file, as one undoable step.
 *
 * The buffer is all this touches; the caller is what carries it to disk. A
 * single `pushEditOperations` for the whole set, so undo covers what the button
 * said it would do rather than unpicking it hunk by hunk. The edits are
 * disjoint by construction, and are ordered so their ranges are computed
 * against the same document state.
 */
export function takeChanges(
  local: Model,
  host: Model,
  changes: Change[]
): void {
  if (!changes.length) return

  // Sorted by where they land in *our* file, not by where they were drawn: the
  // ranges below are ours, and they have to be computed against one document
  // state rather than against each other.
  const edits = [...changes]
    .sort((a, b) => ours(a).start - ours(b).start)
    .map((change) => ({
      range: rangeOf(ours(change)),
      text: host.getValueInRange(rangeOf(theirs(change))),
    }))

  local.pushEditOperations([], edits, () => null)
}
