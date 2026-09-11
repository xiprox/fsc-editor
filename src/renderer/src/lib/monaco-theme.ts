import * as monaco from "monaco-editor"

import { SCOPES, type Scope } from "@shared/highlight"

import { isDarkMode, onThemeChange, token } from "@/lib/theme-tokens"

/**
 * Monaco has its own theming system that knows nothing about CSS variables, so
 * the editor would otherwise drift from the rest of the app on every palette
 * tweak. Instead of maintaining a second palette by hand, we read the resolved
 * shadcn tokens off the document and build the Monaco theme from them.
 */

export const MONACO_THEME = "fsc"

export { isDarkMode }

/** Monaco token rules want bare hex with no alpha channel. */
function bare(color: string): string {
  return color.replace("#", "").slice(0, 6)
}

/** The `--syntax-*` tokens in index.css, which exist only for the editor. */
type SyntaxToken =
  | "block"
  | "key"
  | "prefix"
  | "var"
  | "units"
  | "target"
  | "string"
  | "number"
  | "keyword"
  | "injected"
  | "operator"
  | "rpn-operator"
  | "register"
  | "heading"
  | "comment"
  | "comment-code"
  | "meta"

/** What a scope is painted with: a palette token, or one of two UI colours. */
export interface Paint {
  color: SyntaxToken | "foreground" | "destructive"
  fontStyle?: "bold" | "italic" | "bold underline"
}

/**
 * Every scope the highlighter can emit, and its colour. Typed against the
 * vocabulary so that a scope without a colour, or a colour for a scope that
 * no longer exists, fails typecheck rather than painting silently in the
 * default foreground.
 *
 * `null` means the editor's foreground with no rule of its own.
 */
export const PALETTE: Record<Scope, Paint | null> = {
  "": null,

  // Prose is the quietest thing on screen; a section rule is the loudest
  // comment, because it is structure.
  comment: { color: "comment", fontStyle: "italic" },
  "comment.section": { color: "heading", fontStyle: "bold" },
  "comment.subsection": { color: "heading" },
  "comment.meta": { color: "meta" },
  // Parked entries read as dimmed code rather than prose.
  "comment.code": { color: "comment-code" },

  "yaml.block": { color: "block", fontStyle: "bold" },
  "yaml.key": { color: "key" },
  "yaml.path": { color: "string" },
  "yaml.delimiter": { color: "operator" },

  // Punctuation grey, like every other bracket the language owns. The
  // prefix purple is reserved for the prefix — parens borrowing it diluted
  // the one thing it names.
  "ref.delimiter": { color: "operator" },
  "ref.write": { color: "target", fontStyle: "bold" },
  "ref.prefix": { color: "prefix", fontStyle: "bold" },
  "ref.name": { color: "var" },
  "ref.target": { color: "target" },
  // Upright: italic is what made units read as a comment.
  "ref.unit": { color: "units" },

  "rpn.number": { color: "number" },
  "rpn.string": { color: "string" },
  "rpn.operator": { color: "rpn-operator" },
  "rpn.register": { color: "register" },
  // Control flow is a keyword in either language.
  "rpn.flow": { color: "keyword", fontStyle: "bold" },
  // Unknown to the operator table: a word, in the foreground. Whether it is
  // a mistake is a diagnostic's verdict, not a colour's.
  "rpn.word": null,

  "js.keyword": { color: "keyword" },
  // `value` and `current` are the whole reason a set expression exists.
  "js.injected": { color: "injected", fontStyle: "bold" },
  "js.identifier": null,
  "js.number": { color: "number" },
  "js.operator": { color: "operator" },
  "js.delimiter": { color: "operator" },
  // The quotes frame an RPN program, which paints as one inside them.
  "js.quote": { color: "string" },
  // The hole is "JavaScript injected here" — the colour of `value`.
  "js.hole": { color: "injected", fontStyle: "bold" },
  "js.comment": { color: "comment", fontStyle: "italic" },

  // NBSP, zero-width characters, curly quotes: the tokenizer surfaces what
  // every other rendering hides, and it should look like trouble.
  "invalid.invisible": { color: "destructive", fontStyle: "bold underline" },
}

export function applyMonacoTheme(): void {
  const dark = isDarkMode()

  const background = token("--background", dark ? "#0b0f14" : "#ffffff")
  const foreground = token("--foreground", dark ? "#e6edf3" : "#0b0f14")
  const muted = token("--muted-foreground", dark ? "#8b949e" : "#6b7280")
  const accent = token("--accent", dark ? "#1f2933" : "#f1f5f9")
  const border = token("--border", dark ? "#30363d" : "#e5e7eb")
  const popover = token("--popover", dark ? "#161b22" : "#ffffff")
  const ring = token("--ring", dark ? "#6b7280" : "#9ca3af")
  const destructive = token("--destructive", "#ef4444")

  const resolve = (color: Paint["color"]): string =>
    color === "foreground"
      ? foreground
      : color === "destructive"
        ? destructive
        : token(`--syntax-${color}`, "#808080")

  const rules: monaco.editor.ITokenThemeRule[] = []
  for (const scope of SCOPES) {
    const paint = PALETTE[scope]
    if (!scope || !paint) continue
    rules.push({
      token: scope,
      foreground: bare(resolve(paint.color)),
      ...(paint.fontStyle ? { fontStyle: paint.fontStyle } : {}),
    })
  }

  monaco.editor.defineTheme(MONACO_THEME, {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules,
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorLineNumber.foreground": muted,
      "editorLineNumber.activeForeground": foreground,
      "editorCursor.foreground": foreground,
      "editor.selectionBackground": accent,
      "editor.inactiveSelectionBackground": accent,
      "editor.lineHighlightBackground": accent,
      "editorIndentGuide.background1": border,
      "editorIndentGuide.activeBackground1": ring,
      "editorWhitespace.foreground": border,
      "editorWidget.background": popover,
      "editorWidget.border": border,
      "editorSuggestWidget.background": popover,
      "editorSuggestWidget.border": border,
      "editorSuggestWidget.foreground": foreground,
      "editorSuggestWidget.selectedBackground": accent,
      "editorHoverWidget.background": popover,
      "editorHoverWidget.border": border,
      "editorError.foreground": destructive,
      "editorGutter.background": background,
      "scrollbarSlider.background": border,
      "minimap.background": background,
    },
  })

  monaco.editor.setTheme(MONACO_THEME)
}

/** Rebuilds the theme whenever the app toggles light/dark. */
export function watchThemeChanges(): () => void {
  return onThemeChange(() => applyMonacoTheme())
}
