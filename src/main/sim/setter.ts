/**
 * Turning a profile entry into the calculator code that runs it.
 *
 * This is the half of "run the setter" that needs no simulator: given an entry
 * and a value, produce exactly the string FS Copilot would produce, so the
 * preview can show it and the module can be handed it.
 *
 * ## Four kinds, not one
 *
 * `Definition.Set` in FS Copilot has four branches, and only one of them
 * evaluates JavaScript. Modelling fewer would silently mis-resolve most of the
 * corpus — the measured split across 65 profiles and 25,916 entries:
 *
 * | kind | entries | what happens |
 * | --- | --- | --- |
 * | `implicit` | 15,502 | there is no `set:` at all — the value is written to the `get:` name |
 * | `javascript` | 6,563 | a template literal, evaluated with `value` and `current` in scope |
 * | `prepended` | 1,996 | starts with `(`, so the value goes in front of it |
 * | `literal` | 1,855 | sent exactly as written, ignoring the value |
 *
 * **The implicit case is the majority**, which is the thing to notice. A play
 * button that only appeared on `set:` lines would miss 60% of what can be run,
 * and the 60% it missed would be the plain switches — the entries most likely
 * to be wrong in a profile somebody is still writing.
 *
 * `setKind` in the grammar already classifies the three written forms and is
 * reused rather than restated; the fourth is the absence of a `set:`, which is
 * a fact about the entry rather than about any text.
 *
 * ## Why this is in main
 *
 * The JavaScript case needs an evaluator, and the renderer cannot have one:
 * the window's CSP is `script-src 'self'` with no `unsafe-eval`, so
 * `new Function` throws there. Resolving in main and sending the result to the
 * popover is not a workaround for that — it is the better shape anyway, since
 * the preview then shows the exact string that will be sent rather than a
 * second computation of it.
 */

import vm from "node:vm"

// Relative, where the rest of main uses `@shared/...`, because this file is
// also imported by `scripts/check-setters.ts` — and a script runs under plain
// node, which has no idea what `@shared` is. The alias is a bundler's, and the
// sweep over the real corpus is worth more than the consistency.
import {
  setterKind,
  type SetterBindings,
  type SetterEntry,
  type SetterKind,
  type SetterPreview,
} from "../../shared/setter.ts"

// Re-exported so the callers of `resolveSetter` have one import rather than
// two. The definitions live in shared because the renderer needs them and
// cannot reach into main.
export {
  setterKind,
  type SetterBindings,
  type SetterEntry,
  type SetterKind,
  type SetterPreview,
}

/**
 * How long a setter expression gets to produce a string.
 *
 * A profile is somebody else's file — the corpus is shared around — and
 * `while (true) {}` in a `set:` would hang the main process, taking the window
 * with it. This is not a security boundary and is not pretending to be one:
 * `vm` contexts are escapable, and the same file is already being executed by
 * FS Copilot itself. It is a guard against a hang, which is the failure that
 * actually happens.
 *
 * Generous because it only has to be short next to a person: the whole corpus
 * resolves in a few milliseconds.
 */
const EVALUATE_TIMEOUT_MS = 100

/**
 * The calculator code for one entry, or why there is none.
 *
 * Mirrors `Definition.Set` branch for branch. Where the two could differ, the
 * difference is noted at the branch rather than here.
 */
export function resolveSetter(
  entry: SetterEntry,
  bindings: SetterBindings
): SetterPreview {
  const kind = setterKind(entry)

  if (kind === "implicit") return implicitSetter(entry, bindings)
  if (kind === "prepended")
    return {
      ok: true,
      kind,
      code: `${format(bindings.value)} ${entry.set?.trim()}`,
    }
  if (kind === "literal")
    return { ok: true, kind, code: entry.set?.trim() ?? "" }

  return evaluateSetter(entry, bindings)
}

/**
 * No `set:` — write the value to the `get:` variable.
 *
 *     if (_set == null)
 *       return !string.IsNullOrWhiteSpace(Units)
 *         ? $"{valueStr} (>{Get}, {Units})"
 *         : $"{valueStr} (>{Get})";
 *
 * The units are part of it, and that is not cosmetic: `(>L:Foo, Percent)` and
 * `(>L:Foo, Number)` write different numbers for the same input. The units-less
 * spelling is what `K:` and `H:` entries get, because their units resolve to
 * empty — which is also the only spelling an event would accept.
 */
