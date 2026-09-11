import {
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react"

import { Hammer, LoaderCircle, Play, RotateCw, Square } from "lucide-react"

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

import type { FscMode } from "@shared/types"

/**
 * The title bar's FS Copilot launch island: a label, normal mode, dev mode,
 * and — only while something is running — stop.
 *
 * **A deliberate exception to the UI kit**, like `rail.tsx`: these are raw
 * `<button>`s carrying bare glyphs, not `Button`s. The island is read the way
 * IDEs have taught — green to go, red to stop, in the island's own `--fsc-*`
 * tokens — which inverts the kit's "a feature's colour means the thing is on":
 * here colour is the *invitation*, boxes and borders would only dilute it, and
 * the glyphs are a step larger than a control of this height would allow. The
 * shared focus ring still applies (`control-states`), because the keyboard is
 * about the app, not the island.
 *
 * **Each mode button owns its mode.** Clicking one always ends with FS Copilot
 * running in that mode — a launch when nothing is running, a restart when that
 * mode is (the restart arrow appears under the cursor; the tooltip says
 * which), a switch when the other one is. Main makes all three the same
 * stop-everything-start-this operation, so the buttons never have to say which
 * they mean. Stop appears rather than enabling; the island is centered, so the
 * shift is half a glyph either side.
 *
 * **A workspace without an install keeps the island, disabled** — glyphs at
 * half opacity with a tooltip naming what is missing teach the feature's
 * existence, the same pitch the setup screen makes in words.
 *
 * Centered on the window; the header is a drag region, so the island opts back
 * out with `no-drag`.
 */
export function FscLaunch() {
  const workspace = useStore((state) => state.workspace)
  const fsc = useStore((state) => state.fsc)

  /**
   * Which action is in flight. Local to the buttons because it is the buttons'
   * own state: main's `FscState` reports what is running, and "stopping" or
   * "launching" is a fact about the click, not the process list.
   */
  const [pending, setPending] = useState<FscMode | "stop" | null>(null)

  const available = Boolean(workspace?.installRoot)
  const running = {
    normal: fsc.instances.some((instance) => instance.mode === "normal"),
    dev: fsc.instances.some((instance) => instance.mode === "dev"),
  }
  const anyRunning = running.normal || running.dev

  async function run(action: FscMode | "stop"): Promise<void> {
    setPending(action)
    try {
      if (action === "stop") await window.api.stopFsc()
      else await window.api.launchFsc(action)
    } finally {
      setPending(null)
    }
  }

  function modeLabel(mode: FscMode): string {
    const suffix = mode === "dev" ? " in dev mode" : ""
    return running[mode]
      ? `Restart FS Copilot${suffix}`
      : `Launch FS Copilot${suffix}`
  }

  function glyph(mode: FscMode, icon: ReactNode): ReactElement {
    const label = modeLabel(mode)

    const button = (
      <IslandButton
        label={label}
        className="text-fsc-run hover:text-fsc-run-hover"
        disabled={!available || pending !== null}
        onClick={() => void run(mode)}
      >
        {pending === mode ? (
          <LoaderCircle className="animate-spin" />
        ) : running[mode] ? (
          /*
           * The mode's own glyph keeps the seat while it runs; the restart
           * arrow appears only under the cursor. Swapping it in permanently
           * looked like a different button had arrived — the offer is
           * "restart", but the identity is still "this mode".
           */
          <>
            <span className="contents group-hover/fsc:hidden">{icon}</span>
            <RotateCw className="hidden group-hover/fsc:block" />
          </>
        ) : (
          icon
        )}
      </IslandButton>
    )

    if (!available) return button
    return (
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    )
  }

  const island = (
    <div className="no-drag absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-md bg-fsc-island py-1 ps-3 pe-1">
      <span className="pe-2 text-xs text-fsc-label select-none">
        FS Copilot
      </span>
      {glyph("normal", <Play className="fill-current" />)}
      {/* Lucide has no filled hammer; filling the stroke shape with the same
          colour it is drawn in is the standing trick for one. */}
      {glyph("dev", <Hammer className="fill-current" />)}
      {/*
        `pending === "stop"` keeps the button — and its spinner — on screen for
        the tail of a stop, after the process list has already emptied but
        before the call has resolved.
      */}
      {(anyRunning || pending === "stop") && (
        <Tooltip>
          <TooltipTrigger
            render={
              <IslandButton
                label="Stop FS Copilot"
                className="text-fsc-stop hover:text-fsc-stop-hover"
                disabled={pending !== null}
                onClick={() => void run("stop")}
              >
                {pending === "stop" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Square className="fill-current" />
                )}
              </IslandButton>
            }
          />
          <TooltipContent>Stop FS Copilot</TooltipContent>
        </Tooltip>
      )}
    </div>
  )

  if (available) return island

  // Disabled controls are pointer-events-none, so the hover that explains them
  // has to land on the island — which is why the tooltip wraps the group here
  // rather than each button.
  return (
    <Tooltip>
      <TooltipTrigger render={island} />
      <TooltipContent>
        The current workspace is not an FS Copilot install, so there is nothing
        to launch. Choose the correct FSC folder in Settings to launch and
        restart FSC from here.
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * One glyph of the island: a raw button around a 16px icon.
 *
 * The colour comes in through `className` and *is* the control — no resting
 * skin, no hover fill. What survives from the kit is what belongs to the app
 * rather than to the island: the focus ring (`control-states`), the press
 * nudge, and disabled at half opacity.
 *
 * The rest props are spread through **because `TooltipTrigger` renders this**:
 * Base UI delivers its hover and focus handlers (and the ref) as props to the
 * `render` element, and a component that drops them is a trigger that never
 * triggers.
 */
function IslandButton({
  label,
  className,
  children,
  ...props
}: {
  label: string
  className: string
  children: ReactNode
} & ComponentProps<"button">) {
  return (
    <button
      aria-label={label}
      className={cn(
        "group/fsc grid size-6 place-items-center rounded-sm outline-none select-none control-states active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
