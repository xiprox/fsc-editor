/**
 * What the loaded cockpit's panels are called — the evidence behind
 * `panel-missing`.
 *
 * ## Who gets it
 *
 * The loaded aircraft's profile *and the modules it includes*, which is wider
 * than `aircraft-evidence.ts` allows and on purpose. That file keeps evidence
 * away from modules because a module is shared and the loaded aircraft's
 * answer is not everybody's — true here as well, and handled by what the rule
 * says rather than by who hears it: it reports at info, and claims only that
 * the panel is not in the aircraft that is loaded. A `pointer:` block lives in
 * a module more often than not, and a rule that never looked there would
 * never look.
 *
 * ## When the cockpit is read
 *
 * On demand, not on a timer. The rule asks only for a file that has panel
 * items in it, so an app with no such file open never touches the debugger.
 * The first ask for an aircraft starts a read and answers "nothing known
 * yet"; the result re-runs the diagnostics.
 *
 * A cockpit fills in over the seconds after an aircraft loads, so one read
 * can be early. Each read that finds something new books one more, and the
 * first that finds nothing new is the last — a settled cockpit is read twice.
 * The picker's own scans are taken too, since they are the freshest there is.
 *
 * ## Interactivity is not looked at
 *
 * Every panel the simulator lists counts, lit or dark. An aircraft that swaps
 * avionics in the cockpit reports the swapped-out unit as not interactive,
 * and a profile that names it is right to.
 */

import type { CockpitPanelNames, RuleContext } from "@shared/lang"
import type { PanelScan } from "@shared/panels"

import { useStore } from "../store"
import { provideEvidence, refreshAllDiagnostics } from "./diagnostics-store"
import { inLoadedAircraft, watchReach } from "./profile-reach"

/** How long a cockpit is given to finish arriving before it is read again. */
const SETTLE_MS = 15_000

let known: { aircraft: string; names: CockpitPanelNames } | null = null
let reading = false
let settle: ReturnType<typeof setTimeout> | null = null

function loadedAircraft(): string | null {
  const { sim } = useStore.getState()
  return sim.phase === "live" ? (sim.aircraft ?? null) : null
}

function namesOf(scan: Extract<PanelScan, { ok: true }>): CockpitPanelNames {
  const keys: Record<string, string[]> = {}
  const unread = new Set<string>()

  for (const panel of scan.panels) {
    if (panel.unread) unread.add(panel.identifier)
    else (keys[panel.identifier] ??= []).push(panel.key)
  }
  // Half-read is unread: a list of keys with one missing would convict the
  // very key it is missing.
  for (const identifier of unread) delete keys[identifier]
  for (const list of Object.values(keys)) list.sort()

  return {
    identifiers: [
      ...new Set(scan.panels.map((panel) => panel.identifier)),
    ].sort(),
    keys,
  }
}

/** Takes a scan, from here or from the picker. True when it said something new. */
export function notePanels(scan: PanelScan): boolean {
  const aircraft = loadedAircraft()
  if (!scan.ok || !aircraft) return false

  const names = namesOf(scan)
  const same =
    known?.aircraft === aircraft &&
    JSON.stringify(known.names) === JSON.stringify(names)
  if (same) return false

  known = { aircraft, names }
  refreshAllDiagnostics()
  return true
}

function read(): void {
  if (reading) return
  reading = true

  if (settle) clearTimeout(settle)
  settle = null

  void window.api
    .scanPanels()
    .then((scan) => {
      // Something new may not be everything: look once more when it has had
      // time to finish. Nothing new is a settled cockpit, and the end of it.
      if (notePanels(scan)) settle = setTimeout(read, SETTLE_MS)
    })
    .finally(() => {
      reading = false
    })
}

function cockpitPanels(relPath: string | null): CockpitPanelNames | null {
  const aircraft = loadedAircraft()
  if (!aircraft || !inLoadedAircraft(relPath)) return null

  if (known?.aircraft !== aircraft) {
    known = null
    read()
    return null
  }
  return known.names
}

provideEvidence((relPath): Pick<RuleContext, "cockpitPanels"> => ({
  cockpitPanels: () => cockpitPanels(relPath),
}))

// Which files are part of the loaded aircraft decides who hears any of this,
// and it changes with the aircraft and with every saved `include:`.
watchReach(refreshAllDiagnostics)
