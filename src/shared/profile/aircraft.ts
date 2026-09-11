/**
 * How a profile relates to the aircraft it is for.
 *
 * Two halves of one rule: reading an aircraft out of a filename, and writing a
 * filename's worth of profile for an aircraft that has none.
 */

import { ENTRY_INDENT } from "./grammar.ts"

/**
 * `pa24-250.yaml` -> `pa24-250`, and null for anything that is not an
 * aircraft's profile.
 *
 * A profile is named for the SimObject folder its aircraft lives in, which is
 * also the key the simulator reports on load. Verified against every installed
 * aircraft on a real machine: 16 of 16 match exactly, case aside.
 *
 * **The match is exact, and that is the whole rule.** A suffixed name —
 * `pa24-250-default.yaml`, `pa24-250-old.yaml` — is not a variant of anything,
 * because FS Copilot will not load it either: it looks for the aircraft's key
 * and nothing else. Those files exist because they are convenient to keep
 * around while working, and folding them back onto the aircraft would have this
 * app report a profile as in force that the simulator is ignoring.
 *
 * Subdirectories are excluded by the same rule rather than a separate one:
 * `modules/pa24-250.yaml` is included by path from a profile, never loaded as
 * one, so it is not this aircraft's profile however it is named.
 *
 * Exactness also removes a question that folding created. Two files cannot fold
 * onto one key any more, because two files in one directory cannot share a
 * name — so there is never a tiebreak to make between candidates.
 */
export function profileKey(relPath: string): string | null {
  if (relPath.includes("/") || relPath.includes("\\")) return null

  const name = /^(.+)\.ya?ml$/i.exec(relPath)?.[1]
  return name ? name.toLowerCase() : null
}

/**
 * Whether a file is the profile FS Copilot loads for this aircraft —
 * `profileKey`'s exact-match rule, asked from the other side. False when
 * either half is missing: no file, no aircraft, or a file that is no profile.
 *
 * Its own function because the comparison had been written out inline at each
 * place that needed it, and the third copy is where spellings start to drift.
 */
export function profileIsFor(
  relPath: string | null,
  aircraft: string | null
): boolean {
  if (!relPath || !aircraft) return false
  return profileKey(relPath) === aircraft.toLowerCase()
}

/**
 * Today, as a profile header writes it.
 *
 * Local rather than `toISOString`, which is UTC: someone east of Greenwich
 * creating a profile before their morning would otherwise have it stamped
 * yesterday, and the date in a header is the author's own.
 */
function today(at: Date): string {
  const month = String(at.getMonth() + 1).padStart(2, "0")
  const day = String(at.getDate()).padStart(2, "0")

  return `${at.getFullYear()}-${month}-${day}`
}

/**
 * The starter profile written for an aircraft that has none.
 *
 * It carries one real entry rather than an empty block, because the schema
 * types every top-level key as an array: `shared:` with nothing under it parses
 * as null, and a file created by pressing a button would open with a squiggle
 * across the whole of it.
 *
 * That entry is ambient temperature because ambient temperature is read-only.
 * `shared:` is bidirectional — either pilot's change propagates to the other —
 * so a settable variable here would be a live wire in a file nobody typed, and
 * the obvious candidate for "something simple like the time" is `A:ZULU TIME`,
 * which can shove the other pilot's clock. This one reads a plausible number
 * the moment the sim connects, parked and cold, and refuses every write.
 *
 * `at` is a parameter so this stays a function of its arguments: the clock is
 * the caller's business, and a header that has to be asserted in a test cannot
 * come from one this function reads for itself.
 */
export function newProfile(aircraft: string, at = new Date()): string {
  const indent = " ".repeat(ENTRY_INDENT)

  return [
    `# ${aircraft}`,
    `# Updated: ${today(at)}`,
    ``,
    `shared:`,
    `${indent}# Example entry`,
    `${indent}- get: A:AMBIENT TEMPERATURE, Celsius`,
    ``,
  ].join("\n")
}
