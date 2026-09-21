import { createContext, useContext } from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import type { VariantProps } from "class-variance-authority"

import { toggleVariants } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"

/**
 * Toggles joined into one control, for a choice between a few modes.
 *
 * Every item is a `Toggle` in all but name — the same variants, so a lit
 * segment and a lit toggle beside it are the same colour, edge and fill. The
 * group sets size and tone once and the items read them, so one segment cannot
 * end up a size or a feature away from its neighbours.
 *
 * **Joined, not spaced.** The items overlap by their 1px border, so two
 * neighbours share one line rather than drawing two. The lit item sits above
 * its neighbours, or the unlit border beside it would cover half its edge.
 */
type Shared = Pick<VariantProps<typeof toggleVariants>, "size" | "tone">

const GroupContext = createContext<Shared>({})

function ToggleGroup({
  className,
  size,
  tone,
  children,
  ...props
}: ToggleGroupPrimitive.Props & Shared) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      // The corner radius lives here so the end items can inherit it: `xs`
      // toggles are `rounded-sm`, every other size `rounded-md`.
      className={cn(
        "flex items-center",
        size === "xs" ? "rounded-sm" : "rounded-md",
        className
      )}
      {...props}
    >
      <GroupContext.Provider value={{ size, tone }}>
        {children}
      </GroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

/**
 * One segment. `tone` overrides the group's for this item alone, for a choice
 * whose lit state should not claim the feature's colour: Radar's Off is
 * selected, but green there means capturing.
 */
function ToggleGroupItem({
  className,
  tone: own,
  ...props
}: TogglePrimitive.Props & Pick<Shared, "tone">) {
  const group = useContext(GroupContext)
  const size = group.size
  const tone = own ?? group.tone

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        toggleVariants({ size, tone }),
        "-ml-px rounded-none first:ml-0 first:rounded-l-[inherit] last:rounded-r-[inherit] aria-pressed:z-10",
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
