/**
 * What the caret is inside of.
 *
 * `classifyLine` answers "what is this line", which is the question the
 * formatter asks. Completions ask a different one — "what is being typed right
 * now" — and a line under construction is a *prefix*, not a line: `- ge`,
 * `set:`, `  ` with nothing after it. Those never satisfy the strict grammar
 * and never should, because a half-written line is not a syntax error.
 *
 * So this is a second, smaller grammar, deliberately permissive where the
 * other is strict. What keeps the two from drifting is that the key names come
 * from the same constants, and the block a caret sits in comes from the same
 * `ScanState` the formatter uses rather than from a bespoke backwards scan.
 *
 * Everything a slot needs to become a completion is on it: `prefix` is the
 * text before the range being replaced, `typed` is the text inside it.
 */

import {
  CONTINUATION_KEYS,
  ENTRY_KEY,
  indentOf,
  isEntryBlock,
  type ScanState,
} from "./grammar.ts"

export type SlotKind =
  /** A bare word at column 0: `shared`, `master`, `include`, `ignore`. */
  | "topLevelKey"
  /** After `- ` where items are entries: only `get` opens one. */
  | "entryKey"
  /** After `- ` where items are plain strings: include paths, ignore names. */
  | "sequenceItem"
  /** An indented word under an entry: `set` or `skp`. */
  | "continuationKey"
  /** The variable name on a `get:` line, before any comma. */
  | "variable"
  /** The units on a `get:` line, after the comma. */
  | "units"
  /** The value of a `set:` — a write expression. */
  | "setValue"
  /**
   * The value of a `skp:` — the *name* of the variable whose next change is
   * suppressed. FS Copilot registers it into a table keyed by variable name
   * and looks it up with the `get:` name of another entry, so anything that is
   * not a variable name (`skp: true`, which 24 shipped profiles write) simply
   * never matches and does nothing.
   */
  | "skipTarget"
  /** Anywhere inside a `#` comment. */
  | "comment"
  /** Inside a block scalar body, where the language is JavaScript. */
  | "expression"
  /**
   * Inside an unclosed `(>` … write target, wherever it appears — a plain
   * `set:` value, a JavaScript expression, or a string inside one.
   *
   * This is where the simulator's names go, and it is invisible to the
   * JavaScript service: inside an expression the target is string contents,
   * so nothing but the profile corpus can say what belongs there.
   */
  | "writeTarget"

export interface Slot {
  kind: SlotKind
  /** Text before the range a completion replaces. */
  prefix: string
  /** Text inside that range — what the user has typed so far. */
  typed: string
}

// Permissive on purpose: `-get:` is not an entry to the strict grammar, but it
// is unmistakably someone typing one.
const GET_PREFIX = new RegExp(`^(\\s*-?\\s*${ENTRY_KEY}\\s*:\\s*)(.*)$`)
const CONTINUATION_PREFIX = new RegExp(
  `^\\s*(?:-\\s*)?(${CONTINUATION_KEYS.join("|")})\\s*:\\s*`
)

const COMMENT_PREFIX = /^(\s*)(#.*)$/
const SEQUENCE_PREFIX = /^(\s*-\s*)([\w:]*)$/
const INDENTED_WORD = /^(\s+)(\w*)$/
const BARE_WORD = /^(\w*)$/
/** The identifier fragment under the caret, for filtering inside an expression. */
const TRAILING_WORD = /([\w$]*)$/

/**
 * A `(>` whose `)` has not been typed yet. Anchored to the end, so the match
 * backtracks past any target that is already closed and finds the open one.
 */
const OPEN_WRITE_TARGET = /\(\s*>([^)]*)$/

/** A write target under the caret, or null. Namespaces count as typed text. */
function writeTarget(line: string): Slot | null {
  const match = OPEN_WRITE_TARGET.exec(line)
  if (!match) return null

  return {
    kind: "writeTarget",
    prefix: line.slice(0, match.index + match[0].length - match[1].length),
    typed: match[1],
  }
}

/**
 * Analyses a line up to the caret. `line` must already be truncated there.
 */
export function slotAt(line: string, context: ScanState): Slot | null {
  // Inside a block scalar the language is JavaScript, not the profile format.
  // The old test for this was an indentation threshold of six columns, which
  // is only the right number for a body under a continuation key.
  if (
    context.scalarKeyColumn !== null &&
    indentOf(line) > context.scalarKeyColumn
  ) {
    // A target inside the expression wins: it is the one part of a `set:`
    // block the JavaScript service cannot say anything useful about.
    const target = writeTarget(line)
    if (target) return target

    const word = TRAILING_WORD.exec(line)?.[1] ?? ""
    return {
      kind: "expression",
      prefix: line.slice(0, line.length - word.length),
      typed: word,
    }
  }

  const get = GET_PREFIX.exec(line)
  if (get) {
    // Past the comma the value is units, not a variable name.
    const comma = get[2].indexOf(",")
    if (comma === -1)
      return { kind: "variable", prefix: get[1], typed: get[2] }

    return {
      kind: "units",
      prefix: get[1] + get[2].slice(0, comma + 1),
      typed: get[2].slice(comma + 1),
    }
  }

  const continuation = CONTINUATION_PREFIX.exec(line)
  if (continuation) {
    if (continuation[1] !== "skp") {
      const target = writeTarget(line)
      if (target) return target
    }

    return {
      kind: continuation[1] === "skp" ? "skipTarget" : "setValue",
      prefix: continuation[0],
      typed: line.slice(continuation[0].length),
    }
  }

  // The `#` is inside the replaced range: every heading snippet writes its own.
  const comment = COMMENT_PREFIX.exec(line)
  if (comment)
    return { kind: "comment", prefix: comment[1], typed: comment[2] }

  const sequence = SEQUENCE_PREFIX.exec(line)
  if (sequence)
    return {
      kind: isEntryBlock(context.block) ? "entryKey" : "sequenceItem",
      prefix: sequence[1],
      typed: sequence[2],
    }

  // An indented word continues the entry above — but only while there is one.
  // After a blank line the group is closed, and what is being typed there is
  // the start of the next entry.
  const indented = INDENTED_WORD.exec(line)
  if (indented && isEntryBlock(context.block))
    return {
      kind: context.entryOpen ? "continuationKey" : "entryKey",
      prefix: indented[1],
      typed: indented[2],
    }

  const bare = BARE_WORD.exec(line)
  if (bare) return { kind: "topLevelKey", prefix: "", typed: bare[1] }

  return null
}
