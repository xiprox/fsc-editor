/**
 * What FS Copilot will do with one entry, computed step by step.
 *
 * The app can work this out rather than describe it, which is the idea behind
 * plan §3: a panel of lines that are *computed*, none authored. This is the
 * model half — a pure function returning steps. The panel renders them, and
 * the dialect rules read from them, so a squiggle and a step cannot disagree.
 *
 * ## What is mirrored, and from where
 *
 * | C# | here |
 * | --- | --- |
 * | `Definition` constructor | units default — resolved by the caller |
 * | `Definition.Set` | **not here** — `resolveSetter`, already built |
 * | `Definition.ParseSet` | `parseWrite`, `parseSet` |
 * | `Definition.ApplyTo` | `applySteps` |
 * | `SimClient.Set` / `TransmitKEvent` | `routeSteps`, `normalizeK` |
 * | `SimClient.Stream` | the `read` step in `sendSteps` |
 * | `Coordinator.AddLink` | `sendSteps` |
 * | `SimConnectExtensions.InferDataType` | `clrTypeOf` |
 *
 * `Definition.Set` stays where it is on purpose: it is the one branch needing
 * a JavaScript engine, the renderer's CSP has no `unsafe-eval`, and main
 * already resolves it for the run popover. So this takes the *built string* as
 * an input — a `SetterPreview` — and traces everything after it. One evaluator
 * in the app rather than two.
 *
 * ## Fidelity
 *
 * A trace that lies is worse than no trace, so `state` is part of every step
 * and `unknown` is used honestly: for what depends on the other pilot's last
 * two seconds, and for the one branch that was read in the source but never
 * probed in the simulator. `trace.test.ts` is a table written from the C#
 * rather than from this file.
 */

import { splitPrefix } from "./profile/index.ts"
import type { SetterKind, SetterPreview } from "./setter.ts"
import { parseVar } from "./vars/parse.ts"

/** Which half a step belongs to. */
export type TracePhase = "send" | "apply"

/**
 * How a step turned out.
 *
 * `unknown` is load-bearing. Whether a skip counter is standing is a fact
 * about the other pilot's last two seconds; whether `SimClient.Set`'s missing
 * `else` really fires twice was read in the source and never probed. Claiming
 * either would be a guess wearing a step's clothes.
 */
export type StepState = "ok" | "failed" | "skipped" | "unknown"

/**
 * How a marked stretch of a detail is painted.
 *
 * Not a scope — the model does not import the highlighter's vocabulary, it
 * says what the fragment *is* and the panel maps that to the editor's own
 * `--syntax-*` tokens. `rpn` and `name` hand the text to the painters the
 * editor uses, so a reference looks here exactly as it looks in the file.
 */
export type CodePaint =
  | "rpn"
  | "name"
  | "unit"
  | "number"
  | "injected"
  | "key"
  | "block"
  | "string"
  | "type"
  | "operator"
  /**
   * A bare namespace prefix — `H:`, `L:` — standing away from any name.
   *
   * Its own marker because `name` cannot do it: `paintName` tokenizes a
   * reference, and handed `H:` with nothing after the colon it reads the
   * whole thing as the name and paints it in the name's colour. On a row
   * whose whole point is *because the name is `H:`* that is the one thing it
   * must not look like.
   */
  | "prefix"
  /**
   * A word from the app's vocabulary that the reader may not have met.
   *
   * **Not code** — it stays prose, in prose's colour, and takes only a dotted
   * underline and a definition on hover. `type` is the near neighbour and the
   * difference is worth keeping straight: `int` is a word the *simulator*
   * chose and its tooltip carries the consequence, while this is a word *we*
   * chose and its tooltip carries the meaning.
   */
  | "term"

/**
 * A piece of a detail: prose as a bare string, program text through a marker.
 *
 * The marking is here rather than in the panel because **the panel cannot
 * tell.** The `1013` in *1013 is sent to the other pilot* is a value you
 * could point at in the file and the `33` in *about 33 times a second* is a
 * rate; they are identical as text, and only the step that built them knows
 * which is which. A painter guessing from the finished string would either
 * colour rates or miss values, and docs/help/trace-panel.md settles that a
 * duration, a rate and a count stay prose.
 */
export type Part = string | { text: string; paint: CodePaint }

export interface TraceStep {
  /** Stable, so a rule can name the step it corresponds to. */
  id: string
  /** The left-hand word in the panel — `kind`, `builds`, `guard`, `writes`. */
  label: string
  /**
   * The line beside it, as prose and marked program text.
   *
   * Parts rather than a string with offsets alongside it: the parts are what
   * the call site authors and what the panel renders, so a string would be a
   * projection built only to be cut back up again. `detailText` makes it when
   * something wants the words.
   */
  detail: Part[]
  state: StepState
}

/** A detail as the reader sees it, without the painting. */
export function detailText(step: TraceStep): string {
  return step.detail
    .map((part) => (typeof part === "string" ? part : part.text))
    .join("")
}

export interface Trace {
  /** WHEN IT CHANGES HERE. */
  send: TraceStep[]
  /** WHEN A VALUE ARRIVES. */
  apply: TraceStep[]
}

/** The entry, as FS Copilot's `Definition` constructor resolved it. */
export interface TraceEntry {
  block: "shared" | "master"
  /** The `get:` name, namespaced as written. */
  name: string
  /** Units as resolved — declared, else `Number`, else none for `K:`/`H:`. */
  units: string
  /** The `skp:` name, trimmed, if the entry has one. */
  skp?: string
}

export interface TraceBindings {
  value: number | string
  /**
   * What the entry's variable currently reads locally.
   *
   * `null` is "not read yet", and is not a placeholder: `currentValue` in
   * `Coordinator.AddLink` starts null and is only assigned by the local
   * stream, so before the first local change there genuinely is no current.
   * The toggle guard behaves differently there — see `toggleGuard`.
   */
  current: number | string | null
}

/*
 * The markers. Named so a call site reads as the sentence it produces, which
 * is the point: a detail built out of named fragments is harder to get subtly
 * wrong than one written as a template and described to a painter separately.
 */
