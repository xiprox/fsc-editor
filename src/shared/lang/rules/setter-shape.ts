/**
 * The setter-shape family — what the written shape means, versus what was
 * plainly meant. FS Copilot picks the kind of a setter from its *shape*
 * (`Definition.Set`), so the mistake class here is an author writing one
 * kind and getting another.
 *
 * Two of the three ship with **zero corpus hits**, deliberately. A rule that
 * only gets written after somebody's profile breaks is a rule that arrived
 * too late for them, and both of these are precise: the calibration that
 * found nothing also proved they cannot fire on the 1,940 correct prepended
 * setters or the 8,600 correct expressions the corpus already contains.
 *
 * One catalogued rule of this family is **struck**, not deferred:
 * "`${value}` inside a `literal` setter" cannot happen. `Set`'s trigger is
 * `_set.IndexOfAny(['\\'', '`', '?', '{', '}'])`, so any text containing
 * `${…}` has a `{` and is a *javascript* setter by construction. There is no
 * such thing as a literal setter with a hole in it.
 */

import { parseVar } from "../../vars/parse.ts"
import { parseRpn } from "../ir.ts"
import type { EntryDiagnostic, EntryRule } from "../entry.ts"
import { diagnose } from "../rules.ts"

/**
 * `value` and `current` exist only inside the JavaScript engine. Written
 * into RPN they are bare words, and the 2026-08-29 probe settled what the
 * calculator does with one of those: nothing at all. It is not an error, it
 * is not a variable, it is silently skipped — so the arithmetic the author
 * wrote around it runs on whatever else was on the stack.
 */
const IDENTIFIER = /(^|[\s(])(value|current)(?=[\s)]|$)/

export const valueWord: EntryRule = {
  id: "value-word",
  family: "setter",
  run(entry, context): EntryDiagnostic[] {
    const kind = context.setterKind
    if (kind !== "literal" && kind !== "prepended") return []
    if (entry.set === undefined) return []

    const found = IDENTIFIER.exec(entry.set)
    if (!found) return []

    const word = found[2]!
    const start = found.index + found[1]!.length

    return [
      diagnose({
        ruleId: "value-word",
        target: "set" as const,
        severity: "warning",
        confidence: "certain",
        basis: "source",
        why: ["setter-kind-by-shape", "bare-word-ignored"],
        start,
        end: start + word.length,
        verdict: `${word} only exists in a JavaScript setter, and this is not one.`,
        consequence:
          "The calculator will ignore it, and the rest will run without it.",
        // Which characters make a setter JavaScript is the fact's to say —
        // one of them is a backtick, which a plain venue cannot show as code.
        remedy: "To use it, write the setter as a JavaScript template string.",
      }),
    ]
  },
}

/**
 * A prepended setter is one whose text begins with `(`, and FS Copilot then
 * sends `<value> <text>`. If the expression never reaches below its own
 * pushes, that leading value is simply left on the stack and the entry
 * applies whatever the expression computed instead of what the other pilot
 * sent.
 *
 * This owns its own walk rather than calling `simulate`, for the reason
 * `stack-balance` gives for the same choice: the shared model *softens* a
 * bare `(>K:E)` to pop at most what is available, which is what keeps
 * stack-balance quiet on the corpus and is exactly the wrong model for this
 * question. Strictly walked, all 1,940 corpus prepended setters consume
 * their value — the soft model calls 1,888 of them unconsumed.
 */
function reachesBelowItsOwnPushes(text: string): boolean | null {
  let depth = 0

  for (const node of parseRpn(text).nodes) {
    let pops = 0
    let pushes = 0

    if (node.kind === "invisible") continue
    else if (node.kind === "value") pushes = 1
    else if (node.kind === "ref") {
      if (node.access === "read") pushes = 1
      else pops = node.ref.ns === "K" ? (node.ref.params ?? 1) : 1
    } else {
      // An unknown word could do anything; refuse to judge rather than guess.
      if (node.effect === null) return null
      pops = node.effect.pops
      pushes = node.effect.pushes
    }

    if (depth - pops < 0) return true
    depth = depth - pops + pushes
  }

  return false
}

export const prependedUnused: EntryRule = {
  id: "prepended-unused",
  family: "setter",
  run(entry, context): EntryDiagnostic[] {
    if (context.setterKind !== "prepended" || entry.set === undefined) return []

    const text = entry.set.trim()
    if (!text || reachesBelowItsOwnPushes(text) !== false) return []

    const at = entry.set.length - entry.set.trimStart().length

    return [
      diagnose({
        ruleId: "prepended-unused",
        target: "set" as const,
        severity: "warning",
        // The prepending is source; whether the value is reached is a stack
        // walk that refuses unknown words rather than guessing at them.
        confidence: "likely",
        basis: "source",
        why: ["setter-kind-by-shape"],
        start: at,
        end: at + text.length,
        verdict: "This setter never uses the value it is sent.",
        consequence:
          `${entry.name} will be set to whatever this computes, not to what ` +
          `the other pilot sent.`,
      }),
    ]
  },
}

/**
 * An implicit setter — no `set:` at all, which is 60% of the corpus — writes
 * `value (>Get, Units)`. When `Get` is an `A:` variable the SDK documents as
 * not settable, that write has nowhere to go.
 *
 * **Info, and phrased as the SDK's claim rather than as fact.** 119 corpus
 * entries across 32 names are in this position, in profiles people fly, and
 * a premise with that many counterexamples does not get to warn — the
 * `b-write-op` lesson. The docs' settable column is also the wrong side of
 * the question FS Copilot actually asks: it writes `A:` through a SimConnect
 * data definition, not through the calculator, so the honest resolution is
 * the evidence tier asking a running sim, not a stronger reading of a
 * column.
 */
export const notSettable: EntryRule = {
  id: "not-settable",
  family: "setter",
  run(entry, context): EntryDiagnostic[] {
    // Implicit only: with a `set:` the author has said what to do instead.
    if (entry.set !== undefined) return []

    const ref = parseVar(entry.name)
    if (ref.ns !== "A") return []

    if (context.simVarSettable?.(`A:${ref.name}`) !== false) return []

    return [
      diagnose({
        ruleId: "not-settable",
        target: "get" as const,
        severity: "info",
        // 119 entries in profiles people fly say the column is not the last
        // word — see above.
        confidence: "possible",
        basis: "sdk-docs",
        why: ["implicit-setter", "sdk-settable"],
        start: 0,
        end: entry.get.length,
        verdict: `The SDK lists ${entry.name} as read-only.`,
        consequence:
          "With no set: line the incoming value is written straight to it, " +
          "and that write may go nowhere.",
        remedy: "The usual way round is a K: event in a set: line.",
      }),
    ]
  },
}
