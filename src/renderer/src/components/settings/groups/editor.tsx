import { useState } from "react"

import {
  clampFontSize,
  EDITOR_PREF_DEFAULTS,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  usePrefs,
} from "@/lib/prefs"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { SettingsRow } from "@/components/settings/rows"

/**
 * Settings → Editor. Every row is one field in `EditorPrefs` — adding a
 * preference is a field, a default, one line in `monacoOptionsFor`, and a row
 * here. Changes apply to the live editors immediately (see the prefs effect in
 * `editor-pane.tsx`), so there is no Save and nothing to confirm.
 */
export function EditorGroup() {
  const editor = usePrefs((state) => state.editor)
  const setEditorPref = usePrefs((state) => state.setEditorPref)

  return (
    <div className="flex flex-col gap-3">
      <SettingsRow
        label="Font size"
        description={`Text size in the editor, ${FONT_SIZE_MIN}–${FONT_SIZE_MAX}. The rest of the app is unaffected.`}
      >
        <FontSize
          value={editor.fontSize}
          onCommit={(size) => setEditorPref("fontSize", size)}
        />
      </SettingsRow>

      <SettingsRow
        label="Word wrap"
        description="Wrap long lines instead of scrolling sideways."
      >
        <Checkbox
          aria-label="Word wrap"
          checked={editor.wordWrap}
          onCheckedChange={(checked) =>
            setEditorPref("wordWrap", checked === true)
          }
        />
      </SettingsRow>

      <SettingsRow
        label="Show whitespace"
        description="Mark indentation runs and trailing spaces — profiles are indentation-sensitive."
      >
        <Checkbox
          aria-label="Show whitespace"
          checked={editor.showWhitespace}
          onCheckedChange={(checked) =>
            setEditorPref("showWhitespace", checked === true)
          }
        />
      </SettingsRow>
    </div>
  )
}

/**
 * The size as text while it is being typed, committed on blur or Enter.
 *
 * Committing per keystroke would clamp "1" to 10 on the way to typing "16";
 * letting the field hold a draft and settling it when editing ends is the
 * only version that lets somebody type a two-digit number. Whatever was typed
 * settles to the clamped parse, and nonsense settles back to the current
 * value.
 */
function FontSize({
  value,
  onCommit,
}: {
  value: number
  onCommit: (size: number) => void
}) {
  const [draft, setDraft] = useState(String(value))

  const commit = (): void => {
    const parsed = Number.parseInt(draft, 10)
    const size = Number.isNaN(parsed)
      ? value
      : clampFontSize(parsed || EDITOR_PREF_DEFAULTS.fontSize)

    setDraft(String(size))
    if (size !== value) onCommit(size)
  }

  return (
    <Input
      type="number"
      className="w-16"
      min={FONT_SIZE_MIN}
      max={FONT_SIZE_MAX}
      aria-label="Editor font size"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit()
      }}
    />
  )
}