const rpn = (text: string): Part => ({ text, paint: "rpn" })
/** `NAME` or `NAME, units`, painted as a `get:` line paints it. */
const ref = (text: string): Part => ({ text, paint: "name" })
/** A unit standing on its own, away from the name it qualifies. */
const unit = (text: string): Part => ({ text, paint: "unit" })
/** A value — never a count, a rate or a duration. */
const num = (value: number | string): Part => ({
  text: String(value),
  paint: "number",
})
/** `value` and `current`, the two identifiers a setter is handed. */
const inj = (text: string): Part => ({ text, paint: "injected" })
const key = (text: string): Part => ({ text, paint: "key" })
const blk = (text: string): Part => ({ text, paint: "block" })
const str = (text: string): Part => ({ text, paint: "string" })
/**
 * `[0] 1, [1] 16256` — each operand labelled with the slot it lands in.
 *
 * **Not a bare `[1, 16256]` list**, and the reason is the whole
 * `k-operand-order` finding. `ParseSet` reverses, so `16256 1 (>K:…)` becomes
 * `[1, 16256]` — a positional list prints the author's own two numbers back
 * at them in the opposite order, with a pair of brackets as the only thing
 * saying which order is which. `1 16256` written and `[1, 16256]` rendered
 * are the same two tokens in the same sequence, meaning opposite things.
 *
 * Worse, a list reads left-to-right as *first, second*, which is source
 * order — so the notation invites exactly the misreading the rule exists to
 * catch, in the panel that is supposed to explain it.
 *
 * Naming the slot removes the question: there is no order to interpret, only
 * a value and the slot it arrives in. The slot marker is punctuation, not a
 * value — it is not a number anyone could point at in the file.
 */
const slots = (values: (number | string)[]): Part[] =>
  values.flatMap((value, index): Part[] =>
    index
      ? [op(","), " ", op(`[${index}]`), " ", num(value)]
      : [op(`[${index}]`), " ", num(value)]
  )

/** A CLR type, which the panel gives a tooltip. */
const typ = (text: string): Part => ({ text, paint: "type" })
/**
 * A glossary word, underlined and defined on hover.
 *
 * Used sparingly and only where the word cannot be avoided. *the calculator*
 * is the one that forced this: it is the simulator's RPN evaluator and the
 * SDK's own name for it (`execute_calculator_code`), the app leans on it in
 * fifteen-odd strings, and **nothing anywhere introduces it**. Rewording one
 * row would have been drift; the word is right, it just needed a gloss.
 */
const term = (text: string): Part => ({ text, paint: "term" })
const op = (text: string): Part => ({ text, paint: "operator" })

const step = (
  id: string,
  label: string,
  detail: string | Part[],
  state: StepState = "ok"
): TraceStep => ({
  id,
  label,
  detail: typeof detail === "string" ? [detail] : detail,
  state,
})

/** The id every half's last step carries, so the panel can draw it larger. */
export const OUTCOME_ID = "result"

/**
 * The last step of a half — what actually happened, in one line.
 *
 * Five endings and nothing past them, because five is what the model can
 * derive. An outcome names **variables and events, never aircraft systems**:
 * saying "the altimeter is set to 1016 millibars" would need to know that
 * `A:KOHLSMAN SETTING MB:1` is an altimeter, and nothing here knows that.
 *
 * `failed` is reserved for an outcome that is *not what the entry says it
 * does* — a fallback that swallowed a named event or was reached with an
 * empty expression, or nothing happening at all. A plain write to a variable is an ordinary success even though it is
 * reached through the same branch.
 */
const outcome = (detail: string | Part[], state: StepState = "ok"): TraceStep =>
  step(OUTCOME_ID, "result", detail, state)

// ── SimConnectExtensions.InferDataType ──────────────────────────────────────

/** Units that resolve to a string datum. */
const STRING_UNITS = new Set([
  "string8",
  "string32",
  "string64",
  "string256",
  "stringv",
  "wstring",
  "wstring256",
  "string",
  "text",
  "title",
  "name",
  "model",
  "category",
  "airline",
  "icao",
  "registration",
  "filename",
])

/**
 * Units that resolve to INT32.
 *
 * `feet` and `percent` are in this list and look out of place; they are in the
 * C# too. `number` is **not** — it is commented out there, so the commonest
 * unit in the corpus resolves to a double.
 */
const INT_UNITS = new Set([
  "bool",
  "boolean",
  "index",
  "enum",
  "mask",
  "bitmask",
  "flag",
  "flags",
  "count",
  "items",
  "state",
  "switch",
  "position index",
  "position step",
  "bcd16",
  "bco16",
  "feet",
  "percent",
])

export type ClrType = "float" | "int" | "double" | "string"

/**
 * The .NET type a value of this entry arrives as.
 *
 * Plan §3 listed this as untraced, and the toggle guard hedged because of it.
 * It is `InferDataType` followed by `ToClrType`, with one override: an `L:`
 * variable is read and written as FLOAT32 whatever its units say, because
 * `SetLVar` hardcodes the datum type and `Stream` passes it explicitly.
 */
export function clrTypeOf(name: string, units: string): ClrType {
  if (name.startsWith("L:")) return "float"

  const unit = units.trim().toLowerCase()
  if (!unit) return "string"
  if (STRING_UNITS.has(unit)) return "string"
  if (INT_UNITS.has(unit)) return "int"

  return "double"
}

// ── Definition.ParseSet ─────────────────────────────────────────────────────

/**
 * FS Copilot's `SetRegex`, mirrored:
 *
 *     ^(?<args>.*?)\s*\(\>\s*(?<name>[^,\)]+)\s*(?:,\s*(?<units>[^\)]+))?\s*\)$
 *
 * Anchored at both ends, so the *whole* built string has to end in a write.
 * That anchoring is the entire `dead-set` finding. The lazy `.` is not
 * `[\s\S]` on purpose: .NET's `.` does not cross a newline either, so a
 * block-scalar setter written over several lines does not match there and must
 * not match here.
 */
const SET_REGEX = /^(.*?)\s*\(>\s*([^,)]+)\s*(?:,\s*([^)]+))?\s*\)$/

/**
 * `ParseParam`'s idea of a number — `uint`, then `int`, then invariant
 * `double`, and **0 for anything else**. Not JavaScript's `Number()`, which
 * would call `0x10` numeric where FS Copilot sends 0.
 */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/** A built string that ends in a write, cut up the way `ParseSet` cuts it. */
export interface ParsedWrite {
  /** The name written to, after the `K:n:` rewrite. */
  name: string
  /**
   * The name exactly as it appeared in the built string, before that rewrite.
   *
   * Both are needed and they are not interchangeable: `name` is what FS
   * Copilot writes to, and `written` is what the author will find on their
   * line. A message that quoted `K:FOO` at somebody who typed `K:2:FOO` would
   * be pointing at text that is not there.
   */
  written: string
  units: string
  /** The `args` group exactly as the regex captured it, before splitting. */
  args: string
  /** The operands as FS Copilot cut them — see `splitArgs`. */
  parts: string[]
  /** Those parts as numbers, already reversed: index 0 is the event's `[0]`. */
  values: number[]
}

/**
 * `args.Split(' ', RemoveEmptyEntries).Select(p => p.Trim())`.
 *
 * The space character **only**, and that is not a detail: a tab does not
 * separate operands, it sits inside one and is then trimmed off its ends. So
 * `1\t2` is a single operand, is not a number, and is sent as `0` — where
 * splitting on whitespace would have said `[2, 1]`.
 */
