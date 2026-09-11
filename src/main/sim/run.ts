/**
 * Running one setter, and noticing the one thing you cannot see.
 *
 * The popover stays open over the entry and the `get:` line's live value sits
 * directly above it, so "did it work" is answered by the number on screen
 * rather than by anything here. That covers two of the three things a run can
 * do: the value moved and stayed, or nothing moved at all. Both are visible.
 *
 * **The third is invisible, and it is the one that matters.** An aircraft that
 * owns a variable puts it back — median 83 ms, p90 464 ms, measured over 6,760
 * A→B→A patterns across 101 variables. At that speed the live value flickers
 * and settles back to where it started, which looks exactly like nothing
 * having happened. Read that as "no effect" and you go and rewrite a setter
 * that was correct, never learning that the variable will desync the moment it
 * is bound. That is the bug this whole feature was justified by.
 *
 * So this watches for a second and speaks only when the value came back. Held
 * and no-effect are silence, because the editor is already showing them.
 *
 * ## What it cannot see either
 *
 * The module diffs at 15 Hz, so an excursion that starts and ends inside one
 * 66 ms tick is never reported to anybody — not to the live value, not to
 * here. Roughly half of all reverts are quicker than 83 ms, so some fraction
 * of them are simply below the sample rate. Catching those needs the module to
 * watch the target at frame rate for a second and report the excursion itself,
 * which is a protocol change and worth it only if the gap turns out to matter.
 * Recorded here so the silence is understood rather than trusted.
 *
 * ## Injected dependencies
 *
 * Everything the simulator provides arrives as an argument rather than an
 * import. A run is I/O with a one-second wait in the middle; against fakes it
 * is a synthetic stream and no waiting at all.
 */

import type {
  Revert,
  RunResult,
  SetterBindings,
  SetterEntry,
} from "@shared/setter"
import type { CapturedEvent } from "@shared/sim"

import { resolveSetter } from "./setter"

export type { Revert, RunResult }

/**
 * How long the variable is watched after the write.
 *
 * 1 second catches 97.4% of the measured reversions. The tail past it is long
 * and thin, and nothing is waiting on this — the window runs behind a popover
 * the user is already reading.
 */
export const OBSERVE_MS = 1_000

/**
 * Below this, two readings are the same reading.
 *
 * The same constant as `k_deadband` in `module.cpp`, for the same reason:
 * floating-point variables jitter in their last bits without anything having
 * happened, and a jitter back to the starting value is not a revert.
 */
const DEADBAND = 1e-6

/** What a run needs from the outside world. */
export interface RunDeps {
  /**
   * Sends the code and resolves when the module answers *this* run.
   *
   * Resolving on the token rather than on the next reply is the whole reason
   * the token exists — the output area is a broadcast, and a `link:read`
   * running its own setter alongside would otherwise answer for us.
   */
  exec: (code: string) => Promise<{ ok: boolean }>
  /**
   * The variable's last known value, or null if nothing has reported it.
   *
   * Not `valueOf`, which every object already has: a `Partial<RunDeps>` of an
   * object literal then inherits `Object.prototype.valueOf` and fails to type
   * against this one, which is a confusing error a long way from its cause.
   */
  readValue: (name: string) => number | null
  /** Everything the ring buffer holds between two instants. */
  slice: (from: number, to: number) => CapturedEvent[]
  now: () => number
  /** Waits out the observation window. */
  wait: (ms: number) => Promise<void>
}

/**
 * Resolve, run, watch for a revert.
 *
 * The order matters in one place: `before` is read *before* the write rather
 * than taken from the window, because a variable the aircraft drives may have
 * been moving already and its own motion would then be read as ours.
 */
export async function runSetter(
  deps: RunDeps,
  entry: SetterEntry,
  bindings: SetterBindings
): Promise<RunResult> {
  const resolved = resolveSetter(entry, bindings)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }

  const { code } = resolved
  const target = entry.name.trim()
  const before = deps.readValue(target)
  const at = deps.now()

  const reply = await deps.exec(code)
  if (!reply.ok)
    return {
      ok: false,
      code,
      reason: "the simulator's calculator rejected this code",
    }

  await deps.wait(OBSERVE_MS)

  return {
    ok: true,
    code,
    revert: revertIn(target, before, at, deps.slice(at, at + OBSERVE_MS)),
  }
}

/**
 * The variable left and came back, or it did not.
 *
 * Split out from `runSetter` because this is the part with the judgement in
 * it, and judgement is what a test should be able to reach directly.
 */
export function revertIn(
  target: string,
  before: number | null,
  at: number,
  window: CapturedEvent[]
): Revert | null {
  // Nothing had ever reported this variable, so there is no "back" to come to.
  if (before === null) return null

  const moves = window
    .filter(
      (event): event is CapturedEvent & { kind: "var" | "simvar" } =>
        (event.kind === "var" || event.kind === "simvar") &&
        event.name === target
    )
    .filter((event) => event.t >= at)

  const away = (value: number): boolean => Math.abs(value - before) > DEADBAND

  const left = moves.findIndex((event) => away(event.value))
  // It never left. Either nothing moved, or something re-reported the same
  // number — neither is a revert, and both are visible in the live value.
  if (left < 0) return null

  // Where it got to. The first reading away from home rather than the largest:
  // what is being reported is that it moved and was undone, not how far.
  const went = moves[left].value

  // When it got back, not when it last said anything: a variable that returns
  // and then jitters would otherwise be reported as having taken the whole
  // window, and the elapsed time is the part somebody reads.
  const back = moves.slice(left).find((event) => !away(event.value))
  // Still away when the window closed. The write is holding, or the aircraft
  // overrode it with a third value — either way it did not come back.
  if (!back) return null

  return { went, back: back.value, afterMs: back.t - at }
}
