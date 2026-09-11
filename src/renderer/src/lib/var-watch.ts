/**
 * Which variables the *interface* is showing, as opposed to the editor.
 *
 * ## Why this is not each component's own business
 *
 * The obvious shape — a chip subscribes when it mounts and unsubscribes when it
 * unmounts — breaks twice. Thirty chips on screen is thirty IPC round trips for
 * one screenful, and two chips showing the same variable will unsubscribe each
 * other on unmount, silently, leaving the survivor frozen on its last value.
 *
 * So components *retain* a name here and this keeps the counts. One union, one
 * message, and a name stays watched for exactly as long as something is showing
 * it.
 *
 * ## And why it exists at all rather than just calling `watchSimVars`
 *
 * **The watch set is a replace, not an add.** `store.ts` already sends one
 * built from the `get:` lines in the open tabs, and a second caller would wipe
 * it — the editor's live values would go dark the moment a panel showed a chip.
 * The set the app sends is the union of both, and this half of it lives here so
 * the store's half does not have to know what a panel is.
 */

/** Names by how many things on screen are showing them. */
const wanted = new Map<string, number>()

const listeners = new Set<() => void>()

/**
 * Keeps `name` watched until the returned function is called.
 *
 * Idempotent per caller in the sense that matters: two holders of the same name
 * are two counts, and the name is released when the last one lets go.
 */
export function retainVar(name: string): () => void {
  wanted.set(name, (wanted.get(name) ?? 0) + 1)
  if (wanted.get(name) === 1) announce()

  let released = false

  return () => {
    // Guarded because React can call a cleanup twice in development, and a
    // double release would drop a name something else is still showing.
    if (released) return
    released = true

    const left = (wanted.get(name) ?? 1) - 1
    if (left > 0) {
      wanted.set(name, left)
      return
    }

    wanted.delete(name)
    announce()
  }
}

/** Every name the interface is currently showing. */
export function watchedByUi(): string[] {
  return [...wanted.keys()]
}

/**
 * Fires when the *set* changes, not when a count does.
 *
 * A second chip for a name already on screen changes nothing about what has to
 * be asked of the simulator, and waking the watch rebuild for it would mean a
 * message per row while a list renders.
 */
export function onWatchedByUiChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function announce(): void {
  for (const listener of listeners) listener()
}
