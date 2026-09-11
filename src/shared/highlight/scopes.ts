/**
 * The scope vocabulary — every name the highlighter can paint a span with.
 *
 * One list, typed, so that the painters cannot emit a name the theme does
 * not colour and the theme cannot colour a name nothing emits: the theme is
 * a `Record<Scope, …>`, and the corpus sweep (`npm run check:highlight`)
 * asserts every emitted scope is in this list.
 *
 * Names follow the language a span belongs to rather than the venue it is
 * seen in — an RPN operator is `rpn.operator` whether it sits in a literal
 * setter or inside a JavaScript string, because it is the same thing in
 * both places. The dotted form is what Monaco's theme matcher understands:
 * a rule for `ref` would cover every `ref.*`, though the theme names each
 * one explicitly.
 *
 * `""` is the plain scope: indentation, whitespace between tokens, and text
 * the grammar has no opinion about. Monaco paints it in the editor's
 * foreground.
 */
export const SCOPES = [
  "",

  // Comments and the prose structure a profile carries in them.
  "comment",
  "comment.section",
  "comment.subsection",
  "comment.meta",
  "comment.code",

  // The YAML skeleton.
  "yaml.block",
  "yaml.key",
  "yaml.path",
  "yaml.delimiter",

  // A variable reference — a `get:` name, or `(NAME, unit)` in a program.
  "ref.delimiter",
  "ref.write",
  "ref.prefix",
  "ref.name",
  "ref.target",
  "ref.unit",

  // The calculator's RPN.
  "rpn.number",
  "rpn.string",
  "rpn.operator",
  "rpn.register",
  "rpn.flow",
  "rpn.word",

  // The JavaScript around it.
  "js.keyword",
  "js.injected",
  "js.identifier",
  "js.number",
  "js.operator",
  "js.delimiter",
  "js.quote",
  "js.hole",
  "js.comment",

  // NBSP, zero-width characters, curly quotes: what every other rendering
  // hides, and what should look like trouble.
  "invalid.invisible",
] as const

export type Scope = (typeof SCOPES)[number]

const KNOWN: ReadonlySet<string> = new Set(SCOPES)

export function isScope(name: string): name is Scope {
  return KNOWN.has(name)
}
