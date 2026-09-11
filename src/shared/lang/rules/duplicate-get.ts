/**
 * `duplicate-get` and `block-conflict` — one name, two subscriptions.
 *
 * Both read the same source fact (see profile.ts): FS Copilot keeps
 * definitions in a flat array and gives every one its own subscription, so a
 * repeated `get:` name is two of everything — two outgoing packets per
 * change, two setters run per incoming value.
 *
 * Names are compared **exactly**, because that is how `Coordinator` compares
 * them: `_net.Stream<Update>().Where(update => update.Name == getVar)` is an
 * ordinal string match. Two spellings that differ only in case are two names
 * to FS Copilot even where the simulator would resolve them to one variable
 * — the corpus has 3 such pairs in P180, and they are a different question
 * (what the *sim* does with `L:` casing) that no rule here should pre-judge.
 */

import type { EntryView } from "../entry.ts"
import type { ProfileDiagnostic, ProfileRule } from "../profile.ts"
import { diagnose } from "../rules.ts"

/** What makes two entries for one name the same work rather than two jobs. */
function shapeOf(entry: EntryView): string {
  return [entry.units, entry.set ?? "", entry.skp ?? ""].join(" ")
}

/**
 * Whole-value spans on the entry's own line: these verdicts are about the
 * entry, not a character in it.
 */
function whole(entry: EntryView): {
  line: number
  start: number
  end: number
} {
  return { line: entry.line, start: 0, end: entry.get.length }
}

export const duplicateGet: ProfileRule = {
  id: "duplicate-get",
  family: "dialect",
  run({ entries }): ProfileDiagnostic[] {
    const groups = new Map<string, number[]>()
    entries.forEach((entry, index) => {
      const key = `${entry.block} ${entry.name}`
      groups.set(key, [...(groups.get(key) ?? []), index])
    })

    const out: ProfileDiagnostic[] = []
    for (const indexes of groups.values()) {
      if (indexes.length < 2) continue

      /*
       * Copies that differ are the Aerosoft CRJ pattern — one variable
       * driving the captain's button and the first officer's, 161 groups of
       * it — and running both is exactly what the author wanted. Only
       * identical copies are the same work done twice.
       */
      const shape = shapeOf(entries[indexes[0]!]!)
      if (indexes.some((index) => shapeOf(entries[index]!) !== shape)) continue

      const first = entries[indexes[0]!]!
      for (const index of indexes.slice(1)) {
        const entry = entries[index]!
        out.push(
          diagnose({
            ruleId: "duplicate-get",
            severity: "warning",
            confidence: "certain",
            basis: "source",
            why: ["one-subscription-per-entry"],
            ...whole(entry),
            verdict: `${entry.name} is already declared, identically, at line ${first.line}.`,
            consequence:
              "Every change will be sent twice and every incoming value " +
              "applied twice — a double press for a push or a toggle.",
          })
        )
      }
    }

    return out
  },
}

export const blockConflict: ProfileRule = {
  id: "block-conflict",
  family: "dialect",
  run({ entries }): ProfileDiagnostic[] {
    /** First occurrence of each name in each block — the pair, if it exists. */
    const first = new Map<string, { shared?: number; master?: number }>()
    entries.forEach((entry, index) => {
      const seen = first.get(entry.name) ?? {}
      if (seen[entry.block] === undefined) seen[entry.block] = index
      first.set(entry.name, seen)
    })

    const out: ProfileDiagnostic[] = []
    for (const pair of first.values()) {
      if (pair.shared === undefined || pair.master === undefined) continue

      // The later line carries the verdict, so the reader meets the second
      // declaration already knowing the first exists. Which block that is
      // varies — the corpus's CRJ pairs declare master: first.
      const both = [entries[pair.shared]!, entries[pair.master]!]
      const late = both[0]!.line > both[1]!.line ? 0 : 1

      const entry = both[late]!
      const other = both[1 - late]!

      out.push(
        diagnose({
          ruleId: "block-conflict",
          severity: "warning",
          confidence: "certain",
          basis: "source",
          why: ["one-subscription-per-entry", "block-authority"],
          ...whole(entry),
          verdict: `${entry.name} is in both master: and shared: (also at line ${other.line}).`,
          // Two sends, and each reaches both entries on the other side,
          // because incoming updates are matched by name alone. The other
          // direction is clean: only the shared: entry sends or applies.
          consequence:
            "When the pilot in control changes it, the change will be sent " +
            "twice (once over each channel), and the other pilot will run " +
            "both setters for each one.",
        })
      )
    }

    return out
  },
}