export function splitArgs(args: string): string[] {
  return args
    .split(" ")
    .filter((part) => part !== "")
    .map((part) => part.trim())
}

/**
 * Whether `ParseParam` would read this operand as a number rather than as 0.
 *
 * Exported as the predicate rather than the regex so `master-set-shape`, whose
 * whole finding is "these operands became zeros", asks the same question the
 * trace does instead of keeping a second copy of the pattern.
 */
export function isNumericParam(part: string): boolean {
  return NUMERIC.test(part)
}

/** `ParseParam`. */
export function parseParam(part: string): number {
  return isNumericParam(part) ? Number(part) : 0
}

/**
 * The write at the end of a built string, or null when there is not one.
 *
 * The shared half of `ParseSet` — the regex, the split, the reversal and the
 * `K:n:` strip, without the fallback. `dead-set` and `master-set-shape` ask it
 * the same question the trace does, which is what stops a squiggle and a step
 * disagreeing about whether a setter ends in a write.
 */
export function parseWrite(built: string): ParsedWrite | null {
  const match = SET_REGEX.exec(built)
  if (!match) return null

  const args = match[1] ?? ""
  const written = (match[2] ?? "").trim()
  let target = written
  const units = (match[3] ?? "").trim()
  const parts = splitArgs(args)

  /*
   * `K:2:EVENT` becomes `K:EVENT`:
   *
   *     if (set.Length > 2 && set[0] == 'K' && set[1] == ':' && set[3] == ':')
   *         set = $"K:{set[4..]}";
   *
   * It tests `set[3]`, not a digit — so the arity is one character and
   * `K:12:FOO` is not rewritten. Mirrored as written rather than as intended.
   */
  if (
    target.length > 2 &&
    target[0] === "K" &&
    target[1] === ":" &&
    target[3] === ":"
  )
    target = `K:${target.slice(4)}`

  return {
    name: target,
    written,
    units,
    args,
    parts,
    values: parts.map(parseParam).reverse(),
  }
}

export interface ParsedSet {
  name: string
  units: string
  values: (number | string)[]
  /** Whether the regex matched. False is the fallback, not an error. */
  matched: boolean
}

/**
 * `Definition.ParseSet` whole, fallback included.
 *
 * The fallback is the part worth reading twice:
 *
 *     sUnits = Units; values = [value]; return Get;
 *
 * It does not throw and it does not skip — it writes the incoming value to the
 * entry's own `get:` name, so a setter that "does nothing" is really a setter
 * that quietly does something else.
 */
export function parseSet(
  built: string,
  entry: TraceEntry,
  value: number | string
): ParsedSet {
  const write = parseWrite(built)
  if (!write)
    return {
      name: entry.name,
      units: entry.units,
      values: [value],
      matched: false,
    }

  // `if (values.Length == 0) values = [value];`
  const values: (number | string)[] = write.values.length
    ? write.values
    : [value]

  return { name: write.name, units: write.units, values, matched: true }
}

/**
 * The event a `ParseSet` fallback swallowed, or null.
 *
 * When the regex does not match, FS Copilot writes the incoming value to the
 * entry's own `get:` name — so a setter naming an event does something, just
 * not the something it says. Only a lone namespaced name qualifies: anything
 * holding whitespace or parens is an expression that was meant to be one, and
 * calling it a swallowed event would be inventing a different program.
 *
 * Exported because `dead-set` asks exactly this question to decide whether to
 * offer its `(>…)` fix. One test, so the squiggle and the trace's last line
 * cannot come to different conclusions about what never fires.
 */
export function bareEventName(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  return parseVar(trimmed).ns !== null && !/[\s()]/.test(trimmed)
    ? trimmed
    : null
}

// ── SimClient.TransmitKEvent ────────────────────────────────────────────────

/** `TransmitClientEvent_EX1` carries dwData0–dwData4 and no more. */
const K_MAX_PARAMS = 5

/**
 * `NormalizeValue` — every `K:` parameter becomes a `uint`.
 *
 *     float/double d => unchecked((uint)(int)Math.Round(d, AwayFromZero))
 *     int i          => unchecked((uint)i)
 *
 * Two visible consequences: a fraction is rounded **away from zero** rather
 * than to even, and a negative wraps rather than clamping — `-1` travels as
 * 4294967295. JavaScript's `Math.round` goes toward +∞, so the sign has to be
 * handled explicitly or `-0.5` comes out one apart from .NET's answer.
 */
export function normalizeK(value: number): number {
  const rounded = value < 0 ? -Math.round(-value) : Math.round(value)
  return rounded >>> 0
}

// ── SimClient.Set ───────────────────────────────────────────────────────────

/**
 * Where a parsed write actually goes.
 *
 * The branches are four `if`s with **no `else`**, so an `L:` write calls
 * `SetLVar` and then also matches the catch-all and is executed through the
 * calculator a second time:
 *
 *     if (name.StartsWith("L:")) SetLVar(...);
 *     if (name.StartsWith("A:")) SetSimVar(...);
 *     if (name.StartsWith("K:")) TransmitKEvent(...);
 *     if (name.Length > 2 && name[1] == ':') Execute($"... (>{name})");
 *
 * That second write is `unknown` rather than `ok`: docs/fscopilot-behavior.md
 * records it as read in the source and never probed, and flags it as a
 * possible upstream bug. A step asserting it would be the trace lying about
 * the most surprising thing it says.
 */
/**
 * Where a parsed write actually goes — **as a timeline**.
 *
 * The branches are four `if`s with **no `else`**, so an `L:` write calls
 * `SetLVar` and then also matches the catch-all and is executed through the
 * calculator a second time:
 *
 *     if (name.StartsWith("L:")) SetLVar(...);
 *     if (name.StartsWith("A:")) SetSimVar(...);
 *     if (name.StartsWith("K:")) TransmitKEvent(...);
 *     if (name.Length > 2 && name[1] == ':') Execute($"... (>{name})");
 *
 * ## One row per thing that happens
 *
 * Two writes is **two rows**, twins, in the order they happen. That replaced
 * a single row carrying a sentence about the second one — *FS Copilot sends
 * the event, then runs this as well, so it should fire twice* — which made a
 * timeline describe an event instead of listing it. A reader counting rows
 * got one; a reader reading prose got two. Now both agree, and the repetition
 * is the finding: the same label appears twice because the same thing happens
 * twice.
 *
 * ## And the result states the net
 *
 * Which is what finally gives the last row a job no step can do. `fires`
 * says the event goes; `fires` again says it goes again; **`result` says it
 * goes twice, and that a toggle therefore ends where it started.** No single
 * step states a count, so the ending is never a restatement.
 *
 * The corollary is the rule for everything else in this file: **where only
 * one thing happens, the result is that thing and no separate row is drawn.**
 * That is why a `B:` write has no `runs` row, why a `shared:` apply has no
 * `runs` row, and why the send half lost its transport row — one event, one
 * row, and the ending is it.
 *
 * The second write is `unknown` rather than `ok`: docs/fscopilot-behavior.md
 * records it as read in the source and never probed. See
 * docs/sim-vars/build/double-write-probe.md, which would settle it.
 */
