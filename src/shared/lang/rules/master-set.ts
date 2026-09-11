/**
 * `dead-set` and `master-set-shape` — what a `master:` entry does with its
 * setter, which is not what the text says.
 *
 * Read from FS Copilot's own source (docs/fscopilot-behavior.md, pinned):
 * `ApplyTo` splits on the block. A `shared:` entry runs its expression
 * through the calculator — real RPN. A `master:` entry never does. It
 * matches the whole built expression against one regex:
 *
 *     ^(?<args>.*?)\s*\(\>\s*(?<name>[^,\)]+)\s*(?:,\s*(?<units>[^\)]+))?\s*\)$
 *
 * and then splits `args` on spaces and parses each one as a number, where
 * **anything non-numeric becomes 0**. Two failure modes follow, and they
 * are the two rules here:
 *
 * - **no match at all** — the setter is dead text. FS Copilot falls back to
 *   writing the incoming value to the `get:` variable, so the entry often
 *   still appears to work, which is exactly why nobody notices. JF_RJ_100's
 *   `set: K:THROTTLE1_SET` is the corpus's six instances: the throttle
 *   moves because the fallback writes the A: var, and the K: event named in
 *   the setter never fires.
 * - **a match whose args are not numbers** — the arithmetic silently
 *   becomes zeros. Nothing in the corpus does this today; the rule ships
 *   calibrated to zero, the way stack-balance did, because the shape is one
 *   keystroke away for anyone who moves a working `shared:` setter up.
 *
 * Both are grammar-and-source facts with no external evidence, so they
 * always run — but only for the setter kinds whose built expression is
 * knowable. A `javascript` setter's expression is whatever Jint returns;
 * the corpus has 96 of them under `master:`, and every one of them is
 * outside these rules by construction. Stated as a gap rather than guessed
 * at: absence of evidence is silence.
 */

import {
  bareEventName,
  isNumericParam,
  parseWrite,
  splitArgs,
} from "../../trace.ts"
import { diagnose, type RuleContext } from "../rules.ts"
import type { EntryDiagnostic, EntryRule, EntryView } from "../entry.ts"

/*
 * The regex and the number test used to live here, as this file's own copies
 * of `SetRegex` and `ParseParam`. They are `parseWrite` and `isNumericParam`
 * in src/shared/trace.ts now — the same functions the entry trace asks — so a
 * squiggle and a step cannot come to different conclusions about whether a
 * setter ends in a write, or about which of its operands became zeros.
 *
 * `bareEventName` went the same way, and it is the one with two readers who
 * both speak: this rule offers the `(>…)` fix when it answers, and the
 * trace's last line says the event never fires. One test, so the fix and the
 * sentence cannot be offered about different text.
 */

/** The trimmed setter and where it starts, or null when there is nothing. */
function setterText(
  entry: EntryView,
  context: RuleContext
): { text: string; at: number } | null {
  if (entry.block !== "master" || entry.set === undefined) return null

  // The built expression is only knowable for the kinds that do not run
  // through Jint first. An absent kind is unknown, which is also silence.
  const kind = context.setterKind
  if (kind !== "literal" && kind !== "prepended") return null

  // FS Copilot trims the value in `Definition`'s constructor, so the rules
  // read what it reads — and `at` keeps the offsets pointing at the text as
  // the author actually wrote it.
  const text = entry.set.trim()
  // An empty `set:` is the grammar's complaint to make, not this one's —
  // and a zero-width squiggle marks nothing.
  if (!text) return null

  return { text, at: entry.set.length - entry.set.trimStart().length }
}

export const deadSet: EntryRule = {
  id: "dead-set",
  family: "dialect",
  run(entry, context): EntryDiagnostic[] {
    const setter = setterText(entry, context)
    if (!setter || parseWrite(setter.text)) return []

    /*
     * A prepended setter cannot change the verdict: FS Copilot builds
     * `<value> <text>`, and the regex is anchored at the end, so a numeric
     * prefix can neither create a match nor destroy one. The written text
     * is the whole question.
     */
    const end = setter.at + setter.text.length

    /*
     * The corpus's whole population of this is one shape — a bare event
     * name where a write was meant — and it has an exact correction. Only
     * a lone namespaced name qualifies: wrapping real RPN in `(>` … `)`
     * would invent a different program. Note what the fix does *not* say:
     * "move it to shared:", which is right for master-set-shape and wrong
     * here — a bare name is not an expression, and the calculator would do
     * nothing with it either.
     */
    const bare = bareEventName(setter.text)

    return [
      diagnose({
        ruleId: "dead-set",
        target: "set" as const,
        severity: "warning",
        confidence: "certain",
        basis: "source",
        why: ["master-parsed-not-run", "master-fallback"],
        start: setter.at,
        end,
        verdict: "This setter never runs.",
        // The fallback is why the entry looks like it works, so the sentence
        // names where the value actually goes — and, for the lone event name
        // that is the corpus's whole population of this, what never happens.
        consequence:
          `The incoming value will be written to ${entry.name} instead` +
          (bare ? `, and ${bare} will never fire.` : "."),
        ...(bare
          ? {
              fix: {
                title: `Change to (>${setter.text})`,
                edits: [
                  { start: setter.at, end, newText: `(>${setter.text})` },
                ],
              },
            }
          : {}),
      }),
    ]
  },
}

export const masterSetShape: EntryRule = {
  id: "master-set-shape",
  family: "dialect",
  run(entry, context): EntryDiagnostic[] {
    const setter = setterText(entry, context)
    if (!setter) return []

    const write = parseWrite(setter.text)
    if (!write) return []

    /*
     * `splitArgs` is `Split(' ', RemoveEmptyEntries)` then `Trim()`, and it
     * keeps a part that trims away to nothing, because FS Copilot does: an
     * operand of pure tabs is read as 0 like any other non-number. The rule
     * drops those here rather than there, because naming an empty string in
     * the message helps nobody — the count is what matters, and the count is
     * the same.
     */
    const args = splitArgs(write.args).filter((part) => part !== "")
    const zeroed = args.filter((arg) => !isNumericParam(arg))
    if (!zeroed.length) return []

    // The pieces as FS Copilot cut them, which is rarely how they were
    // written — `(A:FOO, Bool)` arrives as `(A:FOO,` and `Bool)`. Showing
    // the cut is most of the explanation.
    const named = zeroed.slice(0, 3).join(" and ")

    return [
      diagnose({
        ruleId: "master-set-shape",
        target: "set" as const,
        severity: "warning",
        confidence: "certain",
        basis: "source",
        why: ["master-parsed-not-run"],
        start: setter.at,
        end: setter.at + write.args.length,
        verdict: "A master: setter computes nothing.",
        consequence:
          `${named} will ${zeroed.length > 1 ? "each " : ""}be sent as 0 — ` +
          `everything before (>${write.written}) is read as plain numbers.`,
      }),
    ]
  },
}
