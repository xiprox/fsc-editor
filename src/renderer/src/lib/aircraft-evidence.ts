/**
 * The rule context's aircraft half — evidence about the aeroplane in the
 * simulator, which says something only about that aeroplane's profile.
 *
 * Every piece of it answers a question about the *loaded* aircraft: whether it
 * registers an input event, what its controls have been seen doing, whether
 * the module resolved a ref on it. Handed to every open file, it judged one
 * aircraft's profile against another — `b-preset-unknown` telling somebody a
 * control did not exist on the aircraft they were writing for, because a
 * different aircraft was loaded.
 *
 * So it goes only to the file FS Copilot would load for that aircraft —
 * `profileIsFor`'s exact-match rule. Every other file gets nothing, which the
 * rules already read as "no aircraft": the tier's silent case. That includes
 * `include:` modules. One is shared by any number of aircraft, and the loaded
 * one's answer is not the answer for the rest.
 */

import type { RuleContext } from "@shared/lang"
import { profileIsFor } from "@shared/profile"

import {
  aircraftHasInputEvent,
  aircraftInputEventActivity,
  varIndex,
} from "./var-index-store"
import { refResolved } from "./watch-resolution"

export type AircraftEvidence = Pick<
  RuleContext,
  "hasInputEvent" | "inputEventActivity" | "refResolved"
>

/**
 * The aircraft evidence for one file, or none when the file is not the loaded
 * aircraft's profile.
 *
 * The aircraft is the index's rather than the chip's: the input-event list
 * rides the index, so the two can only agree about which aeroplane they
 * describe if they are read from the same place.
 */
export function aircraftEvidence(relPath: string | null): AircraftEvidence {
  if (!profileIsFor(relPath, varIndex()?.aircraft ?? null)) return {}

  return {
    // The first live-evidence channel: this answer changes when the aeroplane
    // does, and the index refresh already re-runs every open file.
    hasInputEvent: aircraftHasInputEvent,
    // The same channel one question deeper: not whether the control exists,
    // but whether working it has ever moved its value. Refreshed by the same
    // index update, so it re-runs every open file for free.
    inputEventActivity: aircraftInputEventActivity,
    // The second, and the one that moves without the aeroplane moving: the
    // module re-reports resolution as refs resolve and as the watch set
    // changes, and `sim:watch-resolution` re-runs every open file.
    refResolved,
  }
}
