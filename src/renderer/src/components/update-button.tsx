import { useState } from "react"

import { Download } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ProgressRing } from "@/components/ui/progress-ring"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

/**
 * The update control, in the title bar beside the app name.
 *
 * One slot with two appearances in the same box, and most of the time neither
 * of them: an update downloads silently, and this says nothing until restarting
 * into it would take two seconds. See docs/pipeline/06-updater.md.
 *
 * - **Downloading** — a progress ring, and not a button. No hover, no focus
 *   ring, nothing to press. That is what makes a click during the download
 *   impossible rather than something that has to be guarded, and it means
 *   nothing in this slot is focusable until there is something to do.
 * - **Ready** — an icon button that needs two clicks. The first reveals what
 *   the second will do, because a button that does not fire on the first click
 *   has to say so or it reads as broken.
 *
 * Hidden entirely while a Remote Connect session is live. Restarting would end
 * that session for the other pilot — `session.resume` never leaves this process
 * — and it can leave the two sides on different builds, which the other pilot
 * has no way to see coming. The whole slot goes, not just the button: a ring
 * that runs to completion and then produces nothing is worse than one that
 * never appeared.
 *
 * Unsaved work is deliberately not a gate. Drafts are restored against the file
 * they were taken from, so a restart loses nothing and must not prompt.
 */
export function UpdateButton() {
  const update = useStore((state) => state.update)
  const sharing = useStore((state) => state.remote.phase !== "idle")

  if (sharing || update.kind === "idle") return null

  if (update.kind === "downloading") {
    return (
      <div className="tone-update no-drag flex size-7 items-center justify-center">
        <ProgressRing value={update.percent} aria-label="Downloading an update" />
      </div>
    )
  }

  // Keyed on the version, and a separate component on purpose — both so that
  // the confirmation below cannot outlive the thing it confirms. Returning
  // null from a component does not unmount it, so a half-made confirmation
  // held up here would survive the control being hidden by a Remote Connect
  // session and come back armed, one click from a restart nobody asked for.
  return <ReadyButton key={update.version} version={update.version} />
}

/**
 * The confirmation, and the only place that state exists.
 *
 * React owns every way of disarming it. Leaving `ready` unmounts this, a
 * session starting unmounts it, and a different version replaces it through
 * the key — so there is no reset to write and none to forget.
 */
function ReadyButton({ version }: { version: string }) {
  const [armed, setArmed] = useState(false)

  return (
    <Button
      variant="ghost"
      size="icon"
      tone="update"
      // `size="icon"` is a 28px square, and the label has to appear without
      // changing the height of anything. Widening it and leaving the height
      // alone is the whole override — a `sm` control would be 24px and the
      // strip would jump by four.
      className={cn("no-drag", armed && "w-auto gap-1 px-2")}
      aria-label={armed ? undefined : `Update to version ${version} and restart`}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) {
          setArmed(true)
          return
        }

        void window.api.installUpdate()
      }}
    >
      <Download />
      {armed && <span>Click again to update and restart</span>}
    </Button>
  )
}
