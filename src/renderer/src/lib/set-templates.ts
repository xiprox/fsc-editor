/**
 * The shapes a `set:` value can take, as completion offers them.
 *
 * One row per shape of the taxonomy in *Highlighting v2*
 * (docs/sim-vars/18-language-core.md), ordered by how often the corpus
 * writes each, and each labelled with the kind FS Copilot will assign it —
 * literal, prepended, javascript — so the menu teaches the vocabulary as it
 * completes. `completions.ts` renders these into Monaco items; this file
 * decides them, headless, so a test can check that every template really
 * is the kind its label claims.
 *
 * Insert text is Monaco snippet syntax. Templates that are JavaScript are
 * wrapped in YAML double quotes, which is how 91% of the corpus writes them
 * and the only plain way to carry a `: ` or a `?` inside a scalar. Block
 * forms use a folded scalar; their indentation is relative, because Monaco
 * prepends the current line's indentation to every line after the first.
 */

import type { SetKind } from "@shared/profile"

export interface SetTemplate {
  label: string
  /** What `setKind` will say of the inserted value. */
  kind: SetKind
  /** Monaco snippet text. */
  insertText: string
  /** Markdown for the item's documentation panel. */
  documentation: string
}

/** Snippet metacharacters that would be read as placeholders, escaped. */
function snippetText(text: string): string {
  return text.replace(/[\\$}]/g, "\\$&")
}

/**
 * What is true of a guard whichever shape it is written in.
 *
 * Shared by the one-line and the block form rather than said twice: they are
 * the same guard, and prose that drifts between two menu items is how one of
 * them ends up wrong.
 */
const GUARD_NOTES = [
  "The truthiness comparison is deliberate: `value` arrives over the wire " +
    "with the other pilot's numeric type and `current` comes from the simulator, " +
    "so `1` and `true` for the same logical state are common.",
  "**Not needed** for a `K:` or `B:` event whose name contains `TOGGLE` — " +
    "FS Copilot already drops those when the values match. It is worth " +
    "having for `H:` events, which it does not check, and for events not " +
    "spelled `TOGGLE`.",
  "One caveat with no fix inside the expression: `current` falls back to " +
    "`value` before the simulator has reported the variable once, so this " +
    "guard swallows the first update if the other pilot beats the sim to it.",
].join("\n\n")

const EMPTY_BRANCH =
  "In a `shared:` entry an expression that evaluates to the empty string " +
  "does nothing — the calculator is not called at all. In a `master:` entry " +
  "it is not a guard: empty text matches no `(>NAME)`, so FS Copilot falls " +
  "back to writing the incoming value to the `get:` variable, which for a " +
  "`K:` `get:` fires the event."

/** A block form: folded scalar, body indented under the key. */
function block(...body: string[]): string {
  return [">", ...body.map((line) => `  ${line}`)].join("\n")
}

/**
 * The templates, for an entry whose `get:` names `event` — the event name
 * without its prefix, so `(>K:…)` under `get: K:PITOT_HEAT_TOGGLE` offers
 * `PITOT_HEAT_TOGGLE` as its first placeholder.
 */
