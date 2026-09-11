import { useState } from "react"

import { cn } from "@/lib/utils"
import { useStore } from "@/store"

import { SimInstallDialog } from "./install-dialog"

/**
 * The footer's simulator indicator.
 *
 * **It reports state and nothing else.** An earlier version put the aircraft
 * key and the `L:` count in here, which made a status indicator into a readout
 * — and a bad one, since it was a line of the footer trying to be a panel. Both
 * of those facts are getting their own surfaces, where there is room to say
 * what they mean; this says which situation the app is in, and the situation is
 * the only thing that changes what a person would do next.
 *
 * The tone is the other half of it, and it is [04-connection]'s: **`offline` is
 * not a nag.** The sim not running is the normal condition of a profile editor,
 * and a status bar that asked to be noticed for it would be wrong every time it
 * was read.
 *
 * That rule turns out to cover the invitation too. 04 makes `Connect to sim` an
 * attention-drawing chip — "the only thing on screen asking for attention" —
 * which is a reasonable thing to want from a footer that is the *only* place
 * the feature is pitched. It is not the only place. So the invitation is muted
 * inline text like `Sim offline`, brightening on hover, and the pitch happens
 * where there is room to make it.
 *
 * What is left carrying colour is what carries information: the two amber
 * states, which are anomalies, and the one connected state.
 *
 * Every state opens the same dialog, because there is always something it can
 * usefully say: what to install, where it went, or how to remove it.
 */
export function SimChip() {
  const sim = useStore((state) => state.sim)
  const [installing, setInstalling] = useState(false)
  // Bumped on every opening, and used as the dialog's key. That is what resets
  // it — a dialog reopened after a failed install should not still be showing
  // the failure — and it is cheaper than the alternative, which is an effect
  // that clears state whenever `open` becomes true.
  const [session, setSession] = useState(0)

  function open(): void {
    setSession((n) => n + 1)
    setInstalling(true)
  }

  const chip = state(sim)

  return (
    <>
      <button
        onClick={open}
        title={chip.title}
        className={cn(
          "flex h-5 shrink-0 items-center gap-1.5 rounded-sm px-1.5 text-[11px]",
          chip.className
        )}
      >
        {chip.dot && (
          <span
            aria-hidden
            className={cn("size-1.5 shrink-0 rounded-full", chip.dot)}
          />
        )}
        <span>{chip.label}</span>
      </button>
      <SimInstallDialog
        key={session}
        open={installing}
        onOpenChange={setInstalling}
      />
    </>
  )
}

interface Chip {
  label: string
  title: string
  className: string
  /** Absent where there is nothing to indicate — see `offline` below. */
  dot?: string
}

/**
 * The four states, in the order they outrank each other.
 *
 * Not installed comes first even when connected: `A:` and `B:` working is not
 * the offer being made, and the offer is `L:`, which is 84% of the corpus. A
 * chip reading `Sim` on a connection that cannot see most of the file the user
 * is editing would be telling the truth and communicating a falsehood.
 */
function state(sim: ReturnType<typeof useStore.getState>["sim"]): Chip {
  // Quiet, and named for the thing rather than for the aspiration. "Connect to
  // sim" promises an outcome and hides what it costs; "Install sim module" says
  // what clicking it does, which is the more respectful version of an offer
  // nobody asked for.
  if (!sim.installed) {
    return {
      label: "Install sim module",
      title: "Read L: variables from MSFS — 84% of a typical profile",
      className: MUTED,
    }
  }

  if (sim.phase === "offline") {
    return {
      label: "Sim offline",
      title: "The sim module is installed. MSFS is not running.",
      className: MUTED,
    }
  }

  // Amber, and both of these keep it. They are the states where something is
  // installed and not working, which is the one thing here a person cannot
  // find out any other way.
  if (sim.silent) {
    return {
      label: "Sim module not responding",
      title:
        "The module is installed, but MSFS has not loaded it. Packages are scanned when the simulator starts, so it needs a restart.",
      className: AMBER,
      dot: "bg-amber-500",
    }
  }

  if (sim.link?.outdated) {
    return {
      label: "Sim module outdated",
      title:
        "The module running in MSFS is older than this app expects. A newer one is already on disk — restart the simulator to load it.",
      className: AMBER,
      dot: "bg-amber-500",
    }
  }

  return {
    // Parallel with `Sim offline`, which is the state it alternates with all
    // day. A bare `Sim` with a coloured dot would be tidier and would make the
    // reader work out what the colour meant.
    label: "Sim connected",
    title: sim.link
      ? "Connected, with the sim module"
      : "Connected. A: and B: only — the sim module is not loaded.",
    className: "border border-sim-border bg-sim-surface text-sim-foreground",
    dot: "bg-sim",
  }
}

/**
 * The two quiet states: no border, no background, no dot.
 *
 * They are the ones that report the absence of something — no module, no
 * simulator — and neither is a fault. Rendering them as chips would put a box
 * in the footer around "nothing is happening".
 */
const MUTED = "text-muted-foreground/60 hover:text-muted-foreground"

/** Installed and not working, which is the only anomaly this chip can show. */
const AMBER =
  "border border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
