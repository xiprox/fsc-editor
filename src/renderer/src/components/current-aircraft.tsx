import { ArrowRight, Plane, Plus } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useAircraftProfile } from "@/lib/aircraft-profile"
import { useStore } from "@/store"

/**
 * What the simulator has loaded, and the one thing you would want to do about
 * it.
 *
 * Inside Profiles rather than beside it, because it is a *row of that list* —
 * the one the sim is asking for — and hiding the list should take it along.
 * Visually it is almost its own panel, sitting between the tree and the footer,
 * which is what the sim tint and the top border are for: the aircraft is the
 * simulator talking, and everything in this app that is wears `--sim`.
 *
 * **Absent when there is nothing to say.** No sim, no aircraft, no box. The
 * alternative is a permanent strip reading "no aircraft", which is a nag about
 * the normal state of a profile editor — 04-connection's rule, and the same one
 * that keeps the footer chip quiet when the sim is not running.
 */
export function CurrentAircraft() {
  const activePath = useStore((state) => state.activePath)
  const openLocal = useStore((state) => state.openLocal)
  const createProfile = useStore((state) => state.createProfile)

  const { aircraft, relPath } = useAircraftProfile()

  if (!aircraft) return null

  const label = relPath ? "Open profile" : "Create profile"

  return (
    <div className="flex shrink-0 items-center gap-1.5 border-t border-sim-border/80 bg-sim/5 py-1.5 pr-1 pl-2 text-sim-foreground">
      <Plane className="size-3.5 shrink-0" />
      <span className="truncate text-[13px] font-medium" title={aircraft}>
        {aircraft}
      </span>

      {/*
        Disabled rather than hidden on the profile you are already looking at.
        This sits directly above the footer with a scrolling list above it, so a
        control that came and went would move the seam on every tab change.

        Full-strength `--sim` rather than the row's `--sim-foreground`: the name
        beside it is a readout and this is the one thing here to press, so it is
        the only part of the row that should catch the eye — which is also why
        its glyph is a step *larger* than the plane beside it rather than the
        step smaller the default icon button would have made it. No delay on
        the tooltip, because an icon whose label you have to wait for is an icon
        you guess at instead.
      */}
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto text-sim hover:bg-sim/10 hover:text-sim"
              aria-label={label}
              disabled={relPath !== null && relPath === activePath}
              onClick={() =>
                void (relPath ? openLocal(relPath) : createProfile(aircraft))
              }
            >
              {relPath ? (
                <ArrowRight className="size-4" />
              ) : (
                <Plus className="size-4" />
              )}
            </Button>
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </div>
  )
}
