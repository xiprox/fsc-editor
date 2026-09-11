/**
 * Reading a profile's entries out of its lines.
 *
 * This is what feeds the completion dictionary: every `get:` in the installed
 * corpus, with the `set:` that applies it, the comment that documents it and
 * the headings it sits under. A YAML parser would give the first two and drop
 * the rest, which is why it folds over the grammar instead.
 */

import {
  ENTRY_KEY,
  type EntryBlock,
  isEntryBlock,
  type Line,
  scalarValue,
  scanLines,
} from "./grammar.ts"
import { headingTrail } from "./outline.ts"
import { parseVar } from "../vars/index.ts"

const MAX_DOC_LENGTH = 320

/**
 * Where an entry's own lines are, 1-based.
 *
 * The prerequisite the entry-level rules named in docs/sim-vars/18-language-core
 * needed: a verdict about an entry has to land on a line, and the entry was
 * the one thing in the pipeline that had forgotten where it came from. Line
 * numbers rather than `Line` objects — an entry crosses IPC, and a `Line`
 * carries its whole scan state with it.
 *
 * `set` and `skp` name the *key* line even when the value is a block scalar
 * spanning several after it; that is the line the value is addressed by, and
 * `expressionAt` walks from there to the body.
 */
export interface EntryLines {
  /** The `- get:` that opened the entry. */
  get: number
  set?: number
  skp?: number
  /**
   * The entry's last line, block-scalar bodies included.
   *
   * Not the same as its last key: a `set: >` opens a value that lives on the
   * lines below it, and those lines are the entry. The Trace panel's locator
   * reads `lines 31-33` off this, and the run popover dims everything except
   * this range — for a block setter the body below `set:` is the code being
   * tested, so dimming it would hide the thing being looked at.
   *
   * Equal to `get` for an entry that occupies one line.
   */
  end: number
}

/**
 * Whether a line extends the entry above it.
 *
 * The subtle half of the extent, and the reason it is one exported rule
 * rather than a walk in each caller: **a blank line inside a literal block is
 * part of the value, and a blank line before the next entry is not.** The
 * scanner has already told the two apart — the first is a `scalarBody` — so
 * the test is whether the line holds anything, not where it sits.
 *
 * `run-entries.ts` asks this too. It cannot simply read `at.end`, because it
 * accepts a `get:` under any block and `entriesFromLines` only keeps the two
 * that hold entries; sharing the rule rather than the loop keeps that
 * difference intact while leaving one place for the rule to be wrong.
 */
export function extendsEntry(line: Line): boolean {
  if (!line.text.trim()) return false

  return (
    line.kind === "continuation" ||
    line.kind === "scalarBody" ||
    line.kind === "mapping"
  )
}

export interface RawEntry {
  name: string
  units: string
  /**
   * The profile wrote the unit, rather than it being inferred from silence.
   *
   * Kept because the two are indistinguishable afterwards and mean very
   * different things: most `L:` lines carry no unit, so a resolved "Number" is
   * usually nobody's decision.
   */
  unitsExplicit: boolean
  block: EntryBlock
  file: string
  /** Line numbers for the entry's own lines, for positioning a verdict. */
  at: EntryLines
  set?: string
  skp?: string
  /** The `set:` was a block scalar, so its value spans lines. */
  scalar?: boolean
  comment?: string
  heading?: string
}

/**
 * Splits `NAME, units` the way FS Copilot does, including its defaults: no
 * units for K: and H: events, "Number" for everything else.
 */
export function splitUnits(raw: string): {
  name: string
  units: string
  explicit: boolean
} {
  const parts = raw.split(",")
  const name = parts[0].trim()

  // Only the second field: FS Copilot reads parts[1] and discards the rest, so
  // `A:FOO, Position 16k, Number` is a Position 16k variable with a stray
  // trailing field, not a variable with two units.
  if (parts.length > 1) return { name, units: parts[1].trim(), explicit: true }

  /*
   * FS Copilot's defaulting, not the sim's capability table: an event line
   * carries no unit, everything else means Number. Asked of the parser rather
   * than of the first letter — the `startsWith("K")` this replaces would have
   * called a bare name like `Kollsman_Knob` an event, unit-less, silently.
   */
  const ns = parseVar(name).ns
  const isEvent = ns === "K" || ns === "H"
  return { name, units: isEvent ? "" : "Number", explicit: false }
}

export function scanEntries(relPath: string, text: string): RawEntry[] {
  return entriesFromLines(scanLines(text), relPath)
}

