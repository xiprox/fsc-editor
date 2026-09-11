/**
 * The language rules, run over one profile's text.
 *
 * Shared because two consumers must never drift: the editor's diagnostics
 * store renders these verdicts as markers and quick fixes, and
 * `npm run lang:sweep` counts them over the whole corpus. One analysis,
 * two venues — the sweep is the same judge the author sees.
 *
 * Walks the document for `set:` expressions (both shapes), runs each
 * through the language core with the kind FS Copilot would assign, and
 * maps every diagnostic span back to document positions through
 * `positionIn`. What comes out is ready to become markers, panel rows, or
 * quick fixes — the store renders, this decides.
 *
 * ## Two levels, two passes
 *
 * The expression rules judge the text; the entry rules judge the
 * `get:`/`set:` pair, because FS Copilot decides what a `set:` even *is*
 * from the block its entry sits in. They cannot share one loop: 15,933 of
 * the corpus's 25,855 entries have no `set:` line at all, and a level-2
 * rule that only visited setters would be blind to the majority of every
 * profile. So the walk gathers expressions and their mappers, and a second
 * pass judges every entry — a `set:`-targeted verdict reusing the walk's
 * mapper, a `get:`-targeted one placed on the entry's own line.
 *
 * ## The quote gap, and where it is now handled
 *
 * The buffer is raw YAML; FS Copilot's parser hands the *unquoted* value to
 * its Set machinery, so `setKind` on a quoted string would misclassify every
 * backtick setter. This file used to strip the quotes itself and carry the
 * one-column shift at every mapping site — correctly, and alone. The hover
 * and the completions read the same expressions and never did, which is why
 * nine in ten JavaScript setters had no JavaScript intelligence in them.
 *
 * So the unquoting moved to where the expression is built: `expressionAt`
 * hands over the value, with `startColumn` already pointing at it. Nothing
 * here shifts anything any more. A value YAML had to *process* — escapes,
 * or `''` — cannot be mapped by arithmetic at all, and `valueSlice` refuses
 * it rather than guess, so the whole setter is skipped: a missing squiggle
 * is a gap, a squiggle on the wrong characters is a lie. The corpus has zero
 * such values today.
 */

import {
  CONTINUATION_KEYS,
  ENTRY_KEY,
  entriesFromLines,
  expressionAt,
  isEntryBlock,
  isKeyed,
  plainValue,
  positionIn,
  scalarValue,
  scanLines,
  setKind,
  type Line,
  type RawEntry,
} from "./profile/index.ts"
import {
  analyze,
  analyzeEntry,
  analyzeProfileView,
  bPresetUnknown,
  bWriteOp,
  collectRefSpans,
  defaultEntryRules,
  defaultProfileRules,
  defaultRules,
  kArity,
  kOperandOrder,
  nsAccess,
  parseRpn,
  rpnUnterminated,
  simulate,
  unitMeaningless,
  type Basis,
  type Confidence,
  type Diagnostic,
  type EntryView,
  type FactId,
  type IrDoc,
  type ProfileBlock,
  type ProfileItem,
  type ProfileMapping,
  type RuleContext,
  type Severity,
} from "./lang/index.ts"

/** The rules that judge references — safe wherever the refs were found. */
const REF_RULES = [kArity, bWriteOp, bPresetUnknown, nsAccess, unitMeaningless]

export interface DocumentPosition {
  lineNumber: number
  column: number
}

export interface FileDiagnostic {
  ruleId: string
  severity: Severity
  message: string
  /**
   * The structured parts, for a rule written through `diagnose` — see
   * `Diagnostic` in lang/rules.ts. Carried across untouched: none of them
   * holds an offset, so placing a diagnostic has nothing to do to them.
   */
  verdict?: string
  consequence?: string
  remedy?: string
  why?: readonly FactId[]
  basis?: Basis
  confidence?: Confidence
  start: DocumentPosition
  end: DocumentPosition
  fix?: {
    title: string
    edits: { start: DocumentPosition; end: DocumentPosition; newText: string }[]
  }
}

/** Where an offset in one of an entry's texts lands on the page. */
type Place = (offset: number) => DocumentPosition

/** What the expression walk learned about one setter, kept for level 2. */
interface Setter {
  text: string
  kind: ReturnType<typeof setKind>
  at: Place
}

