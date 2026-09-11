import type { SimState } from "@shared/sim"

/**
 * Why Radar cannot work right now, or null when it can.
 *
 * One value rather than a set of booleans, because two parts of the panel need
 * an answer from it — what the empty state says, and whether the capture
 * controls do anything — and those two have to agree. A panel explaining that
 * the module is missing while its Capture button still invites a press is a
 * panel with two opinions.
 *
 * The order is the footer chip's, and deliberately so: not installed outranks
 * everything, including a live connection. `A:` and `B:` do keep working
 * without the module, and Radar could rank them — but the answer it would give
 * is drawn from a sixth of what a profile actually writes, which is a worse
 * thing to hand somebody than a straight no.
 *
 * It lives apart from `empty.tsx` because that file exports components and this
 * is not one; fast refresh wants those separated, and the split happens to be
 * the honest one anyway — this is a fact about the session, and the empty state
 * is one of the things that reads it.
 */
export type RadarBlock =
  "install" | "offline" | "silent" | "outdated" | "aircraft" | null

export function radarBlock(sim: SimState): RadarBlock {
  if (!sim.installed) return "install"
  if (sim.phase !== "live") return "offline"
  if (sim.silent) return "silent"
  if (sim.link?.outdated) return "outdated"
  if (!sim.aircraft) return "aircraft"

  return null
}
