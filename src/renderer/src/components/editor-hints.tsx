/**
 * The first few explanations of what the editor draws that is not the file:
 * the live value at the end of a `get:` line. See `hints.ts` for why they stop.
 *
 * ## Hit-testing, and why the anchor is a rectangle
 *
 * The value is Monaco's DOM, not ours, so there is no React trigger to hang a
 * tooltip from. The editor's own mouse events say what is under the pointer —
 * `target.element` carries the feature's class, the same test the run button's
 * click uses — and the tooltip is anchored to a rectangle taken from it.
 *
 * A rectangle rather than the element, because a live value is redrawn every
 * time it changes and the span the pointer entered can leave the document while
 * the tooltip is up. A rectangle taken once stays where the value is.
 *
 * ## A dwell, not a crossing
 *
 * Each show counts against the hint's three, so a pointer passing over a column
 * of values on its way elsewhere must not spend them. The delay is the Base UI
 * tooltip's own default, which is what every other tooltip in the app without a
 * `delay` of its own already waits.
 *
 * ## No hover card over a value
 *
 * Monaco treats a value as the end of its line, and looks up the word before
 * it — so resting on `26.48` opened the whole card for `L:OilInspectionPanel`,
 * every time, on an element a screen shows dozens of. The card is about the
 * name, and the name is right beside it.
 *
 * Monaco has no way to leave injected text out of its hover, so the editor's
 * hover is switched off while the pointer is on a value and back on when it
 * leaves. Turning it off also cancels a card that was about to open. This is
 * permanent, unlike the hints: after the third look, a value shows nothing.
 */

import { useEffect, useState } from "react"

import { Tooltip, TooltipContent } from "@/components/ui/tooltip"
import { hintLeft, noteHintShown, type HintId } from "@/lib/hints"
import { CLASS as LIVE_VALUE } from "@/lib/live-decorations"
import type { monaco } from "@/lib/monaco-setup"

interface Hint {
  id: HintId
  className: string
  text: string
}

const HINTS: Hint[] = [
  { id: "live-value", className: LIVE_VALUE, text: "Live value from the sim" },
]

const DELAY_MS = 600

function hintAt(element: Element | null): { hint: Hint; at: Element } | null {
  for (const hint of HINTS) {
    const at = element?.closest(`.${hint.className}`)
    if (at) return { hint, at }
  }

  return null
}

export function EditorHints({
  editor,
}: {
  editor: monaco.editor.ICodeEditor | null
}) {
  const [shown, setShown] = useState<{ text: string; rect: DOMRect } | null>(
    null
  )

  useEffect(() => {
    if (!editor) return

    /** The hint and line the pointer is waiting on, or is showing. */
    let key: string | null = null
    let timer: number | undefined

    const reset = (): void => {
      window.clearTimeout(timer)
      key = null
      setShown(null)
    }

    /** Whether Monaco's hover is off because the pointer is on a value. */
    let quiet = false
    /** Set once the editor is gone, when its options can no longer be set. */
    let disposed = false

    const setQuiet = (next: boolean): void => {
      if (next === quiet || disposed) return
      quiet = next
      editor.updateOptions({ hover: { enabled: !next } })
    }

    const move = editor.onMouseMove((event) => {
      const found = hintAt(event.target.element)
      // Before anything returns early: this holds for every move, whether or
      // not a hint has shows left.
      setQuiet(found?.hint.id === "live-value")

      const line = event.target.position?.lineNumber
      const next = found && line ? `${found.hint.id}:${line}` : null

      // Still on the same one. A value redrawn under a resting pointer fires
      // nothing, but a pointer moving across its own chip does.
      if (next && next === key) return

      reset()
      if (!found || !next || !hintLeft(found.hint.id)) return

      key = next
      const { clientX, clientY } = event.event.browserEvent
      const { hint } = found

      timer = window.setTimeout(() => {
        // Whatever is under the pointer now, not what it entered: the value
        // may have been redrawn in between.
        const under = hintAt(document.elementFromPoint(clientX, clientY))
        if (under?.hint.id !== hint.id || !hintLeft(hint.id)) return

        noteHintShown(hint.id)
        setShown({ text: hint.text, rect: under.at.getBoundingClientRect() })
      }, DELAY_MS)
    })

    const disposables = [
      move,
      editor.onMouseLeave(() => {
        reset()
        setQuiet(false)
      }),
      editor.onMouseDown(reset),
      editor.onKeyDown(reset),
      // Only a real scroll. A value growing a digit can widen the line and
      // change the scroll width, which is not the rectangle moving.
      editor.onDidScrollChange((event) => {
        if (event.scrollTopChanged || event.scrollLeftChanged) reset()
      }),
      editor.onDidChangeModel(reset),
      editor.onDidDispose(() => {
        disposed = true
      }),
    ]

    return () => {
      for (const disposable of disposables) disposable.dispose()
      reset()
      // This pane is handing over to another editor, or going away. A hover
      // left off here would stay off with nothing left to turn it back on.
      setQuiet(false)
    }
  }, [editor])

  const rect = shown?.rect

  return (
    <Tooltip open={shown !== null}>
      <TooltipContent
        anchor={rect ? { getBoundingClientRect: () => rect } : undefined}
      >
        {shown?.text}
      </TooltipContent>
    </Tooltip>
  )
}
