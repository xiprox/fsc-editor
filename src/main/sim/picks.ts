/**
 * The values a variable has actually been seen at, for the run popover.
 *
 * Typing a number into a field means knowing what number to type, and for a
 * three-position flap lever or a guarded switch the answer is a fact the ring
 * buffer already holds. Offering it turns "what does this thing take?" into a
 * click.
 *
 * ## Why there is a threshold rather than a top-N
 *
 * Measured: the median `L:` variable takes **73 distinct values in 75 seconds**
 * — every counter, every heartbeat, every continuously-driven gauge — so a list
 * of "values seen" is noise for most of the table. But the distribution is not
 * flat: **30% take two or fewer and 40% take ten or fewer**, and those are the
 * switches and detents somebody writing a profile is actually poking at.
 *
 * So picks are all-or-nothing below a threshold rather than the first few of a
 * long list. A truncated list of a knob's 73 positions would look like a set of
 * choices while being an arbitrary sample of one, which is worse than no list:
 * it invites a click on a number that means nothing.
 *
 * ## Which variable
 *
 * The **`get:` variable's** values, never the write target's. `value` is the
 * input to the setter expression, and `${value * 100} (>L:Com1FreqInnerKnob)`
 * writes a hundred times it — for every transforming setter the two are
 * different numbers, and offering the target's would offer the wrong ones.
 *
 * ## `B:` arrives as a different event, under a different name
 *
 * Input-event firings are `kind: "input"` and carry the **bare enumerated id**
 * — the `B:` prefix is added by `store.ts` on the way into the var index, not
 * on the captured event. A `get:` line names the written form, which is
 * prefixed and 232 times over in the corpus carries an operation suffix as
 * well (`get: B:X_Toggle` is legal dialect; see 18-language-core). So the
 * written name is resolved through `inputEventIds` — the same helper the live
 * value and `b-preset` use, so a pick list and the gutter above it cannot
 * disagree about which control a line means.
 */

import type { CapturedEvent } from "@shared/sim"
import { inputEventIds, parseVar } from "@shared/vars"

/**
 * Above this many distinct values, a variable has no picks worth showing.
 *
 * Between the 30% that take ≤2 and the 40% that take ≤10, so it catches the
 * switches and stops short of anything continuous.
 */
export const PICK_LIMIT = 8

/**
 * The bare input-event ids a written name could be taking its value from.
 *
 * Empty for every other namespace, which is what keeps the `input` branch of
 * the loop from matching anything for an `L:` or `A:` name.
 */
function inputIds(name: string): Set<string> {
  const ref = parseVar(name)
  if (ref.ns !== "B") return new Set()

  return new Set(inputEventIds(ref.name, ref.preset))
}

/**
 * Distinct values seen for one variable, ascending, or null if there is no
 * useful list.
 *
 * Ascending because these are positions on a control — 0, 25, 50, 100 reads as
 * a range, and first-seen order reads as history nobody asked about.
 */
export function picksIn(
  events: CapturedEvent[],
  name: string,
  limit = PICK_LIMIT
): number[] | null {
  const ids = inputIds(name)
  const seen = new Set<number>()

  for (const event of events) {
    if (event.kind === "input") {
      if (!ids.has(event.name)) continue
      // Numbers only, for the reason `recordInputValue` drops the rest: every
      // measured value was one, and a string in a field the run binds as a
      // number is not a pick anybody wants offered.
      if (typeof event.value !== "number") continue

      seen.add(event.value)
    } else if (event.kind === "var" || event.kind === "simvar") {
      if (event.name !== name) continue

      seen.add(event.value)
    } else continue

    // Stopping early rather than counting them all: past the limit the answer
    // is already "no list", and this runs over two minutes of a ring that can
    // hold ~115,000 records.
    if (seen.size > limit) return null
  }

  return seen.size ? [...seen].sort((a, b) => a - b) : null
}
