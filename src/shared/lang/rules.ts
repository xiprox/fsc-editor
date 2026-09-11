/**
 * The rule engine — layer 4. Rules are data; adding one is one file.
 *
 * A rule sees the IR, the stack points, and a context of injected evidence,
 * and returns diagnostics. Three families (18-language-core): `sim` — what
 * the simulator will do; `dialect` — what FS Copilot does with the line;
 * `setter` — what the written shape means versus what was plainly meant.
 * A rule declares its family because the same token is legal in one layer
 * and an error in another (`K:` in a `get:` line is the dialect's event-sync
 * form; `(K:FOO)` inside RPN reads nothing).
 *
 * ## Evidence is injected, never imported
 *
 * The catalogue is an 855 KB JSON that main holds and the renderer must not
 * bundle; corpus and live-sim evidence live in still other places. So the
 * engine takes a `RuleContext` of narrow functions and the caller supplies
 * what it has. A context returning null everywhere is valid — rules built on
 * absent evidence mute themselves, which is the confidence-tier contract:
 * absence of evidence is silence, never a guess.
 *
 * ## Fixes are part of the shape
 *
 * Half the planned rules are corrections — append `_Set`, insert the `2:` —
 * so a diagnostic carries an optional fix from day one. A fix is text edits
 * over the same offsets the tokens carry; the editor turns them into code
 * actions, and `run.ts` or a test can apply them with plain string surgery.
 */

import type { Basis, FactId } from "./facts.ts"
import type { IrDoc } from "./ir.ts"
import type { Simulation } from "./stack.ts"

export type RuleFamily = "sim" | "dialect" | "setter"

export type Severity = "error" | "warning" | "info"

export interface TextEdit {
  start: number
  end: number
  newText: string
}

export interface Fix {
  title: string
  edits: TextEdit[]
}

/**
 * How sure a verdict is — separate from `severity`, which is what breaks if
 * it is right, and from a fact's `basis`, which is where the knowledge came
 * from. The three were one tangled axis while a message was one string: a
 * hedge was a sentence, and the reader had to find it.
 *
 * `certain` — follows from the text, or from source read line by line.
 * `likely`  — evidence with a known way of being wrong: a filling table, a
 *             docs column the corpus contradicts.
 * `possible` — one probe, one aircraft.
 *
 * An `error` must be `certain`; `facts.test.ts` holds the rules to it.
 */
export type Confidence = "certain" | "likely" | "possible"

export interface Diagnostic {
  ruleId: string
  severity: Severity
  start: number
  end: number
  /**
   * Everything, as one plain-text string — what a venue with no structure
   * shows. For a rule written through `diagnose` it is composed from the
   * parts below; a rule not yet converted writes it by hand and has none.
   */
  message: string
  fix?: Fix
  /**
   * The finding, in a breath: "This setter never runs." Plain text — the
   * squiggle and the Issues row render no markdown — and short enough to be
   * a row on its own. No mechanism in it; that is what `why` is for.
   */
  verdict?: string
  /** What will happen because of it, in the future tense. Plain text. */
  consequence?: string
  /**
   * What to do, where a quick fix cannot say it — a fix that needs a
   * judgement, or advice that survives the fix. Plain text.
   */
  remedy?: string
  /** The facts the verdict rests on, by id — rendered where there is room. */
  why?: readonly FactId[]
  /** What *this verdict* rests on; its facts each carry their own. */
  basis?: Basis
  confidence?: Confidence
}

/** A structured diagnostic's parts — `Diagnostic` with `message` left out. */
export type Finding = Omit<Diagnostic, "message" | "verdict" | "confidence"> & {
  verdict: string
  confidence: Confidence
}

/**
 * Builds a structured diagnostic. `message` is the parts in reading order, so
 * every plain venue — a marker, a sweep's console line, a test — says the
 * same thing the structured ones do.
 */
export function diagnose<Extra extends object = object>(
  finding: Finding & Extra
): Diagnostic & Extra {
  const message = [finding.verdict, finding.consequence, finding.remedy]
    .filter((part) => part)
    .join(" ")

  return { ...finding, message }
}

/**
 * Everything a rule may ask about the world. All optional in effect: every
 * method may answer null/undefined, and a rule treats that as "unknown".
 */