/** The structured parts a diagnostic has, and only those it has. */
function structure(
  diagnostic: Diagnostic
): Pick<
  FileDiagnostic,
  "verdict" | "consequence" | "remedy" | "why" | "basis" | "confidence"
> {
  const { verdict, consequence, remedy, why, basis, confidence } = diagnostic

  return {
    ...(verdict ? { verdict } : {}),
    ...(consequence ? { consequence } : {}),
    ...(remedy ? { remedy } : {}),
    ...(why ? { why } : {}),
    ...(basis ? { basis } : {}),
    ...(confidence ? { confidence } : {}),
  }
}

/** A core diagnostic, positioned — the one place spans become columns. */
function place(diagnostic: Diagnostic, at: Place): FileDiagnostic {
  return {
    ruleId: diagnostic.ruleId,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...structure(diagnostic),
    start: at(diagnostic.start),
    end: at(diagnostic.end),
    ...(diagnostic.fix
      ? {
          fix: {
            title: diagnostic.fix.title,
            edits: diagnostic.fix.edits.map((edit) => ({
              start: at(edit.start),
              end: at(edit.end),
              newText: edit.newText,
            })),
          },
        }
      : {}),
  }
}

/**
 * The `get:` value as the rules measure it, and where it sits on its line.
 *
 * `scalarValue` is what the entry itself was read through, so the text is
 * identical to the one `name` and `units` were split out of. Finding it
 * back in the raw line rather than computing a column absorbs the quoting
 * for free: a quoted value's inner text is simply found one column right.
 */
function valuePlace(
  line: Line | undefined,
  value: string
): { text: string; at: Place } | null {
  if (!line || !value) return null

  const base = line.text.indexOf(value, line.keyColumn)
  if (base === -1) return null

  return {
    text: value,
    at: (offset) => ({ lineNumber: line.number, column: base + 1 + offset }),
  }
}

function getTarget(
  lines: Line[],
  entry: RawEntry
): { text: string; at: Place } | null {
  const line = lines[entry.at.get - 1]
  if (!line || !isKeyed(line)) return null

  return valuePlace(line, scalarValue(line.value))
}

/**
 * FS Copilot's `UpdatedRx`, mirrored character for character —
 * `RegexOptions.Multiline` and case-sensitive, matching anywhere in the file
 * rather than only in the comment header. Applied per line here, which is
 * the same thing with a line number attached, and which is why `\s` cannot
 * run past the end of a line. It also earns its keep on CRLF files, where
 * the trailing `\s*` absorbs the `
` that would otherwise land inside the
 * captured date.
 */
const UPDATED = /^\s*#\s*Updated:\s*(.+?)\s*$/

/** The first line FS Copilot would take the profile's date from. */
function updatedLine(lines: Line[]): ProfileItem | null {
  for (const line of lines) {
    const found = UPDATED.exec(line.text)
    if (found) return { line: line.number, text: found[1]! }
  }
  return null
}

/** The keys an entry may carry. Anything else on an entry line is a stray. */
const KNOWN_ENTRY_KEYS = new Set([ENTRY_KEY, ...CONTINUATION_KEYS])

