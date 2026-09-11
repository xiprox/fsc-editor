import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Every button in the app, in one of five palettes.
 *
 * The rules this file obeys rather than owns — no motion, the shared
 * measurements, what a resting control looks like, why the focus ring is
 * neutral — are in `docs/ui.md` and in `index.css`. Only what is specific to
 * this component is written here.
 *
 * **The variants are written against `--tone-*`, never against a feature's own
 * tokens.** `tone` rebinds those properties; the essay above the `tone-*`
 * utilities in `index.css` says what each role is for. That is what makes a
 * Radar control and a Remote Connect control the same button in a different
 * palette rather than two hand-dressed buttons that drift apart — which is
 * exactly what they had done before this existed.
 */
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-xs/relaxed font-medium whitespace-nowrap outline-none select-none control-states active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-default aria-disabled:opacity-50 control-icons",
  {
    variants: {
      variant: {
        // The one filled variant. `--tone-on` rather than a foreground token,
        // because this is text sitting *on* the saturated value — a contract
        // every feature palette holds and the neutral one satisfies with
        // `--primary-foreground`.
        default:
          "bg-[var(--tone)] text-[color:var(--tone-on)] hover:bg-[color-mix(in_oklab,var(--tone)_80%,transparent)]",
        outline:
          "border-[color:var(--tone-border)] text-[color:var(--tone-foreground)] not-aria-expanded:bg-input/20 hover:bg-[var(--tone-wash)] aria-expanded:bg-[var(--tone-surface)] dark:not-aria-expanded:bg-input/30",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "text-[color:var(--tone-foreground)] hover:bg-[var(--tone-wash)] aria-expanded:bg-[var(--tone-surface)]",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline underline-offset-2 hover:underline-offset-4",
        // A word that acts, where a box around it would be more furniture than
        // the action deserves — Cancel under a primary, Back out of a code
        // field, Select none under a list. It is a real button with a real hit
        // target and a real focus ring; what it gives up is the fill.
        quiet:
          "font-normal text-muted-foreground hover:text-[color:var(--tone-foreground)]",
      },
      size: {
        default: "control-md text-xs/relaxed",
        xs: "control-xs rounded-sm text-[0.625rem]",
        sm: "control-sm text-xs/relaxed",
        lg: "control-lg text-xs/relaxed",
        icon: "size-7 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-2.5",
        "icon-sm": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-lg": "size-8 [&_svg:not([class*='size-'])]:size-4",
      },
      /**
       * Which feature is talking. `neutral` is the app itself and needs no
       * class — the neutral bindings live on `:root`, where dark mode gets to
       * differ from light in the two roles that should.
       *
       * `destructive` is the one that overlaps a variant name, and the two do
       * different jobs: the variant is a red button on the page's own ground,
       * the tone is any variant put into red because the surface under it is
       * already red. A bar's buttons want the tone.
       */
      tone: {
        neutral: "",
        remote: "tone-remote",
        radar: "tone-radar",
        sim: "tone-sim",
        warning: "tone-warning",
        update: "tone-update",
        destructive: "tone-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
      tone: "neutral",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  tone = "neutral",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, tone, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
