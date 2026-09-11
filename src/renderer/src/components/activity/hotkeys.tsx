import { useState } from "react"

import { Keyboard } from "lucide-react"

import type { HotkeyAction } from "@shared/activity"
import type { Hotkeys as Bindings } from "@shared/types"

import { HotkeysDialog, Keys } from "@/components/settings/groups/hotkeys"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

// Re-exported because the empty state teaches the same binding, and two
// renderings of one keystroke is one of them being wrong eventually. The
// component itself lives with the binding UI in settings/groups/hotkeys.
export { Keys }

const LABELS: Record<HotkeyAction, string> = {
  capture: "Capture",
  arm: "Arm auto-capture",
}

/**
 * The keys, and the one thing they cannot promise.
 *
 * `globalShortcut` only sees clashes with other applications' `RegisterHotKey`
 * bindings. MSFS reads its keybindings through raw input, so a key bound in the
 * simulator registers cleanly here and then quietly does two things at once.
 * 08-marks asks for that to be stated rather than discovered, and for it to
 * live in this header rather than in settings.
 *
 * ## An icon, a tooltip, and a dialog — in that order
 *
 * It was a text label reading `Ctrl+Alt+S`, or `unbound` in amber when Windows
 * refused it. That spends a header on something read once and then never again,
 * and says nothing about the second key at all.
 *
 * The state that has to survive without hovering is the *refusal*, because
 * nothing else in the app will ever mention it — so the icon carries that in
 * its colour and the rest goes behind a pointer. A tooltip rather than a
 * popover: the click opens the dialog, and a popover on hover would be either a
 * heavier tooltip or a fight with the click.
 *
 * The dialog itself is the shared binding group — the same body Settings shows
 * under "Radar hotkeys" — in a focused wrapper, so the panel's shortcut to it
 * stays one click while the group has exactly one implementation.
 */
export function HotkeyButton({
  hotkeys,
  onChange,
}: {
  hotkeys: Bindings | null
  onChange: (next: Bindings) => void
}) {
  const [open, setOpen] = useState(false)

  const refused = hotkeys
    ? (["capture", "arm"] as const).filter((action) => !hotkeys[action].ok)
    : []

  return (
    <>
      <Tooltip>
        {/* No delay: this is a status mark as much as a control, and a state
            you have to wait for is a state you do not check. */}
        <TooltipTrigger
          delay={0}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Hotkeys"
              onClick={() => setOpen(true)}
            >
              <Keyboard
                className={cn(
                  refused.length > 0 && "text-amber-600 dark:text-amber-400"
                )}
              />
            </Button>
          }
        />
        <TooltipContent side="bottom" align="end" className="w-60 p-0">
          <p className="border-b border-foreground/10 px-2.5 py-1.5 font-medium">
            Radar hotkeys
          </p>

          <div className="flex flex-col gap-1.5 px-2.5 py-2">
            {(["capture", "arm"] as const).map((action) => (
              <div key={action} className="flex items-center gap-2">
                <span className="text-muted-foreground">{LABELS[action]}</span>
                <span className="ml-auto shrink-0">
                  {hotkeys?.[action].ok ? (
                    <Keys accelerator={hotkeys[action].accelerator} />
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400">
                      unbound
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>

          <p className="border-t border-foreground/10 px-2.5 py-1.5 text-muted-foreground">
            {refused.length > 0
              ? "Windows refused a binding — another application already holds it."
              : "MSFS bindings cannot be detected. If the simulator uses one of these, it will do both."}
          </p>
        </TooltipContent>
      </Tooltip>

      <HotkeysDialog
        open={open}
        onOpenChange={setOpen}
        hotkeys={hotkeys}
        onChange={onChange}
      />
    </>
  )
}
