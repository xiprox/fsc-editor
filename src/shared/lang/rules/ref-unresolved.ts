/**
 * `ref-unresolved` — a `get:` naming a variable the loaded aircraft does not
 * have, as the Link module reports it.
 *
 * The evidence tier's second source, and the one protocol 5 was built for.
 *
 * ## Why absence is visible here and nowhere else
 *
 * Proven in the sim 2026-08-27 (v1-log, "Protocol 4 verified in the sim").
 * `Z:AUDIO_Knob_Selector_1` reported nothing on either aircraft, and `exec
 * "(Z:AUDIO_Knob_Selector_1)"` explained why in two lines: the *calculator*
 * read created the variable — legacy touch-creates applies to `Z:` in RPN —
 * and the moment it existed the watch's retry resolved it. The typed Get the
 * module watches with does not create.
 *
 * That asymmetry is the whole rule. FS Copilot reads these lines through the
 * calculator, so its own read conjures the variable and then syncs a constant
 * 0 forever: the profile looks like it works and reports nothing. The module
 * declines to create, which is what makes the absence sayable. The thirteen
 * corpus lines reading `Z:AUDIO_Knob_Selector_1` are 2020-era, and the 2024
 * NavCom template uses that name only as an animation.
 *
 * ## Which names can be asked about
 *
 * Only the ones the module reads by typed id — `Z:`, `E:`, indexed `L:`, the
 * `readOf(name) === "watch"` set. Plain `L:` is streamed rather than watched
 * (the module forwards every variable that moves), so resolution never speaks
 * for it and its existence question belongs to a separate rule over the
 * enumeration. `A:` goes through SimConnect and is not in the mapping at all.
 *
 * And only `get:` lines, because only they enter the watch set: `store.ts`
 * builds it from the open tabs' `get:` names. A `Z:` written inside a `set:`
 * expression is never watched, so there is no evidence about it and this rule
 * says nothing — the reason it is an entry rule rather than an expression one.
 *
 * ## Absence stays weak
 *
 * A ref resolves the instant the variable appears, retry loop and all, so an
 * unresolved verdict is a fact about this moment: an aircraft still waking up,
 * or one where FS Copilot has not yet run the read that creates the thing.
 * **Warning, never error**, and the message says to check on a settled
 * aircraft — the same asymmetry `b-preset-unknown` carries for the same
 * reason.
 */

import { readOf } from "../../vars/index.ts"
import type { EntryDiagnostic, EntryRule } from "../entry.ts"
import { diagnose } from "../rules.ts"

export const refUnresolved: EntryRule = {
  id: "ref-unresolved",
  family: "sim",
  run(entry, context): EntryDiagnostic[] {
    if (!context.refResolved) return []
    // Namespaces the module does not watch are never in the mapping, so
    // asking would always answer null. Gating makes that honest rather than
    // accidental.
    if (readOf(entry.name) !== "watch") return []

    // Only an explicit false is evidence. Null is "no verdict" — no module,
    // no tab, or a watch set still in flight — and must stay silent.
    if (context.refResolved(entry.name) !== false) return []

    return [
      diagnose({
        ruleId: "ref-unresolved",
        target: "get" as const,
        severity: "warning",
        // A ref resolves the instant the variable appears, so this is a fact
        // about now — see "Absence stays weak" above.
        confidence: "likely",
        basis: "observed",
        why: ["calculator-read-creates"],
        start: 0,
        end: entry.name.length,
        verdict: `The aircraft in the sim has no ${entry.name}.`,
        // The part nobody would guess, and the reason this is worth a
        // squiggle at all: the failure does not look like one.
        consequence:
          "This entry will sync a constant 0 and nothing will look broken — " +
          "FS Copilot's own read creates the variable.",
        remedy:
          "A variable can appear late, so check on an aircraft that has " +
          "finished loading before changing it.",
      }),
    ]
  },
}
