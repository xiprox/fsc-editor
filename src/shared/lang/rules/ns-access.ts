/**
 * `ns-access` — a namespace used in a direction it does not have.
 *
 * The descriptor table knows which namespaces are fired rather than read
 * and which are read-only — its `readable` and `writable` columns, which
 * completion reads too — and this rule is those facts applied to reference
 * position. Conservative by construction: only the combinations with no
 * benign reading fire, and `F:` reads are excluded outright — a function
 * call is spelled as a read.
 */

import { NAMESPACES } from "../../vars/namespaces.ts"
import { diagnose, type Rule, type Diagnostic } from "../rules.ts"

/** "A key event", "An HTML event" — by sound, so `HTML` takes "An". */
function article(label: string): string {
  return `${/^(HTML|[aeiou])/i.test(label) ? "An" : "A"} ${label}`
}

export const nsAccess: Rule = {
  id: "ns-access",
  family: "sim",
  run(doc) {
    const out: Diagnostic[] = []

    for (const node of doc.nodes) {
      if (node.kind !== "ref" || node.ref.ns === null) continue
      const ns = node.ref.ns

      // Every verdict here is the SDK's description of a namespace, which
      // is a good witness and not an infallible one: likely.
      const found = {
        ruleId: "ns-access",
        severity: "warning",
        confidence: "likely",
        basis: "sdk-docs",
        start: node.token.start,
        end: node.token.end,
      } as const

      // Fired or one-way: reading one asks a question the sim cannot answer.
      if (node.access === "read" && !NAMESPACES[ns].readable) {
        out.push(
          diagnose({
            ...found,
            why: ["ns-fired-not-read"],
            verdict: `${article(NAMESPACES[ns].label)} is fired, not read.`,
            consequence: "This read will give nothing.",
            remedy: `To fire it, write (>${node.ref.full}).`,
          })
        )
      }

      if (node.access === "write") {
        // Nothing outside the sim's own machinery may write these.
        if (!NAMESPACES[ns].writable) {
          out.push(
            diagnose({
              ...found,
              why: ["ns-read-only"],
              verdict: `${article(NAMESPACES[ns].label)} cannot be written from a profile.`,
              consequence: "This write will do nothing.",
            })
          )
        } else if (
          ns === "E" &&
          node.ref.name.toUpperCase() !== "SIMULATION RATE"
        ) {
          out.push(
            diagnose({
              ...found,
              why: ["ns-read-only"],
              verdict: "Environment variables are read-only.",
              consequence: "This write will do nothing.",
            })
          )
        }
      }
    }

    return out
  },
}
