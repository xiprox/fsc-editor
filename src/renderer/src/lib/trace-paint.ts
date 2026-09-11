/**
 * A trace step's detail, cut into spans the editor's own palette can colour.
 *
 * The panel's rule is that a fragment which is code looks here exactly as it
 * looks in the file — same painter, same scopes, same `--syntax-*` tokens. So
 * this does not hold a palette of its own: `rpn` and `name` fragments go
 * through `paintRpn` and `paintName`, the two functions the editor's
 * tokenizer calls, and every scope is resolved through `monaco-theme`'s
 * `PALETTE`. Tuning a colour moves the editor and the panel together because
 * there is only one place it is written down.
 *
 * The model decides *which* fragments are code — see `Part` in
 * `@shared/trace`, and the reason there: a value and a rate are the same
 * characters, and only the step that built them knows which is which.
 */

import { paintName, paintRpn, Spans, type Scope } from "@shared/highlight"
import type { CodePaint, Part } from "@shared/trace"

import { PALETTE } from "./monaco-theme"

/** A stretch of a detail and the scope it is painted in. */
export interface PaintedSpan {
  text: string
  /** Null is prose — the panel's own foreground, with no rule of its own. */
  scope: Scope | null
  /** A CLR type, which the panel underlines and gives a tooltip. */
  type?: boolean
  /** A glossary word, underlined the same way but left as prose. */
  term?: boolean
}

/**
 * The scope each simple marker resolves to.
 *
 * Simple meaning "the whole fragment is one token", as against `rpn` and
 * `name`, which are programs and get tokenized. The choices are the scope map
 * in docs/help/trace-panel.md, and two of them are worth the note it makes:
 * `TOGGLE` is a **string**, because it is a literal substring FS Copilot
 * searches the built expression for rather than a keyword of any language;
 * and punctuation takes `js.operator` — which resolves to `--syntax-operator`
 * — rather than `rpn.operator`, which is a different token in a different
 * hue for the calculator's verbs.
 */
const SIMPLE: Record<
  Exclude<CodePaint, "rpn" | "name" | "type" | "term">,
  Scope
> = {
  unit: "ref.unit",
  number: "rpn.number",
  injected: "js.injected",
  key: "yaml.key",
  block: "yaml.block",
  string: "rpn.string",
  operator: "js.operator",
  prefix: "ref.prefix",
}

/** How one scope is drawn: static classes, and the token as a colour. */
export interface ScopePaint {
  /** Weight, slant and underline — all of them fixed class names. */
  className: string
  /** The `--syntax-*` token, or nothing where the scope inherits. */
  style?: { color: string }
}

const PLAIN: ScopePaint = { className: "" }

/**
 * What one scope is drawn with.
 *
 * **The colour arrives as an inline custom property, not a utility class**,
 * and that is not a shortcut. Tailwind generates a class by finding its name
 * written out in the source, so a class built at runtime —
 * `` `text-[var(--syntax-${token})]` `` — is never emitted and the span
 * silently inherits whatever is around it. That shipped once already: the
 * locator's block word and every `skp:` came out in the surrounding grey,
 * while the two scopes `var-chip.tsx` happens to spell out in full were the
 * only ones that worked.
 *
 * `style` still carries the token rather than a colour, so this stays inside
 * the system docs/ui.md asks for — the value is `var(--syntax-block)`, and
 * tuning that token still moves the editor and the panel together. What it
 * gives up is only the class name.
 *
 * `PALETTE` is Monaco's own rule table, so a scope with no entry — or one
 * mapped to the plain foreground — comes back with nothing and reads as the
 * surrounding text, which is what it does in the editor too.
 */
export function scopePaint(scope: Scope | null): ScopePaint {
  const paint = scope ? PALETTE[scope] : null
  if (!paint) return PLAIN

  const className = [
    paint.fontStyle?.startsWith("bold") ? "font-semibold" : "",
    paint.fontStyle === "italic" ? "italic" : "",
    paint.fontStyle?.endsWith("underline") ? "underline" : "",
  ]
    .filter(Boolean)
    .join(" ")

  if (paint.color === "foreground") return { className }

  return {
    className,
    style: {
      color:
        paint.color === "destructive"
          ? "var(--destructive)"
          : `var(--syntax-${paint.color})`,
    },
  }
}

/**
 * Runs one of the editor's painters over a fragment and cuts it up.
 *
 * `Spans` records where each scope *starts*; a span runs to the next start,
 * or to the end of the fragment. Anything before the first start is prose —
 * which happens for a name whose prefix begins a character or two in.
 */
