/**
 * `b-value-constant` — a `get:` on a `B:` control whose value never moves.
 *
 * ## The two zeros
 *
 * An input event's value reads `0` in two completely different situations, and
 * they are indistinguishable by reading it. Measured on the A220, 2026-09-04
 * (see the entry in `docs/sim-vars/build/v1-log.md`):
 *
 * - **A momentary control** — a push button — fires with the value `0` every
 *   time it is pressed. `AIRLINER_FCU_ALT_PUSH` produced ten arrivals in under
 *   a second while being worked, all of them `0`. Its value is not state; it
 *   has none. A `get:` on it can never report anything.
 * - **A latching control nobody has touched.** `AIRLINER_LDG_LEVER` also read
 *   `0` throughout, because the aeroplane was on the runway with the gear down.
 *   A `get:` on it is perfectly good and will report the moment somebody
 *   retracts it.
 *
 * Polling faster distinguishes nothing: the value is `0` at every sample rate.
 * What separates them is whether the control has been **worked** — which the
 * subscription reports as a firing even when the value does not move, and which
 * `store.ts` counts separately for exactly this rule.
 *
 * So: fired repeatedly, never changed → the value is a constant, and a line
 * reading it is reading nothing. Never fired → no evidence, no diagnostic.
 *
 * ## Why this is worth a warning
 *
 * There are **651 `get: B:` lines across the corpus**. A `get:` on a momentary
 * control is a silently broken read — it produces a number, so nothing looks
 * wrong, and the number is always the same one. Somebody experienced spots it
 * by watching the gutter while working the switch. This rule is for everybody
 * else.
 *
 * ## Evidence, not declaration
 *
 * Nothing in the simulator says which controls are momentary: every one of the
 * A220's 464 events declares `DOUBLE`, and `enumerateInputEventParams` returns
 * `";FLOAT64"` for all of them. It is authored in the aircraft's model
 * behaviors — the same wall `b-preset.ts` documents for writes. So this is
 * learned by watching, it accumulates across sessions, and it appears and
 * disappears with the simulator like every rule in the evidence tier.
 *
 * Absence of evidence stays quiet, which is the whole discipline here: a rule
 * that warned on every untouched control would warn on almost every `B:` line
 * on a freshly loaded aeroplane.
 */

import { inputEventIds } from "../../vars/input-events.ts"
import { parseVar } from "../../vars/parse.ts"
import type { EntryDiagnostic, EntryRule } from "../entry.ts"
import { diagnose } from "../rules.ts"
import type { RuleContext } from "../rules.ts"

/**
 * How many separate firings before silence becomes evidence.
 *
 * One is a coincidence: `store.ts` separates a press from a 4 Hz tick by the
 * gap between arrivals, and a simulator stall long enough to look like a gap
 * would manufacture exactly one. Three of them is somebody working a control
 * and watching nothing happen — which is the observation this rule is making
 * on their behalf.
 */
const ENOUGH_FIRINGS = 3

/** The activity recorded for whichever id a written name resolves to. */
function activityFor(
  written: string,
  preset: string,
  context: RuleContext
): { firings: number; changes: number } | null {
  if (!context.inputEventActivity) return null

  for (const id of inputEventIds(written, preset)) {
    const activity = context.inputEventActivity(id)
    if (activity) return activity
  }

  return null
}

export const bValueConstant: EntryRule = {
  id: "b-value-constant",
  family: "sim",
  run(entry, context): EntryDiagnostic[] {
    const ref = parseVar(entry.name)
    if (ref.ns !== "B") return []

    const activity = activityFor(ref.name, ref.preset, context)
    if (!activity) return []

    // Worked enough to be sure, and never once moved. Either half missing is
    // silence: too few firings is not yet evidence, and any change at all
    // means the control does carry state and the read is good.
    if (activity.firings < ENOUGH_FIRINGS) return []
    if (activity.changes > 0) return []

    return [
      diagnose({
        ruleId: "b-value-constant",
        target: "get" as const,
        // Info, and an observation rather than a verdict. Firings without a
        // change are also what a latching control produces when it is worked
        // against its stop, or while whatever it switches cannot change —
        // seen in practice on controls whose value does move. One change
        // ever recorded silences this for good; until then it can only say
        // what it has seen.
        severity: "info",
        confidence: "possible",
        basis: "observed",
        why: ["momentary-reads-zero"],
        start: 0,
        end: entry.get.length,
        verdict: `${ref.name} has fired ${activity.firings} times and its value has not changed.`,
        // Both readings, because the evidence cannot tell them apart and
        // the author can — the user's own wording, 2026-09-19.
        consequence:
          "This might mean that this event carries no value and can't be " +
          "relied upon. Or it might mean that the value hasn't changed " +
          "between these " + activity.firings + " instances.",
      }),
    ]
  },
}
