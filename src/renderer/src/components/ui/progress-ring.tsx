"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "@/lib/utils"

/**
 * A circular progress indicator the size of an icon.
 *
 * Drawn in a 24×24 viewBox at stroke width 2 — Lucide's own geometry — so that
 * it matches the weight of the glyph it stands in for by construction rather
 * than by eye. Give it the same size class the icon would have had.
 *
 * Colour comes from the tone, so a `tone-*` class on any ancestor dresses it:
 * the arc is `--tone` and the track is `--tone-border`, which is what that
 * token is for — the outline of a control at rest.
 *
 * **The fill transitions, and that is deliberate.** `docs/ui.md` forbids
 * `transition-*` because a transition puts time between an act and its answer;
 * a download's progress is neither an act nor an answer, it is continuous data,
 * and stepping it would make the ring lag its own numbers in a way that reads
 * as jitter. Nothing else here moves.
 *
 * Pass `value: null` for work whose size is not known. That spins, which is the
 * one motion `ui.md` has always allowed, and is the same fallback the app uses
 * in eight other places.
 */

const RADIUS = 10
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Enough of the ring to read as a moving arc rather than as a full circle. */
const INDETERMINATE_ARC = CIRCUMFERENCE * 0.25

interface ProgressRingProps extends ProgressPrimitive.Root.Props {
  /** 0–100, or null when the total is not known. */
  value: number | null
}

function ProgressRing({ className, value, ...props }: ProgressRingProps) {
  const known = value !== null

  return (
    <ProgressPrimitive.Root
      data-slot="progress-ring"
      value={value}
      className={cn("size-3.5 shrink-0", className)}
      {...props}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        className={cn("size-full", !known && "animate-spin")}
      >
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          stroke="var(--tone-border)"
          strokeWidth="2"
        />
        <circle
          cx="12"
          cy="12"
          r={RADIUS}
          stroke="var(--tone)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={
            known ? CIRCUMFERENCE : `${INDETERMINATE_ARC} ${CIRCUMFERENCE}`
          }
          strokeDashoffset={
            known ? CIRCUMFERENCE * (1 - Math.min(100, Math.max(0, value)) / 100) : 0
          }
          // Starts at twelve o'clock rather than three, which is where a ring
          // is read from.
          transform="rotate(-90 12 12)"
          className={cn(known && "transition-[stroke-dashoffset] duration-200 ease-linear")}
        />
      </svg>
    </ProgressPrimitive.Root>
  )
}

export { ProgressRing }
