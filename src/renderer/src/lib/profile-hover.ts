/**
 * Hover for the profile's own language — refs and RPN words, wherever the
 * cursor finds them.
 *
 * Four territories, walked in order:
 *
 * - inside a `set:` expression (one-line or block scalar), `expressionAt` +
 *   `offsetIn` place the cursor in the expression text and the language
 *   core's `tokenAt` descends to the ref or word under it — through JS
 *   strings and `${…}` holes, where most references live;
 * - a `get:` line's value — the name and its units;
 * - a `skp:` value — a bare name whose meaning (a suppression
 *   cross-reference) is exactly the kind of thing nobody remembers;
 * - a **key** — `shared:`, `get:`, `skp:` — which is what monaco-yaml was
 *   for until its worker stopped starting. The prose is in key-docs.ts.
 *
 * The card is one markdown block, built in hover-card.ts: what the name is,
 * what it does, the one thing that matters about it in this position, and how
 * much company it has. The samples and the file list stay in completion's
 * documentation panel, which is a venue with room for them.
 */

import type * as monaco from "monaco-editor"

import {
  ENTRY_KEY,
  expressionAt,
  offsetIn,
  positionIn,
  plainValue,
  splitUnits,
} from "@shared/profile"
import { parseRef, tokenAt, tokenize } from "@shared/lang"

import { linesOf } from "./completions"
import { entryFor } from "./var-index-store"
import { refCard, wordCard, type RefHoverContext } from "./hover-card"
import { keyDoc } from "./key-docs"

type Hover = monaco.languages.Hover

/**
 * A ref card — **one** section, which is the whole point of it.
 *
 * Monaco stacks a section per block a provider returns, and this used to
 * return two: the header, then everything `documentation()` knows. That is
 * the card that ran a screen tall. `refCard` keeps the four parts a reader
 * is actually looking at the name to find out, and completion's panel is
 * where the samples and the file list still live.
 */
function refContents(
  node: ReturnType<typeof parseRef>,
  context: Omit<RefHoverContext, "entry">
): monaco.IMarkdownString[] {
  const entry = entryFor(node.ref.full)
  return [{ value: refCard(node, { ...context, entry }) }]
}

/** The ref parsed out of a bare name field, as a read in `where` position. */
function nameFieldHover(
  field: string,
  fieldStartColumn: number,
  position: monaco.Position,
  where: "get" | "skp"
): Hover | null {
  const column = position.column - fieldStartColumn
  if (column < 0 || column > field.length) return null

  // The whole field is one reference; tokenize handles a `(`-less name by
  // yielding words, so parse it as ref text directly.
  const [token] = tokenize(`(${field})`)
  if (!token || token.kind !== "ref") return null
  const node = parseRef(token)

  return {
    contents: refContents(node, { where }),
    range: {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: fieldStartColumn,
      endColumn: fieldStartColumn + field.length,
    },
  }
}

/**
 * The documentation for the key the caret is on, or null if it is not on one.
 *
 * Only the keys the format defines. An unrecognised one gets no hover and a
 * `key-unknown` squiggle instead, which is the more useful of the two things
 * to say about `sett:`.
 */
function keyHover(
  line: ReturnType<typeof linesOf>[number],
  position: monaco.Position
): Hover | null {
  const named =
    line.kind === "blockKey"
      ? { name: line.name, column: line.indent + 1 }
      : line.kind === "entry" || line.kind === "continuation"
        ? { name: line.key, column: line.keyColumn + 1 }
        : null

  if (!named) return null
  if (position.column < named.column) return null
  if (position.column > named.column + named.name.length) return null

  const doc = keyDoc(named.name)
  if (!doc) return null

  return {
    contents: [{ value: `\`${named.name}:\`\n\n${doc}` }],
    range: {
      startLineNumber: position.lineNumber,
      endLineNumber: position.lineNumber,
      startColumn: named.column,
      endColumn: named.column + named.name.length,
    },
  }
}

export function profileHover(
  model: monaco.editor.ITextModel,
  position: monaco.Position
): Hover | null {
  const lines = linesOf(model)
  const line = lines[position.lineNumber - 1]
  if (!line) return null

  /*
   * Territory one: the key itself.
   *
   * First, and not by accident. A key and its value never share a column, but
   * the expression territory below returns null for anything on its line that
   * is outside the value — so asking it first would answer "nothing here" for
   * the `set:` three columns to the left.
   */
  const key = keyHover(line, position)
  if (key) return key

  // Territory two: inside a set: expression, of either shape.
  const expression = expressionAt(lines, position.lineNumber)
  if (expression) {
    const offset = offsetIn(expression, position.lineNumber, position.column)
    if (offset !== null) {
      const hit = tokenAt(expression.text, offset)
      if (hit) {
        const start = positionIn(expression, hit.start)
        const end = positionIn(expression, hit.end)
        const range = {
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        }

        if (hit.kind === "ref") {
          const context: Omit<RefHoverContext, "entry"> = {
            where: "expression",
            ...(hit.node.access === "write"
              ? {
                  writeCount:
                    entryFor(hit.node.ref.full)?.corpus?.write?.entries ?? 0,
                }
              : {}),
          }
          return { contents: refContents(hit.node, context), range }
        }

        const card = wordCard(hit)
        return card ? { contents: [{ value: card }], range } : null
      }
    }
    return null
  }

  // Territories three and four: the value of a get: or skp: line.
  if (line.kind === "entry" && line.key === ENTRY_KEY && line.value) {
    const at = line.text.indexOf(line.value, line.keyColumn)
    if (at === -1) return null

    const { name } = splitUnits(plainValue(line.value))
    // The name only: the units after the comma belong to a future units
    // card, and a hover that answers for the wrong span is worse than none.
    return nameFieldHover(name, at + 1, position, "get")
  }

  if (line.kind === "continuation" && line.key === "skp" && line.value) {
    const at = line.text.indexOf(line.value, 0)
    if (at === -1) return null
    return nameFieldHover(plainValue(line.value), at + 1, position, "skp")
  }

  return null
}
