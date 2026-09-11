/**
 * `b-preset-unknown` — a `B:` input event the loaded aircraft does not have.
 *
 * The first rule in the evidence tier, and the one `b-write-op`'s muted half
 * was always waiting for. That branch tried to decide from the text whether a
 * bare `B:` write could work, and could not: the 2026-08-29 probe showed
 * "op" is a naming convention over presets rather than a sim mechanism, so
 * `..._Push` may be a complete Preset ID or a preset plus an operation, and
 * nothing in the string says which. Nor, it turns out, does the aircraft —
 * see below. What the aircraft can settle is whether the *control* exists,
 * and that is the question this rule ended up asking.
 *
 * ## Presence is strong, absence is weak
 *
 * The sim's input-event table fills as add-ons register — the same reason the
 * `L:` walk runs twice after an aircraft change — so a name missing seconds
 * after a swap may only be late. That asymmetry sets the severity at
 * **warning**, never error, and it is why the rule says "this aircraft does
 * not have" rather than "this does not exist".
 *
 * ## The enumeration lists IDs, not the names anyone writes
 *
 * **Measured on the A220, 2026-09-03**: `EnumerateInputEvents` returns 464
 * names, and they are `<InputEvent ID=...>` values — `AIRLINER_FCU_CHRONO_2`
 * is there and `AIRLINER_FCU_CHRONO_2_Push`, which the Behaviors tool shows
 * and which FS Copilot writes, is not. Exactly **one** of the 464 ends in a
 * generated operation. So a miss on the *written* name carries no
 * information at all: it is the normal state of every correct `ID_Preset`.
 * Only the base can be asked about, and one trailing `_Word` is stripped to
 * find it. Which word is unknowable, with one exception: an all-digit
 * suffix is an index rather than a preset, and is kept — `ELECTRICAL_Alternator_1`
 * and `_2` are different controls, and 71 corpus names have that shape.
 *
 * That also retires this rule's earlier reading of `AIRLINER_FCU_SPD_PUSH`
 * beside `AIRLINER_FCU_SPD_PUSH_PUSH`. Both are IDs — the A220 names two
 * controls that way, as it does for `ALT` — not a preset and a preset-plus-op.
 * The op-stripping the old text inferred from that pair was a coincidence
 * generalised into a rule.
 *
 * ## What it can no longer say
 *
 * The Baron's `SAFETY_ELT_1_ARM` — base enumerated, `_ARM` verified dead —
 * now goes quiet, and must. Nothing in the text separates it from
 * `AIRLINER_FCU_CHRONO_2_Push`, which is base-enumerated and *works*; the
 * 2026-08-28 finding is that whether a write lands is decided by set-code
 * authored per preset and is invisible to any static rule. Running the
 * setter answers that question. This rule answers a smaller one — is the
 * control there at all — and answers it honestly.
 *
 * Evidence-gated in the usual way: no aircraft, no answer, no diagnostic.
 * Verdicts therefore appear and disappear as the simulator connects and as
 * aeroplanes change, which is the point of the tier.
 */

import { inputEventIds } from "../../vars/input-events.ts"
import { parseVar } from "../../vars/parse.ts"
import type { EntryDiagnostic, EntryRule } from "../entry.ts"
import {
  diagnose,
  type Rule,
  type Diagnostic,
  type RuleContext,
} from "../rules.ts"

/**
 * The verdict on one `B:` name, or null when there is nothing to say —
 * shared by the expression rule and its `get:`-line counterpart, because the
 * question is about the name and not about where it was written.
 */
function absent(
  written: string,
  preset: string,
  context: RuleContext
): { verdict: string; remedy: string } | null {
  const known = (name: string): boolean =>
    // Null anywhere means no aircraft is loaded, so there is no question to
    // answer — not that the answer is no.
    context.hasInputEvent?.(name) !== false

  /*
   * The written name is `<InputEvent ID>_<Preset>` and the table holds IDs, so
   * the base is the only thing worth asking about. `inputEventIds` owns that
   * stripping, shared with the resolver that turns the same name into a hash —
   * a rule and a gutter value disagreeing about which control a line names is
   * the failure that helper exists to prevent.
   */
  const candidates = inputEventIds(written, preset)

  if (candidates.some(known)) return null

  const alsoTried = candidates.filter((name) => name !== written)

  return {
    verdict: `The aircraft in the sim has no input event ${written}.`,
    // What else was looked for, so the reader does not go and look for it —
    // then the one reason this can be wrong, which is a reason to wait
    // rather than a reason to doubt.
    remedy:
      (alsoTried.length
        ? `${alsoTried.join(" and ")} ${alsoTried.length === 1 ? "is" : "are"} not there either. `
        : "") +
      "It can also be missing because the aircraft has not finished " +
      "loading, so check again once it has.",
  }
}

