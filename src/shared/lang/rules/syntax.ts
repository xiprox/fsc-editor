/**
 * `rpn-unterminated` and `rpn-braces` — the mistakes that are pure text.
 *
 * The first corpus sweep caught a live one: the Albatross profiles write
 * `(>B:INSTRUMENT_IE_HU16_CB_NAV_2_Toggle` with no closing paren, in a
 * `set:` the sim will never run correctly. Nothing else in the ecosystem
 * says anything; the calculator quietly does whatever it does with the
 * fragment.
 *
 * Both are error-grade: text-level facts need no evidence and have no
 * benign reading.
 */

import { diagnose, type Rule, type Diagnostic } from "../rules.ts"

export const rpnUnterminated: Rule = {
  id: "rpn-unterminated",
  family: "sim",
  run(doc) {
    const out: Diagnostic[] = []

    for (const token of doc.unterminated) {
      const opener = token.kind === "string" ? "'" : token.kind === "hole" ? "${" : "("
      const closer = token.kind === "string" ? "'" : token.kind === "hole" ? "}" : ")"

      out.push(
        diagnose({
          ruleId: "rpn-unterminated",
          severity: "error",
          confidence: "certain",
          basis: "grammar",
          start: token.start,
          end: token.end,
          verdict: `This ${opener} is never closed.`,
          consequence: "Everything after it will be read as part of it.",
          fix: {
            title: `Close with ${closer}`,
            edits: [{ start: token.end, end: token.end, newText: closer }],
          },
        })
      )
    }

    return out
  },
}

export const rpnBraces: Rule = {
  id: "rpn-braces",
  family: "sim",
  run(doc) {
    const out: Diagnostic[] = []
    const open: { token: { start: number; end: number }; word: string }[] = []

    for (const node of doc.nodes) {
      if (node.kind !== "word") continue
      const word = node.token.text.toLowerCase()

      // The real grammar: `cond if{ A } els{ B }` — the alternative closes
      // the if-block first and opens a block of its own, so *both* words are
      // openers and every block ends with its own }.
      if (word === "if{" || word === "els{") open.push({ token: node.token, word })
      else if (word === "}") {
        if (open.length === 0)
          out.push(
            diagnose({
              ruleId: "rpn-braces",
              severity: "error",
              confidence: "certain",
              basis: "grammar",
              start: node.token.start,
              end: node.token.end,
              verdict: "This } has no if{ or els{ to close.",
            })
          )
        else open.pop()
      }
    }

    for (const opener of open) {
      out.push(
        diagnose({
          ruleId: "rpn-braces",
          severity: "error",
          confidence: "certain",
          basis: "grammar",
          start: opener.token.start,
          end: opener.token.end,
          verdict: `This ${opener.word} is never closed.`,
          remedy: "Every if{ and els{ block should end with its own }.",
        })
      )
    }

    return out
  },
}
