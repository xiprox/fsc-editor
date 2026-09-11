/**
 * The entry under the caret, traced.
 *
 * The renderer's half of plan §3: find which entry the caret is in, ask main
 * to build its setter, and hand both to the model. Everything that decides
 * what FS Copilot does lives in `@shared/trace`; this file only answers
 * *which* entry and *with what*.
 *
 * ## Why main builds the setter
 *
 * `Definition.Set` is the one branch needing a JavaScript engine, and the
 * window's CSP has no `unsafe-eval`. `setter:preview` already resolves it for
 * the run popover, so the trace calls the same IPC rather than growing a
 * second evaluator — which also means the panel and the run button can never
 * disagree about what a setter builds.
 */

import { scanEntries, scanLines, type RawEntry } from "@shared/profile"
import { traceEntry, type Trace, type TraceBindings } from "@shared/trace"

import { simValue } from "./sim-values"

/** The entry a trace is about, with the lines it occupies. */
export interface TracedEntry {
  entry: RawEntry
  /** The `get:` line, which is where the panel points. */
  line: number
}

/**
 * The entry the caret is inside, or null.
 *
 * "Inside" is the entry whose `get:` is the nearest one above, *in the same
 * block*. The block check is what stops the last entry of `shared:` claiming
 * the caret once it has moved into `master:` — the nearest `get:` above is
 * still that one, and without the check the panel would describe an entry
 * from the wrong half of the file.
 *
 * A blank line or a comment between entries keeps the previous one, which is
 * deliberate: the panel follows a caret that is being moved around, and going
 * blank on every gap would flicker.
 */
export function entryAt(text: string, line: number): TracedEntry | null {
  const lines = scanLines(text)
  const caret = lines[line - 1]
  if (!caret) return null

  const block = caret.context.block
  if (block !== "shared" && block !== "master") return null

  let best: TracedEntry | null = null
  for (const entry of scanEntries("", text)) {
    if (entry.block !== block) continue
    if (entry.at.get > line) break
    best = { entry, line: entry.at.get }
  }

  return best
}

/**
 * What the model needs to know about an entry.
 *
 * Narrower than `RawEntry` on purpose: the panel passes these five fields as
 * separate values, so React can compare them and the round trip to main only
 * happens when one of them actually moved — not on every keystroke in the
 * file, which is when `entryAt` builds a fresh object.
 */
export interface TraceRequest {
  block: "shared" | "master"
  name: string
  units: string
  set?: string
  skp?: string
}

/**
 * What the field holds, as the model wants it.
 *
 * A number where the text is one, because every comparison in the model is
 * numeric; the text is kept as text so a string-valued entry can still be
 * traced. An empty field is 0 rather than nothing — the right-hand field is
 * the value arriving, and an update always carries one.
 */
function bound(typed: string): number | string {
  const trimmed = typed.trim()
  if (trimmed === "") return 0

  return Number.isNaN(Number(trimmed)) ? typed : Number(trimmed)
}

/**
 * `value` from the right field, `current` from the left one or the simulator.
 *
 * `current` is the entry's local reading, and the panel lets it be typed over
 * so the toggle guard can be pushed open and shut without waiting for the
 * aircraft. An empty left field falls back to the live value, and where there
 * is no live value either it is **null** — which the model reads as FS
 * Copilot's own null rather than as a missing input. That distinction is
 * load-bearing: `currentValue` starts null in `Coordinator.AddLink` and the
 * guard behaves differently there, so a panel that substituted 0 would show
 * a guard closing that in the simulator would have stayed open.
 */
export function bindingsFor(
  name: string,
  typed: string,
  typedCurrent = ""
): TraceBindings {
  const live = simValue(name)

  return {
    value: bound(typed),
    current:
      typedCurrent.trim() !== ""
        ? bound(typedCurrent)
        : live
          ? live.value
          : null,
  }
}

/**
 * The trace for one entry, with the setter built by main.
 *
 * Returns null when the preview call fails, which is not the same as a setter
 * that threw: the second is a `SetterPreview` with `ok: false` and is traced
 * like any other, because FS Copilot carries on with an empty expression.
 */
export async function traceFor(
  request: TraceRequest,
  bindings: TraceBindings
): Promise<Trace | null> {
  const preview = await window.api.previewSetter(
    { name: request.name, units: request.units, set: request.set },
    { value: bindings.value, current: bindings.current ?? bindings.value }
  )
  if (!preview) return null

  return traceEntry(request, bindings, preview)
}
