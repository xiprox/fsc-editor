/**
 * The global hotkey, and the marks it makes.
 *
 * A mark is a point in time and nothing else. 08-marks argues that from where
 * the key gets pressed rather than from what is easy to build: **the simulator
 * is fullscreen in front of you.** A toggle you have lost track of cannot be
 * checked without alt-tabbing, which is the exact cost this exists to avoid, so
 * a stateless control is the only one that cannot be wrong. Press it whenever
 * something happens, press it five times, it is always correct.
 *
 * ## What registration can and cannot tell us
 *
 * `globalShortcut.register` returns false when Windows refuses the binding,
 * which catches other applications that used `RegisterHotKey`. It does **not**
 * see MSFS's own keybindings, which are read through raw input — so a key bound
 * in the simulator will both mark and do whatever the sim does, with nothing
 * anywhere reporting a conflict.
 *
 * That asymmetry is why `bindMarkHotkey` returns a result rather than throwing
 * or logging: the honest answer has two halves, "Windows accepted this" and "we
 * cannot speak for the simulator", and only the UI can say the second one.
 */

import { globalShortcut } from "electron"

import {
  DEFAULT_HOTKEYS,
  type HotkeyAction,
  type Mark,
} from "@shared/activity"
import type { Hotkeys, MarkHotkey } from "@shared/types"

/** Marks are kept only as long as the buffer they index into. */
const MARK_LIMIT = 256

let marks: Mark[] = []
let notify: (mark: Mark) => void = () => {}

const ACTIONS: HotkeyAction[] = ["capture", "arm"]

const bound: Record<HotkeyAction, string | null> = { capture: null, arm: null }

/** `capture` is this file's own; `arm` is registered by whoever owns arming. */
const handlers: Record<HotkeyAction, () => void> = {
  capture: () => void mark(),
  arm: () => {},
}

/** Where a new mark goes. The Activity panel's cue to recompute. */
export function onMark(sink: (mark: Mark) => void): void {
  notify = sink
}

export function marksSince(from: number): Mark[] {
  return marks.filter((mark) => mark.t >= from)
}

export function allMarks(): Mark[] {
  return marks
}

/** For a disconnect: marks index into a buffer that is about to be emptied. */
export function resetMarks(): void {
  marks = []
}

/**
 * Binds the hotkey, replacing whatever was bound before.
 *
 * Unregistering first matters even when the accelerator is unchanged: Electron
 * keeps the old binding alive otherwise, and a rebind that half-worked would
 * leave two keys making marks with no way to discover the second one.
 */
export function bindHotkey(
  action: HotkeyAction,
  accelerator = DEFAULT_HOTKEYS[action]
): MarkHotkey {
  unbindHotkey(action)

  let ok: boolean
  try {
    ok = globalShortcut.register(accelerator, () => fire(action))
  } catch {
    // An accelerator Electron cannot parse throws rather than returning false.
    // A typo in a user-entered binding is not a reason to take down the app.
    ok = false
  }

  bound[action] = ok ? accelerator : null
  return { ok, accelerator }
}

/**
 * Binds both, for launch.
 *
 * One failing does not stop the other: they are independent keys doing
 * independent jobs, and "the arm key was taken" is not a reason to lose the
 * capture key as well.
 */
export function bindHotkeys(): void {
  for (const action of ACTIONS) bindHotkey(action)
}

export function unbindHotkey(action: HotkeyAction): void {
  const accelerator = bound[action]
  if (!accelerator) return

  globalShortcut.unregister(accelerator)
  bound[action] = null
}

export function unbindHotkeys(): void {
  for (const action of ACTIONS) unbindHotkey(action)
}

/**
 * What each key does, registered by whoever owns the behaviour.
 *
 * Kept as a hook rather than called directly, because `arm` belongs to
 * `activity-history.ts` and this file has no business importing it — the
 * hotkey's job is to notice a key, not to know what the app does about it.
 */
export function onHotkey(action: HotkeyAction, handler: () => void): void {
  handlers[action] = handler
}

function fire(action: HotkeyAction): void {
  handlers[action]()
}

/** What is bound right now, for the panel header. */
export function hotkeys(): Hotkeys {
  return {
    capture: state("capture"),
    arm: state("arm"),
  }
}

function state(action: HotkeyAction): MarkHotkey {
  const accelerator = bound[action]
  return accelerator
    ? { accelerator, ok: true }
    : { accelerator: DEFAULT_HOTKEYS[action], ok: false }
}

/**
 * Records a mark at this instant.
 *
 * Exported because the panel offers a button as well as the hotkey — the key is
 * for when the simulator has focus, and the button is for when this window
 * does. Same mark either way.
 */
export function mark(): Mark {
  return markAt(Date.now())
}

/**
 * Records a mark that already happened.
 *
 * For replay: a capture carries its marks, and a session played back with the
 * simulator closed has to produce the same panel as the session it came from.
 * The clock is the only difference between this and `mark`, which is why they
 * are one function and not two.
 */
export function markAt(t: number): Mark {
  const made: Mark = { t }

  marks.push(made)
  if (marks.length > MARK_LIMIT) marks = marks.slice(-MARK_LIMIT)

  notify(made)
  return made
}
