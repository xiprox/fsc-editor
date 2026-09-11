/**
 * `k-operand-order` — the `${…}` value pushed into the index slot.
 *
 * `[0]` is popped from the top of the stack, so a two-parameter event takes
 * its `[1]` first and its `[0]` last — the probe confirmed the order live
 * (v1-log 2026-08-29, "The arity probes"): `2 16272 (>K:2:KOHLSMAN_SET)`
 * moved only altimeter 2. The corpus writes the reverse thirteen times —
 * `${value * 16} 1 (>K:KOHLSMAN_SET)` — and no arity fix can save that
 * line: with `:2` the event's value is 1, without it the sim broadcasts 1
 * to every altimeter. Order is its own defect, so it is its own rule;
 * k-arity fires beside it, each honest about the one thing it can prove.
 *
 * Order is a heuristic — operands are opaque — so every gate errs silent:
 * the event must document exactly two parameters, exactly one describing
 * itself as an index (`[0]` is NOT always the value: FUELSYSTEM_PUMP_SET
 * documents "[0]: The pump index"); the two operands must sit directly
 * before the call as plain values; and exactly one must be a `${…}` hole,
 * which is the synced value if it is anything. Only then, if the hole sits
 * in the index slot, is the layout called swapped.
 *
 * Known gap, accepted for now: RPN inside single-quoted JS strings is one
 * token to the top-level pass, so order there goes unjudged — the corpus
 * writes all its swapped lines as top-level template RPN.
 */

import { diagnose, type Rule, type Diagnostic } from "../rules.ts"

/** The description of each documented slot, in slot order. */
export function paramSlots(parameters: string): string[] {
  const out: string[] = []
  for (let slot = 0; ; slot++) {
    const at = parameters.indexOf(`[${slot}]`)
    if (at === -1) break
    const next = parameters.indexOf(`[${slot + 1}]`)
    out.push(
      parameters
        .slice(at + `[${slot}]`.length, next === -1 ? undefined : next)
        .replace(/^[:\s]+/, "")
        .trim()
    )
  }
  return out
}

/**
 * A slot's description cut to its first clause. The catalogue's text runs
 * from two words to a paragraph, and in a sentence it is a name, not the docs.
 */
export function slotName(description: string): string {
  return description.split(/[.,(]/)[0]!.trim()
}

export const kOperandOrder: Rule = {
  id: "k-operand-order",
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

      const slots = paramSlots(parameters)
      if (slots.length !== 2) continue

      // Exactly one slot must self-describe as an index — two ("source bus,
      // target bus") or zero leaves no home for the value, and no verdict.
      const indexLike = slots.map((slot) => /\bindex\b/i.test(slot))
      if (indexLike[0] === indexLike[1]) continue

      // The operands: both pushed directly before the call, both plain
      // values. Anything computed in between means the layout is not the
      // story the source tells, and the rule has nothing to say.
      const first = doc.nodes[i - 2]
      const last = doc.nodes[i - 1]
      if (first?.kind !== "value" || last?.kind !== "value") continue

      const firstIsHole = first.token.kind === "hole"
      const lastIsHole = last.token.kind === "hole"
      if (firstIsHole === lastIsHole) continue

      // Pushed last is [0], pushed first is [1] — the hole is the synced
      // value, and if it sits in the value slot the layout is right.
      const holeSlot = lastIsHole ? 0 : 1
      if (!indexLike[holeSlot]) continue

      const indexSlot = indexLike[0] ? 0 : 1
      const valueSlot = 1 - indexSlot
      const literal = lastIsHole ? first : last

      out.push(
        diagnose({
          ruleId: "k-operand-order",
          severity: "warning",
          // A heuristic over opaque operands — every gate above errs silent,
          // and what is left is still a reading of intent.
          confidence: "likely",
          basis: "sdk-docs",
          why: ["k-zero-pushed-last"],
          start: first.token.start,
          end: last.token.end,
          verdict: `${node.ref.name}'s values look swapped.`,
          // Named by what the SDK calls the slots, not by [0] and [1]: the
          // reader is looking at an altimeter, not at a parameter list.
          consequence:
            `As written, the synced value will be read as the ` +
            `${slotName(slots[indexSlot]!)} and ${literal.token.text} as the ` +
            `${slotName(slots[valueSlot]!)}.`,
          fix: {
            title: "Swap the operands",
            edits: [
              {
                start: first.token.start,
                end: first.token.end,
                newText: last.token.text,
              },
              {
                start: last.token.start,
                end: last.token.end,
                newText: first.token.text,
              },
            ],
          },
        })
      )
    }

    return out
  },
}
