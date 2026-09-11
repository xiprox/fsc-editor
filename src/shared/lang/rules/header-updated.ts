/**
 * `header-updated` — a profile with no `# Updated:` date.
 *
 * The one rule in this codebase that fires on something *not* being there,
 * and it earns that by naming a consequence rather than a convention.
 *
 * `Definitions.Load` reads the date through `TryReadUpdatedUtc` and falls
 * back to `DateTime.MinValue` when there is none. `MainViewModel` then does
 *
 *     .Select(updatedAt => updatedAt != null && updatedAt > defs.UpdatedAt)
 *     .Subscribe(updateAvailable => NewProfileAvailable = updateAvailable)
 *
 * so with no date **every** published version compares as newer and FS
 * Copilot offers to replace the profile — not once, but every time it
 * checks, forever. A profile that is more current than the published one
 * still gets told to overwrite itself. That is why this is an error and not
 * the style nag it looks like.
 *
 * ## What is deliberately not checked
 *
 * An *unparseable* date has the identical consequence — `TryReadUpdatedUtc`
 * returns null and the date is `MinValue` just the same. It is not flagged,
 * because deciding it means mirroring .NET's
 * `DateTime.TryParse(raw, CultureInfo.InvariantCulture, …)` in JavaScript,
 * whose accepted formats are not the same set. All 52 dates in the corpus
 * are `yyyy-MM-dd` or `yyyy-MM-dd HH:mm:ss`, both of which parse, so the
 * branch would be an emulation risk with nothing to catch. It belongs with
 * the run-the-real-parser evidence tier, not here.
 *
 * Nor is a near-miss suggested. None of the four corpus profiles missing the
 * header wrote `# Last Updated:` or anything else date-shaped — they simply
 * have no such line, so there is nothing to correct *to*.
 */

import type { ProfileDiagnostic, ProfileRule } from "../profile.ts"
import { diagnose } from "../rules.ts"

export const headerUpdated: ProfileRule = {
  id: "header-updated",
  family: "dialect",
  run({ entries, blocks, updated }): ProfileDiagnostic[] {
    if (updated) return []

    /*
     * A file with no entries is not yet a profile — somebody has opened a
     * blank one, or written a header and stopped. The absence rules in
     * 18-language-core hold: nothing here nags a file that is still being
     * started. An entry is what makes the missing date cost something.
     */
    if (!entries.length) return []

    // The top of the profile proper. Entries cannot exist without a block
    // above them, so this is always here when the guard above passes.
    const anchor = blocks[0]
    if (!anchor) return []

    return [
      diagnose({
        ruleId: "header-updated",
        line: anchor.line,
        severity: "error",
        confidence: "certain",
        basis: "source",
        why: ["updated-date-compared"],
        start: 0,
        end: anchor.text.length,
        verdict: "This profile has no Updated date.",
        // Conditional, because it is: `updatedAt != null && …` — with no
        // published profile for the aircraft there is nothing to offer.
        consequence:
          "If a published profile exists for this aircraft, FS Copilot will " +
          "offer to replace this one every time it checks, however current " +
          "this one is.",
        remedy: "Add a header line such as # Updated: 2026-08-29.",
      }),
    ]
  },
}