export function analyzeProfile(
  text: string,
  context: RuleContext
): FileDiagnostic[] {
  const lines = scanLines(text)
  const out: FileDiagnostic[] = []

  const entries = entriesFromLines(lines)

  /*
   * What the walk below learns about each setter, kept for the level-2
   * pass: the text it analyzed and the mapper that puts an offset in that
   * text back on the page. Keyed by the `set:` key line, which is what an
   * entry records.
   *
   * The two levels cannot share one loop, because most entries have no
   * `set:` line to meet the walk at — 15,933 of the corpus's 25,855 are
   * implicit, and a `get:`-line rule that skipped them would be blind to
   * the majority of the profile. So the walk runs first, and every entry
   * is judged afterwards whether it has a setter or not.
   */
  const setters = new Map<number, Setter>()

  /*
   * Where a level-3 verdict can land: the value text of any line that has
   * one, by line number. Entries fill this in below; the list items of the
   * two optional blocks are gathered here, since nothing else walks them.
   *
   * `include:` and `ignore:` are both optional blocks — a profile with
   * neither is the normal case, and nothing may read their absence as a
   * finding.
   */
  const placeOfLine = new Map<number, Place>()
  const includes: ProfileItem[] = []
  const ignores: ProfileItem[] = []
  const pointers: ProfileItem[] = []
  const blocks: ProfileBlock[] = []
  const mappings: ProfileMapping[] = []

  for (const line of lines) {
    if (line.kind === "blockKey") {
      const placed = valuePlace(line, line.name)
      if (placed) {
        placeOfLine.set(line.number, placed.at)
        blocks.push({ line: line.number, text: line.name, known: line.known })
      }
      continue
    }

    /*
     * A key the format does not define. Two line kinds carry one: an
     * indented `sett: x` is a `mapping`, and `- sett: x` is an `entry`
     * whose key happens not to be `get`. The grammar draws that line by
     * whether a dash opened the item, which is not a difference FS Copilot's
     * deserializer can see — both are an unmatched property on the same
     * object, and both throw.
     */
    const stray =
      line.kind === "mapping"
        ? line.key
        : line.kind === "entry" && !KNOWN_ENTRY_KEYS.has(line.key)
          ? line.key
          : null

    if (stray !== null) {
      const placed = valuePlace(line, stray)
      if (placed) {
        placeOfLine.set(line.number, placed.at)
        mappings.push({
          line: line.number,
          text: stray,
          // `entryOpen` is the state *before* the line, so a `- sett:` that
          // opens its own item reads false there. What actually decides the
          // vocabulary is the block it is in.
          inEntry: isEntryBlock(line.context.block) && line.indent > 0,
        })
      }
      continue
    }

    if (line.kind !== "sequenceItem") continue

    const block = line.context.block

    if (block === "pointer") {
      // `scalarValue`, not `plainValue`: a key can need quoting, and the
      // rules compare what FS Copilot reads. `valuePlace` finds the inner
      // text in the raw line, so the span lands inside the quotes.
      const placed = valuePlace(line, scalarValue(line.value).trim())
      if (!placed) continue

      placeOfLine.set(line.number, placed.at)
      pointers.push({ line: line.number, text: placed.text })
      continue
    }

    if (block !== "include" && block !== "ignore") continue

    // `plainValue`, because YAML strips a trailing comment from a plain
    // scalar and FS Copilot never sees one — two corpus includes carry an
    // `# ADDED BY …` note that is not part of the path.
    const placed = valuePlace(line, plainValue(line.value).trim())
    if (!placed) continue

    placeOfLine.set(line.number, placed.at)
    ;(block === "include" ? includes : ignores).push({
      line: line.number,
      text: placed.text,
    })
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!

    // Each expression exactly once: a one-line `set:` value at its own
    // line, a block scalar at its first body line.
    const oneLine =
      line.kind === "continuation" &&
      line.key === "set" &&
      !line.scalar &&
      Boolean(line.value)
    const blockStart =
      line.kind === "scalarBody" && lines[index - 1]?.kind !== "scalarBody"
    if (!oneLine && !blockStart) continue

    // The line the value is addressed by, and the one an entry records: its
    // own for a one-liner, the key above for a block scalar's first body
    // line — nothing but a scalar header can precede one.
    const keyLine = oneLine ? line.number : lines[index - 1]!.number

    const expression = expressionAt(lines, line.number)
    if (!expression) continue

    /*
     * No unquoting step, and no offset shift to go with it. `expressionAt`
     * hands over the value FS Copilot evaluates and points `startColumn` at
     * where that value starts on the page, so `positionIn` already lands on
     * the right characters. This used to be a private `unquoted()` here and
     * a `+ delta` at every mapping site — which the hover and the
     * completions never had, and were broken for exactly that reason.
     */
    const at = (offset: number): DocumentPosition =>
      positionIn(expression, offset)

    const kind = setKind(expression.text)
    const ruleContext = { ...context, setterKind: kind }
    setters.set(keyLine, { text: expression.text, kind, at })

    /*
     * Two compositions, because a JavaScript setter is not an RPN program.
     *
     * For literal/prepended kinds the text IS the program: the full rule
     * set runs, stack simulation included. For the javascript kind, RPN
     * words are JavaScript — `switch (value) {` must not trip the brace
     * rule — while the *references* are still references wherever the
     * quoting put them. So the ref-judging rules run over the top level
     * (plus the layout rules, which need the operand adjacency only it
     * has) and over `collectRefSpans`' descended nodes for the refs the
     * quoting hid; the unterminated check reads only the top level, where
     * a stray quote (the P180 typo) is exactly what it catches.
     */
    let diagnostics: Diagnostic[]
    if (kind === "javascript") {
      /*
       * The top-level pass sees the raw JS, where a backtick is a lone
       * word and template RPN keeps its operand adjacency — which is what
       * the layout-reading rules (k-arity's laid-out escalation,
       * k-operand-order) judge, so the ref rules run HERE for every ref
       * the top level carries. The descended doc keeps only the refs
       * found inside string and hole interiors — judged once, by span —
       * where adjacency does not survive and the per-ref rules alone
       * apply.
       */
      const topLevel = parseRpn(expression.text)
      const topLevelRefs = new Set(
        topLevel.nodes
          .filter((node) => node.kind === "ref")
          .map((node) => node.token.start)
      )

      const refDoc: IrDoc = {
        nodes: collectRefSpans(expression.text)
          .filter((span) => !topLevelRefs.has(span.start))
          .map((span) => ({
            ...span.node,
            token: {
              kind: "ref" as const,
              start: span.start,
              end: span.end,
              text: expression.text.slice(span.start, span.end),
            },
          })),
        unterminated: [],
      }

      diagnostics = [
        ...analyze(REF_RULES, refDoc, simulate(refDoc), ruleContext),
        ...analyze(
          [...REF_RULES, rpnUnterminated, kOperandOrder],
          topLevel,
          simulate(topLevel),
          ruleContext
        ),
      ]
    } else {
      const doc = parseRpn(expression.text)
      const simulation = simulate(doc, kind === "prepended" ? 1 : 0)
      diagnostics = analyze(defaultRules, doc, simulation, ruleContext)
    }

    for (const diagnostic of diagnostics) out.push(place(diagnostic, at))
  }

  /*
   * Levels 2 and 3 — every entry, setter or not, and then the whole set.
   * Both work from the same views and the same mappers, built once here;
   * `views` and `places` stay index-aligned because a level-3 verdict names
   * its entry by position in the array it was handed.
   */
  const views: EntryView[] = []
  const places: { get: Place; set?: Place }[] = []

  for (const entry of entries) {
    const target = getTarget(lines, entry)
    if (!target) continue

    const setter =
      entry.at.set === undefined ? undefined : setters.get(entry.at.set)

    /*
     * The kind is evidence like any other. No `set:` line at all means
     * `implicit`, FS Copilot's fourth kind. A `set:` the walk could not map
     * — the escape case above — means *unknown*, so the field is left off
     * rather than defaulted: rules that need it then mute, which is the
     * confidence-tier contract instead of a guess.
     */
    const kind =
      entry.at.set === undefined ? ("implicit" as const) : setter?.kind

    const view: EntryView = {
      line: entry.at.get,
      get: target.text,
      name: entry.name,
      units: entry.units,
      unitsExplicit: entry.unitsExplicit,
      block: entry.block,
      set: setter?.text,
      skp: entry.skp,
    }

    const ruleContext: RuleContext = {
      ...context,
      ...(kind ? { setterKind: kind } : {}),
    }

    views.push(view)
    places.push({ get: target.at, ...(setter ? { set: setter.at } : {}) })
    placeOfLine.set(entry.at.get, target.at)

    for (const diagnostic of analyzeEntry(
      defaultEntryRules,
      view,
      ruleContext
    )) {
      // A `set:`-targeted verdict without a mapped setter has nowhere to
      // land. No shipped rule can produce one — they all read `entry.set`,
      // which is absent in exactly that case — so this is a guard, not a
      // silent drop.
      const at = diagnostic.target === "get" ? target.at : setter?.at
      if (!at) continue

      out.push(place(diagnostic, at))
    }
  }

  /*
   * Level 3 — the file's parts against each other. No per-entry context: a
   * rule that spans a file has no one setter kind to be told about. Verdicts
   * anchor to a line rather than to an entry, because an `include:` item is
   * not an entry and has no `get:`.
   */
  for (const diagnostic of analyzeProfileView(
    defaultProfileRules,
    {
      entries: views,
      includes,
      ignores,
      pointers,
      blocks,
      mappings,
      updated: updatedLine(lines),
    },
    context
  )) {
    const at = placeOfLine.get(diagnostic.line)
    if (!at) continue

    out.push(place(diagnostic, at))
  }

  return out
}
