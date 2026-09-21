import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

/*
 * `pt-px pb-[3px]` rather than `py-0.5`: the same 4px of vertical padding, a
 * pixel higher. Chromium draws an input's text about a pixel below where a
 * line centred in the same box would sit, so the placeholder in a search field
 * read low against the magnifier beside it. Labels elsewhere centre on their
 * capitals (see `text-trim`), and an input cannot be trimmed, so its padding
 * carries the pixel instead. The box keeps its height.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-7 w-full min-w-0 rounded-md border control-states border-input bg-input/20 px-2 pt-px pb-[3px] text-xs/relaxed outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs/relaxed file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { Input }