function implicitSetter(
  entry: SetterEntry,
  bindings: SetterBindings
): SetterPreview {
  const name = entry.name.trim()
  if (!name)
    return { ok: false, kind: "implicit", reason: "the entry has no name" }

  const units = entry.units.trim()
  const value = format(bindings.value)

  return {
    ok: true,
    kind: "implicit",
    code: units ? `${value} (>${name}, ${units})` : `${value} (>${name})`,
  }
}

/**
 * The JavaScript, with `value` and `current` in scope.
 *
 * FS Copilot evaluates this in Jint and takes the result as a string; anything
 * else throws inside `AsString()`, is caught, and becomes `string.Empty` — a
 * setter that silently does nothing. Reported here instead, because a preview
 * saying "this produces a number, not code" is the entire value of having one.
 *
 * ## It is a script, not an expression
 *
 * `Engine.Evaluate` runs the text as a **script** and hands back the script's
 * completion value, which is why so much of the corpus is written as statements
 * rather than as one expression. Two consequences, both learned from a sweep:
 *
 * **`return` at the top level is legal in Jint and is not in V8.** 296 entries
 * across the CRJ family, the Albatross, the TBM 850 and others are written as
 * `switch (value) { case 0: return <code> }`. Those profiles are distributed
 * and work, so the shape is supported rather than broken, and running the
 * source as a plain script rejects every one of them with `Illegal return
 * statement`. A second attempt wraps it in a function, where `return` means
 * what its author meant.
 *
 * **A leading `{` is a block, not an object literal.** Which is why the source
 * is not parenthesised: `(${source})` would make `{ value }` an object and
 * change what a handful of entries resolve to.
 */
function evaluateSetter(
  entry: SetterEntry,
  bindings: SetterBindings
): SetterPreview {
  const source = entry.set ?? ""
  const scope = { value: bindings.value, current: bindings.current }

  const run = (code: string): unknown =>
    vm.runInNewContext(code, scope, { timeout: EVALUATE_TIMEOUT_MS })

  let produced: unknown
  try {
    produced = run(source)
  } catch (error) {
    if (!isSyntaxError(error))
      return { ok: false, kind: "javascript", reason: message(error) }

    // The statement form. Wrapped rather than transformed, so what runs is the
    // author's text with nothing rewritten inside it.
    try {
      produced = run(`(function () {\n${source}\n})()`)
    } catch (retry) {
      return { ok: false, kind: "javascript", reason: message(retry) }
    }
  }

  if (typeof produced !== "string")
    return {
      ok: false,
      kind: "javascript",
      // Naming what came back rather than only what was wanted: the usual cause
      // is a missing pair of backticks, and `number` says so at a glance.
      reason: `the expression produced ${describe(produced)}, not calculator code`,
    }

  return { ok: true, kind: "javascript", code: produced }
}

/**
 * A bound value as it appears inside generated code.
 *
 * Numbers only, in effect. FS Copilot builds these branches with C#'s
 * `Convert.ToString`, which renders a bool as `True` — and `True` is not
 * calculator code, so a profile relying on it is already broken in FS Copilot.
 * A boolean typed in the popover arrives here as 1 or 0, which is what the
 * calculator understands and what the wire actually carries.
 */
function format(value: number | string): string {
  return typeof value === "number" ? String(value) : value
}

/**
 * Whether the engine refused to parse, rather than the code failing to run.
 *
 * By name, never by `instanceof`. An error raised inside a `vm` context is
 * built from *that* context's constructors, so `error instanceof SyntaxError`
 * is false for every syntax error this file will ever see — which silently
 * disabled the statement-body retry and rejected 296 corpus entries that had
 * just been made to work.
 */
function isSyntaxError(error: unknown): boolean {
  return name(error) === "SyntaxError"
}

function name(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error
    ? String((error as { name: unknown }).name)
    : ""
}

/** Same realm problem, so the message is read off the object rather than cast. */
function message(error: unknown): string {
  return typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : String(error)
}

function describe(value: unknown): string {
  if (value === null) return "null"
  if (value === undefined) return "undefined"
  if (Array.isArray(value)) return "an array"

  const type = typeof value

  return `${"aeiou".includes(type[0]) ? "an" : "a"} ${type}`
}
