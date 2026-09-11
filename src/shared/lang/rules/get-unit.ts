/**
 * `get-unit-meaningless` — a units field on a `get:` whose namespace has
 * no units. The entry-level twin of `unit-meaningless`, and the first rule
 * to place a verdict on the `get:` line rather than the setter.
 *
 * ## Why a twin is safe here, when b-write-op's would not be
 *
 * 18-language-core keeps a standing warning: `get: B:X_Toggle` is legal
 * 232 times over, so the RPN rule about suffixed B: reads must never grow
 * an entry-level copy. Position decides meaning. That check was run for
 * this rule and comes out the other way — there is no reading of a `get:`
 * line on which a units field means something the descriptor says the
 * namespace does not have. Confirmed in the sim rather than assumed
 * (v1-log 2026-08-29): `1 16272 (>K:2:KOHLSMAN_SET, Bool)` moved the
 * altimeter exactly as the unit-free form does, so the calculator accepts
 * the unit and ignores it. It is redundant, not harmful — which is what
 * makes this **info** rather than a warning.
 *
 * That mattered more than it looks. All 60 corpus instances are `H:` lines
 * with *implicit* setters, so FS Copilot builds `1 (>H:NAME, Bool)` and
 * the unit really does reach a write. Had the calculator rejected it, the
 * finding would have been sixty dead entries across the Black Square
 * fleet, not a tidy-up.
 *
 * Descriptor-driven: the rule asks `NAMESPACES[ns].units === "none"`
 * rather than naming `K:`/`H:`, so a namespace whose units fact changes
 * takes this rule with it — one row, one edit.
 */

import { NAMESPACES } from "../../vars/namespaces.ts"
import { parseVar } from "../../vars/parse.ts"
import type { EntryDiagnostic, EntryRule } from "../entry.ts"
import { diagnose } from "../rules.ts"

export const getUnitMeaningless: EntryRule = {
  id: "get-unit-meaningless",
  family: "sim",
  run(entry): EntryDiagnostic[] {
    // Only a unit somebody typed. The resolved default is nobody's
    // decision and there is nothing on the line to remove.
    if (!entry.unitsExplicit || !entry.units) return []

    const ns = parseVar(entry.name).ns
    if (ns === null || NAMESPACES[ns].units !== "none") return []

    // The comma through the end of the value — the whole units field,
    // including a stray third one, which FS Copilot ignores anyway.
    const comma = entry.get.indexOf(",")
    if (comma === -1) return []

    return [
      diagnose({
        ruleId: "get-unit-meaningless",
        target: "get" as const,
        severity: "info",
        confidence: "likely",
        basis: "sdk-docs",
        why: ["unit-ignored-without-units"],
        start: comma,
        end: entry.get.length,
        // Word for word what `unit-meaningless` says inside a setter: the
        // same finding on a different line should not read as a new one.
        verdict: `A ${NAMESPACES[ns].label} has no units.`,
        consequence: `The ${entry.units} here will be ignored.`,
        fix: {
          title: "Remove the unit",
          edits: [{ start: comma, end: entry.get.length, newText: "" }],
        },
      }),
    ]
  },
}