function routeSteps(parsed: ParsedSet, writtenArgs: string): Routed {
  const steps: TraceStep[] = []
  const { prefix } = splitPrefix(parsed.name)
  const last = parsed.values[parsed.values.length - 1]
  const units = parsed.units ? `, ${parsed.units}` : ""

  /*
   * The four `if`s are in FS Copilot's own order, so where more than one
   * fires the first names the verb and the catch-all becomes its twin.
   */
  let ending: ((twice: boolean) => TraceStep) | null = null
  /** The verb both rows share — `writes` for a variable, `fires` for an event. */
  let verb = ""

  const writtenTo = (withUnits: boolean) => (twice: boolean) =>
    outcome(
      [
        num(last ?? ""),
        " is written to ",
        ref(withUnits ? `${parsed.name}${units}` : parsed.name),
        ...(twice ? [" — twice, with the same value"] : []),
      ],
      twice ? "unknown" : "ok"
    )

  if (prefix === "L:") {
    verb = "writes"
    /*
     * The units are named only to say they are ignored, and the ending leaves
     * them off the name entirely. `SetLVar` hardcodes FLOAT32 and `Stream`
     * passes it explicitly — docs/fscopilot-behavior.md, "An `L:` variable
     * ignores the table". Ending on `written to L:FOO, Number` would have the
     * trace contradicting its own row one line apart.
     */
    steps.push(
      step("route", verb, [
        ref(parsed.name),
        " = ",
        num(last ?? ""),
        " — as ",
        typ(clrTypeOf(parsed.name, parsed.units)),
        ...(parsed.units ? [", ", unit(parsed.units), " is ignored"] : []),
      ])
    )
    ending = writtenTo(false)
  } else if (prefix === "A:") {
    verb = "writes"
    steps.push(
      step("route", verb, [
        ref(parsed.name),
        " = ",
        num(last ?? ""),
        ...(parsed.units ? [" in ", unit(parsed.units)] : []),
        " — as ",
        typ(clrTypeOf(parsed.name, parsed.units)),
      ])
    )
    ending = writtenTo(true)
  } else if (prefix === "K:") {
    verb = "fires"
    const fired = kEventSteps(parsed)
    steps.push(...fired.steps)
    ending = fired.outcome
  }

  if (parsed.name.length > 2 && parsed.name[1] === ":") {
    const code = `${parsed.values.join(" ")} (>${parsed.name})`

    /*
     * The twin. Same label, same shape, one line down — because that is what
     * happens, and a timeline that shows it needs no sentence explaining it.
     *
     * It says *again* and names the route, which is the one job the route has
     * here: telling this row apart from the one above it. That is a different
     * thing from leading with the route, which an earlier draft did and which
     * answered a question nobody asked.
     *
     * **The expression is shown only when the operands come out reordered**,
     * and that is a finding rather than a formatting choice. `Execute` is
     * handed `string.Join(' ', values)`, and `values` is `ParseSet`'s
     * **reversed** array — so a line reading `16256 1 (>K:2:KOHLSMAN_SET)`
     * reaches the calculator as `1 16256 (>K:KOHLSMAN_SET)`, a genuinely
     * different program, and *rebuilt as* is the only place the author is
     * told.
     *
     * The test is the operands alone, not the whole string. The other two
     * ways the rebuilt expression differs already have rows of their own —
     * the `K:n:` arity is `strips`, and the dropped units are the `writes`
     * row's *`Bool` is ignored*. Comparing whole strings fired on those too
     * and printed a near-identical expression for every `L:` write in the
     * corpus, which is noise standing where a finding should be.
     */
    if (ending !== null)
      steps.push(
        step(
          "execute",
          verb,
          [
            ref(parsed.name),
            " again, from the ",
            term("calculator"),
            /*
             * **Why** it happens, which naming the route never explained.
             *
             * *from the calculator* says where the second write comes from
             * and leaves the reader asking why there is a second write at
             * all. The answer is the missing `else`: `SimClient.Set` tests
             * four prefixes in a row, a `K:` or `L:` or `A:` name satisfies
             * its own test **and** the catch-all, and nothing stops after
             * the first. Said as a fact about the name rather than about the
             * C#, so it needs no vocabulary the reader does not have.
             */
            " — the name matches two write routes and FS Copilot takes both",
            ...(parsed.values.join(" ") === writtenArgs
              ? []
              : [", rebuilt as ", rpn(code)]),
          ],
          "unknown"
        )
      )

    // Only when nothing above claimed the ending: a prefix outside L:/A:/K:
    // reaches the simulator through the calculator and nowhere else, so that
    // is one thing happening and the ending is it — no separate row.
    ending ??= () =>
      outcome(["the ", term("calculator"), " runs ", rpn(code)], "unknown")
  }

  /*
   * No `nowhere` row. It read `FOO matches no branch — nothing is written`
   * directly above `result  nothing is applied — FOO matches no branch`,
   * which is one fact wearing two rows. The ending is the better sentence and
   * is already `failed`, so the timeline ends on it alone.
   */
  const twice = steps.some((each) => each.id === "execute")

  return {
    steps,
    outcome: ending
      ? ending(twice)
      : outcome(
          ["nothing is applied — ", ref(parsed.name), " matches no branch"],
          "failed"
        ),
  }
}

/** Steps, and the one that ends the half. */
interface Routed {
  steps: TraceStep[]
  outcome: TraceStep
}