/**
 * The same fold, over a scan a caller already has.
 *
 * `analysis.ts` walks the lines itself to place diagnostics; making it scan
 * a second time to learn which entry a `set:` belongs to would be one text,
 * two passes, and eventually two answers.
 */
export function entriesFromLines(lines: Line[], relPath = ""): RawEntry[] {
  const entries: RawEntry[] = []

  let pending: string[] = []
  let current: RawEntry | null = null
  let scalar: { key: string; body: Line[]; at: number } | null = null

  const documentation = () =>
    pending.join(" ").slice(0, MAX_DOC_LENGTH) || undefined

  /**
   * Closes an open block scalar onto its entry.
   *
   * Without this the value of a `set: >` is the indicator and nothing else,
   * and every write target inside the block — which is where the interesting
   * ones live — is invisible to everything downstream.
   */
  const closeScalar = () => {
    const open = scalar
    scalar = null
    if (!open || !current) return

    const filled = open.body.filter((line) => line.text.trim() !== "")
    if (!filled.length) return

    // The block's own indentation is not part of the value.
    const base = Math.min(...filled.map((line) => line.indent))
    const value = open.body
      .map((line) => line.text.slice(base))
      .join("\n")
      .trim()
    if (!value) return

    if (open.key === "set") {
      current.set = value
      current.scalar = true
      current.at.set = open.at
    } else {
      current.skp = value
      current.at.skp = open.at
    }
  }

  for (const line of lines) {
    // Before the switch, because a `scalarBody` never reaches it and the body
    // of a block scalar is exactly what makes the extent worth having.
    if (current && extendsEntry(line)) current.at.end = line.number

    if (line.kind === "scalarBody") {
      if (scalar) scalar.body.push(line)
      continue
    }

    closeScalar()

    switch (line.kind) {
      // The only comments that document anything.
      case "prose":
        pending.push(line.body)
        continue

      // A heading is structure and a divider is decoration; both separate what
      // is above them from what is below, so documentation does not cross one.
      case "heading":
      case "divider":
      case "blank":
        pending = []
        continue

      // A parked entry is code someone left in place. It is not documentation,
      // but it does not end it either — prose sitting above a disabled
      // alternative still describes the entry that replaced it. Transparent
      // rather than clearing, which also makes the classifier's inability to
      // tell `# get: A:FOO` from the prose line `# get: lvar because …`
      // harmless: either way the comment above survives.
      case "parked":
        continue

      case "blockKey":
        pending = []
        current = null
        continue

      case "entry": {
        current = readEntry(line, relPath, documentation())
        if (current) entries.push(current)
        pending = []
        continue
      }

      case "continuation": {
        if (!current) continue

        // A block scalar's value is its body, gathered by `closeScalar`.
        if (line.scalar) {
          scalar = { key: line.key, body: [], at: line.number }
          continue
        }

        /*
         * `scalarValue`, not `plainValue`: entries store what FS Copilot's
         * YAML parser hands FS Copilot, and 6,030 of the corpus's one-line
         * `set:` values are double-quoted to get a backtick past YAML. The
         * quotes are syntax, not setter. `plainValue` remained here long
         * after `scalarValue` existed for the run path, so the dictionary
         * held `"..."` while the run feature ran `...` — one value, two
         * stories, found when the language sweep tokenized the quotes.
         */
        const value = scalarValue(line.value)
        if (line.key === "set") {
          current.set = value
          current.at.set = line.number
        } else {
          current.skp = value
          current.at.skp = line.number
        }
        continue
      }

      default:
        pending = []
        continue
    }
  }

  closeScalar()
  return entries
}

function readEntry(
  line: Extract<Line, { kind: "entry" }>,
  relPath: string,
  comment: string | undefined
): RawEntry | null {
  const block = line.context.block

  // `include:` and `ignore:` items are not entries, and neither is a sequence
  // item keyed on anything but `get`.
  if (line.key !== ENTRY_KEY || !isEntryBlock(block)) return null

  // `scalarValue` for the same reason as `set:` above. No `get:` line in the
  // corpus is quoted today, and for plain scalars the two are identical — this
  // is the correct answer waiting for the first author who quotes one.
  const { name, units, explicit } = splitUnits(scalarValue(line.value))
  if (!name) return null

  return {
    name,
    units,
    unitsExplicit: explicit,
    block,
    file: relPath,
    at: { get: line.number, end: line.number },
    comment,
    heading: headingTrail(line),
  }
}
