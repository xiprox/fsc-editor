import { describe, expect, test } from "vitest"

import { changesInRange, takeChanges } from "./diff-hunks"

/**
 * Taking a change rewrites a profile someone is about to fly with, so the line
 * arithmetic is the part of Remote Connect most worth pinning down: an
 * off-by-one here welds two entries onto the same line, or leaves a blank one
 * where an entry used to be, and both look plausible until FS Copilot reads it.
 *
 * The model below is a stand-in, not Monaco. It implements the same contract —
 * 1-based lines, 1-based columns, positions past the end clamped to it, edits
 * applied back to front — which is enough to exercise the range decisions this
 * module makes, and is not evidence that Monaco agrees. That part is only true
 * if the real editor is driven, which `npm run remote:sandbox` is for.
 */

interface Range {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

function fakeModel(initial: string) {
  const self = {
    text: initial,
    lines: () => self.text.split("\n"),
    getLineCount: () => self.lines().length,
    getLineMaxColumn: (line: number) => (self.lines()[line - 1] ?? "").length + 1,
    /**
     * Clamped the way Monaco validates a position it is handed: a line past the
     * end of the buffer becomes the *end* of the last line, whatever column it
     * asked for. Whole-line ranges are built one line past their last, so this
     * is the rule that decides what taking the final line of a file does.
     */
    offset(line: number, column: number) {
      const lines = self.lines()
      const row = Math.min(Math.max(line, 1), lines.length)
      const col =
        line > lines.length
          ? lines[row - 1].length + 1
          : Math.min(Math.max(column, 1), lines[row - 1].length + 1)

      let at = 0
      for (let i = 0; i < row - 1; i++) at += lines[i].length + 1
      return at + col - 1
    },
    getValueInRange: (range: Range) =>
      self.text.slice(
        self.offset(range.startLineNumber, range.startColumn),
        self.offset(range.endLineNumber, range.endColumn)
      ),
    pushEditOperations(_before: unknown, edits: Array<{ range: Range; text: string }>) {
      const ordered = [...edits].sort(
        (a, b) =>
          self.offset(b.range.startLineNumber, b.range.startColumn) -
          self.offset(a.range.startLineNumber, a.range.startColumn)
      )

      for (const edit of ordered) {
        const from = self.offset(edit.range.startLineNumber, edit.range.startColumn)
        const to = self.offset(edit.range.endLineNumber, edit.range.endColumn)
        self.text = self.text.slice(0, from) + edit.text + self.text.slice(to)
      }
    },
  }

  return self
}

type Change = Parameters<typeof changesInRange>[0][number]

/**
 * Monaco says "nothing on this side" with an end line of 0 rather than an empty
 * range, which is what makes insertions and deletions separate shapes here.
 *
 * `original` is our file and `modified` is the host's, which is the way round
 * the diff editor is set up: the host's copy is the pane on screen, ours is the
 * hidden half a take writes into.
 */
const change = (
  originalStart: number,
  originalEnd: number,
  modifiedStart: number,
  modifiedEnd: number
): Change =>
  ({
    originalStartLineNumber: originalStart,
    originalEndLineNumber: originalEnd,
    modifiedStartLineNumber: modifiedStart,
    modifiedEndLineNumber: modifiedEnd,
    charChanges: undefined,
  }) as Change

/** Applies `changes` to `ours` and returns what our file becomes. */
function take(ours: string, theirs: string, changes: Change[]): string {
  const local = fakeModel(ours)
  takeChanges(local as never, fakeModel(theirs) as never, changes)
  return local.text
}

describe("taking a single change", () => {
  test("replaces a line", () => {
    expect(take("a\nB\nc\n", "a\nX\nc\n", [change(2, 2, 2, 2)])).toBe("a\nX\nc\n")
  })

  test("replaces a block with a shorter one", () => {
    expect(take("a\nx\ny\nz\nb\n", "a\nQ\nb\n", [change(2, 4, 2, 2)])).toBe("a\nQ\nb\n")
  })

  test("takes a line the host has and we do not", () => {
    expect(take("a\nc\n", "a\nb\nc\n", [change(1, 0, 2, 2)])).toBe("a\nb\nc\n")
  })

  test("takes one before our first line, which has nothing to anchor to", () => {
    expect(take("b\nc\n", "a\nb\nc\n", [change(0, 0, 1, 1)])).toBe("a\nb\nc\n")
  })

  test("drops a line the host does not have, without leaving a blank one", () => {
    expect(take("a\nb\nc\n", "a\nc\n", [change(2, 2, 1, 0)])).toBe("a\nc\n")
  })

  test("drops our last line, where there is no following break to consume", () => {
    // The range runs past the end of the file and the model clamps it, so the
    // break *before* the line stays and the file keeps a trailing newline.
    // The formatter ends every profile with one regardless, so this costs
    // nothing that the next save does not put back.
    expect(take("a\nb", "a", [change(2, 2, 1, 0)])).toBe("a\n")
  })
})

describe("taking several changes at once", () => {
  test("applies every one, without them shifting each other", () => {
    expect(
      take("a\nX\nc\nY\ne\n", "a\n1\nc\n2\ne\n", [
        change(2, 2, 2, 2),
        change(4, 4, 4, 4),
      ])
    ).toBe("a\n1\nc\n2\ne\n")
  })

  test("mixes one we drop and one we take", () => {
    expect(
      take("a\nb\nd\n", "a\nc\nd\n", [change(2, 2, 1, 0), change(2, 0, 2, 2)])
    ).toBe("a\nc\nd\n")
  })

  test("taking all of them reproduces the host's file exactly", () => {
    const ours = "shared:\n  - get: A\n    set: 1\n  - get: B\n    set: 2\n"
    const theirs =
      "shared:\n  - get: A\n    set: 9\n  - get: B\n    set: 2\n  - get: C\n    set: 3\n"

    expect(take(ours, theirs, [change(3, 3, 3, 3), change(5, 0, 6, 7)])).toBe(theirs)
  })

  test("taking nothing leaves the file alone", () => {
    expect(take("a\nb\n", "x\ny\n", [])).toBe("a\nb\n")
  })
})

describe("which changes a selection covers", () => {
  // Hit-tested against the host's file, since that is the pane on screen and
  // therefore the one a selection is dragged in.
  const changes = [change(2, 2, 2, 2), change(5, 5, 4, 0), change(8, 9, 9, 10)]

  test("includes a change whose lines fall inside", () => {
    expect(changesInRange(changes, 1, 3)).toHaveLength(1)
  })

  test("includes one with no lines of theirs by the line it follows", () => {
    expect(changesInRange(changes, 4, 4)).toHaveLength(1)
  })

  test("includes a change the selection only partly covers", () => {
    expect(changesInRange(changes, 9, 20)).toHaveLength(1)
  })

  test("excludes changes the selection misses", () => {
    expect(changesInRange(changes, 6, 7)).toHaveLength(0)
  })
})
