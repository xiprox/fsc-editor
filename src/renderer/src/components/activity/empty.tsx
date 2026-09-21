import { useState, type ReactNode } from "react"

import {
  Circle,
  Crosshair,
  PackagePlus,
  Plane,
  TriangleAlert,
  Unplug,
} from "lucide-react"

import { MARK_BEFORE_MS, type CaptureMode } from "@shared/activity"

import type { RadarBlock } from "./blocked"
import { Keys } from "./hotkeys"

import { SimInstallDialog } from "@/components/sim/install-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { cn } from "@/lib/utils"

/**
 * The panel when there is nothing in it — one surface, not two columns.
 *
 * **Empty means empty.** It is shown only when no capture exists, which is why
 * a lost connection does not take the table away: captures outlive the session
 * that produced them and are still the answer to the question that was asked.
 * A disconnect greys the two controls in the header and leaves the rest where
 * it was.
 *
 * The blocked states say what is wrong and stop. Radar is not a troubleshooting
 * guide — restarting MSFS so it loads a package, or what to do about an old one,
 * is the install dialog's subject and the footer chip's — so what belongs here
 * is the reason the panel is blank, in the place somebody is already looking.
 * The one exception is a missing module, where installing it *is* the whole of
 * the fix and the offer costs a single line.
 *
 * The blocker arrives as a prop rather than being read from the store here, so
 * that the panel's disabled controls and this text are answering the same
 * question from the same value.
 */
export function RadarEmpty({
  block,
  mode,
  hotkey,
}: {
  block: RadarBlock
  mode: CaptureMode
  /** The Capture binding, so the state that teaches it cannot misquote it. */
  hotkey?: string
}) {
  if (block === "install") return <InstallEmpty />

  if (block === "offline") {
    return (
      <Shell
        icon={<Unplug />}
        title="Sim offline"
        description="Radar reads what the simulator reports as it happens, so there is nothing to watch until MSFS is running."
      />
    )
  }

  // The two anomalies wear the warning tone the chip gives them: something is
  // installed and not working, which is the one thing here that nothing else on
  // screen can tell you.
  if (block === "silent") {
    return (
      <Shell
        tone="warning"
        icon={<TriangleAlert />}
        title="Sim module not responding"
        description="The module is installed but MSFS has not loaded it, so there is nothing for Radar to surface."
      />
    )
  }

  if (block === "outdated") {
    return (
      <Shell
        tone="warning"
        icon={<TriangleAlert />}
        title="Sim module outdated"
        description="The module running in MSFS is older than this app expects, so the two no longer agree on what is being sent."
      >
        <EmptyContent>
          <ModuleDialogButton label="Update sim module" />
        </EmptyContent>
      </Shell>
    )
  }

  if (block === "aircraft") {
    return (
      <Shell
        icon={<Plane />}
        title="No aircraft yet"
        description="Load a flight and give it a few seconds to settle. Cold and dark is fine."
      />
    )
  }

  return <ReadyEmpty mode={mode} hotkey={hotkey} />
}

/**
 * Connected, an aircraft, and nothing captured — the ordinary state.
 *
 * The one that is not a failure, and so the one worth the most care: it is
 * where somebody opening Radar for the first time lands, with two buttons above
 * them and no way to tell what pressing either would do.
 *
 * **The two explanations do not sit in the middle with the rest.** They belong
 * to controls that are somewhere else on the screen, and a paragraph naming a
 * button is worth less than the same words sitting under it. So they are one
 * column pinned to the top-right corner, out of the flow — which is what keeps
 * the centre centred on the *panel* rather than on whatever is left under them.
 *
 * The cost of out-of-flow is that nothing reserves the space, so below a width
 * the column and the centred block reach for the same pixels — and the column
 * is the half that goes. It is a caption for two controls that are still on
 * screen and still carry their own tooltips; the state itself is the part that
 * has to survive a narrow panel.
 *
 * The threshold is arithmetic rather than taste. The column is 224 px wide and
 * sits 12 px off the edge, the centre is `max-w-md` = 448, so they touch when
 * `panel / 2 + 224 > panel − 236`, i.e. below 920 px. 60rem is the first round
 * number clear of it. It is a **container** query rather than a media one: this
 * panel is a window minus two resizable sidebars, and the viewport does not
 * know that.
 *
 * The binding lives in the Capture caption rather than in the middle, because
 * it is that button's keystroke and nothing else's — the shortcut beside the
 * control it fires.
 *
 * What is in that centre is three things: the mark, the state, and one sentence
 * about what the panel is for. A line of live proof under it — the aircraft key
 * and the size of the module's table — was tried and cut. It answered a
 * question nobody asks here, since the footer already says the module is
 * connected and the sidebar already says which aircraft, and an empty state
 * that has to justify itself reads as one that is not sure.
 */
