/**
 * The current value of everything the simulator has told us about.
 *
 * One map, fed by both transports. That is the whole reason this file exists:
 * `A:` arrives as a complete set once a second and `L:` arrives as deltas at
 * 15 Hz, and the renderer replaces its values wholesale on every message — so
 * emitting each transport's news on its own would mean each one erasing the
 * other's. Main holds the union and emits that.
 *
 * ## Why every `L:` is kept, not just the watched ones
 *
 * The module sends deltas. A variable that has not moved since enumeration
 * sends nothing, so a watch set assembled *after* connecting would sit empty
 * for every switch nobody has touched — which is most of them, and exactly the
 * ones somebody writing a profile is looking at.
 *
 * It works because the module seeds its `last` array with NaN, so the first
 * tick after enumeration reports all ~6,150. Keeping them costs a map of
 * numbers and means opening a file shows values immediately instead of waiting
 * for something to move.
 *
 * ## Units
 *
 * Values are stored raw and labelled on the way out with whatever units the
 * profile line asked for. For `A:` that is honest — SimConnect converted on
 * request. For `L:` it is an assumption, and it is measured rather than hoped:
 * of 19,977 `L:` `get:` lines in the corpus, 74% carry no unit at all, and of
 * the 5,345 that do, 99.7% are `Number`, `Bool`, `Percent` or `Enum`. The
 * genuinely converting units — `Fahrenheit`, `Mhz`, `degrees`, `Position16k`,
 * `ft/min` — total **17 lines**, 0.085%.
 *
 * So raw is right almost everywhere, and passing the requested units through is
 * what lets `Bool` render as a boolean rather than as `1`. The 17 are a known
 * inaccuracy, recorded here rather than papered over; making them exact needs
 * the module to read per-unit, which is a protocol change and not worth it for
 * 0.085% of lines.
 */

import type { SimValue, SimVarWatch } from "@shared/sim"
import { inputEventIds, parseVar } from "@shared/vars"

/** Raw values by namespaced name — `A:BATTERY VOLTAGE`, `L:DmeOnOffKnob`. */
const values = new Map<string, number>()

/**
 * What the editor is asking about, every namespace.
 *
 * Deliberately not the same list `session.ts` keeps in `live.watching`. That
 * one is `A:` only and its *indices are datum ids*, so it cannot gain entries
 * without shifting the meaning of every tagged record in flight. This one is
 * for deciding what to emit, and nothing indexes into it.
 */
let watching: SimVarWatch[] = []

/**
 * The same names again, for membership.
 *
 * `recordValue` runs once per *arriving value*, and the module reports every
 * `L:` that moved — about 6,150 of them on the tick after enumeration. Asking
 * an array whether it contains a name made that `O(stream × watch)`, which was
 * survivable while the watch set was a few `get:` lines and stopped being so
 * the moment a panel could watch hundreds. The array stays because order is
 * meaningful to `watchedValues`; this is only for the question asked hottest.
 */
let watchedNames = new Set<string>()

/**
 * Which watched names take their value from each input-event id.
 *
 * `B:` is the one namespace where the name a profile writes is not the name a
 * value arrives under. The simulator's table holds IDs and profiles write
 * `<ID>_<Preset>`, so a value recorded as `B:AIRLINER_FCU_CHRONO_2` belongs on
 * a line that says `B:AIRLINER_FCU_CHRONO_2_Push`. Resolved once per watch set
 * rather than per arriving value, which is the hot path.
 *
 * A consequence worth stating: every preset of one control shares one value,
 * because there is no per-preset value to have. Two lines writing different
 * presets of the same switch show the same number, and that number is the
 * switch's.
 */
let inputAliases = new Map<string, string[]>()

/** Set when a watched value moved, so an idle cockpit emits nothing. */
let dirty = false

/** The input-event ids a watched `B:` name could take its value from. */
function idsFor(written: string): string[] {
  const ref = parseVar(written)
  if (ref.ns !== "B") return []

  return inputEventIds(ref.name, ref.preset).map((id) => `B:${id}`)
}

export function setWatch(next: SimVarWatch[]): void {
  watching = next
  watchedNames = new Set(next.map((entry) => entry.name))

  inputAliases = new Map()
  for (const entry of next) {
    for (const id of idsFor(entry.name)) {
      const names = inputAliases.get(id) ?? []
      names.push(entry.name)
      inputAliases.set(id, names)
    }
  }
  // The set changed, so what the renderer holds is wrong even if no value did:
  // it clears and replaces on receipt, and a variable that has left the watch
  // set has to stop having a value or its hint lingers showing a stale number.
  dirty = true
}

export function recordValue(name: string, value: number): void {
  const previous = values.get(name)
  values.set(name, value)

  // `inputAliases` covers the `B:` case, where the arriving name is the input
  // event's id and the watched name carries a preset suffix on top of it.
  if (previous !== value && (watchedNames.has(name) || inputAliases.has(name))) {
    dirty = true
  }
}

export function recordValues(next: SimValue[]): void {
  for (const value of next) recordValue(value.name, value.value)
}

/**
 * The watched subset, labelled with the units each line asked for.
 *
 * Keyed by name only, matching the renderer: two `get:` lines naming the same
 * variable in different units collapse to one hint there, so producing two
 * entries here would only be a longer message saying the same thing.
 */
/**
 * What one watched name reads, following the `B:` id fallback.
 *
 * The written name is tried first so nothing changes for the namespaces where
 * it is also the name values arrive under — which is all of them but one.
 */
function valueOf(name: string): number | undefined {
  const direct = values.get(name)
  if (direct !== undefined) return direct

  for (const id of idsFor(name)) {
    const value = values.get(id)
    if (value !== undefined) return value
  }

  return undefined
}

export function watchedValues(): SimValue[] {
  const out: SimValue[] = []
  const seen = new Set<string>()

  for (const { name, units } of watching) {
    if (seen.has(name)) continue

    const value = valueOf(name)
    if (value === undefined) continue

    seen.add(name)
    out.push({ name, units, value })
  }

  return out
}

/**
 * What one variable last read, raw, or null if nothing has reported it.
 *
 * Raw rather than unit-labelled because the caller is a run, not a display:
 * `run.ts` compares this against what the module reports afterwards, and both
 * sides of that comparison have to be the same number in the same units.
 *
 * Null and zero are different answers here — "nobody has ever said" versus
 * "it reads zero" — and a run uses the distinction: with no `before` there is
 * nothing for a value to come back *to*, so no revert can be claimed.
 */
export function valueFor(name: string): number | null {
  return values.get(name) ?? null
}

/** True when something worth sending has changed since the last `takeDirty`. */
export function takeDirty(): boolean {
  const was = dirty
  dirty = false
  return was
}

/**
 * Forgets everything. A disconnect, or the end of a session.
 *
 * The watch set survives, because it describes the open editors rather than the
 * connection — reconnecting should light the same lines up again without the
 * renderer having to re-send it.
 */
export function resetValues(): void {
  values.clear()
  dirty = false
}

/** How many values are held. For the Log panel, and for tests. */
export function valueCount(): number {
  return values.size
}
