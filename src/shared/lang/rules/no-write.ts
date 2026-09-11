/**
 * `no-write` — a `shared:` setter that cannot write anything.
 *
 * The sibling of `dead-set`, on the other side of the block split, and the
 * harsher of the two. A `master:` setter that misses ParseSet still applies
 * *something*: FS Copilot falls back to writing the value to the `get:`
 * variable, which is why JF_RJ_100's throttles appear to work. A `shared:`
 * setter goes to `sim.Execute` and there is no fallback at all. If the
 * expression contains no write, the entry silently never applies an
 * incoming value — it still sends the local one, so the profile looks
 * half-alive, and the direction that is broken is the one nobody watches.
 *
 * ## Why "contains no write" is the whole test
 *
 * `(>NAME)` is the only way calculator code writes, so an expression
 * without one cannot. That was inference until 2026-08-29, when the corpus
 * offered five counterexample-shaped lines — four WBSIM `H:KAP140_*_PRESS`
 * and one inibuilds `NAV SWAP:2 = 1` — all written as bare words, as if a
 * name alone were a command. The probe (v1-log, "Bare words are ignored")
 * settled it on synaptic_a220:
 *
 *   - `K:KOHLSMAN_SET` bare left the altimeter at 1015, while
 *     `1 16272 (>K:2:KOHLSMAN_SET)` moved it to 1017 in the same session.
 *     A bare name does not fire.
 *   - `0 (>L:P) K:KOHLSMAN_SET 7 (>L:P) (L:P)` returned **7**, and the same
 *     with `H:KAP140_NAV_PRESS` also returned 7: the token is silently
 *     ignored, not a parse error that aborts what follows.
 *
 * So a bare word reads nothing, writes nothing, fires nothing and stops
 * nothing. All five corpus lines are dead text.
 *
 * **Error, not warning** — the difference from `dead-set` is deliberate.
 * There is no fallback here to make the entry work by accident.
 *
 * Muted for `javascript`, whose expression is Jint's output, and for
 * `implicit`, which has no `set:` and writes the `get:` name by
 * construction.
 */

import { collectRefs } from "../refs.ts"
import { parseVar } from "../../vars/parse.ts"
import type { EntryDiagnostic, EntryRule } from "../entry.ts"
import { diagnose } from "../rules.ts"

export const noWrite: EntryRule = {
  id: "no-write",
  family: "dialect",
  run(entry, context): EntryDiagnostic[] {
    if (entry.block !== "shared" || entry.set === undefined) return []

    const kind = context.setterKind
    if (kind !== "literal" && kind !== "prepended") return []

    const text = entry.set.trim()
    if (!text) return []

    /*
     * `collectRefs`, not the top-level parse: it descends through quoting
     * and holes, so a write hiding anywhere counts. An *unterminated* write
     * counts too — `(>B:FOO` still parses as one — which keeps this rule
     * off the Albatross lines that `rpn-unterminated` already owns. One
     * mistake, one squiggle.
     */
    if (collectRefs(text).some((ref) => ref.access === "write")) return []

    const at = entry.set.length - entry.set.trimStart().length
    // The same lone-name correction `dead-set` offers, for the same reason:
    // four of the five corpus lines are an event name that meant to be a
    // write. Anything else is a program, and wrapping a program changes it.
    const bare = parseVar(text).ns !== null && !/[\s()]/.test(text)

    return [
      diagnose({
        ruleId: "no-write",
        target: "set" as const,
        severity: "error",
        confidence: "certain",
        basis: "source",
        why: ["shared-runs-in-calculator", "bare-word-ignored"],
        start: at,
        end: at + text.length,
        verdict: "This setter writes nothing — there is no (>…) in it.",
        consequence: `${entry.name} will never apply a value from the other pilot.`,
        ...(bare
          ? {
              fix: {
                title: `Change to (>${text})`,
                edits: [
                  { start: at, end: at + text.length, newText: `(>${text})` },
                ],
              },
            }
          : {}),
      }),
    ]
  },
}
