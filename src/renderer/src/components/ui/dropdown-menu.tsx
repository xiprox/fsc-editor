import type * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"

import { cn } from "@/lib/utils"

/*
 * A menu opened by a button, where `context-menu.tsx` is the same menu opened
 * by a right-click. The popup, items and separator carry the context menu's
 * classes exactly, so a row offering both shows one menu either way.
 */

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
}

function DropdownMenuContent({
  className,
  align = "end",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  collisionPadding,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset" | "collisionPadding"
  >) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            "z-50 max-h-(--available-height) min-w-32 origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
            className
          )}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

/**
 * The palettes a menu row can be put in. Only what a row has needed so far —
 * adding one is a word here and nothing else, since the row is written against
 * `--tone-*` like every other control.
 */
const ITEM_TONES = {
  update: "tone-update",
} as const

/**
 * Highlighting an item repaints everything inside it in the highlight colour,
 * so an icon or a muted hint does not sit dark on the lit row. An element that
 * carries meaning in its own colour opts out with `data-keep-color` — a `B:`
 * name keeps the editor's syntax colours while the pointer is on it.
 *
 * A toned row is the exception to that repaint: it is in its feature's colour
 * at rest and stays in it when highlighted, taking the tone's surface rather
 * than the neutral accent. The context menu has no toned rows yet, which is the
 * one place these rows and its rows differ.
 *
 * Its label is `--tone`, the saturated value, not `--tone-foreground`. A toned
 * row is the one a mark elsewhere points at — the icon on the app menu — and it
 * is found by matching that mark's colour. The paler foreground also read
 * dimmer than the white rows around it, which made the row that mattered most
 * look like the one that mattered least.
 */
function DropdownMenuItem({
  className,
  variant = "default",
  tone,
  ...props
}: MenuPrimitive.Item.Props & {
  variant?: "default" | "destructive"
  tone?: keyof typeof ITEM_TONES
}) {
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-variant={variant}
      data-tone={tone}
      className={cn(
        "group/dropdown-menu-item control-icons relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2 py-1 text-xs/relaxed outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:not-data-tone:focus:**:not-data-keep-color:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 data-tone:text-[color:var(--tone)] data-tone:focus:bg-[var(--tone-surface)] data-tone:focus:text-[color:var(--tone)] data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg:not([class*='size-'])]:size-3.5 data-[variant=destructive]:*:[svg]:text-destructive",
        tone && ITEM_TONES[tone],
        className
      )}
      {...props}
    />
  )
}

/** A key beside a row, in the context menu's own style. */
function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-[0.625rem] tracking-widest text-muted-foreground group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

/** A heading inside a group. Base UI only renders one inside a `Group`. */
function DropdownMenuLabel({
  className,
  ...props
}: MenuPrimitive.GroupLabel.Props) {
  return (
    <MenuPrimitive.GroupLabel
      data-slot="dropdown-menu-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border/50", className)}
      {...props}
    />
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
}