/** `TransmitKEvent`: five parameters, each coerced to a `uint`. */
function kEventSteps(parsed: ParsedSet): {
  steps: TraceStep[]
  outcome: (twice: boolean) => TraceStep
} {
  const numbers = parsed.values.map((each) =>
    typeof each === "number" ? each : parseParam(String(each))
  )
  const sent = numbers.slice(0, K_MAX_PARAMS)
  const normalized = sent.map(normalizeK)
  const changed = sent.some((each, index) => each !== normalized[index])

  const steps: TraceStep[] = []

  /*
   * The coercion, and only when it changed something: this row shows what the
   * setter wrote and the `fires` row below shows what travels, so `-1` above
   * `4294967295` teaches the wrap rather than asserting it in prose.
   */
  /*
   * Says what the coercion *did*, not merely that there was one.
   *
   * It read `[0] -1.5 — to whole uints` above `fires … with [0] 4294967294`,
   * and the jump from one to the other is unguessable: `NormalizeValue` is
   * `unchecked((uint)(int)Math.Round(d, AwayFromZero))`, so -1.5 rounds to -2
   * — away from zero, not to even — and -2 reinterpreted as a uint is
   * 4294967294. Two steps, neither of them obvious, and the row that exists
   * to explain the difference was not explaining it.
   */
  if (changed) {
    /*
     * Each clause only when that clause is why the number moved.
     *
     * **The tie-break is not said at all.** `AwayFromZero` differs from
     * .NET's default only at exactly a half — 2.5 to 3 rather than to 2 —
     * and naming it on `[0] 2.3` sent a reader looking for a difference that
     * was not there. It is also the one thing here nobody can act on: the
     * mode is FS Copilot's, and a unit either way on an event parameter is
     * noise. The wrap is the opposite — `-1` arriving as 4294967295 is
     * catastrophic, and *do not send a negative to an event* is a real move.
     *
     * Both clauses are conditional, because `-1` is already whole: saying it
     * was *rounded to whole numbers* would be describing something that did
     * not happen. `changed` is true exactly when one of the two applies, so
     * there is always at least one.
     */
    const rounded = sent.some((each) => !Number.isInteger(each))
    const wraps = sent.some((each) => each < 0)

    steps.push(
      step("rounds", "rounds", [
        ...slots(sent),
        " — ",
        ...(rounded ? ["rounded to whole numbers"] : []),
        ...(rounded && wraps ? ["; "] : []),
        ...(wraps ? ["a negative wraps to a large uint"] : []),
      ])
    )
  }

  steps.push(
    step("route", "fires", [
      ref(parsed.name),
      " with ",
      ...slots(normalized),
    ])
  )

  if (numbers.length > K_MAX_PARAMS)
    steps.push(
      step(
        "dropped",
        "drops",
        `${numbers.length - K_MAX_PARAMS} operand${
          numbers.length - K_MAX_PARAMS === 1 ? "" : "s"
        } — an event carries five`,
        "failed"
      )
    )

  /*
   * The ending states the **net**, which is the one thing no row above it
   * can: a count, and what a count of two means.
   *
   * Fired once it names the operands, because that is the whole story. Fired
   * twice it names the count instead — and for a **toggle** it says what two
   * firings come to, which is nothing, because the aircraft ends where it
   * started. That sentence is why this panel is worth opening on the PC-12's
   * `set: (>K:TOGGLE_STARTER1)`, and no step can carry it: each one is true
   * on its own and the defect is only in the pair.
   *
   * Not a failure however many operands were dropped — `drops` says what was
   * lost, and repeating it here would make the last line argue with itself.
   */
  /*
   * `fires twice`, flat — not *should fire twice*.
   *
   * The hedge is the hollow outcome node, which is what `unknown` draws and
   * what it means everywhere else in this column. Saying it in words as well
   * hedged twice for one doubt, and the sentence the reader needs to take
   * away is short.
   */
  const name = splitPrefix(parsed.name).rest

  return {
    steps,
    outcome: (twice) =>
      twice
        ? outcome(
            [
              ref(parsed.name),
              " fires twice",
              /*
               * **The** toggle, not **a** toggle. The definite article points
               * at the event on this row rather than at toggles in general,
               * which is what the reader is asking about — and the same
               * correction applies to the step case, where *it* was vaguer
               * still than *the value*.
               */
              ...(OP_TOGGLE.test(name)
                ? [" — the toggle reverses itself"]
                : OP_STEP.test(name)
                  ? [" — the value moves two steps"]
                  : [
                      " with ",
                      ...slots(normalized),
                      ...(OP_ABSOLUTE.test(name)
                        ? [" — the same value both times"]
                        : []),
                    ]),
            ],
            "unknown"
          )
        : outcome([ref(parsed.name), " fires with ", ...slots(normalized)]),
  }
}

// ── Definition.ApplyTo ──────────────────────────────────────────────────────

/** `>K:#` — the escape hatch that routes a shared entry the master way. */
const HASH_ROUTE = ">K:#"

/**
 * `TOGGLE` **in the built expression**, which is what `ApplyTo`'s guard
 * searches for. A bare substring, deliberately: FS Copilot tests
 * `set.Contains("TOGGLE")` on the whole string, not the event's name.
 */
const TOGGLE = /toggle/i

/*
 * Whether firing an event twice comes to the same thing as firing it once.
 *
 * These read the **event name**, and are a different question from `TOGGLE`
 * above — which reads the built expression because that is what the C# does.
 * Keep them apart: widening the guard's test would change what FS Copilot is
 * described as doing.
 *
 * The vocabulary is `parse.ts`'s `INPUT_OP` — `set|inc|dec|toggle|on|off`,
 * the operations MSFS generates for a preset — applied to `K:` names, where
 * the op may lead as well as trail (`TOGGLE_STARTER1`, `LANDING_LIGHTS_SET`).
 *
 * **Absolute and relative is the real distinction, not event and variable.**
 * An earlier ending said a doubled *event* was the finding, which is too
 * broad: `K:LANDING_LIGHTS_SET` fired twice lands the same value, exactly as
 * a doubled `L:` write does. Only a relative op — toggle, increment,
 * decrement — comes out somewhere else.
 *
 * Over the 312 distinct `K:` names in the corpus this splits 58 toggle, a
 * handful of step, 176 absolute, and a remainder like `AP_MASTER` and
 * `AP_ALT_HOLD` that **are** relative and do not say so. Those fall through
 * to the neutral ending, which states the count and claims nothing — the
 * honest answer for a name the app cannot read.
 */
const OP_TOGGLE = /(^|_)toggle(_|$)/i
const OP_STEP = /(^|_)(inc|dec|increase|decrease)(_|$)/i
const OP_ABSOLUTE = /(^|_)(set|on|off)(_|$)/i

/**
 * `value.Equals(current)`, with the case that is not equality.
 *
 * **`current` is null until the first local read.** `Coordinator.AddLink`
 * starts `currentValue` at null, and `ApplyTo` tests the raw parameter — not
 * the `current ?? value` it used two lines earlier to build the expression. So
 * `value.Equals(null)` is false and the first incoming apply after connecting
 * is never guarded, however equal the numbers look.
 *
 * Otherwise it is numeric equality: both machines resolve the same entry to
 * the same CLR type through `clrTypeOf`, so the boxed comparison agrees with
 * the written one.
 */
function toggleGuard(bindings: TraceBindings): {
  state: StepState
  detail: Part[]
} {
  const { value, current } = bindings

  /*
   * Short, because the long version was unreadable.
   *
   * It ran to 190 characters — *value 1, and nothing has been read here yet
   * — so it runs. The guard compares against the local value, and there is
   * not one until this variable changes on this machine* — two dashes, two
   * sentences and a clause explaining a clause. **`no current yet` says the
   * same thing**: there is no local value, and the comparison therefore
   * cannot match. A reader gets from there to *so it runs* without help.
   *
   * `no current`, without a trailing *yet*. The word added nothing the
   * sentence did not already carry, and the row reads tighter beside its two
   * siblings, which are a bare comparison.
   */
  if (current === null)
    return {
      state: "ok",
      detail: [inj("value"), " ", num(value), " and no ", inj("current")],
    }

  const same = String(value) === String(current)

  return {
    state: same ? "skipped" : "ok",
    detail: [
      inj("value"),
      " ",
      num(value),
      same ? " = " : " ≠ ",
      inj("current"),
      " ",
      num(current),
    ],
  }
}

