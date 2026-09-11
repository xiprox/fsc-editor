/**
 * Plays a capture back into the app as if the simulator were producing it.
 *
 * This is the half of stage 2 that pays for the other half. The sim is a slow,
 * stateful, manual dependency: getting into a flight, loading an aircraft and
 * reaching a switch is minutes of work that cannot be scripted, and MSFS cannot
 * be left running while an editor is rebuilt twenty times an hour. Everything
 * downstream of the transport — live values, anchors, findings, ranking — is
 * pure logic over an event stream, so it only has to be *recorded* from the sim
 * once and can then be developed against forever.
 *
 * Replay deliberately reuses the real path. `FSCE_SIM_REPLAY` swaps the source
 * of events and changes nothing else: the same `CapturedEvent`s, through the
 * same emit, into the same state summary and the same renderer. A bug that
 * only appears live is therefore a bug in the client, which is a small and
 * well-understood file, rather than anywhere in the features being built.
 *
 * Events keep their original timestamps. They are evidence, and stage 4's
 * correlation is defined on the deltas between them — restamping to wall-clock
 * time would make every replay of one capture produce slightly different
 * findings, which is exactly the property a fixture must not have. Only
 * *delivery* is rescheduled.
 */

import fs from "node:fs"
import zlib from "node:zlib"

import type { CapturedEvent, SimVia } from "@shared/sim"

interface Playing {
  timers: ReturnType<typeof setTimeout>[]
  /** Mirrors what the live client tracks, so the chip reads the same. */
  aircraft: string | null
  /**
   * The input-event names the current aircraft enumerated — the list, not just
   * its length, so the index and the `B:` rules can be exercised from a capture
   * exactly as they are from the simulator. Emptied by an aircraft event, the
   * way the live client clears its table on a swap.
   */
  names: string[]
}

let playing: Playing | null = null

/**
 * Brings a capture written before `source` became `via` up to date.
 *
 * The field was renamed because both values named a transport rather than a
 * source — everything from the simulator *is* one source. But captures already
 * existed by then, in the repo as fixtures and in every user's app data, and
 * they are evidence: the files are read forgivingly rather than rewritten.
 *
 * Cheap to keep, and the alternative is a capture that silently replays with an
 * undefined transport.
 */
function migrate(event: CapturedEvent & { source?: SimVia }): CapturedEvent {
  if (event.via === undefined && event.source !== undefined) {
    const { source, ...rest } = event
    return { ...rest, via: source }
  }

  return event
}

/**
 * Reads a capture, tolerating a truncated last line and an older field name.
 *
 * A capture is append-only and the app may have been killed mid-write, so the
 * final line being half a JSON object is an ordinary outcome rather than a
 * corrupt file. Everything before it is still perfectly good evidence.
 */
export function readCapture(file: string): CapturedEvent[] {
  // `.gz` for committed fixtures. A slice worth keeping is still tens of
  // thousands of records of mostly-repeated variable names, which gzip takes
  // an order of magnitude off — and a fixture lives in the repository forever.
  // Live captures are written plain: they are appended to as a session runs.
  const bytes = fs.readFileSync(file)
  const lines = (
    file.endsWith(".gz") ? zlib.gunzipSync(bytes) : bytes
  )
    .toString("utf8")
    .split("\n")
  const events: CapturedEvent[] = []

  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue

    try {
      events.push(migrate(JSON.parse(line) as CapturedEvent & { source?: SimVia }))
    } catch {
      if (index === lines.length - 1) break
      console.warn(`replay: skipped unparseable line ${index + 1}`)
    }
  }

  return events
}

/**
 * Starts playback.
 *
 * `speed` multiplies the rate: 2 halves every gap, 0 delivers everything on the
 * next tick. The last is what tests want — the whole session, in order, with no
 * waiting — and it is why the schedule is computed from the original stamps
 * rather than by sleeping between events.
 */
export function startReplay(
  file: string,
  speed: number,
  emit: (event: CapturedEvent) => void,
  publish: () => void
): void {
  stopReplay()

  const events = readCapture(file)
  if (!events.length) {
    console.warn(`replay: ${file} has no events`)
    return
  }

  playing = { timers: [], aircraft: null, names: [] }

  const start = events[0]!.t

  for (const event of events) {
    const delay = speed > 0 ? (event.t - start) / speed : 0

    playing.timers.push(
      setTimeout(() => {
        if (!playing) return

        // The fields the chip and the index read. Tracked here rather than
        // derived in the session, because a replay has no SimConnect handle to
        // ask.
        if (event.kind === "aircraft") {
          playing.aircraft = event.key
          playing.names = []
        }
        if (event.kind === "input-events")
          playing.names = event.events.map((entry) => entry.name)

        emit(event)
        publish()
      }, delay)
    )
  }

  console.log(
    `replay: ${events.length} events from ${file}` +
      (speed > 0 ? ` at ${speed}×` : " as fast as possible")
  )
}

export function stopReplay(): void {
  if (!playing) return

  for (const timer of playing.timers) clearTimeout(timer)
  playing = null
}

/** What the chip and the index should see while replaying, or null when not. */
export function replayState(): {
  aircraft: string | null
  count: number
  names: string[]
} | null {
  return playing
    ? {
        aircraft: playing.aircraft,
        count: playing.names.length,
        names: playing.names,
      }
    : null
}
