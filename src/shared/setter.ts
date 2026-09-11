/**
 * What running a setter means, as a contract.
 *
 * Split from the resolving itself because the two halves live in different
 * processes and only one of them can evaluate anything: the JavaScript branch
 * needs an engine, and the window's CSP is `script-src 'self'` with no
 * `unsafe-eval`, so `new Function` throws in the renderer. Main resolves and
 * the popover asks — which is the better shape regardless, since the preview
 * then shows the exact string that will be sent rather than a second
 * computation of it.
 *
 * The classification lives here rather than in main because the renderer needs
 * it without asking: whether an entry is runnable at all, and which line the
 * button goes on, are decided while painting a screenful of decorations.
 */

import { setKind } from "./profile/index.ts"

/**
 * How the code for an entry is arrived at.
 *
 * Four, matching `Definition.Set` in FS Copilot branch for branch, in the
 * order they occur across the 65-profile corpus:
 *
 * | kind | entries | |
 * | --- | --- | --- |
 * | `implicit` | 15,933 | no `set:` — the value goes to the `get:` name |
 * | `javascript` | 6,720 | evaluated with `value` and `current` in scope |
 * | `prepended` | 2,017 | starts with `(`, so the value goes in front |
 * | `literal` | 1,863 | sent exactly as written |
 *
 * The implicit case being the majority is the fact that shapes the feature: a
 * run button that only appeared on `set:` lines would miss 60% of what can be
 * run, and the 60% it missed would be the plainest switches in any profile.
 */
export type SetterKind = "implicit" | "javascript" | "prepended" | "literal"

/** The parts of an entry that decide what running it does. */
export interface SetterEntry {
  /** The `get:` name, namespaced as the profile wrote it. */
  name: string
  /**
   * Units as FS Copilot resolves them: what the `get:` line declared, else
   * `Number`, except for `K:` and `H:` events which resolve to none. Use
   * `splitUnits` to get this right rather than reading the raw text.
   */
  units: string
  /** The `set:` value as written. Absent means an implicit setter. */
  set?: string
}

/** What `value` and `current` are bound to for one run. */
export interface SetterBindings {
  value: number | string
  /**
   * What the `get:` variable currently reads.
   *
   * Editable in the popover rather than only observed, because our reads and
   * FS Copilot's can genuinely differ — it reads through the calculator, which
   * converts, and the module reads raw. 13% of setters use `current`, and for
   * `value > current ? INC : DEC` a wrong one picks the wrong branch.
   */
  current: number | string
}

/** The resolved code, or why there is none. The popover's preview. */
export type SetterPreview =
  | { ok: true; kind: SetterKind; code: string }
  | { ok: false; kind: SetterKind; reason: string }

/** The aircraft put the value back — the one outcome the eye cannot catch. */
export interface Revert {
  /** Where the write got it to, before it was undone. */
  went: number
  /** Where it came back to, which is where it started. */
  back: number
  /** How long the aircraft took. 80 ms fights forever; 900 ms is a system. */
  afterMs: number
}

export type RunResult =
  | {
      ok: true
      /** Exactly what was sent to the simulator. */
      code: string
      /**
       * Null when the value held, and null when nothing moved.
       *
       * Both of those are already on screen — the `get:` line's live value sits
       * directly above the popover — so saying them again would be noise. Only
       * the invisible case speaks.
       */
      revert: Revert | null
    }
  /** Nothing was sent, or the calculator refused it. */
  | { ok: false; reason: string; code?: string }

/** The kind of an entry, without resolving it. */
export function setterKind(entry: SetterEntry): SetterKind {
  return entry.set === undefined ? "implicit" : setKind(entry.set)
}

/** What the run popover needs to show for one entry. */
export interface SetterInputs {
  /** A `value` field: the setter does something with what you type. */
  value: boolean
  /** A `current` field: the setter reads what the variable already is. */
  current: boolean
  /** The resolved-code preview. */
  preview: boolean
}

/**
 * Word-boundary matches, so `L:CurrentAltitude` and `my_value` do not count.
 *
 * A mention inside a string still does — `'0 (>L:value)'` would offer a field
 * nothing reads — but that is a field too many rather than a field too few,
 * and the alternative is parsing the expression to find out.
 */
const USES_VALUE = /\bvalue\b/
const USES_CURRENT = /\bcurrent\b/

/**
 * Which fields are worth showing, and whether the preview earns its space.
 *
 * A popover that asks for everything every time makes the common case as heavy
 * as the rare one, and the common case is very light: an `L:` switch with no
 * `set:` needs a number and a button. So each kind is asked what it actually
 * reads.
 *
 * | kind | value | current | preview | |
 * | --- | --- | --- | --- | --- |
 * | `implicit` | yes | no | **no** | the code is `<value> (>NAME, Units)` — every part of it is already on the line you clicked |
 * | `prepended` | yes | no | yes | the value is prepended to code somebody wrote, and that code can be wrong |
 * | `literal` | **no** | no | yes | fixed code; what you type would change nothing |
 * | `javascript` | if mentioned | if mentioned | yes | |
 *
 * The preview is not decoration where it is shown — it is the whole of the
 * mitigation for running arbitrary calculator code. Hiding it for the implicit
 * case is safe precisely because there is no authored code to preview: the name
 * and the units are on screen, and the value is in the field.
 */
export function setterInputs(entry: SetterEntry): SetterInputs {
  const kind = setterKind(entry)

  if (kind === "implicit")
    return { value: true, current: false, preview: false }
  if (kind === "prepended")
    return { value: true, current: false, preview: true }
  if (kind === "literal") return { value: false, current: false, preview: true }

  const source = entry.set ?? ""

  return {
    value: USES_VALUE.test(source),
    current: USES_CURRENT.test(source),
    preview: true,
  }
}
