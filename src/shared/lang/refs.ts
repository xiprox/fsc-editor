/**
 * Every variable reference in a text, wherever it hides.
 *
 * The tokenizer is honest about islands: a `'…'` string is one token, and in
 * a JavaScript setter that is exactly where the references live —
 * `value ? '(>K:AP_VS_ON)' : '(>K:AP_VS_OFF)'`. So collection recurses into
 * string and hole interiors, the same descent the highlighter makes, written
 * once here instead of twice.
 *
 * This is the seed of the effects analyzer 18-language-core plans: "what
 * does this code touch" answered without caring what the code is embedded
 * in. `collectRefs` carries no offsets — its consumer counts names — while
 * `tokenAt` below carries exact ones: interiors are verbatim slices, so an
 * offset survives the descent as plain arithmetic. Hover was the consumer
 * that made positions worth building, as this header once predicted.
 */

import { parseRef, type IrNode } from "./ir.ts"
import { stackEffectOf, type StackEffect } from "./ops.ts"
import { tokenize } from "./tokens.ts"

export type CollectedRef = Pick<
  Extract<IrNode, { kind: "ref" }>,
  "access" | "ref" | "unit"
>

/** What sits under one offset — a ref with its anatomy, or an RPN word. */
export type TokenHit =
  | {
      kind: "ref"
      node: Extract<IrNode, { kind: "ref" }>
      start: number
      end: number
    }
  | {
      kind: "word"
      text: string
      effect: StackEffect | null
      start: number
      end: number
    }

/**
 * The reference or word at an offset, descending the same islands
 * `collectRefs` does — this is the promised positions-carrying variant,
 * built when hover became its first consumer. Interior offsets survive the
 * descent exactly, because interiors are verbatim slices: nothing is
 * unescaped on the way down, so `start`/`end` always index the text given.
 *
 * Numbers, strings-as-strings and hole interiors that are plain JavaScript
 * return null — they belong to the JavaScript hover, which runs beside
 * this one.
 */
export function tokenAt(
  text: string,
  offset: number,
  depth = 0
): TokenHit | null {
  if (depth > 4) return null

  for (const token of tokenize(text)) {
    if (offset < token.start || offset >= token.end) continue

    if (token.kind === "ref")
      return { kind: "ref", node: parseRef(token), start: token.start, end: token.end }

    if (token.kind === "word")
      return {
        kind: "word",
        text: token.text,
        effect: stackEffectOf(token.text),
        start: token.start,
        end: token.end,
      }

    if (token.kind === "string") {
      const inner = tokenAt(token.text.slice(1, -1), offset - token.start - 1, depth + 1)
      return inner
        ? { ...inner, start: inner.start + token.start + 1, end: inner.end + token.start + 1 }
        : null
    }

    if (token.kind === "hole") {
      const inner = tokenAt(token.text.slice(2, -1), offset - token.start - 2, depth + 1)
      return inner
        ? { ...inner, start: inner.start + token.start + 2, end: inner.end + token.start + 2 }
        : null
    }

    return null
  }

  return null
}

/** A ref with its absolute span — `collectRefs` for consumers that point. */
export interface RefSpan {
  node: Extract<IrNode, { kind: "ref" }>
  start: number
  end: number
}

/**
 * Every reference with its exact position, through the same descent.
 * Diagnostics over JavaScript setters are the consumer: the refs are what
 * the rules judge, wherever the quoting hid them, and the spans are where
 * the squiggles go.
 */
export function collectRefSpans(text: string, depth = 0): RefSpan[] {
  if (depth > 4) return []

  const out: RefSpan[] = []

  for (const token of tokenize(text)) {
    if (token.kind === "ref") {
      out.push({ node: parseRef(token), start: token.start, end: token.end })
      continue
    }

    const interior =
      token.kind === "string" && token.text.length > 2
        ? 1
        : token.kind === "hole" && token.text.length > 3
          ? 2
          : null
    if (interior === null) continue

    for (const span of collectRefSpans(
      token.text.slice(interior, -1),
      depth + 1
    )) {
      out.push({
        node: span.node,
        start: span.start + token.start + interior,
        end: span.end + token.start + interior,
      })
    }
  }

  return out
}

export function collectRefs(text: string, depth = 0): CollectedRef[] {
  // Quote layers nest a couple deep in real setters (YAML quote around JS
  // around RPN); anything past that is pathological input, not code.
  if (depth > 4) return []

  const out: CollectedRef[] = []

  for (const token of tokenize(text)) {
    if (token.kind === "ref") {
      const { access, ref, unit } = parseRef(token)
      out.push({ access, ref, unit })
      continue
    }

    if (token.kind === "string" && token.text.length > 2) {
      out.push(...collectRefs(token.text.slice(1, -1), depth + 1))
      continue
    }

    if (token.kind === "hole" && token.text.length > 3) {
      out.push(...collectRefs(token.text.slice(2, -1), depth + 1))
    }
  }

  return out
}
