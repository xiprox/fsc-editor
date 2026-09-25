/**
 * The references a setter names, found by the walk the highlighter makes.
 *
 * `collectRefs` in the language core answers the same question with a model
 * of its own: it tokenizes a whole JavaScript setter as RPN and descends into
 * every string and hole. That finds the references, and it also reads every
 * JavaScript parenthesis as one — `(value == 100)`, `Math.abs(current - value`
 * — which is 1,346 namespace-less "reads" in the corpus. Counting names never
 * noticed, since a reference with no namespace is no variable; a completion
 * asking where the caret is would have offered variable names after
 * `Math.abs(`.
 *
 * The walk already knows which stretches are RPN, because painting them
 * needed it. So the references are what the painter would paint as
 * references, and the corpus scan, completion and the highlighter cannot
 * disagree about where one is.
 */

import { parseRef, tokenize, type IrNode } from "../lang/index.ts"
import { setKind } from "../profile/grammar.ts"
import { JS, RPN, walkCode, type CodeListener, type Frame } from "./paint.ts"

export type RefNode = Extract<IrNode, { kind: "ref" }>

/** A reference and where it sits in the text it was found in. */
export interface CodeRef {
  node: RefNode
  /** Offset of its `(`. */
  start: number
  /** Offset one past its `)`, or the end of its stretch when it never closed. */
  end: number
}

/**
 * The frames a setter's text starts in — the rule `line.ts` paints by.
 *
 * A one-line value is JavaScript or RPN by its shape, which is how FS Copilot
 * decides too. A block scalar's body is walked as JavaScript from its first
 * line, as the highlighter walks it; a reference written straight into it is
 * still found, through the walk's bare-reference branch.
 */
export function setterFrames(text: string, scalar: boolean): Frame[] {
  if (scalar) return [JS]
  return [setKind(text) === "javascript" ? JS : RPN]
}

/**
 * Every reference in program text, walked line by line from `frames`.
 *
 * Offsets index `text` as given, newlines included, so a caller that knows
 * where the text starts on the page can put any of them back.
 */
export function refsInCode(text: string, frames: Frame[]): CodeRef[] {
  const out: CodeRef[] = []

  const listener: CodeListener = {
    rpn(stretch, base) {
      for (const token of tokenize(stretch)) {
        if (token.kind !== "ref") continue
        out.push({
          node: parseRef(token),
          start: base + token.start,
          end: base + token.end,
        })
      }
    },
    ref(token, base) {
      out.push({ node: parseRef(token), start: base, end: base + token.end })
    },
    mark() {},
  }

  let at = 0
  let current = frames
  for (const line of text.split("\n")) {
    current = walkCode(line, at, current, listener)
    at += line.length + 1
  }

  return out
}

/** The references in a `set:` value — what the corpus scan stores. */
export function setterRefs(text: string, scalar = false): CodeRef[] {
  return refsInCode(text, setterFrames(text, scalar))
}
