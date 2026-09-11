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
 */
export function SearchInput({
  value,
  onValueChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: string
  onValueChange: (value: string) => void
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />

      <Input
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        spellCheck={false}
        autoComplete="off"
        className={cn("h-7 rounded-sm pr-7 pl-7", className)}
        {...props}
      />

      {value !== "" && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Clear the filter"
          onClick={() => onValueChange("")}
          className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
        >
          <X />
        </Button>
      )}
    </div>
  )
}
