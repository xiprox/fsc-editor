/**
 * Live values from the simulator, as the editor reads them.
 *
 * Module state rather than store state, for a reason specific to Monaco: an
 * inlay hint provider is registered once, outside React, and is called by the
 * editor whenever it decides to repaint a range. It cannot read a hook. So the
 * values live here, the provider reads them synchronously, and an event tells
 * the editor when to ask again.
 *
 * The parsing half is in `watch-set.ts`, which stays free of monaco so it can
 * be tested.
 */

import * as monaco from "monaco-editor"

import type { SimValue } from "@shared/sim"

const values = new Map<string, SimValue>()

const changed = new monaco.Emitter<void>()

/** Fires when any watched value moved. The provider's refresh signal. */
export const onDidChangeSimValues = changed.event

/**
 * Replaces the known values.
 *
 * The whole set arrives each time rather than a delta, so this clears first — a
 * variable that has left the watch set must stop having a value, or its hint
 * lingers showing whatever it read last.
 */
export function setSimValues(next: SimValue[]): void {
  values.clear()
  for (const value of next) values.set(value.name, value)
  changed.fire()
  fired += 1
}

/*
 * Two counters, and the reason they exist.
 *
 * Stage 3's symptom was a hint that shows once and then freezes while values
 * keep arriving. That had two causes on opposite sides of a boundary nothing
 * could see across: either this event stopped firing, or Monaco stopped asking.
 * Watching the screen could not tell them apart, and neither could a test — the
 * provider was called by the editor, not by us.
 *
 * **It was the second one, and it is answered now**: `InlayHintsController`
 * dropped its subscription after the first update and never renewed it. The
 * rendering moved to decorations in `live-decorations.ts`, so both sides of the
 * boundary are ours and the mystery is gone.
 *
 * The counters stay, with `asked` now meaning "a redraw actually changed
 * something on screen" rather than "Monaco asked". That is still the question
 * worth being able to answer from the Log panel — values arriving and nothing
 * appearing is a different fault from no values arriving — and the pair is
 * cheap.
 */
let fired = 0
let asked = 0

/** Called when a model's decorations are actually rewritten. */
export function noteHintsRequested(): void {
  asked += 1
}

/** `{ fired, asked }` — see the note above. */
export function refreshCounters(): { fired: number; asked: number } {
  return { fired, asked }
}

/** Drops everything, for a disconnect. Hints vanish rather than going stale. */
export function clearSimValues(): void {
  if (!values.size) return
  values.clear()
  changed.fire()
}

export function simValue(name: string): SimValue | undefined {
  return values.get(name)
}