/** What the two rules below share: the evidence, and how sure it is. */
const ABSENT = {
  severity: "warning",
  // Presence is strong and absence is weak — see the file comment.
  confidence: "likely",
  basis: "observed",
  why: ["input-events-listed-by-id", "input-events-register-late"],
} as const

export const bPresetUnknown: Rule = {
  id: "b-preset-unknown",
  family: "sim",
  run(doc, _stack, context) {
    if (!context.hasInputEvent) return []

    const out: Diagnostic[] = []

    for (const node of doc.nodes) {
      if (node.kind !== "ref" || node.ref.ns !== "B") continue

      const found = absent(node.ref.name, node.ref.preset, context)
      if (!found) continue

      out.push(
        diagnose({
          ...ABSENT,
          ...found,
          ruleId: "b-preset-unknown",
          start: node.token.start,
          end: node.token.end,
          consequence: `This ${node.access === "write" ? "write" : "read"} will do nothing.`,
        })
      )
    }

    return out
  },
}

/**
 * `get-preset-unknown` — the same question on a `get:` line.
 *
 * A `B:` `get:` is legal dialect: it subscribes to the input event and
 * mirrors its firing, the way a `K:` `get:` is the event-sync form. But it
 * can only mirror an event the aircraft actually has, and **643 corpus
 * entries name a `B:` preset in `get:` position** where no rule has ever
 * looked — the expression rules only ever see `set:` values.
 *
 * Note this is not the entry-level twin 18-language-core warns against.
 * That warning is about `b-write-op`, whose question is positional: a
 * suffixed name means something different in `get:` than inside an
 * expression. Existence is not positional. A preset the aircraft does not
 * have is absent wherever it is written.
 */
export const getPresetUnknown: EntryRule = {
  id: "get-preset-unknown",
  family: "sim",
  run(entry, context): EntryDiagnostic[] {
    const ref = parseVar(entry.name)
    if (ref.ns !== "B") return []

    const found = absent(ref.name, ref.preset, context)
    if (!found) return []

    return [
      diagnose({
        ...ABSENT,
        ...found,
        ruleId: "get-preset-unknown",
        target: "get" as const,
        start: 0,
        end: entry.get.length,
        consequence: "This entry will never report anything.",
      }),
    ]
  },
}

/**
 * `b-write-bare` — writing a name the sim lists as an input event **ID**.
 *
 * `b-write-op`'s bare-write branch, finally decidable. It was muted twice for
 * the same reason both times: nothing in the text says whether `..._Push` is a
 * complete Preset ID or an ID plus an action, so "this write has no action on
 * it" could not be asked. Verbatim presence in the enumeration asks it — the
 * table holds IDs and only IDs, so a written name that is in it *is* an ID,
 * and the preset half is missing.
 *
 * Note which direction this reads. `b-preset-unknown` keys on absence, which
 * the sim's filling table makes weak; this keys on **presence**, which is the
 * strong half of the same asymmetry.
 *
 * ## Write position only
 *
 * A bare ID in `get:` is the canonical form — it is what `SubscribeInputEvent`
 * takes, and **411 of the corpus's 643 `B:` `get:` lines** carry no action at
 * all. A rule that judged reads would light up two thirds of the corpus for
 * writing the correct thing.
 *
 * ## What it cannot be calibrated against
 *
 * Nothing. Of the 599 distinct names the corpus writes through `>B:`, **zero**
 * appear in the A220's 464 — the corpus writes Asobo's generic template names
 * and this aeroplane registers none of them. So the sweep cannot vet this rule
 * the way it vets the static ones, and it will only ever speak while somebody
 * is authoring against the aeroplane in front of them. Which is the case it is
 * for, and is also why the message hedges: the evidence for the claim is one
 * probe on one event.
 */
export const bWriteBare: Rule = {
  id: "b-write-bare",
  family: "sim",
  run(doc, _stack, context) {
    if (!context.hasInputEvent) return []

    const out: Diagnostic[] = []

    for (const node of doc.nodes) {
      if (node.kind !== "ref" || node.ref.ns !== "B") continue
      if (node.access !== "write") continue
      // Only an outright yes. Null is "no aircraft loaded" and false is
      // b-preset-unknown's question, not this one.
      if (context.hasInputEvent(node.ref.name) !== true) continue

      out.push(
        diagnose({
          ruleId: "b-write-bare",
          severity: "warning",
          // One probe, one event, one aircraft — and the sweep cannot vet it.
          // The verdict is a fact about the table; only the consequence is
          // the guess, and it is worded as one.
          confidence: "possible",
          basis: "observed",
          why: ["input-events-listed-by-id", "b-write-needs-action"],
          start: node.token.start,
          end: node.token.end,
          verdict: `${node.ref.name} is an input event ID, not an action.`,
          consequence: "This write will probably do nothing.",
          remedy:
            `An action should follow the ID, as in ${node.ref.name}_Set or ` +
            `${node.ref.name}_Toggle — which ones exist depends on the ` +
            `aircraft.`,
        })
      )
    }

    return out
  },
}
