/**
 * `invisible-chars` — characters that break RPN while looking like nothing.
 *
 * Profiles are written by people pasting from forums and Discord, where an
 * NBSP or a curly quote arrives dressed as the character that works. The
 * calculator has no idea what a smart quote is; the expression fails in a
 * way that reads as "the sim ignored me". The fix substitutes what was
 * plainly meant: quotes straighten, NBSP becomes a space, zero-width
 * characters vanish.
 */

import { diagnose, type Rule, type Diagnostic } from "../rules.ts"

const REPLACEMENT: Record<string, string> = {
  " ": " ",
  "‘": "'",
  "’": "'",
  "“": "'",
  "”": "'",
  "​": "",
  "‌": "",
  "‍": "",
  "﻿": "",
}

const NAME: Record<string, string> = {
  " ": "a non-breaking space",
  "‘": "a curly quote",
  "’": "a curly quote",
  "“": "a curly double quote",
  "”": "a curly double quote",
  "​": "a zero-width space",
  "‌": "a zero-width character",
  "‍": "a zero-width character",
  "﻿": "a byte-order mark",
}

export const invisibleChars: Rule = {
  id: "invisible-chars",
  family: "sim",
  run(doc) {
    const out: Diagnostic[] = []

    for (const node of doc.nodes) {
      if (node.kind !== "invisible") continue

      const replacement = REPLACEMENT[node.token.text] ?? " "
      const name = NAME[node.token.text] ?? "an invisible character"

      out.push(
        diagnose({
          ruleId: "invisible-chars",
          severity: "warning",
          // What the character *is* is certain. What the calculator makes
          // of it has never been measured — so this is a heads-up that the
          // author probably did not mean it, and is worded as one.
          confidence: "possible",
          basis: "grammar",
          start: node.token.start,
          end: node.token.end,
          // A lookalike is named against what it looks like; a character
          // with no width has nothing to be compared with.
          verdict:
            replacement === ""
              ? `There is ${name} here.`
              : `This is ${name}, not ${replacement === " " ? "a space" : "a straight quote"}.`,
          // A lookalike can be misread; a character with no width has
          // nothing to look like, so its trouble is that it cannot be seen.
          consequence:
            "You probably did not mean it — it usually arrives with pasted " +
            (replacement === ""
              ? "text, and nothing on screen shows it is there."
              : "text, and it may not be read as the character it looks like."),
          fix: {
            title:
              replacement === ""
                ? "Remove it"
                : `Replace with ${replacement === " " ? "a space" : replacement}`,
            edits: [
              {
                start: node.token.start,
                end: node.token.end,
                newText: replacement,
              },
            ],
          },
        })
      )
    }

    return out
  },
}
