/**
 * What the Link module says about the refs it is watching.
 *
 * The evidence tier's second source. The first — the loaded aircraft's input
 * events — rides `VarIndex`, because per-aircraft evidence has exactly the
 * index's lifetime. This one does not: the watch set is assembled in
 * `store.ts` from the `get:` lines of the open tabs, so it moves when somebody
 * opens a file, and rebuilding a 25,000-row index to answer that would be the
 * wrong trade. Hence a store of its own, fed by `sim:watch-resolution`.
 *
 * ## Three answers, not two
 *
 * A name this store has never heard of is *not* a name that resolves. It is a
 * name nobody is watching — because no tab holding it is open, because the
 * watch set is still in its 120 ms debounce, or because the module is not
 * there at all. Only names the module has actually reported on carry a
 * verdict, which is why `refResolved` is tri-state and why the null case
 * outnumbers the others.
 */

import type { WatchedRef } from "@shared/link"

/**
 * Verdicts by name, lower-cased.
 *
 * Null when no module is talking — distinct from an empty map, which means a
 * module that is watching nothing. The rules must stay silent for the first
 * and are simply never asked about anything in the second.
 */
let verdicts: Map<string, boolean> | null = null

export function setWatchResolution(refs: WatchedRef[] | null): void {
  if (!refs) {
    verdicts = null
    return
  }

  const next = new Map<string, boolean>()
  // Names go in as the app asked for them, prefix and index included, so the
  // key is the written `get:` name rather than an identity — `L:1:Foo` and
  // `L:2:Foo` are different watches and resolve independently.
  //
  // A ref the module has not tried yet is left *out* rather than stored as
  // null, which is the same answer `refResolved` gives for a name nobody is
  // watching: no verdict. Protocol 6 exists so that state is sayable at all —
  // under 5 it arrived as "absent" and every fresh watch flashed a warning.
  for (const ref of refs) {
    if (ref.resolved === null) continue
    next.set(ref.name.toLowerCase(), ref.resolved)
  }
  verdicts = next
}

/**
 * Whether the module resolved this ref on the loaded aircraft, or null when
 * there is no verdict — see the three-answers note above.
 */
export function refResolved(name: string): boolean | null {
  if (!verdicts) return null
  return verdicts.get(name.toLowerCase()) ?? null
}