export function setTemplates(event: string): SetTemplate[] {
  const e = snippetText(event)

  return [
    {
      label: "(>K:…)  key event",
      kind: "prepended",
      insertText: `(>K:\${1:${e}})`,
      documentation:
        "**Prepended.** Starts with `(`, so FS Copilot puts the value in " +
        "front: sent as `<value> (>K:…)`.",
    },
    {
      label: "(>L:…)  local variable",
      kind: "prepended",
      insertText: "(>L:${1:VAR})",
      documentation:
        "**Prepended.** Writes the value to an L: variable — `<value> (>L:…)`.",
    },
    {
      label: "(>B:…)  input event",
      kind: "prepended",
      insertText: "(>B:${1:EVENT})",
      documentation:
        "**Prepended.** Sends the value to a B: input event — `<value> (>B:…)`.",
    },
    {
      label: "(>H:…)  HTML event",
      kind: "prepended",
      insertText: "(>H:${1:EVENT})",
      documentation:
        "**Prepended.** Fires an H: HTML event with the value in front.",
    },
    {
      label: "1 (>K:…)  fixed operand",
      kind: "literal",
      insertText: `\${1:1} (>K:\${2:${e}})`,
      documentation:
        "**Literal.** Sent exactly as written — the incoming value is *not* " +
        "prepended. The operand in front is what the event receives, " +
        "whatever was set. The most common authored setter in the corpus.",
    },
    {
      label: "1 2 (>K:2:…)  two operands",
      kind: "literal",
      insertText: `\${1:0} \${2:1} (>K:2:\${3:${e}})`,
      documentation:
        "**Literal**, two-parameter event. RPN pushes left to right and the " +
        "event takes the top of the stack as parameter `[0]`, so the *last* " +
        "operand written is `[0]` and the first is `[1]`. The `K:2:` says " +
        "two are coming; without it the second is leaked and the first " +
        "broadcasts.",
    },
    {
      label: "`${value} …`  expression",
      kind: "javascript",
      insertText: `"\`\\\${value} (>K:\${1:${e}})\`"`,
      documentation:
        "**JavaScript.** Evaluated with `value` and `current` in scope; the " +
        "string it produces is the RPN to execute. The template body is " +
        "RPN, the `${…}` holes are JavaScript.",
    },
    {
      label: "`${value * 16} …`  scaled expression",
      kind: "javascript",
      insertText: `"\`\\\${value * \${1:16}} (>K:\${2:${e}})\`"`,
      documentation:
        "**JavaScript.** The value is arithmetic on its way in — a unit " +
        "conversion, an axis range, an offset. Any expression can sit in " +
        "the hole; the result is what the RPN sees.",
    },
    {
      label: "value > current ? INC : DEC  increment pair",
      kind: "javascript",
      insertText:
        `"value > current ? '(>\${1:B}:\${2:${e}_INC})' : '(>\${1:B}:\${3:${e}_DEC})'"`,
      documentation:
        "**JavaScript.** For a variable that only has increment and " +
        "decrement events: compare the incoming value with what the " +
        "simulator has, and step in the right direction. Every string here " +
        "is an RPN program.",
    },
    {
      label: "value == 1 ? … : ''  empty-branch guard",
      kind: "javascript",
      insertText: `"value == \${1:1} ? '(>\${2:B}:\${3:${e}})' : ''"`,
      documentation:
        "**JavaScript.** Acts on one value and ignores the rest. " +
        EMPTY_BRANCH,
    },
    {
      label: "guarded toggle  `${… ? … : ''}`",
      kind: "javascript",
      insertText: `"\`\\\${!!value !== !!current ? '(>\${1:H}:\${2:${e}})' : ''}\`"`,
      documentation:
        "**JavaScript.** Fires the event only when the two sides actually " +
        "differ, and evaluates to the empty string when they already " +
        "agree.\n\n" +
        EMPTY_BRANCH +
        "\n\n" +
        "The whole guard on one line, for the common case where it is the " +
        "entire expression. The block below is what this grows into once " +
        "there is a second statement to write.\n\n" +
        GUARD_NOTES,
    },
    {
      label: "switch (value) { case … }  block",
      kind: "javascript",
      insertText: block(
        "(() => {",
        "  switch (value) {",
        `    case \${1:0}: return '(>\${2:B}:\${3:${e}_OFF})';`,
        `    case \${4:1}: return '(>\${2:B}:\${5:${e}_ON})';`,
        "    default: return '';",
        "  }",
        "})()"
      ),
      documentation:
        "**JavaScript** block scalar, one branch per value. " +
        EMPTY_BRANCH +
        " Wrapped in a function so `return` is legal.",
    },
    {
      label: "block  (() => { … })()",
      kind: "javascript",
      insertText: block(
        "(() => {",
        `  return '(>\${1:H}:\${2:${e}})';`,
        "})()"
      ),
      documentation:
        "**JavaScript** block scalar returning the string to execute. Room " +
        "for more than one statement, and the usual shape once an " +
        "expression stops fitting on a line.",
    },
    {
      label: "guarded block  (() => { … })()",
      kind: "javascript",
      insertText: block(
        "(() => {",
        "  if (!!value === !!current) return '';",
        `  return '(>\${1:H}:\${2:${e}})';`,
        "})()"
      ),
      documentation:
        "**JavaScript.** Returns an empty string to do nothing, for an event " +
        "that must not echo back what it was just told. The same guard as " +
        "the one-line form, with room for more than one statement.\n\n" +
        GUARD_NOTES,
    },
  ]
}

/**
 * The value a template inserts, with its placeholders resolved to their
 * defaults and snippet escapes undone — what the buffer holds after the
 * user accepts the item and tabs through. Exported for the test that checks
 * every template's kind.
 */
export function resolvedInsert(template: SetTemplate): string {
  return template.insertText
    .replace(/\$\{\d+:((?:\\.|[^}\\])*)\}/g, "$1")
    .replace(/\$\d+/g, "")
    .replace(/\\([\\$}])/g, "$1")
}
