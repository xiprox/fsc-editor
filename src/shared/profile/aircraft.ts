/**
 * How a profile relates to the aircraft it is for.
 *
 * Two halves of one rule: reading an aircraft out of a filename, and writing a
 * filename's worth of profile for an aircraft that has none. `profileFilename`
 * is the third side of the same coin — what a name somebody *typed* means —
 * and lives here because the answer is the filename rule again.
 */

import { ENTRY_INDENT, renderHeading } from "./grammar.ts"

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
 * **It is a working profile, not a lecture.** The first version of this was
 * five lines of stub; the second over-corrected into forty lines of prose with
 * every example commented out, on the theory that a file nobody typed must not
 * be able to move anything. Both taught badly, and for the same reason: what a
 * reader needs is *entries that look like the ones they are about to write*,
 * with a line above each saying what it demonstrates. So every entry here is
 * live, each section carries one shape, and the comments are one or three lines
 * rather than paragraphs.
 *
 * The safety argument the commented version was built on does not survive
 * contact with what this file is. It is named for an aircraft the user asked
 * about, it is theirs to edit before anyone flies with it, and the variables
 * below belong to an aeroplane that is not the one they have loaded — so it
 * syncs nothing until they make it theirs. A profile that cannot do anything is
 * not a profile.
 *
 * **Every entry is checked, and that matters more than it sounds.** The first
 * draft of this set reached for `(>K:BEACON_LIGHTS_SET)` and
 * `(>K:AP_ALT_VAR_SET_ENGLISH)` with a prepended value; both events take two
 * parameters, and the `k-arity` rule caught them. A starter file is the one
 * file in the app whose mistakes get copied, so it is opened in the editor and
 * read against the full rule set — with the SDK catalogue and a live sim — and
 * it comes back clean. `analyzeProfile` covers the structural half in the
 * tests; the rest needs the running app.
 *
 * **`Math.round` in the decision height example is load-bearing.** `Array(n)`
 * refuses a fractional `n` — `Invalid array length` — and `A:DECISION HEIGHT`
 * is stored in metres, so a reading asked for in `Feet` is fractional whenever
 * the conversion does not land clean. Without the rounding the setter throws
 * on an ordinary value, which a draft of this file did. It also absorbs float
 * noise into the `delta === 0` guard, so a difference of nothing stays nothing.
 *
 * What it deliberately does **not** do is divide by a step. The profile this
 * came from does (`/ 3.048`, its inc/dec event moving 10 ft at a time), so the
 * count here is one event per foot rather than one per step of the bug — right
 * only for an aircraft whose event steps by one. That is the reader's to adapt
 * and the comment above it says so; the alternative was asserting a step
 * constant nobody has confirmed for the stock `K:` events, which is a worse
 * thing for a file whose mistakes get copied.
 *
 * What each part is for:
 *
 * - The header block is prose first, then `Author:`, `Updated:` and
 *   `Version:`. `Updated:` is the one FS Copilot parses. Prose above it is safe
 *   because `HEADER_META` only claims a leading comment shaped `Word: value`,
 *   and none of these sentences is.
 * - `NOTES` is a section at column 0, which is what puts it in the sidebar
 *   outline — and the comment under it says so, because a heading that silently
 *   does something useful teaches nothing.
 * - `master:` holds a throttle and a trim: continuous controls, which is what
 *   the block is for.
 * - `shared:` holds the four setter shapes in the order they are met —
 *   implicit, prepended, JavaScript, block scalar — then a `skp:` pair, which
 *   needs *two* entries to make sense and is the reason `L:BusTieSwitch` has an
 *   entry of its own.
 *
 * Written in the formatter's canonical shape rather than near it: headings come
 * from `renderHeading`, entries from `ENTRY_INDENT`. A starter file whose first
 * save visibly rewrote itself would teach that saving moves your work around.
 * `newProfile` is pinned against `formatProfile` in the tests.
 *
 * `at` is a parameter so this stays a function of its arguments: the clock is
 * the caller's business, and a header that has to be asserted in a test cannot
 * come from one this function reads for itself.
 */
