/**
 * What write-position completion offers, decided without Monaco in the room.
 *
 * `completions.ts` renders these decisions into CompletionItems; this file
 * makes them, from the descriptor table and the catalogue, so the logic runs
 * headless in tests. The questions answered per candidate name:
 *
 * - does it belong in `(>…)` at all? A non-settable `A:` var or a plain
 *   environment variable completes into a line that silently does nothing —
 *   the worst outcome an editor can sell.
 * - what text goes in? A bare `B:` preset is offered as its `_Set` operation
 *   when the aircraft has one. A `K:` event documented with two parameters is
 *   offered as its whole calling shape — operands and `K:2:` — because the
 *   editor making sure the `:2` is not missed was this feature's founding
 *   requirement.
 */

import { documentedParams } from "@shared/lang"
import { parseVar } from "@shared/vars"
import type { VarEntry } from "@shared/types"

export interface WriteOffer {
  /** Replaces the typed target name, inside the `(>` … `)`. */
  insert: string
  /**
   * A full-shape snippet replacing from the `(` instead: operands as
   * placeholders, then the reference. Monaco snippet syntax; the renderer
   * decides whether the caret context allows the wider range.
   */
  snippet?: string
  /** One line for the item's detail column. */
  note?: string
}

/** Snippet metacharacters that would be read as placeholders, escaped. */
function snippetText(text: string): string {
  return text.replace(/[\\$}]/g, "\\$&")
}

/**
 * The label for one documented parameter — `[1]: Altimeter index` becomes
 * `Altimeter index`, trimmed to something a placeholder can wear.
 */
export function parameterLabel(parameters: string, slot: number): string {
  const at = parameters.indexOf(`[${slot}]`)
  if (at === -1) return `p${slot}`

  const start = parameters.indexOf(":", at)
  if (start === -1) return `p${slot}`

  const next = parameters.indexOf("[", start)
  const raw = parameters
    .slice(start + 1, next === -1 ? undefined : next)
    .trim()

  // First clause only, and short: this rides inside a placeholder, not a doc.
  const clause = raw.split(/[.,(]/)[0]!.trim()
  const label = clause.length > 32 ? `${clause.slice(0, 32).trimEnd()}…` : clause
  return label || `p${slot}`
}

/**
 * The whole calling shape for a multi-parameter key event.
 *
 * Operand order is the reversed documentation order — `[0]` is pushed last,
 * nearest the call — which FS Copilot's own ParseSet confirms by reversing
 * the args before transmission (docs/fscopilot-behavior.md). The final
 * placeholder is the `[0]` value, so tabbing runs outside-in.
 */
export function kEventSnippet(event: string, parameters: string): string {
  const count = documentedParams(parameters)

  const operands = []
  for (let slot = count - 1; slot >= 0; slot -= 1) {
    operands.push(
      `\${${count - slot}:${snippetText(parameterLabel(parameters, slot))}}`
    )
  }

  return `${operands.join(" ")} (>K:${count}:${event}`
}

/**
 * How one index entry completes in write position, or null to withhold it.
 *
 * `knows` answers whether the index holds a name — the `B:` branch uses it
 * rather than inventing an operation the aircraft never enumerated. Optional,
 * because a caller without the index is better served by the bare name than
 * by a guess.
 */
export function writeOffer(
  entry: VarEntry,
  knows?: (name: string) => boolean
): WriteOffer | null {
  const parsed = parseVar(entry.name)

  switch (parsed.ns) {
    case "A": {
      // Documented and not settable: writing it is a no-op the sim never
      // reports. Undocumented A: names stay — absence of evidence.
      if (entry.sdk?.doc?.settable === false) return null
      return { insert: entry.name }
    }

    case "K": {
      const parameters = entry.sdk?.doc?.parameters
      const count = parameters ? documentedParams(parameters) : 0

      if (parameters && count >= 2) {
        return {
          insert: `K:${count}:${parsed.name}`,
          snippet: kEventSnippet(parsed.name, parameters),
          note: `takes ${count} parameters — [0] pushed last`,
        }
      }
      return { insert: entry.name }
    }

    case "B": {
      /*
       * A state preset is written through a generated operation, and `_Set`
       * is the one that takes a value. But whether a bare write lands is
       * decided by the code the aircraft attached to the preset, not by the
       * grammar (`b-write-needs-action`) — vendors ship presets that *are*
       * the action, and the corpus writes hundreds of them bare.
       *
       * So `_Set` is offered only when the aircraft has enumerated a name by
       * that spelling. Appending it blind used to complete a name nothing
       * in the sim answers to, which looks exactly like a setter that works.
       */
      if (parsed.op === null) {
        const set = `${entry.name}_Set`
        if (knows?.(set))
          return {
            insert: set,
            note: "writes through an operation — _Inc, _Dec may exist too",
          }
        return {
          insert: entry.name,
          note: "no _Set on this aircraft — a bare write lands only if the preset is the action",
        }
      }
      return { insert: entry.name }
    }

    case "E":
      // The one writable environment variable.
      return parsed.name.toUpperCase() === "SIMULATION RATE"
        ? { insert: entry.name }
        : null

    case "L":
    case "Z":
    case "H":
    case "I":
    case "O":
    case null:
      return { insert: entry.name }

    // Fired-only or context-bound namespaces have no write position.
    default:
      return null
  }
}
