/**
 * What the file being edited says, read from its live buffer.
 *
 * The strongest evidence completion has. Measured leaving each corpus file out
 * in turn, 66% of the names a setter writes are used elsewhere in the same
 * file, and 97% of `B:` setters write their own `get:` name or its input
 * event. None of that is on disk until the file is saved, and the corpus it
 * would join is rescanned only then — so the buffer is read here, and the
 * saved copy is left out of the corpus at rank time.
 *
 * Every use carries where it is, so the reference under the caret — half
 * typed, and counted as a use like any other — can be left out of the
 * evidence for its own completion.
 */

import { identityOf } from "../corpus.ts"
import { refsInCode, setterFrames } from "../highlight/refs.ts"
import {
  entriesFromLines,
  includesFromLines,
  type RawEntry,
} from "../profile/entries.ts"
import { expressionAt, positionIn } from "../profile/expression.ts"
import type { Line } from "../profile/grammar.ts"
import type { Block } from "../types.ts"
import { varColumns } from "../vars/parse.ts"
import type { NamePosition } from "./shapes.ts"

/** One place this file names a variable. */
export interface DocumentUse {
  position: NamePosition
  /** As written. */
  form: string
  identity: string
  /** 1-based line the name is on. */
  line: number
  /** 0-based offset of the name's first character within that line. */
  column: number
  /** The entry it belongs to, by the 1-based line of its `get:`. */
  entry: number
  block: Block
}

export interface DocumentFacts {
  relPath: string | null
  lines: Line[]
  entries: RawEntry[]
  uses: DocumentUse[]
  /** `include:` targets as written. */
  includes: string[]
  /** The entry a line belongs to, or null between entries. */
  entryAt(line: number): RawEntry | null
}

/** Where a reference's name starts, past its `(`, an optional `>` and spaces. */
const REF_OPENER = /^\(\s*>?\s*/

export function documentFacts(
  lines: Line[],
  relPath: string | null
): DocumentFacts {
  const entries = entriesFromLines(lines, relPath ?? "")
  const uses: DocumentUse[] = []

  for (const entry of entries) {
    const at = entry.at.get
    const push = (
      position: NamePosition,
      form: string,
      line: number,
      column: number
    ) => {
      const columns = varColumns(form)
      if (!columns.namespace) return
      uses.push({
        position,
        form,
        identity: identityOf(columns.namespace, columns.name),
        line,
        column,
        entry: at,
        block: entry.block,
      })
    }

    const getLine = lines[at - 1]
    if (getLine) push("get", entry.name, at, nameColumn(getLine, entry.name))

    // The exact text FS Copilot matches, so one with a comma names nothing.
    const skipped = entry.skp?.trim()
    if (skipped && entry.at.skp && !skipped.includes(",")) {
      const skpLine = lines[entry.at.skp - 1]
      if (skpLine)
        push("skp", skipped, entry.at.skp, nameColumn(skpLine, skipped))
    }

    if (entry.at.set === undefined) continue

    // A block scalar's key line holds no expression; its body does.
    const expression = expressionAt(
      lines,
      entry.scalar ? entry.at.set + 1 : entry.at.set
    )
    if (!expression) continue

    const text = expression.text
    for (const found of refsInCode(
      text,
      setterFrames(text, expression.block)
    )) {
      const name = found.node.ref.full.trim()
      if (found.node.ref.ns === null || !name || /[()\n]/.test(name)) continue

      const opener = REF_OPENER.exec(text.slice(found.start))?.[0].length ?? 1
      const place = positionIn(expression, found.start + opener)
      push(found.node.access, name, place.lineNumber, place.column - 1)
    }
  }

  const byStart = [...entries].sort((a, b) => a.at.get - b.at.get)

  return {
    relPath,
    lines,
    entries,
    uses,
    includes: includesFromLines(lines),
    entryAt(line) {
      let found: RawEntry | null = null
      for (const entry of byStart) {
        if (entry.at.get > line) break
        found = entry
      }
      return found && line <= found.at.end ? found : null
    },
  }
}

/** Where a name starts on its key line: the first place after the key. */
function nameColumn(line: Line, name: string): number {
  const from = "keyColumn" in line ? line.keyColumn : 0
  const at = line.text.indexOf(name, from)
  return at === -1 ? from : at
}
