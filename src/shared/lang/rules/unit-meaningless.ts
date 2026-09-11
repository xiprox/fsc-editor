/**
 * `unit-meaningless` — a units argument on a reference that has no units.
 *
 * `(>K:TOGGLE_ICS, Bool)` parses, runs, and the `Bool` decides nothing —
 * which is worse than an error, because the author now believes something
 * about the line that is not true. The descriptor table's `units: "none"`
 * rows say exactly which namespaces this holds for; `raw` namespaces are
 * left alone, where a unit is at most a display hint and flagging it would
 * fight half the corpus.
 */

import { NAMESPACES } from "../../vars/namespaces.ts"
import { diagnose, type Rule, type Diagnostic } from "../rules.ts"

export const unitMeaningless: Rule = {
  id: "unit-meaningless",
  family: "sim",
  run(doc) {
    const out: Diagnostic[] = []

    for (const node of doc.nodes) {
      if (node.kind !== "ref" || node.ref.ns === null) continue
      if (node.unit === null || node.unit === "") continue
      if (NAMESPACES[node.ref.ns].units !== "none") continue

      // The comma through the closing paren — deleting exactly the unit
      // argument, leaving the reference intact.
      const commaAt = node.token.start + node.token.text.indexOf(",")
      const end = node.token.end - (node.token.unterminated ? 0 : 1)

      out.push(
        diagnose({
          ruleId: "unit-meaningless",
          severity: "info",
          // Measured on a key event; carried to the other unitless
          // namespaces by the SDK's description of them.
          confidence: "likely",
          basis: "sdk-docs",
          why: ["unit-ignored-without-units"],
          start: node.token.start,
          end: node.token.end,
          verdict: `A ${NAMESPACES[node.ref.ns].label} has no units.`,
          consequence: `The ${node.unit} here will be ignored.`,
          fix: {
            title: "Remove the unit",
            edits: [{ start: commaAt, end, newText: "" }],
          },
        })
      )
    }

    return out
  },
}