/** What the loaded cockpit's panels are called, as `pointer:` would name them. */
export interface CockpitPanelNames {
  /** Every `instrumentIdentifier` present, once each. */
  identifiers: string[]
  /**
   * The full keys behind an identifier. Absent for an identifier whose panels
   * could not be read — known to be there, by a title, and no more than that.
   */
  keys: Record<string, string[]>
}

export interface RuleContext {
  /**
   * How FS Copilot will treat the setter this expression came from —
   * `setter.ts`'s four kinds. Absent for text that is not a setter (a
   * search query, a scratch expression), and rules about whole-program
   * shape mute themselves without it.
   */
  setterKind?: "implicit" | "javascript" | "prepended" | "literal"

  /**
   * The catalogue's `parameters` string for a key event — e.g.
   * `"[0]: Value to set [1]: Altimeter index"` — or null when the event is
   * unknown or undocumented. 662 of 1,524 events carry one; rules must stay
   * silent for the rest.
   */
  keyEventParams?(event: string): string | null

  /**
   * Every profile in the workspace, as root-relative forward-slashed paths
   * — the shape `include:` targets are written in, since FS Copilot
   * resolves them from the Definitions root rather than from the including
   * file. Absent wherever the caller has no listing (a test, a scratch
   * expression), and the rules that need it then stay silent.
   */
  workspaceFiles?(): string[] | null

  /**
   * The panels in the **currently loaded aircraft's** cockpit, or null when
   * there is no such evidence for this file — no simulator, a cockpit not
   * read yet, or a file that is not part of the aircraft that is loaded.
   *
   * Every panel, interactive or not: an aircraft that swaps avionics in the
   * cockpit reports the unit that is swapped out as not interactive, and a
   * profile rightly lists both.
   */
  cockpitPanels?(): CockpitPanelNames | null

  /**
   * Whether the SDK documents an `A:` variable as settable — false only when
   * the docs say so, and null when the variable is unknown or the column was
   * blank. Ask with the base name, index already stripped.
   */
  simVarSettable?(name: string): boolean | null

  /**
   * Whether the **currently loaded aircraft** has registered this input
   * event, or null when nothing is loaded — the first piece of evidence in
   * this context that changes while the file does not.
   *
   * Ask with a bare preset name, no `B:` prefix. Presence is strong evidence
   * and absence is weak: the sim's table fills as add-ons register, so a
   * name missing moments after an aircraft swap may only be late.
   */
  hasInputEvent?(name: string): boolean | null

  /**
   * What the loaded aircraft has been seen doing with an input event, or null
   * when there is no aircraft and therefore nothing observed.
   *
   * Ask with a bare input-event **ID**, no `B:` prefix — the same key
   * `hasInputEvent` takes.
   *
   * `firings` counts times somebody worked the control; `changes` counts times
   * its value moved. For every other namespace those are the same number. For
   * `B:` they are not, and the gap between them is the only evidence that
   * separates a control whose value cannot be read from one nobody has touched
   * — both read 0 forever.
   *
   * Accumulates across sessions, so silence here means "not yet", never "no".
   */
  inputEventActivity?(
    name: string
  ): { firings: number; changes: number } | null

  /**
   * Whether the Link module resolved a watched ref on the loaded aircraft —
   * false when it looked and found nothing, null when there is no verdict.
   *
   * Ask with the written name, prefix and index included: this is keyed by
   * what the app asked the module to watch, not by identity.
   *
   * Null is the common case and means *no question was asked*, not "fine".
   * Only the namespaces the module reads by typed id are ever watched (`Z:`,
   * `E:`, indexed `L:`), only `get:` lines of open tabs enter the set, and the
   * set takes a moment to travel. A rule reading this must treat everything
   * but an explicit false as silence.
   */
  refResolved?(name: string): boolean | null
}

export interface Rule {
  id: string
  family: RuleFamily
  run(doc: IrDoc, stack: Simulation, context: RuleContext): Diagnostic[]
}

/**
 * Runs every rule over one expression.
 *
 * The registry is passed in rather than global so a caller — a test, a
 * feature flag, a future per-profile configuration — decides what runs.
 * `defaultRules` below is the everything list.
 */
export function analyze(
  rules: Rule[],
  doc: IrDoc,
  stack: Simulation,
  context: RuleContext
): Diagnostic[] {
  const out: Diagnostic[] = []
  for (const rule of rules) out.push(...rule.run(doc, stack, context))
  return out
}
