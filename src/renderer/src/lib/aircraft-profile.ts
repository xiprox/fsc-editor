import { useMemo } from "react"

import { profileKey } from "@shared/profile"

import { useStore } from "@/store"

/**
 * The aircraft the simulator has loaded, and this app's profile for it.
 *
 * Shared by the two places that offer to do something about it — the row under
 * Profiles and the empty editor — so that they cannot disagree about whether a
 * profile exists. One of them saying "open" while the other says "create" would
 * be two answers to a question with one answer.
 *
 * At most one file can match, so this finds rather than picks — the exact-match
 * rule paying for itself, see `profileKey`.
 *
 * Tabs are searched as well as files, for the two cases where a profile exists
 * without being listed: the frame between `createProfile` writing the file and
 * the rescan reporting it, and the fallback it takes when that write is
 * refused, which leaves a real profile in a tab with no file under it. Offering
 * to create a second one in either case would be absurd.
 */
export function useAircraftProfile(): {
  aircraft: string | null
  relPath: string | null
} {
  const sim = useStore((state) => state.sim)
  const files = useStore((state) => state.files)
  const tabs = useStore((state) => state.tabs)

  const aircraft = sim.phase === "live" ? sim.aircraft : null

  const relPath = useMemo(() => {
    if (!aircraft) return null

    const key = aircraft.toLowerCase()
    const isFor = (path: string): boolean => profileKey(path) === key

    return (
      files.find((file) => isFor(file.relPath))?.relPath ??
      tabs.find(isFor) ??
      null
    )
  }, [aircraft, files, tabs])

  return { aircraft, relPath }
}
