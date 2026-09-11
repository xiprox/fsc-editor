import { create } from "zustand"

/**
 * Editor preferences, in the `localStorage` tier.
 *
 * Deliberately not the main process's settings file — that is reserved for the
 * single thing that must survive the renderer's storage being cleared: where
 * the profiles are (see `session.ts`). Losing a font size costs one visit to
 * Settings.
 *
 * One object under one key rather than a key per preference, so a future
 * preference is a field and a default here, not a new storage entry to migrate.
 */
export interface EditorPrefs {
  /** Monaco's `fontSize`. The UI type scale is unaffected. */
  fontSize: number
  wordWrap: boolean
  /**
   * Rendered as `"boundary"` rather than `"all"`: the profiles are
   * indentation-sensitive YAML, so leading runs and trailing strays are the
   * whitespace worth seeing, and a dot between every word is noise.
   */
  showWhitespace: boolean
}

export const EDITOR_PREF_DEFAULTS: EditorPrefs = {
  fontSize: 13,
  wordWrap: false,
  showWhitespace: false,
}

/** The range the font size input clamps to. */
export const FONT_SIZE_MIN = 10
export const FONT_SIZE_MAX = 22

const KEY = "prefs:editor"

export function clampFontSize(value: number): number {
  return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(value)))
}

/**
 * Whatever was stored, merged over the defaults — a build that adds a
 * preference reads an older object cleanly, and a corrupt one is just the
 * defaults again.
 */
function load(): EditorPrefs {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "")
    if (typeof stored !== "object" || stored === null)
      return EDITOR_PREF_DEFAULTS

    const editor = { ...EDITOR_PREF_DEFAULTS, ...stored }
    editor.fontSize = clampFontSize(
      typeof editor.fontSize === "number"
        ? editor.fontSize
        : EDITOR_PREF_DEFAULTS.fontSize
    )
    return editor
  } catch {
    return EDITOR_PREF_DEFAULTS
  }
}

interface PrefsState {
  editor: EditorPrefs
  setEditorPref: <K extends keyof EditorPrefs>(
    key: K,
    value: EditorPrefs[K]
  ) => void
}

export const usePrefs = create<PrefsState>((set, get) => ({
  editor: load(),

  setEditorPref(key, value) {
    const editor = { ...get().editor, [key]: value }
    localStorage.setItem(KEY, JSON.stringify(editor))
    set({ editor })
  },
}))

/**
 * The Monaco options a preference set resolves to, for `updateOptions` — the
 * one translation from what Settings stores to what the editor speaks, so the
 * three editor instances cannot each translate differently.
 */
export function monacoOptionsFor(prefs: EditorPrefs): {
  fontSize: number
  wordWrap: "on" | "off"
  renderWhitespace: "boundary" | "selection"
} {
  return {
    fontSize: prefs.fontSize,
    wordWrap: prefs.wordWrap ? "on" : "off",
    // "selection" is Monaco's default, kept as the off state.
    renderWhitespace: prefs.showWhitespace ? "boundary" : "selection",
  }
}
