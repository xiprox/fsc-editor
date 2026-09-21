import * as React from "react"

import { Search, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

/**
 * A filter box, with the glyph and the clear it always turns out to need.
 *
 * There were three of these before this file existed — the remote file list,
 * the share picker, the Variables panel — written out longhand each time, and
 * they had already stopped agreeing: two of them drew the icon at one inset and
 * the third at another, one wrapped the input in a bordered box and put a bare
 * field inside it, and only one had a way to empty itself. All three are the
 * same control, so it is one control now.
 *
 * **Two boxes, not one.** `top-1/2` centres against whatever is `relative`, so
 * the positioning wrapper has to be the input's own box — hang the row's
 * padding on it and the icon centres against the input *plus* that padding, and
 * sits half of it low every single time.
 *
 * **The clear appears, and nothing moves.** It occupies a reserved slot at the
 * trailing edge, so the text does not reflow the moment a first character is
 * typed. There is no fade: this app does not animate, and a control you can see
 * arriving is one you can hit sooner.
 *
 * **A token, when the caller has one.** `token` is drawn as a pill between the
 * glyph and the text — the Variables panel's namespace, so far. It is not part
 * of `value`: the caller owns both, and decides when text becomes a token.
 * Backspace with the caret at the start removes it, the way a pill in any
 * token field goes, and the clear empties both.
 */
export function SearchInput({
  value,
  onValueChange,
  token,
  onTokenRemove,
  onClear,
  inputRef,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string
  onValueChange: (value: string) => void
  token?: React.ReactNode
  onTokenRemove?: () => void
  /** What the clear does, when it should empty more than `value`. */
  onClear?: () => void
  inputRef?: React.Ref<HTMLInputElement>
}) {
  const pill = React.useRef<HTMLSpanElement>(null)
  // The text starts after the pill, whatever its width. Measured rather than
  // assumed, so a wider token cannot slide under the caret.
  const [inset, setInset] = React.useState<number | null>(null)

  React.useLayoutEffect(() => {
    setInset(token && pill.current ? pill.current.offsetWidth : null)
  }, [token])

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />

      {/*
        The pill centres on the field, like the magnifier and the typed text:
        its label is trimmed to its capitals (see `text-trim`), so centring its
        box centres the letters. A baseline shared with the placeholder was
        tried and read low — the pill's capitals are smaller than the text's.
      */}
      {token && (
        <span
          ref={pill}
          className="pointer-events-none absolute top-1/2 left-7 flex -translate-y-1/2"
        >
          {token}
        </span>
      )}

      <Input
        ref={inputRef}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          const input = event.currentTarget
          if (
            token &&
            onTokenRemove &&
            event.key === "Backspace" &&
            input.selectionStart === 0 &&
            input.selectionEnd === 0
          ) {
            event.preventDefault()
            onTokenRemove()
          }
        }}
        spellCheck={false}
        autoComplete="off"
        // `block`: an input is inline by default, so it sat on a line box in
        // the wrapper — half a pixel down and the wrapper 28.5px tall — and
        // the glyph and the pill, centred on the wrapper, were centred on a
        // box that was not the field.
        className={cn("block h-7 rounded-sm pr-7 pl-7", className)}
        style={inset !== null ? { paddingLeft: 28 + inset + 4 } : undefined}
        {...props}
      />

      {(value !== "" || token) && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Clear the filter"
          onClick={() => (onClear ? onClear() : onValueChange(""))}
          className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
        >
          <X />
        </Button>
      )}
    </div>
  )
}
