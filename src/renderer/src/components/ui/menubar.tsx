import type * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { Menubar as MenubarPrimitive } from "@base-ui/react/menubar"

import { Button } from "@/components/ui/button"
import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

/*
 * The menu bar, in the title bar.
 *
 * Drawn by the app rather than by Windows. The header strip *is* the window's
 * title bar, so a native menu would have nowhere to go — and
 * `Menu.setApplicationMenu(null)` stays for the reason `main/index.ts` gives.
 *
 * Only the bar and its triggers are new here. A menu in the bar is the
 * dropdown menu: the same popup, rows and separator, re-exported under these
 * names. So a menu opened from the bar cannot come to look different from one
 * opened by a button, and there is no third copy of the row classes to keep in
 * step with the context menu's.
 */

function Menubar({ className, ...props }: MenubarPrimitive.Props) {
  return (
    <MenubarPrimitive
      data-slot="menubar"
      className={cn("flex items-center", className)}
      {...props}
    />
  )
}

function MenubarMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="menubar-menu" {...props} />
}

/**
 * A ghost button at the default control height — the height of every other
 * control in the header strip, so opening a menu moves nothing. The ghost
 * variant already lights on `aria-expanded`, which is what marks the trigger
 * whose menu is open.
 */
function MenubarTrigger({ ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger
      data-slot="menubar-trigger"
      render={<Button variant="ghost" />}
      {...props}
    />
  )
}

/**
 * Opens below its trigger, lined up with its leading edge.
 *
 * `collisionPadding` is 4 rather than Base UI's 5 because the first trigger
 * sits 4px from the window's edge, and at 5 the popup was pushed a pixel off
 * the trigger it hangs from.
 */
function MenubarContent({
  align = "start",
  sideOffset = 4,
  collisionPadding = 4,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="menubar-content"
      align={align}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      {...props}
    />
  )
}

export {
  Menubar,
  MenubarMenu,
  MenubarTrigger,
  MenubarContent,
  DropdownMenuGroup as MenubarGroup,
  DropdownMenuItem as MenubarItem,
  DropdownMenuLabel as MenubarLabel,
  DropdownMenuSeparator as MenubarSeparator,
  DropdownMenuShortcut as MenubarShortcut,
}
