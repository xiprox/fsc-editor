/**
 * Tooltips that explain something the first few times, then stop for good.
 *
 * For things the editor draws many times over, like the live value at the end of
 * every `get:` line. A tooltip on a toolbar
 * button can answer forever, because the pointer only crosses it on the way to
 * it. One on an element a screen shows twenty times answers every time the
 * pointer crosses the code, and it has stopped explaining anything long before
 * it stops appearing.
 *
 * Counted per hint, not per element: three looks at one value teach what every
 * value is.
 *
 * In the `localStorage` tier with the editor preferences. Losing it costs three
 * tooltips each.
 */

export type HintId = "live-value"

/** How many times a hint shows before it stops. */
export const HINT_SHOWS = 3

const KEY = "hints:shown"

function load(): Partial<Record<HintId, number>> {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "")
    return typeof stored === "object" && stored !== null ? stored : {}
  } catch {
    return {}
  }
}

let shown = load()

export function hintLeft(id: HintId): boolean {
  return (shown[id] ?? 0) < HINT_SHOWS
}

export function noteHintShown(id: HintId): void {
  shown = { ...shown, [id]: (shown[id] ?? 0) + 1 }

  try {
    localStorage.setItem(KEY, JSON.stringify(shown))
  } catch {
    // Storage full or unavailable: the count holds for this session, and the
    // hint shows a few more times next launch. Nothing worse.
  }
}