function ReadyEmpty({ mode, hotkey }: { mode: CaptureMode; hotkey?: string }) {
  return (
    /*
      `flex` and not just `relative`, and the Shell below takes `flex-1`. A
      chain of `min-h-full` alone centres nothing: min-height is not a definite
      height, so the child has nothing to be centred *in* and sits at the top.
      One flex column fixes it, and keeps the growth `min-h-full` was for.
    */
    <div className="@container relative flex min-h-full flex-col">
      {/*
        Pointer-transparent: it is a caption, and the panel underneath should
        not lose a drag or a scroll to it.
      */}
      <div className="pointer-events-none absolute top-0 right-0 hidden w-56 flex-col gap-3 p-4 @min-[60rem]:flex">
        <Hint icon={<Crosshair />} name="Auto-capture" lit={mode !== "off"}>
          {AUTO_CAPTURE_HINT[mode]}
        </Hint>
        <Hint icon={<Circle />} name="Capture">
          For controls the simulator doesn't report. Work it, then press{" "}
          {hotkey ? <Keys accelerator={hotkey} /> : "Capture"} to capture the
          last {MARK_BEFORE_MS / 1000} seconds.
        </Hint>
      </div>

      <Shell
        className="min-h-0 flex-1"
        tone="radar"
        icon={<Crosshair />}
        title="Nothing captured yet"
        description="Work a control and Radar ranks every variable it can find that moved with it."
      />
    </div>
  )
}

const AUTO_CAPTURE_HINT: Record<CaptureMode, string> = {
  off: "Choose Once or Always to capture control movement in the sim (e.g. a switch, a knob) automatically.",
  once: "The next control you move in the sim (e.g. a switch, a knob) will be captured automatically.",
  always:
    "Every control you move in the sim (e.g. a switch, a knob) will be captured automatically.",
}

/**
 * One button, named and explained, sitting under it.
 *
 * Two lines rather than one: the label line repeats the button exactly — same
 * glyph, same word, same order, same tint when the mode is lit — and the
 * sentence sits under it, so a column reads as a caption for a control instead
 * of as a paragraph that happens to mention one. The width belongs to the
 * column, not to these; the alignment with the buttons above is approximate by
 * construction, since one is as wide as its sentences and the others are as
 * wide as their labels, and nothing here measures the header.
 */
function Hint({
  icon,
  name,
  lit,
  children,
}: {
  icon: ReactNode
  name: string
  lit?: boolean
  children: ReactNode
}) {
  return (
    <div className="[&_svg]:size-3 [&_svg]:shrink-0">
      <p
        className={cn(
          "flex items-center gap-1.5 text-[11px] font-medium",
          lit ? "text-radar-foreground" : "text-foreground"
        )}
      >
        <span className={lit ? "text-radar" : "text-muted-foreground/70"}>
          {icon}
        </span>
        {name}
      </p>
      <p className="mt-1 text-[11px]/relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  )
}

/**
 * The pitch.
 *
 * It says what Radar does before it says what is missing, because somebody who
 * has never seen the panel work cannot evaluate an install prompt for a feature
 * nobody has described to them.
 */
function InstallEmpty() {
  return (
    <Shell
      icon={<PackagePlus />}
      title="Radar needs the sim module"
      description="Radar finds the variable behind a cockpit control by watching what changes when you work it."
    >
      <EmptyContent>
        <ModuleDialogButton label="Install sim module" />
      </EmptyContent>
    </Shell>
  )
}

/**
 * The one control the empty states have, in the two places it makes sense.
 *
 * Both open the same dialog the footer chip does, keyed by an opening counter
 * the same way: a dialog reopened after a failed install should not still be
 * showing the failure.
 */
function ModuleDialogButton({ label }: { label: string }) {
  const [open, setOpen] = useState(false)
  const [session, setSession] = useState(0)

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setSession((n) => n + 1)
          setOpen(true)
        }}
      >
        {label}
      </Button>

      <SimInstallDialog key={session} open={open} onOpenChange={setOpen} />
    </>
  )
}

/**
 * The shape every state shares, so that moving between them moves nothing.
 *
 * Same metrics as the Variables panel's empty states — this app has one way of
 * saying there is nothing here. The one difference is `min-h-full` where that
 * panel says `h-full`, and the bottom panel is why: its height is somebody's
 * drag handle, and pinned to exactly the container the centred text is clipped
 * rather than reachable the moment the panel is short. Growing past it lets the
 * scroll it sits in do its job.
 */
function Shell({
  tone,
  icon,
  title,
  description,
  className,
  children,
}: {
  tone?: "radar" | "warning"
  icon: ReactNode
  title: string
  description: string
  className?: string
  children?: ReactNode
}) {
  return (
    <Empty className={cn("min-h-full gap-2.5 px-3 py-2", className)}>
      {/*
        `max-w-md` rather than the component's `max-w-sm`, and the icon's bottom
        margin halved. Both are the same constraint: the bottom panel opens at
        260 px and the header eats 36 of it, so every state has to say what it
        says inside about 220 px or the panel that means "there is nothing here"
        arrives with a scrollbar. A description that fits on one line is worth
        eighteen of those pixels.
      */}
      <EmptyHeader className="max-w-md gap-1.5">
        <EmptyMedia
          variant="icon"
          className={cn(
            "mb-1",
            tone === "radar"
              ? "border border-radar-border bg-radar-surface text-radar-foreground"
              : tone === "warning"
                ? "border border-warning-border bg-warning-surface text-warning-foreground"
                : undefined
          )}
        >
          {icon}
        </EmptyMedia>
        <EmptyTitle className="text-[13px]">{title}</EmptyTitle>
        <EmptyDescription className="text-[11.5px]/relaxed">
          {description}
        </EmptyDescription>
      </EmptyHeader>
      {children}
    </Empty>
  )
}
