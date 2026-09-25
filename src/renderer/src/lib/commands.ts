import { useStore } from "@/store"

/**
 * What the app can be told to do from a menu or a key, in one place.
 *
 * A menu prints a shortcut beside its item, and a label typed separately from
 * the binding that fires it is one that drifts: sooner or later the menu
 * advertises a key that does something else. So a command carries its own
 * keys, the one listener below dispatches them, and a menu reads the label off
 * the same record.
 *
 * Only what the menu bar shows, and what shared the listener it replaced, is
 * here so far. The editor's keys — Ctrl+S, Ctrl+W, Ctrl+Tab, Ctrl+\ — stay
 * where they are until a menu offers them. They act on whichever pane has
 * focus, and how a command asks that is worth designing when a menu needs it,
 * not before.
 */

export interface Keys {
  /** `KeyboardEvent.key`, lower case. */
  key: string
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
}

export interface Command {
  /** As a menu shows it. */
  title: string
  keys?: Keys
  run: () => void
}

export const commands = {
  settings: {
    title: "Settings…",
    keys: { key: ",", ctrl: true },
    run: () => useStore.getState().setDialog("settings"),
  },
  toggleProfiles: {
    title: "Profiles",
    keys: { key: "b", ctrl: true },
    run: () => {
      const { profiles, setProfiles } = useStore.getState()
      setProfiles(!profiles)
    },
  },
} satisfies Record<string, Command>

export type CommandId = keyof typeof commands

function matches(keys: Keys, event: KeyboardEvent): boolean {
  return (
    event.key.toLowerCase() === keys.key &&
    event.ctrlKey === Boolean(keys.ctrl) &&
    event.shiftKey === Boolean(keys.shift) &&
    event.altKey === Boolean(keys.alt)
  )
}

/**
 * Dispatches every command's keys, and returns the way to stop.
 *
 * On the window rather than as Monaco commands, so a key works from any panel
 * and not only with the editor focused. Monaco binds nothing to the keys here,
 * so nothing is taken away from it; a command given a key Monaco does use has
 * to settle that first.
 */
export function watchCommands(): () => void {
  const all: Command[] = Object.values(commands)

  const onKey = (event: KeyboardEvent) => {
    const command = all.find(({ keys }) => keys && matches(keys, event))
    if (!command) return

    event.preventDefault()
    command.run()
  }

  window.addEventListener("keydown", onKey)
  return () => window.removeEventListener("keydown", onKey)
}

/** `Ctrl+,` — the way Windows writes a shortcut beside a menu item. */
export function keysLabel(keys: Keys): string {
  return [
    keys.ctrl && "Ctrl",
    keys.shift && "Shift",
    keys.alt && "Alt",
    keys.key.length === 1 ? keys.key.toUpperCase() : keys.key,
  ]
    .filter(Boolean)
    .join("+")
}
