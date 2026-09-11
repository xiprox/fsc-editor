/**
 * The Why section of a hover — the mechanism behind a diagnostic, built
 * without Monaco in the room.
 *
 * A marker's own text is plain and is now short: verdict, consequence, remedy.
 * What used to ride along inside it — what FS Copilot or the simulator does
 * that makes the verdict true — is cited by id from the facts table, and this
 * is the venue with room to say it. Markdown, so the code in a statement
 * finally renders as code.
 *
 * Every statement is followed by where it comes from. The diagnostic's own
 * basis leads, because it answers a different question: not "how do you know
 * what FS Copilot does" but "how do you know that about *this line*".
 */

import { BASIS_LABEL, factOf, type Basis, type FactId } from "@shared/lang"

export interface WhyInput {
  why?: readonly FactId[]
  basis?: Basis
}

/** The section's markdown, or null when the diagnostic cites nothing. */
export function whyCard(diagnostic: WhyInput): string | null {
  if (!diagnostic.why?.length) return null

  // Null for a basis with nothing worth saying — see `BASIS_LABEL`.
  const label = diagnostic.basis ? BASIS_LABEL[diagnostic.basis] : null
  const lines: string[] = [label ? `**Why** — _${label}_` : "**Why**"]

  for (const id of diagnostic.why) {
    const fact = factOf(id)
    lines.push("", fact.statement)

    // Said only where it adds something: a fact from the same place as the
    // verdict would repeat the line above it.
    const own = BASIS_LABEL[fact.basis]
    if (own && fact.basis !== diagnostic.basis) lines.push("", `_${own}_`)
  }

  return lines.join("\n")
}
