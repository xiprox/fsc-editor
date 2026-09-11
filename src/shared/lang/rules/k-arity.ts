/**
 * `k-arity-missing` / `k-arity-extra` — the written K: arity against the
 * catalogue's documented parameters.
 *
 * `50 1 (>K:2:PANEL_LIGHTS_POWER_SETTING_SET)` passes two values; the plain
 * form passes one. An event documented with a `[1]` parameter called without
 * `:2` silently drops one operand — usually the index, so the event lands on
 * the wrong instrument, which is exactly the kind of bug that flies for
 * weeks. The inverse — `:2` on an event documented with only `[0]` — feeds
 * a value the event ignores.
 *
 * Catalogue-backed, and mute without the catalogue: only 662 of 1,524
 * events carry a `parameters` string, and firing on the silent 862 would be
 * guessing.
 *
 * The probe answered the severity question (v1-log 2026-08-29, "The arity
 * probes"): a bare call pops exactly ONE value and the missing parameters
 * default to 0. So when the operands are laid out — `documented` plain
 * values sitting directly before the call — the sim provably drops all but
 * the top one, and that is an ERROR: the author's layout shows what they
 * meant, and the sim does something else. With fewer operands visible the
 * call is underspecified rather than proven broken (index 0 broadcasts,
 * which single-instrument profiles plausibly intend), and the honest
 * strength stays warning.
 */

import { diagnose, type Rule, type Diagnostic } from "../rules.ts"
import { paramSlots, slotName } from "./k-operand-order.ts"

/** How many parameters a catalogue `parameters` string documents. */
export function documentedParams(parameters: string): number {
  let count = 0
  while (parameters.includes(`[${count}]`)) count += 1
  return count
}

/**
 * The documented slots as a sentence, in push order — `[0]` last.
 *
 * Each description is cut to its first clause — see `slotName` — and a slot
 * with nothing usable falls back to its number.
 */
function pushOrder(parameters: string): string {
  return paramSlots(parameters)
    .map((slot, index) => slotName(slot) || `[${index}]`)
    .reverse()
    .join(", then ")
}

export const kArity: Rule = {
  id: "k-arity",
  family: "sim",
  run(doc, _stack, context) {
    if (!context.keyEventParams) return []

    const out: Diagnostic[] = []

    for (let i = 0; i < doc.nodes.length; i++) {
      const node = doc.nodes[i]!
      if (node.kind !== "ref" || node.ref.ns !== "K") continue
      if (node.access !== "write") continue

      const parameters = context.keyEventParams(node.ref.name)
      if (parameters === null) continue

      const documented = documentedParams(parameters)
      if (documented === 0) continue
      const written = node.ref.params

      // The event name's offset inside the token — the anchor both fixes
      // edit against, robust to spacing and prefix case the parser accepted.
      const nameAt = node.token.start + node.token.text.indexOf(node.ref.name)

      if (written < documented) {
        // Laid out: `documented` plain values directly before the call.
        // Then the author's intent is on the stack and the sim provably
        // pops only the top — proven broken, not merely underspecified.
        let laidOut = true
        for (let back = 1; back <= documented; back++)
          if (doc.nodes[i - back]?.kind !== "value") laidOut = false

        // Said the same way in all three cases: the two numbers are the
        // finding, and everything else follows from which is larger.
        const verdict =
          `${node.ref.name} takes ${documented} parameters and this call ` +
          `passes ${written}.`

        // The fix inserts the arity right before the event name.
        const at = nameAt
        out.push(
          diagnose({
            ruleId: "k-arity",
            severity: laidOut ? "error" : "warning",
            // Laid out, the author's intent is on the stack and the sim's
            // behaviour is measured: certain. Otherwise the call may mean
            // index 0 on purpose, which broadcasts — likely, not proven.
            confidence: laidOut ? "certain" : "likely",
            basis: "sdk-docs",
            why: ["k-bare-pops-one", "k-zero-pushed-last"],
            start: node.token.start,
            end: node.token.end,
            verdict,
            consequence: laidOut
              ? `Only the last ${written === 1 ? "value" : `${written} values`} ` +
                "will reach the event, and its other parameters will be 0."
              : "The parameters it leaves out will be 0.",
            // With operands still to write, which goes where is what the
            // reader needs — so the slots are named in the order to push
            // them, which is the reverse of the order the SDK lists them.
            ...(laidOut
              ? {}
              : {
                  remedy: `Push them in this order: ${pushOrder(parameters)}.`,
                }),
            fix: {
              title: `Change to K:${documented}:${node.ref.name}`,
              edits: [{ start: at, end: at, newText: `${documented}:` }],
            },
          })
        )
      } else if (written > documented) {
        // The written arity sits immediately before the name — `2:` in
        // `K:2:EVENT` — so deleting up to the name removes exactly it.
        out.push(
          diagnose({
            ruleId: "k-arity",
            severity: "warning",
            // The docs' silence about a second parameter is not proof the
            // event has none.
            confidence: "likely",
            basis: "sdk-docs",
            why: ["k-bare-pops-one"],
            start: node.token.start,
            end: node.token.end,
            verdict:
              `${node.ref.name} takes ${documented} ` +
              `parameter${documented === 1 ? "" : "s"} and this call passes ` +
              `${written}.`,
            consequence: "The SDK documents no use for the extra value.",
            fix: {
              title: `Change to K:${node.ref.name}`,
              edits: [
                {
                  start: nameAt - `${written}:`.length,
                  end: nameAt,
                  newText: "",
                },
              ],
            },
          })
        )
      }
    }

    return out
  },
}
