import { useCallback, useEffect, useSyncExternalStore } from "react"

import { onDidChangeSimValues, simValue } from "@/lib/sim-values"
import { retainVar } from "@/lib/var-watch"

/**
 * The current value of one variable, and nothing else.
 *
 * A **number**, deliberately, rather than the `SimValue` it comes from. The
 * store replaces its whole map on every batch, so returning the object would
 * hand React a new identity fifteen times a second for every subscriber on
 * screen and re-render all of them. A number compares by value, so a row
 * re-renders when its own variable moves and not when anything else does.
 *
 * Reading a value does not ask for one: `retainVar` is what puts a name in the
 * watch set. A hook that quietly subscribed would make every read of a value a
 * request to the simulator, which is the wrong default for a list that is
 * mostly scrolled past.
 */
export function useVarValue(name: string): number | undefined {
  const subscribe = useCallback((notify: () => void) => {
    const sub = onDidChangeSimValues(notify)
    return () => sub.dispose()
  }, [])

  return useSyncExternalStore(
    subscribe,
    useCallback(() => simValue(name)?.value, [name])
  )
}

/**
 * Keeps a whole list of names watched, for as long as the list is on screen.
 *
 * ## Why a list, when `VarChip` already retains its own name
 *
 * Because a chip retains on **mount**, and a virtualized list mounts and
 * unmounts rows as it scrolls — so the watch set would be rebuilt on every
 * scroll tick, and every rebuild re-sends the whole set and tears down the
 * SimConnect data definition behind any `A:` in it. A chip appearing is not by
 * itself a request for data.
 *
 * So the caller holds the subscription for a *list* it chooses, and the rows
 * only draw. The Variables panel chooses the rows in view, settled — see
 * `SETTLE_MS` — which is what bounds the cost of live values by the size of the
 * panel rather than by the size of the search.
 *
 * Keyed on the contents rather than on the array, so a caller that rebuilds an
 * equal list on every render does not re-subscribe on every render.
 */
export function useRetainedVars(names: readonly string[]): void {
  const key = names.join("\n")

  useEffect(() => {
    if (!key) return

    const release = key.split("\n").map(retainVar)
    return () => {
      for (const stop of release) stop()
    }
  }, [key])
}
