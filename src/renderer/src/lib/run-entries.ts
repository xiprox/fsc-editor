/**
 * Which entries in a file can be run, and where their button goes.
 *
 * The button belongs to the **entry**, not to a `set:` line. 60% of the corpus
 * has no `set:` at all — FS Copilot writes the value straight to the `get:`
 * variable — and those are the plainest switches in any profile, so they are
 * the ones most worth a one-click check. So the anchor is the `set:` line when
 * there is one and the `get:` line when there is not.
 *
 * The `get:` line is carried either way, because it is what the popover asks
 * the user to watch: its live value is the answer to "did that work".
 *
 * Built on `scanLines` rather than `scanEntries`, which returns entries without
 * line numbers — and line numbers are the whole point here.
 */

import {
  expressionAt,
  extendsEntry,
  plainValue,
  scalarValue,
  scanLines,
  splitUnits,
  type Line,
} from "@shared/profile"
import type { SetterEntry } from "@shared/setter"

export interface RunnableEntry {
  /** Line the button is drawn on: the `set:` line, or the `get:` line. */
  line: number
  /** 1-based column the key starts at, so the button lands in front of it. */
  column: number
  /** The `get:` line, whose live value is what you watch after running. */
  getLine: number
  /**
   * The entry's last line, block-scalar bodies included.
   *
   * Only the dimming uses it: while the popover is open every line *except*
   * this entry's is dimmed, and for a block setter the body below the `set:`
   * line is the code being tested — dimming it would hide the thing being
   * looked at.
   */
  endLine: number
  entry: SetterEntry
}

/**
 * The `set:` text for an entry, block scalars included.
 *
 * A block scalar's value is not on the `set:` line — the line only opens it —
 * so the expression is read from the first body line, which is what
 * `expressionAt` is built to do.
 *
 * A one-line value goes through `scalarValue`, which gives what FS Copilot's
 * own parser gives it: a trailing comment dropped, and the quoting gone. The
 * quoting is the part that matters here — the corpus writes 6,030 of these
 * quoted, and a template literal evaluated with its double quotes still around
 * it is just a string whose value is the source text. The run would send the
 * expression rather than the code the expression computes.
 */
function setTextAt(lines: Line[], at: number): string | undefined {
  const line = lines[at]
  if (line.kind !== "continuation" || line.key !== "set") return undefined

  if (line.scalar) return expressionAt(lines, line.number + 1)?.text

  const value = scalarValue(line.value)

  return value || undefined
}

export function runnableEntriesIn(text: string): RunnableEntry[] {
  const lines = scanLines(text)
  const found: RunnableEntry[] = []

  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]
    if (line.kind !== "entry" || line.key !== "get") continue

    const { name, units } = splitUnits(plainValue(line.value))
    // A `get:` with nothing after it is a line being typed, not an entry.
    if (!name) continue

    const getLine = line.number
    let anchor = { line: getLine, column: line.keyColumn + 1 }
    let endLine = getLine
    let set: string | undefined

    // Forward to the end of this entry, which is the next one or the next
    // block. `skp:` and anything else in between is somebody else's business —
    // but it is still part of the entry, so it counts towards `endLine`.
    for (let next = at + 1; next < lines.length; next++) {
      const after = lines[next]
      if (after.kind === "entry" || after.kind === "blockKey") break

      /*
       * Only lines that are part of the entry extend it, and only if they hold
       * something — the blank line before the next entry is not the entry, and
       * inside a block scalar it is *scanned* as one because a literal block's
       * trailing blank lines belong to the value. Lighting them would leave
       * the popover sitting under a strip of undimmed nothing.
       *
       * The rule is `extendsEntry` in the grammar, which is also what fills
       * `at.end` for the Trace panel's locator. Reading it from there rather
       * than keeping a second copy: this walk and that one agreed when both
       * were written, and the way they stop agreeing is one of them being
       * fixed.
       */
      if (extendsEntry(after)) endLine = after.number

      if (after.kind !== "continuation" || after.key !== "set") continue
      if (set !== undefined) continue

      set = setTextAt(lines, next)
      // The button moves to the `set:` line even when the value is empty or
      // unreadable: what the user wants to run is the line they are looking at,
      // and an unresolvable setter is a thing the popover can say.
      anchor = { line: after.number, column: after.keyColumn + 1 }
    }

    found.push({ ...anchor, getLine, endLine, entry: { name, units, set } })
  }

  return found
}

/** The entry whose button is on this line, if any. */
export function runnableAt(
  entries: RunnableEntry[],
  line: number
): RunnableEntry | undefined {
  return entries.find((entry) => entry.line === line)
}