export function newProfile(aircraft: string, at = new Date()): string {
  const indent = " ".repeat(ENTRY_INDENT)
  const line = (text = ""): string => (text ? `${indent}${text}` : "")
  const note = (text: string): string => line(`# ${text}`)
  const section = (title: string): string =>
    line(renderHeading(1, title, ENTRY_INDENT))
  const subsection = (title: string): string =>
    line(renderHeading(2, title, ENTRY_INDENT))

  return [
    `# A profile for ${aircraft}.`,
    `#`,
    `# Comments and the examples to help you get oriented.`,
    `#`,
    `# Author: Your Name`,
    `# Updated: ${today(at)}`,
    `# Version: 0.0.1`,
    ``,
    renderHeading(1, "Notes"),
    `# This notes section will show up on the sidebar (click > on the left of the`,
    `# file name).`,
    ``,
    `# master entries are driven only by whoever is flying.`,
    `master:`,
    section("Throttle"),
    line(`- get: L:Throttle_1_Raw`),
    line("  set: \"`${Math.round(value * 16383)} (>K:THROTTLE1_SET)`\""),
    ``,
    section("Trim"),
    note("Units come after a comma. They default to Number when you leave them out."),
    line(`- get: A:ELEVATOR TRIM PCT, Percent scaler 16k`),
    line(`  set: (>K:ELEVATOR_TRIM_SET)`),
    ``,
    `# shared entries go both ways — a change on either PC is sent to the other.`,
    `shared:`,
    section("Lights"),
    ``,
    note("With no set: line, whatever arrives is written straight to the variable."),
    line(`- get: L:LandingLightSwitch_1`),
    ``,
    note("A set: starting with ( gets the incoming value put in front of it, so this"),
    note("one is sent as `1 (>B:LIGHTING_PANEL_1_Set)` when L:LIGHTING_PANEL_1 comes"),
    note("as 1."),
    line(`- get: L:LIGHTING_PANEL_1`),
    line(`  set: (>B:LIGHTING_PANEL_1_Set)`),
    ``,
    note("A set: holding ' ` ? { or } runs as JavaScript first, with `value` and"),
    note("`current` in scope. What it returns is the string that gets executed by"),
    note("the sim."),
    line(`- get: A:LIGHT BEACON:1, Bool`),
    line("  set: \"`1 ${value} (>K:2:BEACON_LIGHTS_SET)`\""),
    ``,
    section("Electrical"),
    ``,
    note("Longer logic goes in a block. Same rule: return the string to execute, or"),
    note("an empty one to do nothing at all."),
    line(`- get: L:GeneratorSwitch_1`),
    line(`  set: |`),
    line(`    if (value < 5) return '21 (>L:ElectricalTrigger)'`),
    line(`    if (value >= 15) return '22 (>L:ElectricalTrigger)'`),
    line(`    return ''`),
    ``,
    note("Sometimes, you may need to do something more complicated."),
    // `note("")` would emit `# ` with a trailing space, which the formatter
    // strips — the one way this file could fail to be its own canonical form.
    line(`#`),
    note("In this example, there is no absolute setter that can make sure the other"),
    note("pilot receives the same value on their sim (we only have increment and"),
    note("decrement). The solution calculates the difference between the current"),
    note("value and the incoming one, and repeats that many inc/dec events in"),
    note("one go."),
    line(`- get: A:DECISION HEIGHT, Feet`),
    line(`  set: |`),
    line(`    (() => {`),
    line(`      const delta = Math.round(value - current);`),
    line(`      if (delta === 0) return '';`),
    line(`      const event = delta > 0`),
    line(`        ? '0 (>K:INCREASE_DECISION_HEIGHT)'`),
    line(`        : '0 (>K:DECREASE_DECISION_HEIGHT)';`),
    line(`      return Array(Math.abs(delta)).fill(event).join(' ');`),
    line(`    })()`),
    ``,
    subsection("Switches that move each other"),
    ``,
    note("Applying this one also moves the bus tie, and the get entry below would"),
    note("send that change straight back. skp: holds back its next change."),
    line(`- get: L:GeneratorSwitch_2`),
    line(`  skp: L:BusTieSwitch`),
    ``,
    line(`- get: L:BusTieSwitch`),
    ``,
  ].join("\n")
}

/**
 * The characters Windows will not have in a filename, named so that typing one
 * gets a sentence rather than an `EINVAL`. Not the whole rule — reserved names
 * and trailing dots are still the filesystem's to refuse, and it does.
 */
const ILLEGAL_NAME = /[<>:"/\\|?*]/

/** A typed name as a profile's filename, or why it is not one. */
export type ProfileFilename =
  | { ok: true; filename: string }
  | { ok: false; reason: string }

/**
 * What a name somebody typed means as a filename.
 *
 * Shared rather than main's alone because two surfaces now ask it and only one
 * of them touches a disk. Renaming a profile is a filesystem operation and
 * always was; naming a *new* one is not — nothing is written until the tab is
 * saved, so the renderer has to be able to turn down `A320?` itself rather
 * than opening a buffer that Ctrl+S will refuse a minute later, by which time
 * the name is no longer the thing being typed.
 *
 * The extension is added rather than demanded. `A320neo` is what people type,
 * and a name that lost its `.yaml` would stop being a profile without ever
 * looking wrong in the sidebar.
 *
 * Separators are refused along with the rest, which is what keeps a name a
 * name: a profile's folder decides whether FS Copilot loads it as an aircraft
 * or includes it as a module, so typing one is a bigger thing than naming.
 */
export function profileFilename(name: string): ProfileFilename {
  const trimmed = name.trim()

  if (!trimmed) return { ok: false, reason: "A profile needs a name." }

  if (ILLEGAL_NAME.test(trimmed))
    return {
      ok: false,
      reason: `A profile name cannot contain < > : " / \\ | ? *`,
    }

  return {
    ok: true,
    filename: /\.ya?ml$/i.test(trimmed) ? trimmed : `${trimmed}.yaml`,
  }
}
