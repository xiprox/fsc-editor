import { useEffect, useRef, useState } from "react"

import {
  CODE_ALPHABET,
  CODE_GROUP,
  CODE_LENGTH,
  parseCode,
} from "@shared/remote-connect"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/**
 * The invite code, one character per cell.
 *
 * A single text field would need a mask, would fight the caret, and would give
 * no clue how long the code is. Cells answer all three by being visible.
 *
 * Codes get read aloud and pasted out of chat messages, so what counts as valid
 * input is generous: lowercase, the display hyphen, and any surrounding
 * whitespace are all accepted, and anything outside the alphabet is dropped
 * rather than rejected.
 */
export function CodeInput({
  onComplete,
  disabled,
}: {
  onComplete: (code: string) => void
  disabled?: boolean
}) {
  const [chars, setChars] = useState<string[]>(() =>
    Array(CODE_LENGTH).fill("")
  )
  /** Whether what is in the cells arrived from the clipboard rather than typed. */
  const [pasted, setPasted] = useState(false)
  const cells = useRef<Array<HTMLInputElement | null>>([])

  const focus = (index: number) =>
    cells.current[Math.min(Math.max(index, 0), CODE_LENGTH - 1)]?.focus()

  /** Writes from `at` onwards and reports the code once every cell is filled. */
  const fill = (at: number, text: string) => {
    const usable = [...text.toUpperCase()].filter((char) =>
      CODE_ALPHABET.includes(char)
    )
    if (!usable.length) return

    const next = [...chars]
    let cursor = at

    for (const char of usable) {
      if (cursor >= CODE_LENGTH) break
      next[cursor] = char
      cursor++
    }

    setChars(next)
    setPasted(false)
    focus(cursor)

    // Submitting the moment the last character lands is the whole point of
    // knowing the length: there is nothing further to decide, so asking for a
    // second confirming click would only be ceremony.
    if (next.every(Boolean)) onComplete(next.join(""))
  }

  /**
   * The field takes focus, and takes a code off the clipboard if one is there.
   *
   * Getting here means clicking "Connect with a code", and a code arrives by
   * being sent to you — so the overwhelmingly likely next act is a paste of
   * something already copied. Doing it up front turns that into a glance.
   *
   * Filled but deliberately not submitted. Everything else in this field
   * submits on the last character because the last character was typed by the
   * person sitting there; this was not, and joining a stranger's session
   * because their code happened to be on the clipboard is not a thing to do
   * without being asked. Enter is what asks.
   */
  useEffect(() => {
    if (disabled) return

    focus(0)

    let cancelled = false

    void navigator.clipboard
      .readText()
      .then((text) => {
        const code = parseCode(text)
        if (cancelled || !code) return

        setChars([...code])
        setPasted(true)
        focus(CODE_LENGTH - 1)
      })
      // No clipboard permission, or nothing readable on it. The field is
      // focused either way, which is the part that was worth doing.
      .catch(() => {})

    return () => {
      cancelled = true
    }
    // Once, on the way in: a later re-read would fight whatever has been typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const submit = () => {
    const code = chars.join("")
    if (code.length === CODE_LENGTH && chars.every(Boolean)) onComplete(code)
  }

  const onKeyDown = (index: number, event: React.KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault()
      submit()
      return
    }

    if (event.key === "Backspace") {
      event.preventDefault()

      const next = [...chars]
      // Backspace in an empty cell reaches back to the previous one, so holding
      // it clears the whole code the way it would in a single field.
      if (next[index]) next[index] = ""
      else if (index > 0) next[index - 1] = ""

      setChars(next)
      setPasted(false)
      focus(chars[index] ? index : index - 1)
      return
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault()
      focus(index - 1)
    }

    if (event.key === "ArrowRight") {
      event.preventDefault()
      focus(index + 1)
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className="flex items-center gap-1"
        role="group"
        aria-label={`Invite code, ${CODE_LENGTH} characters`}
      >
        {chars.map((char, index) => (
          <div key={index} className="flex items-center gap-1">
            {index === CODE_GROUP && (
              <span
                aria-hidden
                className="w-1.5 text-center text-muted-foreground/50 select-none"
              >
                –
              </span>
            )}

            <input
              ref={(element) => {
                cells.current[index] = element
              }}
              value={char}
              disabled={disabled}
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              aria-label={`Character ${index + 1}`}
              onChange={(event) => fill(index, event.target.value)}
              onKeyDown={(event) => onKeyDown(index, event)}
              onPaste={(event) => {
                event.preventDefault()
                fill(0, event.clipboardData.getData("text"))
              }}
              onFocus={(event) => event.target.select()}
              // `focus:`, not `focus-visible:` — a cell you are typing into
              // has to say so however you got there. The geometry is the app's
              // ring exactly; only the hue is the feature's, because at this
              // moment the field *is* the feature.
              className={cn(
                "size-8 rounded-sm border text-center font-mono text-[15px] uppercase tone-remote outline-none",
                "focus:border-[color:var(--tone)] focus:ring-2 focus:ring-[color-mix(in_oklab,var(--tone)_30%,transparent)]",
                char
                  ? "border-[color:var(--tone-border)] bg-[var(--tone-surface)] text-[color:var(--tone-foreground)]"
                  : "border-border bg-background text-foreground",
                disabled && "opacity-50"
              )}
            />
          </div>
        ))}
      </div>

      {/*
        The parallel of "Host a session" on the screen before this one, so it
        is the same neutral primary rather than a second kind of go-button. It
        exists only for a code that arrived from the clipboard — a typed one
        submits on its last character, because that character was pressed by
        the person sitting here and this one was not.
      */}
      {pasted && (
        <Button size="sm" onClick={submit}>
          Connect
        </Button>
      )}
    </div>
  )
}