function describeKind(kind: SetterKind, entry: TraceEntry): Part[] {
  if (kind === "implicit")
    return [
      "implicit — no ",
      key("set:"),
      ", so the value is written to ",
      ref(entry.name),
    ]
  if (kind === "prepended")
    return [
      "prepended — starts with ",
      op("("),
      ", so the value goes in front",
    ]
  if (kind === "literal")
    return [
      "literal — no ",
      str("'"),
      " ",
      str("`"),
      " ",
      op("?"),
      " ",
      op("{"),
      " ",
      op("}"),
      " and does not start with ",
      op("("),
      ", so it is sent exactly as written and the value is ignored",
    ]

  return [
    "javascript — contains one of ",
    str("'"),
    " ",
    str("`"),
    " ",
    op("?"),
    " ",
    op("{"),
    " ",
    op("}"),
    ", so it is evaluated first",
  ]
}

function parsedRoute(
  entry: TraceEntry,
  bindings: TraceBindings,
  code: string
): Routed {
  const parsed = parseSet(code, entry, bindings.value)
  const write = parseWrite(code)

  if (!parsed.matched) {
    // The same test `dead-set` uses, so the fix it offers and the line the
    // trace ends on are answering one question rather than two.
    const swallowed = bareEventName(code)
    // A setter that threw, or a branch that built `''` on purpose.
    const empty = !code.trim()

    /*
     * The fallback's write is routed like any other. `ApplyTo` hands
     * `ParseSet`'s `Get, Units, [value]` to the same `sim.Set(set, units,
     * values)` a matched write goes to, so a `K:` name fires twice, an `L:`
     * write has its twin and a name with no prefix matches no branch. Ending
     * on `1 is written to K:FOO` instead said one thing where the same write,
     * reached the other way, says another.
     */
    const routed = routeSteps(parsed, parsed.values.join(" "))
    const ending = routed.outcome

    return {
      steps: [
        step(
          "match-write",
          "match",
          empty
            ? ["no ", op("(>…)"), " — the expression is empty"]
            : ["no ", op("(>…)"), " at the end — this text is never used"],
          "failed"
        ),
        /*
         * No `instead` row. It read `1 → FOO, Number` above an outcome that
         * already says `1 is written to FOO, Number` — and the outcome says
         * it better, because it also names the event the fallback swallowed.
         */
        ...routed.steps,
      ],
      /*
       * Failed when the fallback is not what the entry says it does. When
       * the text it swallowed named an event, which is the finding
       * `dead-set` exists to make. And when there was no text at all: in a
       * `master:` entry an empty expression is not a guard, so the value is
       * written anyway, which neither a setter that threw nor a branch that
       * returned `''` asked for. Otherwise the state is the route's.
       */
      outcome: {
        ...ending,
        detail: swallowed
          ? [...ending.detail, ", and ", ref(swallowed), " never fires"]
          : ending.detail,
        state: swallowed || empty ? "failed" : ending.state,
      },
    }
  }

  const zeroed = (write?.parts ?? []).filter((part) => !isNumericParam(part))

  const renamed =
    write && write.written !== write.name
      ? [
          step("arity", "strips", [
            ref(write.written),
            " → ",
            ref(write.name),
            " — the arity travels as event data, not in the name",
          ]),
        ]
      : []

  const routed = routeSteps(parsed, (write?.parts ?? []).join(" "))

  return {
    steps: [
      ...renamed,
      /*
       * Drawn only when `ParseParam` zeroed something.
       *
       * It used to print the operand list unconditionally under the label
       * `sends` — on the *receiving* side, where nothing is sent to anybody,
       * and one row above a route step that printed the same list again.
       * Its one piece of unique knowledge is that an operand was not a
       * number and travelled as 0, which is a sync fact the author cannot
       * see in their own line, so that is all it says now.
       *
       * Conditional on the entry's own operands rather than on either
       * binding, so moving the caret changes it and typing in a field does
       * not — except for a setter that interpolates `value` straight into
       * the operand list, which is the one shape where this row can appear
       * under the pointer.
       */
      ...(zeroed.length
        ? [
            step("args", "args", [
              rpn(zeroed.slice(0, 3).join(" and ")),
              ` ${zeroed.length > 1 ? "are" : "is"} not a number, so `,
              ...slots(parsed.values),
            ]),
          ]
        : []),
      ...routed.steps,
    ],
    outcome: routed.outcome,
  }
}

/**
 * `if (fromPeer) Simulation.Skip.Next(Get);`
 *
 * Registered **before** `sim.Execute`, which matters more than it looks:
 * `Execute` returns early on a blank expression, so a setter that built
 * nothing still marks the entry's own next change as not-to-be-sent. Nothing
 * reaches the simulator, and a genuine local change inside the window is
 * swallowed anyway.
 */
function echoStep(entry: TraceEntry): TraceStep {
  return step("echo", "echo", [
    "the next change of ",
    ref(entry.name),
    " is not sent back (2s)",
  ])
}

