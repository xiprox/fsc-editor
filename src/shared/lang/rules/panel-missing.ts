/**
 * `panel-missing` — a `pointer:` or `ignore:` item that names no panel in the
 * aircraft that is loaded.
 *
 * Both blocks fail silently. `pointer:` items are handed to every panel, and a
 * panel that does not find itself in the list simply carries on as it was
 * (`hook.js`, `_configure`); `ignore:` is a `HashSet` that nothing ever checks
 * for a name it never sees. A misspelt item is a line that does nothing, and
 * the only symptom is a display that does not sync — which looks exactly like
 * a display nobody listed.
 *
 * ## What is compared, and what is deliberately not
 *
 * The item against the panels the simulator has loaded, **whether or not they
 * are interactive**. Interactivity is a state, not a fact about the aircraft:
 * the Black Square Baron swaps avionics in the cockpit, and the unit that is
 * swapped out reports `isInteractive` false until it is swapped back in. A
 * profile lists both, because it cannot know which one the other pilot chose,
 * and the one that is dark right now is not a mistake.
 *
 * An identifier is matched exactly and case-sensitively, because that is how
 * FS Copilot matches it — `indexOf` in the panel, an ordinal `HashSet` in the
 * app. `displayunits` is a finding.
 *
 * A full key (`Identifier|query`) is checked in two steps, and the second is
 * the useful one. If no panel has the identifier, that is the finding. If
 * panels do but none has *this key*, the item is one the aircraft half
 * matches — the A220's `DisplayUnits|config=Default` on any livery but the
 * house one — and the message lists the keys that are there.
 *
 * ## Info, never more
 *
 * This is evidence about one aircraft in one state, offered to a file that
 * may serve several: a module's `pointer:` block can name the panels of every
 * variant that includes it, and the variant that is loaded has only its own.
 * So it says what is true — not in the aircraft that is loaded — and leaves
 * what that means to the person who knows what the file is for.
 *
 * Evidence-gated: no panels means silence. That covers no simulator, a file
 * that is not part of the loaded aircraft, and a cockpit that has not been
 * read yet.
 */

import { nearest } from "../nearest.ts"
import type { ProfileDiagnostic, ProfileItem, ProfileRule } from "../profile.ts"
import { diagnose, type CockpitPanelNames } from "../rules.ts"

/**
 * The item as FS Copilot reads it. `ignore:` items arrive with their quotes
 * on; nobody quotes an identifier, but a key can need it.
 */
function unquoted(text: string): { value: string; shift: number } {
  const trimmed = text.trim()
  const quote = trimmed[0]
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote))
    return { value: trimmed.slice(1, -1), shift: text.indexOf(trimmed) + 1 }

  return { value: trimmed, shift: text.indexOf(trimmed) }
}

/**
 * Info, never more, and never more than likely: one aircraft in one state,
 * offered to a file that may serve several — see the file comment.
 */
const FOUND = {
  ruleId: "panel-missing",
  severity: "info",
  confidence: "likely",
  basis: "observed",
} as const

function check(
  block: "pointer" | "ignore",
  item: ProfileItem,
  panels: CockpitPanelNames
): ProfileDiagnostic | null {
  const { value, shift } = unquoted(item.text)
  if (!value) return null

  const bar = value.indexOf("|")
  // `ignore:` only ever matches an identifier, so the whole text is one.
  const identifier =
    block === "pointer" && bar !== -1 ? value.slice(0, bar) : value
  const where = { line: item.line, start: shift, end: shift + value.length }

  if (!panels.identifiers.includes(identifier)) {
    const suggestion = nearest(identifier, panels.identifiers)
    const fixed = suggestion
      ? suggestion + value.slice(identifier.length)
      : null

    return diagnose({
      ...FOUND,
      ...where,
      why: [
        block === "pointer" ? "pointer-matches-exactly" : "ignore-is-a-set",
      ],
      verdict: `No panel in the aircraft in the sim is called ${identifier}.`,
      consequence: "This entry will have no effect.",
      ...(fixed
        ? {
            fix: {
              title: `Change to ${fixed}`,
              edits: [{ start: where.start, end: where.end, newText: fixed }],
            },
          }
        : {}),
    })
  }

  if (identifier === value) return null

  const keys = panels.keys[identifier]
  // Not read — another debugger holds those panels — so there is no list of
  // keys to hold this one against.
  if (!keys || keys.includes(value)) return null

  return diagnose({
    ...FOUND,
    ...where,
    why: ["panel-key-query"],
    verdict: `${identifier} is in the aircraft in the sim, but not with this key.`,
    consequence: "This entry will have no effect.",
    remedy:
      `The keys there are ${keys.join(", ")}. ${identifier} alone takes ` +
      `every panel that reports it.`,
    fix: {
      title: `Change to ${identifier}`,
      edits: [{ start: where.start, end: where.end, newText: identifier }],
    },
  })
}

export const panelMissing: ProfileRule = {
  id: "panel-missing",
  family: "sim",
  run({ pointers, ignores }, context): ProfileDiagnostic[] {
    if (!pointers.length && !ignores.length) return []

    const panels = context.cockpitPanels?.()
    if (!panels || !panels.identifiers.length) return []

    return [
      ...pointers.map((item) => check("pointer", item, panels)),
      ...ignores.map((item) => check("ignore", item, panels)),
    ].filter((found): found is ProfileDiagnostic => found !== null)
  },
}