function tokenized(
  text: string,
  paint: (text: string, base: number, out: Spans) => void
): PaintedSpan[] {
  const out = new Spans()
  paint(text, 0, out)

  const marks = out.list
  if (!marks.length) return [{ text, scope: null }]

  const spans: PaintedSpan[] = []
  const first = marks[0]!
  if (first.start > 0)
    spans.push({ text: text.slice(0, first.start), scope: null })

  for (let at = 0; at < marks.length; at++) {
    const mark = marks[at]!
    const end = marks[at + 1]?.start ?? text.length
    if (end > mark.start)
      spans.push({ text: text.slice(mark.start, end), scope: mark.scope })
  }

  return spans
}

/** One part of a detail, as the spans that draw it. */
export function paintPart(part: Part): PaintedSpan[] {
  if (typeof part === "string") return [{ text: part, scope: null }]

  if (part.paint === "rpn") return tokenized(part.text, paintRpn)
  if (part.paint === "name") return tokenized(part.text, paintName)

  /*
   * The CLR type is the one fragment that is not a token from the file: `int`
   * is what FS Copilot resolved the entry to, not something the author wrote.
   * It keeps the keyword colour — `int` and `double` are keywords in the
   * language they come from — and the panel gives it the dotted underline and
   * the tooltip that carry the consequence.
   */
  if (part.paint === "type")
    return [{ text: part.text, scope: "js.keyword", type: true }]

  /*
   * A glossary word is **prose**, so it takes no scope at all — it reads in
   * the surrounding colour and keeps the surrounding face. Only the dotted
   * underline marks it, which is the same affordance the type gets, and that
   * sameness is deliberate: one underline in this panel means "there is more
   * here", whether the word came from the simulator or from us.
   */
  if (part.paint === "term")
    return [{ text: part.text, scope: null, term: true }]

  return [{ text: part.text, scope: SIMPLE[part.paint] }]
}

/** A whole detail, flattened to spans in order. */
export function paintDetail(parts: Part[]): PaintedSpan[] {
  return parts.flatMap(paintPart)
}

/**
 * The glossary, for words the panel cannot avoid and has never introduced.
 *
 * Deliberately tiny. A tooltip on every noun would make the panel a hover
 * maze, so a word earns an entry only when it is (a) unavoidable, (b) used
 * across the app rather than in one row, and (c) undefined anywhere a reader
 * would meet it first.
 *
 * `calculator` is all three. It is the simulator's expression evaluator and
 * the SDK's own term — `execute_calculator_code` — and the app leans on it in
 * `facts.ts`, `key-docs.ts`, `hover-card.ts`, `set-templates.ts`, `run.ts`
 * and `setter.ts`, while appearing nowhere in docs/copy.md's vocabulary
 * table. The word is right; replacing it would teach a vocabulary nothing
 * else uses, which is the same argument that kept `int` in TYPE_DOC below.
 *
 * **This wants to move.** It lives here because the trace panel is where the
 * need surfaced, but nothing about it is trace-specific — the hover cards and
 * the diagnostics say `calculator` far more often than this panel does. When
 * a second surface wants it, that is the signal to lift it beside `facts.ts`
 * rather than to copy it.
 */
export const TERM_DOC: Record<string, string> = {
  calculator: "The simulator's own expression evaluator.",
  /*
   * Keyed by the rendered text, so a phrase is a key like any word. This one
   * is a mechanism rather than a word, and it earns the same affordance: it
   * is the trigger for the row it sits in, it is genuinely surprising, and it
   * is in the way of the majority of readers whose entry is an ordinary
   * toggle. The purpose comes last because that is the part that makes the
   * condition make sense.
   */
  /*
   * This is where the pattern went. The row used to print
   * `args (>NAME, units)` and a reader called it meaningless — it described
   * the regex rather than the aircraft. The shape is still worth having for
   * anyone checking whether their line fits it, which is the whole of
   * `dead-set`; it just belongs behind the word rather than in front of it.
   */
  manually:
    "For master: entries, FS Copilot matches the built expression against " +
    "`args (>NAME, units)` and rewrites the pieces itself, instead of just " +
    "handing the built expression to the simulator, like it does for " +
    "shared: entries.",
  "is on":
    "FS Copilot checks if a given expression holds an event write (>K: or " +
    ">B:) and the text TOGGLE, anywhere in it. If yes, it skips the write if " +
    "the value hasn't actually changed.",
}

/**
 * What each CLR type means for the author, which the type's tooltip carries.
 *
 * The precise word is kept rather than replaced with its consequence: `int`
 * is what the entry resolves to and what anyone reading the C# will see, and
 * a panel that renamed it would be teaching a vocabulary nothing else uses.
 * The consequence goes in the tooltip, where it is available without being in
 * the way.
 */
export const TYPE_DOC: Record<string, string> = {
  int: "Whole numbers only. A fraction is dropped on the way to the simulator.",
  double: "A 64-bit float — about fifteen digits of precision.",
  float: "A 32-bit float — about seven digits of precision.",
  string: "Text rather than a number, so it is compared as text.",
}
