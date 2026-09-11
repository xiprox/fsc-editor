/**
 * The variable index, held once for every language feature.
 *
 * Completion held this privately until hover needed the same truth — the
 * same split the descriptor table exists to prevent, one layer up. The
 * store also answers the identity question the raw array cannot: a hover
 * on `A:NAV OBS:1` wants the entry for `A:NAV OBS`, and `K:2:KOHLSMAN_SET`
 * wants `K:KOHLSMAN_SET` — `varIdentity` folds written forms to the names
 * the index is keyed by.
 */

import { parseVar, varIdentity } from "@shared/vars"
import type { VarIndex, VarEntry } from "@shared/types"

let index: VarIndex | null = null
let byIdentity = new Map<string, VarEntry>()
let inputEvents: Set<string> | null = null

export function setVarIndexStore(next: VarIndex | null): void {
  index = next

  // Lower-cased, because the only question asked of it is whether a written
  // `B:` name is in here, and nothing about these names is case-carrying.
  inputEvents = next?.inputEvents
    ? new Set(next.inputEvents.map((name) => name.toLowerCase()))
    : null

  byIdentity = new Map()
  for (const entry of next?.entries ?? []) {
    // Entries are already identity-named by the fold in main; parseVar makes
    // that explicit rather than assumed.
    byIdentity.set(varIdentity(parseVar(entry.name)), entry)
  }
}

export function varIndex(): VarIndex | null {
  return index
}

/** The entry a written name folds to, or undefined. */
export function entryFor(name: string): VarEntry | undefined {
  return byIdentity.get(varIdentity(parseVar(name)))
}

/**
 * Whether the loaded aircraft has registered this input event, or null when
 * there is no aircraft and therefore no answer.
 *
 * Presence is strong evidence, absence is weak: the table fills as add-ons
 * wake up, so a name missing moments after a swap may only be late.
 */
export function aircraftHasInputEvent(name: string): boolean | null {
  if (!inputEvents) return null
  return inputEvents.has(name.toLowerCase())
}

/**
 * What this aircraft has been seen doing with an input event, or null when
 * nothing has been recorded for it.
 *
 * Null covers both "no aeroplane" and "this control has never been touched",
 * which are the same answer to a rule: no evidence. Counts accumulate across
 * sessions, so this fills in as somebody flies rather than arriving at once.
 */
export function aircraftInputEventActivity(
  name: string
): { firings: number; changes: number } | null {
  const facet = entryFor(`B:${name}`)?.aircraft
  if (!facet) return null

  const firings = facet.firings ?? 0
  const changes = facet.changes ?? 0
  if (!firings && !changes) return null

  return { firings, changes }
}
