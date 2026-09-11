/**
 * `stack-balance` — the expression's arithmetic against what surrounds it.
 *
 * Only whole RPN programs are held to balance: `literal` and `prepended`
 * setters, where FS Copilot runs exactly what is written. JavaScript
 * setters' template fragments are conditions and pieces — the first sweep
 * showed 482 of them legitimately ending at depth 1 — so without a kind the
 * rule stays silent.
 *
 * The simulation is re-run here with the kind's initial depth, because the
 * general one handed to `analyze` cannot know what surrounds the text: a
 * prepended setter's value is pushed by FS Copilot before the first written
 * word, and judging it from depth 0 calls every prepended setter an
 * underflow. This rule owning its own simulation *is* the design — context
 * decides depth, and only the rule has the context.
 */

import { simulate } from "../stack.ts"
import { diagnose, type Rule, type Diagnostic } from "../rules.ts"

/** A reading of the text through a stack model that softens what it cannot see. */
const FOUND = {
  ruleId: "stack-balance",
  severity: "warning",
  confidence: "likely",
  basis: "grammar",
} as const

export const stackBalance: Rule = {
  id: "stack-balance",
  family: "setter",
  run(doc, _stack, context) {
    const kind = context.setterKind
    if (kind !== "literal" && kind !== "prepended") return []

    const { points, end } = simulate(doc, kind === "prepended" ? 1 : 0)
    const out: Diagnostic[] = []

    points.forEach((point, index) => {
      if (!point.underflow) return
      const token = doc.nodes[index]!.token
      out.push(
        diagnose({
          ...FOUND,
          start: token.start,
          end: token.end,
          verdict:
            `This needs ${point.pops} value${point.pops === 1 ? "" : "s"} and ` +
            `the stack has ${point.before === 0 ? "none" : point.before}.`,
          // What the calculator does with a short stack has not been
          // measured, so the sentence claims only what the text shows.
          consequence: "It will not compute what it looks like it computes.",
        })
      )
    })

    if (end !== null && end > 0) {
      const last = doc.nodes.at(-1)?.token
      if (last) {
        out.push(
          diagnose({
            ...FOUND,
            ...(kind === "prepended" ? { why: ["setter-kind-by-shape"] } : {}),
            start: last.start,
            end: last.end,
            verdict: `This setter leaves ${end} value${end === 1 ? "" : "s"} on the stack.`,
            consequence:
              kind === "prepended"
                ? "The value FS Copilot puts in front may never be used, so " +
                  "the setter would ignore what it was sent."
                : "A value left over usually means something was meant to " +
                  "use it.",
          })
        )
      }
    }

    return out
  },
}
