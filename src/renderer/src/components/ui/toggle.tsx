import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * A control that stays lit while it is on.
 *
 * The shared rules — the resting skin every control wears, a feature's colour
 * meaning *on* and nothing else, nothing moving and nothing drawn outside the
 * box — are in `docs/ui.md`. What is specific to this file:
 *
 * **The same box as `Button`, deliberately.** A filter chip and the action
 * beside it sit in one row all day, and a couple of pixels between them reads
 * as sloppiness long before anyone works out what they are looking at. The
 * focus and invalid states now come from `control-states`, so those cannot
 * drift. The *sizes* below are still kept in step with `button.tsx` by hand,
 * and have already drifted once — see the drift list at the end of
 * `docs/ui.md`.
 *
 * **On changes three things at once**: the outline steps up to `--tone-edge`,
 * the fill arrives, and the label goes from muted to the tone's foreground.
 *
 * The outline is the load-bearing one. A resting border only has to be *found*,
 * but a lit one has to be *read* across a row — and on the neutral palette
 * `--tone-border` **is** `--border`, so a lit chip and an unlit one had the same
 * outline and only the fill and the label to tell them apart. The fill cannot
 * carry it either, because neutral has exactly one (`--muted` *is* `--accent` *is*
 * `--secondary` here), which left a hovered chip and a *selected* chip as
 * the same rectangle. `--tone-edge` exists for that; see `index.css`.
 *
 * **Being on survives the pointer.** Hover on a lit toggle keeps the lit fill
 * rather than reverting to the neutral hover — a mode that drops its colour
 * under the cursor looks like it switched off at the exact moment somebody
 * reached for it.
 *
 * State is read off `aria-pressed`, which Base UI emits and which a hand-rolled
 * pressed control can set too, so both spellings land on one set of rules.
 */
const toggleVariants = cva(
  "group/toggle inline-flex shrink-0 items-center justify-center rounded-md border border-input bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap text-muted-foreground outline-none select-none not-aria-pressed:bg-input/20 hover:bg-muted control-states active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50 aria-pressed:border-[color:var(--tone-edge)] aria-pressed:text-[color:var(--tone-foreground)] dark:not-aria-pressed:bg-input/30 dark:not-aria-pressed:hover:bg-muted/60 control-icons",
  {
    variants: {
      variant: {
        /** On is the feature's surface — a tint, for a mode or a filter. */
        default:
          "aria-pressed:bg-[var(--tone-surface)] aria-pressed:hover:bg-[var(--tone-surface)]",
        /**
         * On is the saturated value itself, carrying `--tone-on` as text.
         *
         * For the one kind of state a tint is too quiet for: something that
         * keeps acting on your files while it is on. Mirroring is the only one
         * of those so far, and the palettes were built to hold this — see the
         * `--tone-on` contract in `index.css`.
         */
        solid:
          "aria-pressed:border-[color:var(--tone)] aria-pressed:bg-[var(--tone)] aria-pressed:text-[color:var(--tone-on)] aria-pressed:hover:bg-[var(--tone)]",
      },
      size: {
        default: "control-md min-w-7",
        xs: "control-xs min-w-5 rounded-sm text-[0.625rem]",
        sm: "control-sm min-w-6 text-xs/relaxed",
        lg: "control-lg min-w-8",
      },
      /** Which feature is talking, once it is on — see `buttonVariants`. */
      tone: {
        neutral: "",
        remote: "tone-remote",
        radar: "tone-radar",
        sim: "tone-sim",
        warning: "tone-warning",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      tone: "neutral",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  tone = "neutral",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, tone, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