function applySteps(
  entry: TraceEntry,
  bindings: TraceBindings,
  built: SetterPreview
): TraceStep[] {
  const steps: TraceStep[] = []

  // Incoming updates are matched by name alone — no block, no file. Which is
  // why one name in both blocks receives twice.
  steps.push(step("match", "arrives", ["an update named ", ref(entry.name)]))

  if (entry.block === "master")
    steps.push(
      step(
        "control",
        "applies",
        "only while you are not the pilot in control",
        "unknown"
      )
    )

  steps.push(step("kind", "kind", describeKind(built.kind, entry)))

  /*
   * A setter that threw is not the end of the path.
   *
   * `Definition.Set` catches the exception, logs it and returns
   * `string.Empty`, so `ApplyTo` carries on with an empty expression: the
   * guard cannot match it, the echo is still registered, and `Execute`
   * returns early. Stopping here would hide the echo, which is the one thing
   * that still happens. In a `master:` entry the empty expression goes to
   * `ParseSet` instead, fails the regex, and the fallback writes the value.
   */
  const code = built.ok ? built.code : ""
  steps.push(
    built.ok
      ? step(
          "builds",
          "builds",
          code ? [rpn(code)] : ["an empty string"],
          code ? "ok" : "failed"
        )
      : step("builds", "builds", `nothing — ${built.reason}`, "failed")
  )

  if (entry.block === "master") {
    steps.push(
      /*
       * Plain words for a plain action, arrived at after three failures.
       *
       * 1. `master:  not run — read as args (>NAME, units)` — *not run* reads
       *    as **skipped**, as though the row were a dead end and everything
       *    under it had not happened. It is the busiest branch in the file.
       * 2. `matched, not run by the calculator` — fixed that and bought a
       *    **contradiction**: three rows down the twin says the write comes
       *    *from the calculator*. Both true, and the distinction between them
       *    — `ApplyTo` not handing over the author's expression, versus
       *    `SimClient.Set` reassembling one from the pieces — is far too fine
       *    for a clause. On screen it read as the panel arguing with itself.
       * 3. `a master: setter as args (>NAME, units) — the shape it has to
       *    fit` — no contradiction, and no meaning either. It described the
       *    regex rather than the aircraft, which is the panel talking about
       *    itself.
       *
       * What actually happens is one sentence with no jargon in it: FS
       * Copilot picks the name and the numbers out of the string with its own
       * code. Say that. The rows underneath are then visibly those two things
       * — the event and its operands — so this row introduces them instead of
       * abstracting over them, and `because the entry is master:` answers the
       * only other question it raises, which is why a `shared:` entry has no
       * such row.
       *
       * **`parses`, not `reads`.** The send half already has a `read` step
       * for reading the variable out of the simulator, and two columns on one
       * screen carrying `read` and `reads` for different things is the same
       * near-collision that `sends`/`send` was. `manually` is the word that
       * replaces the whole *not run by the calculator* clause: it says FS
       * Copilot does this itself, without claiming anything about where the
       * write goes afterwards — which is what made the earlier drafts
       * contradict the twin three rows down.
       *
       * **`numbers`, not `value`.** `value` is a painted identifier in this
       * panel — the right-hand binding, and the `guard` row's *value 1 ≠
       * current 0* — so the same word in plain prose for a different thing
       * would read as a reference to it. It is not: on
       * `${value * 16} 1 (>K:2:KOHLSMAN_SET)` the numbers parsed out are
       * 16256 and 1, and neither of them is `value`.
       *
       * The pattern notation is gone. It was there so a reader could check
       * their line against it, but `match-write` already says *no `(>…)` at
       * the end* when the line does not fit, in words, at the moment it
       * matters.
       */
      step("parse", "parses", [
        "the name and the numbers ",
        term("manually"),
        ", because the entry is ",
        blk("master:"),
      ])
    )
    const routed = parsedRoute(entry, bindings, code)
    return [...steps, ...routed.steps, routed.outcome]
  }

  if (code.includes(HASH_ROUTE)) {
    steps.push(
      step("hash", "route", [
        "contains ",
        rpn(HASH_ROUTE),
        " — parsed rather than run",
      ])
    )
    const routed = parsedRoute(entry, bindings, code)
    return [...steps, echoStep(entry), ...routed.steps, routed.outcome]
  }

  let stopped = false
  if ((code.includes(">K:") || code.includes(">B:")) && TOGGLE.test(code)) {
    const guard = toggleGuard(bindings)
    steps.push(
      /*
       * The trigger moved into a tooltip, and the row kept the verdict.
       *
       * It read *the expression writes an event and says TOGGLE — …*, which
       * states the **condition** and never the **purpose**, so it explained
       * nothing: a reader learns that two substrings were found and still
       * does not know why anyone looked. The purpose is that a repeated value
       * would toggle twice, and it needs more room than a clause.
       *
       * `is on` rather than `is tripped`, which was the first suggestion and
       * fights the outcome — a guard that trips is one that stopped
       * something, and in two of the three states this one does not. `is on`
       * is true whenever the row exists, which is exactly when it is drawn.
       *
       * The tooltip carries `Definitions.cs:325` whole:
       * `(expression.Contains(">K:") || expression.Contains(">B:")) &&
       * expression.Contains("TOGGLE", OrdinalIgnoreCase)`. **Both tests are
       * over the built expression, not the event name** — so
       * `(L:ToggleGuard) 1 (>K:FOO)` trips this with nothing toggle-ish in
       * it, and `K:AP_MASTER`, a real toggle, does not trip it at all. That
       * is the surprise worth having available, and worth keeping out of the
       * way of a reader whose entry is an ordinary toggle.
       */
      step(
        "guard",
        "guard",
        [
          term("is on"),
          " — ",
          ...guard.detail,
          guard.state === "skipped" ? ", so it is skipped" : ", so it runs",
        ],
        guard.state
      )
    )
    // `return;` — and it sits above the echo mark, so a guarded apply marks
    // nothing either.
    stopped = guard.state === "skipped"
  }

  /*
   * The steps past a closed branch are listed and marked, not dropped.
   *
   * Two reasons, and the second is the one that decided it. They are true:
   * the `return` is above `Skip.Next(Get)`, so neither the echo nor the run
   * happens, and "did not happen" is what `skipped` means. And the panel
   * types a value into a field to watch the path change — if the rows
   * vanished, the box would reflow under the pointer, which docs/ui.md
   * forbids in as many words.
   */
  const mark = (built: TraceStep): TraceStep =>
    stopped ? { ...built, state: "skipped" } : built

  /*
   * No `runs` row. `runs  in the calculator, exactly as built` sat directly
   * above `result  the calculator runs <code>`, and the empty case was worse
   * — `nothing — the expression is empty` above `nothing is applied — the
   * expression is empty`, the same words twice. The outcome carries both,
   * and the echo above it still takes the `skipped` mark when the guard
   * closed, so a stopped path is still visible as a stopped path.
   */
  steps.push(mark(echoStep(entry)))

  /*
   * A `shared:` entry's honest ending is that the calculator *receives* the
   * code — we do not evaluate RPN, so what the aircraft then does is outside
   * what this can know. It restates `builds` and that redundancy is the
   * truthful version; `master:`, which FS Copilot parses rather than runs, is
   * where the last line is genuinely new information.
   *
   * **With one thing we do know: a write to a name with no namespace.**
   *
   * `parseWrite` is anchored at the end of the string, so when it matches, the
   * last thing the calculator is asked to do is write that name — and a name
   * with no `X:` prefix is not a name the calculator can write. It is the
   * same fact `get-no-prefix` reports as an **error** at **certain**
   * confidence, in those words: *the entry is inert in both directions.
   * Nothing is read, nothing is sent, nothing is applied.*
   *
   * Without this the panel contradicted it on one screen — the send half all
   * red from the failed `read`, the apply half all green and ending on *the
   * calculator runs 1 (>LANDING_GEAR_POSITION, Number)*, which is the shape
   * of seventeen dead lines in the corpus. A squiggle and a step must not
   * disagree, and when they do it is the panel that is believed, because it
   * looks like arithmetic.
   *
   * Only where the code *ends* in the write. A setter whose write is in the
   * middle of a longer expression is one `parseWrite` cannot speak for, and
   * the ending stays the honest *receives the code*.
   */
  const written = code ? parseWrite(code) : null
  const bare =
    written && parseVar(written.name).ns === null ? written.name : null

  const ending = (): TraceStep => {
    if (stopped)
      return outcome(
        [
          "nothing is applied — ",
          inj("value"),
          " already matches ",
          inj("current"),
        ],
        "failed"
      )
    if (!code)
      return outcome("nothing is applied — the expression is empty", "failed")
    if (bare)
      return outcome(
        ["nothing is applied — ", ref(bare), " has no X: prefix"],
        "failed"
      )

    return outcome(["the ", term("calculator"), " runs ", rpn(code)])
  }

  steps.push(ending())

  return steps
}

