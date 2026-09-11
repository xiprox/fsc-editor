import { Check } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"

const OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const

type ThemeChoice = (typeof OPTIONS)[number]["value"]

/**
 * The theme, chosen from previews rather than words.
 *
 * Each card is a miniature of the workbench — sidebar, editor lines — painted
 * with the *real* tokens: the card scopes a `light`/`dark` class and the
 * palette rebinds for its subtree (see the note above the token blocks in
 * `index.css`). There is no copied colour to go stale; a palette change
 * changes the previews with it. The System card is both palettes split
 * corner to corner, which is what "whichever the OS says" looks like.
 */
export function AppearanceGroup() {
  const { theme, setTheme } = useTheme()

  return (
    <div role="radiogroup" aria-label="Theme" className="flex gap-3">
      {OPTIONS.map((option) => (
        <ThemeCard
          key={option.value}
          value={option.value}
          label={option.label}
          selected={theme === option.value}
          onSelect={() => setTheme(option.value)}
        />
      ))}
    </div>
  )
}

function ThemeCard({
  value,
  label,
  selected,
  onSelect,
}: {
  value: ThemeChoice
  label: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className="group/theme flex flex-1 flex-col items-stretch gap-1.5 rounded-md outline-none control-states"
    >
      {/*
        The border is always drawn and only recolours — selection must not move
        the box (docs/ui.md). The check badge is the second signal, for the
        moment two borders sit side by side and "which blue-grey is the lit
        one" becomes a real question.
      */}
      <span
        className={cn(
          "relative block overflow-hidden rounded-md border",
          selected
            ? "border-primary"
            : "border-input group-hover/theme:border-ring"
        )}
      >
        {value === "system" ? (
          <>
            <MiniApp mode="light" />
            <MiniApp
              mode="dark"
              className="absolute inset-0"
              // The bottom-right triangle. A diagonal rather than a half-and-
              // half split, so it reads as one window under two lights instead
              // of two windows.
              style={{ clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
            />
          </>
        ) : (
          <MiniApp mode={value} />
        )}

        {selected && (
          <span
            aria-hidden
            className="absolute right-1 bottom-1 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground"
          >
            <Check className="size-3" />
          </span>
        )}
      </span>

      <span
        className={cn(
          "text-center text-[11px]",
          selected ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </button>
  )
}

/**
 * The workbench at postage-stamp size: a sidebar of rows, an editor with a
 * couple of syntax-coloured lines. Every colour is a token, resolved inside
 * the `mode` class this element carries.
 */
function MiniApp({
  mode,
  className,
  style,
}: {
  mode: "light" | "dark"
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <span
      aria-hidden
      className={cn(mode, "flex h-16 w-full bg-background", className)}
      style={style}
    >
      <span className="flex w-1/4 shrink-0 flex-col gap-1 border-r border-border bg-sidebar p-1.5">
        <span className="h-1 w-full rounded-full bg-foreground/25" />
        <span className="h-1 w-3/4 rounded-full bg-foreground/15" />
        <span className="h-1 w-full rounded-full bg-foreground/15" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1 p-1.5">
        <span className="h-1 w-1/2 rounded-full bg-[var(--syntax-block)]" />
        <span className="ml-1.5 h-1 w-2/3 rounded-full bg-foreground/20" />
        <span className="ml-1.5 h-1 w-1/2 rounded-full bg-[var(--syntax-string)]" />
        <span className="h-1 w-2/5 rounded-full bg-foreground/20" />
      </span>
    </span>
  )
}
