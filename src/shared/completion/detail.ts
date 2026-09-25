/**
 * The detail line an offer carries — why it is in the list, in a phrase.
 *
 * Held to docs/copy.md: one vocabulary ("the aircraft in the sim", "input
 * event"), singulars handled, no advice. A detail says what the evidence is
 * and stops; the documentation panel beside the list is where the rest goes.
 */

import type { Evidence } from "./complete.ts"

/** "1 profile", "12 profiles". */
function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function detailOf(evidence: Evidence): string {
  switch (evidence.from) {
    case "entry":
      return "this entry's variable"

    case "sets-write":
      return `written for this variable in ${count(evidence.profiles, "profile")}`

    case "file":
      return evidence.uses === 1
        ? "used once in this file"
        : `used ${evidence.uses} times in this file`

    case "aircraft":
      return evidence.how === "moved"
        ? "moved on the aircraft in the sim"
        : evidence.how === "input-event"
          ? "input event on the aircraft in the sim"
          : "named by the profile of the aircraft in the sim"

    case "corpus": {
      const profiles = count(evidence.profiles, "profile")
      switch (evidence.at) {
        case "write":
          return `written by ${profiles}`
        case "skp":
          return `skipped by ${profiles}`
        default:
          return `read by ${profiles}`
      }
    }

    case "catalog":
      return evidence.category ?? "documented in the SDK"

    case "sim":
      return "known to the sim"

    case "shared-get":
      return evidence.file === null
        ? "used under shared: in this file"
        : `used under shared: in ${evidence.file}`

    case "sequence":
      return `next in ${evidence.file}, a profile like this one`

    case "operation":
      return "seen in no profile"

    case "bare":
      return `written bare in ${count(evidence.profiles, "profile")}`

    case "similar":
      return `used in ${evidence.file}, a profile like this one`

    case "similar-setter":
      return `written for this variable in ${evidence.file}, a profile like this one`

    case "unit":
      if (evidence.canonicalOf)
        return `canonical spelling of "${evidence.canonicalOf}"`
      return evidence.uses ? count(evidence.uses, "use") : ""
  }
}