// ── Coordinator.AddLink, the send half ──────────────────────────────────────

/**
 * `SimClient.Stream(name, units)` — how the value is read in the first place.
 *
 * The last branch is the one worth a step: a name with no `X:` prefix matches
 * nothing and returns `Observable.Empty`, so the entry is inert on this side
 * as well as the other.
 */
function readStep(entry: TraceEntry): TraceStep {
  const { prefix } = splitPrefix(entry.name)
  const units = entry.units.trim()

  /*
   * `float`, as a **type token** rather than the words *a 32-bit float*.
   *
   * It was prose, so the one row in the panel that names a datum type got no
   * colour, no dotted underline and no tooltip, sitting a line away from the
   * `A:` branch below which gets all three. A reader comparing an `L:` entry
   * with an `A:` one saw two different kinds of statement where there is one.
   * `TYPE_DOC.float` already says *a 32-bit float — about seven digits of
   * precision*, which is the prose this replaces and more.
   *
   * `clrTypeOf` rather than a literal `"float"`: it hardcodes the answer for
   * `L:` anyway, and deriving it keeps one source for the question.
   */
  if (prefix === "L:")
    return step("read", "read", [
      ref(entry.name),
      " — as ",
      typ(clrTypeOf(entry.name, entry.units)),
      ...(units ? [", ", unit(units), " is ignored"] : []),
    ])
  if (prefix === "A:")
    return step("read", "read", [
      ref(entry.name),
      ...(units ? [" in ", unit(units)] : []),
      " — as ",
      typ(clrTypeOf(entry.name, entry.units)),
    ])
  if (prefix === "H:")
    return step("read", "read", [ref(entry.name), ", an HTML event"])
  if (prefix === "K:")
    return step("read", "read", [ref(entry.name), ", a key event"])
  if (entry.name.length > 2 && entry.name[1] === ":")
    return step("read", "read", [
      ref(entry.name),
      ", through the ",
      term("calculator"),
    ])

  return step(
    "read",
    "read",
    ["nothing — ", ref(entry.name), " has no X: prefix, so it is never read"],
    "failed"
  )
}

function sendSteps(entry: TraceEntry, bindings: TraceBindings): TraceStep[] {
  const read = readStep(entry)
  const steps: TraceStep[] = [read]
  const master = entry.block === "master"

  if (master)
    steps.push(
      step("sample", "sampled", "about 33 times a second"),
      step(
        "control",
        "sends",
        "only while you are the pilot in control",
        "unknown"
      )
    )

  // `if (getVar[0] == 'H') simRx = simRx.Delay(500ms);`
  if (entry.name.startsWith("H:"))
    steps.push(
      step("delay", "waits", [
        "half a second, because the name is ",
        { text: "H:", paint: "prefix" },
      ])
    )

  if (!master)
    steps.push(
      step(
        "skip-check",
        "unless",
        [
          "a ",
          key("skp:"),
          " elsewhere marked ",
          ref(entry.name),
          " in the last 2s",
        ],
        "unknown"
      )
    )

  // `if (!master && def.Skip != null) Skip.Next(def.Skip);` — before the send,
  // and only from a shared entry.
  if (entry.skp)
    steps.push(
      master
        ? step(
            "skp",
            "skp",
            [
              ref(entry.skp),
              " is ignored — ",
              key("skp:"),
              " does nothing in a ",
              blk("master:"),
              " entry",
            ],
            "skipped"
          )
        : step("skp", "skp", [
            "the next change of ",
            ref(entry.skp),
            " is not sent (2s)",
          ])
    )

  /*
   * No transport row, for two reasons that arrived together.
   *
   * It is not the author's concern: `SendAll(..., unreliable: master)` is
   * decided by the block they already chose, there is nothing to do about
   * it either way, and the panel's rule is that an FS Copilot internal earns
   * a row only where it bears on **sync** — unit and type coercion, the skip
   * counters, the guards. Reliability does not.
   *
   * And what it said was wrong. *A dropped update is overtaken* assumed a
   * continuous 33 Hz carrier, but `Coordinator.AddLink` runs `Sample(30ms)`
   * over a `SIM_FRAME` + `CHANGED` subscription — Rx `Sample` emits nothing
   * in a window where nothing arrived, so a `master:` stream is bursty, not
   * continuous. The **last** sample of a movement has nothing behind it to
   * overtake it, and losing that one leaves the peer stale until the
   * variable next moves. Better nothing than a row that says the opposite.
   */
  steps.push(sendOutcome(entry, bindings, read))

  return steps
}

/**
 * What leaves this machine, in one line.
 *
 * Two cases the shape of the ending does not cover on its own:
 *
 * - **The name is never read.** `SimClient.Stream` returns `Observable.Empty`
 *   for a name with no `X:` prefix, so nothing ever changes here to be sent.
 *   Ending on "is sent to the other pilot" under a red `read` step would be
 *   the trace contradicting itself on the same screen.
 * - **Nothing has been read yet.** `current` is null before this variable
 *   first moves locally, and naming a value the model does not have would be
 *   a placeholder wearing an answer's clothes. The sentence goes to the
 *   future tense instead, which is what the half is about anyway.
 */
function sendOutcome(
  entry: TraceEntry,
  bindings: TraceBindings,
  read: TraceStep
): TraceStep {
  if (read.state === "failed")
    return outcome(
      ["nothing is sent — ", ref(entry.name), " is never read"],
      "failed"
    )

  /*
   * One sentence for both blocks. `unreliably` left with the transport row
   * above — same reasoning, and an adverb the reader can do nothing with is
   * no better in the last line than it was in the middle.
   */
  const how = " is sent to the other pilot"

  return outcome(
    bindings.current === null
      ? [`the new value${how}`]
      : [num(bindings.current), how]
  )
}

/**
 * The whole trace for one entry and one value.
 *
 * `built` is what `Definition.Set` produced — `resolveSetter`'s answer. The
 * caller supplies it because only main can evaluate the JavaScript kind.
 */
export function traceEntry(
  entry: TraceEntry,
  bindings: TraceBindings,
  built: SetterPreview
): Trace {
  return {
    send: sendSteps(entry, bindings),
    apply: applySteps(entry, bindings, built),
  }
}
