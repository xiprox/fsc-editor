/**
 * The four properties `check:highlight` asserts, without the folder walk.
 *
 *   1. Totality    — `highlightLine` never throws. Half-typed code is the
 *                    normal input of a token provider, and a corpus of real
 *                    files is the closest thing to it that can be run in bulk.
 *   2. Vocabulary  — every emitted scope is in `SCOPES`. A scope the theme does
 *                    not know paints in the default foreground, silently.
 *   3. Shape       — spans start at column 0 and strictly increase, which is
 *                    what Monaco requires of a token list.
 *   4. Frames      — the frame stack is empty at end of file. A template or
 *                    comment left open past the last line is a painter that
 *                    lost its place.
 *
 * The scope histogram and the `rpn.word` frequencies are *not* here. They are
 * a description of a corpus rather than a pass condition, and they stay in the
 * script — which is what `onLine` is for. The script needs the same spans this
 * walks to build its histogram, and handing them over as they are produced is
 * what keeps there from being two walks, or worse, two opinions about what a
 * well-formed span list is. See docs/pipeline/03-checks.md.
 */

import {
  highlightLine,
  initialHighlightState,
  isScope,
  type Span,
} from "../../src/shared/highlight/index.ts"
import type { Problem } from "./corpus.ts"

export function checkHighlight(
  text: string,
  onLine?: (line: string, spans: Span[]) => void
): Problem[] {
  const problems: Problem[] = []
  const lines = text.split(/\r?\n/)
  let state = initialHighlightState()

  lines.forEach((line, index) => {
    const number = index + 1

    let spans
    try {
      const result = highlightLine(line, state)
      spans = result.spans
      state = result.state
    } catch (error) {
      problems.push({ line: number, message: `highlightLine threw: ${error}` })
      return
    }

    onLine?.(line, spans)

    if (spans[0]?.start !== 0)
      problems.push({ line: number, message: "first span not at column 0" })

    let last = -1
    for (const span of spans) {
      if (span.start <= last)
        problems.push({
          line: number,
          message: `span at ${span.start} does not follow ${last}`,
        })
      last = span.start

      if (!isScope(span.scope))
        problems.push({
          line: number,
          message: `unknown scope ${JSON.stringify(span.scope)}`,
        })
    }
  })

  // A file may end inside a block scalar, whose base frame is bare JavaScript
  // at depth 0. Anything on top of that — a string, a template, a comment, an
  // unclosed brace — was left open.
  const open = state.frames.filter(
    (frame) => !(frame.mode === "js" && frame.depth === 0)
  )

  if (open.length)
    problems.push({
      line: lines.length,
      message: `${open.map((frame) => frame.mode).join(">")} still open at end of file`,
    })

  return problems
}
