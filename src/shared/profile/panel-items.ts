/**
 * Where in a profile a cockpit panel can be picked, and what a pick writes.
 *
 * Pure text in, pure text out — no editor and no simulator — so the rules for
 * where the Pick button appears and what it inserts are tested as functions
 * rather than by driving a cockpit.
 */

import { panelBlockSpec, type PanelBlockSpec } from "../panels.ts"
import { ENTRY_INDENT, scalarValue, type Line } from "./grammar.ts"

export interface PickSite {
  spec: PanelBlockSpec
  /** The empty item, 1-based. */
  line: number
  /** What the block already lists, trimmed the way FS Copilot trims. */
  taken: string[]
}

/** Items of the block that `line` belongs to, reading outwards from it. */
function itemsAround(lines: Line[], index: number, block: string): string[] {
  const taken: string[] = []

  const gather = (from: number, step: 1 | -1): void => {
    for (let at = from; at >= 0 && at < lines.length; at += step) {
      const line = lines[at]!
      if (line.kind === "blockKey") return
      if (line.kind !== "sequenceItem" || line.context.block !== block) continue

      const text = scalarValue(line.value).trim()
      if (text) taken.push(text)
    }
  }

  gather(index - 1, -1)
  gather(index + 1, 1)
  return taken
}

/**
 * The pick site on this line, or null.
 *
 * An *empty* item in a block that takes panels: `  - ` with nothing after it.
 * An item that already says something is somebody's text, and a button beside
 * it would be offering to replace what they wrote.
 */
export function pickSiteAt(lines: Line[], lineNumber: number): PickSite | null {
  const line = lines[lineNumber - 1]
  if (!line || line.kind !== "sequenceItem") return null
  if (scalarValue(line.value).trim()) return null

  const spec = panelBlockSpec(line.context.block)
  if (!spec) return null

  return {
    spec,
    line: lineNumber,
    taken: itemsAround(lines, lineNumber - 1, spec.block),
  }
}

/**
 * The lines that replace the empty item: one per chosen panel.
 *
 * The first takes the place of the empty item and the rest follow it, all at
 * the grammar's own indent rather than whatever the empty line had — the
 * formatter would put them there on save anyway, and an insert that needs
 * formatting afterwards is an insert that looks broken until then. Repeats
 * and anything the block already lists are dropped: panels that share an
 * identifier are one item.
 */
export function pickedItems(chosen: string[], taken: string[]): string {
  const seen = new Set(taken)
  const fresh = chosen.filter((text) => {
    if (seen.has(text)) return false
    seen.add(text)
    return true
  })

  return fresh
    .map((text) => `${" ".repeat(ENTRY_INDENT)}- ${itemScalar(text)}`)
    .join("\n")
}

/**
 * The text as a YAML scalar FS Copilot will read back as that text.
 *
 * An identifier is plain. A full key carries the instrument's url query, which
 * is the aircraft author's to write: `: ` would make the item a mapping, ` #`
 * would end it at a comment, and a leading indicator would make it something
 * else entirely. Those are quoted; everything else is left as it was typed,
 * because a quoted `DisplayUnits` is noise in a file people read.
 */
function itemScalar(text: string): string {
  const plain =
    !/: | #|:$/.test(text) &&
    !/^[\s&*!|>'"%@`[\]{},?#-]/.test(text) &&
    text === text.trim()
  if (plain) return text

  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`
}

/** The paths a profile names under `include:`, as FS Copilot will read them. */
export function includePaths(lines: Line[]): string[] {
  return lines.flatMap((line) => {
    if (line.kind !== "sequenceItem" || line.context.block !== "include")
      return []

    const path = scalarValue(line.value).trim().replace(/\\/g, "/")
    return path ? [path] : []
  })
}
