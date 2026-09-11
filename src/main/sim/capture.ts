/**
 * Writes every simulator event to disk, one session per file.
 *
 * This exists because the sim is a slow, stateful, manual dependency and
 * Activity's real content — correlation and ranking — is pure logic over an
 * event stream. Captured once, all of it can be built and tuned with MSFS
 * closed, and the captures become vitest fixtures. The repo already works this
 * way with `diff-hunks.test.ts` and `scripts/remote-sandbox.ts`; this is the
 * same trick pointed at the simulator.
 *
 * NDJSON, append-only, one `CapturedEvent` per line. No separate header record:
 * the `open` event is always the first line and carries everything a header
 * would, which means a capture has exactly one shape to parse and a truncated
 * file is still a valid prefix of a session.
 *
 * ## Why this runs in packaged builds too
 *
 * It began as a development aid and is now also the evidence a debug report
 * carries — see docs/debug-report.md. The reports worth having are the ones for
 * issues nobody can reproduce on demand, which means the recording has to
 * already exist when somebody clicks the button. Asking a tester to turn
 * capture on and go and make it happen again only ever collects the bugs that
 * were never the problem.
 *
 * That turns the size into something real, so the stream is bounded in the two
 * ways it can run away: a session that never ends rolls into parts, and the
 * directory as a whole evicts its oldest.
 */

import fs from "node:fs"
import path from "node:path"

import {
  CAPTURE_DIR,
  CAPTURE_EXT,
  type CapturedEvent,
  type SimEvent,
  type SimVia,
} from "@shared/sim"

/**
 * What bounds the recording.
 *
 * Injected rather than read from a constant so the rolling and the eviction can
 * be tested at a scale a test can actually write. `run.ts` takes its simulator
 * the same way and for the same reason: the behaviour worth covering is at the
 * boundary, and a boundary at 25 MB is one no test will ever reach honestly.
 */
export interface CaptureLimits {
  /**
   * How large one part grows before the next is started.
   *
   * The measured rate is ~957 events a second, which is roughly 200 MB an hour
   * — so a long-haul flight is not a corner case, it is Tuesday. 25 MB is about
   * seven minutes, which makes the eviction below granular enough that losing
   * the oldest part is never losing the last half hour.
   */
  partBytes: number
  /**
   * How much the whole directory is allowed to hold.
   *
   * Four parts at the size above. Enough to still contain the session somebody
   * is about to report on, and small enough to sit in an app data folder
   * without ever being the reason a disk filled.
   */
  dirBytes: number
}

export const CAPTURE_LIMITS: CaptureLimits = {
  partBytes: 25 * 1024 * 1024,
  dirBytes: 100 * 1024 * 1024,
}

/**
 * The events a capture cannot be read without.
 *
 * Which aircraft, what the input events are called, what the `L:` names are —
 * all announced in the first seconds of a session and never repeated. A part
 * that does not carry them is a file of values by name with nothing to say what
 * session produced them, so each part re-emits the last of each.
 *
 * `vars` is plural because the `L:` enumeration arrives as chunks and all of
 * them together are the table; the others replace their predecessor.
 */
interface Announcements {
  open: CapturedEvent | null
  aircraft: CapturedEvent | null
  inputEvents: CapturedEvent | null
  vars: CapturedEvent[]
}

interface Live {
  stream: fs.WriteStream
  limits: CaptureLimits
  /** Where it is being written now — a timestamp, before the rename. */
  file: string
  dir: string
  userData: string
  /** Shared by every part of one session, so parts sort and group together. */
  stamp: string
  /** 1-based. Part 1 carries no suffix, so the common case looks unchanged. */
  part: number
  /** Bytes in the current part, for the roll. */
  bytes: number
  /** Learned from the first `aircraft` event, and used to rename at the end. */
  aircraft: string | null
  announcements: Announcements
}

let live: Live | null = null

/**
 * The newest part written, whether or not a session is still live.
 *
 * What `prune` must not evict, and not the same thing as `captureFile()`. A
 * part's close callback can run long after the session that queued it ended —
 * a burst of rolls queues one per part and the flushes land when the disk says
 * so — and by then `live` is null. Asked for the file "being written now",
 * every one of those late prunes is told there is none, and evicts the last
 * part of the session somebody is about to report on: the one file the cap
 * exists to keep.
 */
let newest: string | null = null

/** `2026-08-23T09-51-02` — sortable, and legal on Windows. */
function stamp(at: Date): string {
  return at.toISOString().slice(0, 19).replace(/:/g, "-")
}

/** How many characters of a capture's name `stamp` above accounts for. */
const STAMP_CHARS = 19

/**
 * `2026-08-23T09-51-02-pa24-250.p2.ndjson`.
 *
 * Built rather than patched. An earlier version renamed by substituting into
 * the path, which works for one part and stops being obvious the moment there
 * are two names in play.
 */
function nameFor(at: string, aircraft: string | null, part: number): string {
  const named = aircraft ? `${at}-${aircraft}` : at
  return `${named}${part > 1 ? `.p${part}` : ""}${CAPTURE_EXT}`
}

/**
 * Where one capture sorts: its session's stamp, then its part number.
 *
 * Read rather than inferred from the name, because the name does not sort.
 * `.p10` comes before `.p9` as text, so from the tenth part on, a session
 * ordered by name is in nobody's order — not the disk's and not its own. That
 * is the order `prune` evicts in and the order a debug report is assembled in,
 * so past nine parts both were reaching for whatever sorted early rather than
 * for whatever was oldest.
 *
 * The aircraft between the two, when there is one, is deliberately not part of
 * this: it is learned at the end and identifies the session, not its place.
 */
function orderOf(name: string): [string, number] {
  const part = /\.p(\d+)$/.exec(name.slice(0, -CAPTURE_EXT.length))
  return [name.slice(0, STAMP_CHARS), part ? Number(part[1]) : 1]
}

/** Every capture on disk, oldest first. */
export function captureFiles(userData: string): string[] {
  const dir = path.join(userData, CAPTURE_DIR)

  try {
    return fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(CAPTURE_EXT))
      .map((name): [string, [string, number]] => [name, orderOf(name)])
      .sort(([, [aAt, aPart]], [, [bAt, bPart]]) =>
        aAt === bAt ? aPart - bPart : aAt < bAt ? -1 : 1
      )
      .map(([name]) => path.join(dir, name))
  } catch {
    return []
  }
}

/**
 * Evicts oldest-first until the directory is under its cap.
 *
 * `keep` is the newest part, which is never a candidate: the point of the cap
 * is to bound history, and the part a session just finished — or is filling
 * right now — is not history. Failure is silent by design — an undeletable
 * capture is a directory slightly over its budget, which is not worth a word
 * to anybody.
 */
function prune(
  userData: string,
  keep: string | null,
  limits: CaptureLimits
): void {
  const files = captureFiles(userData)
    .filter((file) => file !== keep)
    .map((file) => {
      try {
        return { file, bytes: fs.statSync(file).size }
      } catch {
        return { file, bytes: 0 }
      }
    })

  let total = files.reduce((sum, one) => sum + one.bytes, 0)

  for (const one of files) {
    if (total <= limits.dirBytes) return

    try {
      fs.rmSync(one.file)
      total -= one.bytes
    } catch {
      // Locked by something reading it. The next start tries again.
    }
  }
}

/** Opens one part's stream, wired for failure. Null if the disk says no. */
function openPart(file: string): fs.WriteStream | null {
  try {
    const stream = fs.createWriteStream(file, { flags: "a" })

    // A write error after opening — disk full, drive yanked — arrives here
    // rather than as an uncaught exception that would take the process down.
    stream.on("error", (error) => {
      console.error(`capture: stopped writing — ${error.message}`)
      live = null
    })

    return stream
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`capture: could not start — ${reason}`)
    return null
  }
}

/**
 * Opens a capture for a session that has just connected.
 *
 * Failure to write a capture must never stop the app connecting to the sim: a
 * read-only disk is not a reason to lose live values. Every failure here
 * degrades to "no capture" and says so once.
 */
export function startCapture(
  userData: string,
  limits: CaptureLimits = CAPTURE_LIMITS
): string | null {
  void stopCapture()

  try {
    const dir = path.join(userData, CAPTURE_DIR)
    fs.mkdirSync(dir, { recursive: true })

    // Before the new file exists, so the session about to be written has its
    // room made for it rather than being what pushes the directory over.
    prune(userData, null, limits)

    const at = stamp(new Date())
    const file = path.join(dir, nameFor(at, null, 1))

    const stream = openPart(file)
    if (!stream) return null

    newest = file
    live = {
      stream,
      limits,
      file,
      dir,
      userData,
      stamp: at,
      part: 1,
      bytes: 0,
      aircraft: null,
      announcements: {
        open: null,
        aircraft: null,
        inputEvents: null,
        vars: [],
      },
    }

    return file
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`capture: could not start — ${reason}`)
    return null
  }
}

/** Keeps what a later part will have to re-announce to stand on its own. */
function announce(current: Live, captured: CapturedEvent): void {
  const held = current.announcements

  if (captured.kind === "open") held.open = captured
  else if (captured.kind === "aircraft") held.aircraft = captured
  else if (captured.kind === "input-events") held.inputEvents = captured
  else if (captured.kind === "vars") held.vars.push(captured)
}

/**
 * Ends the current part and opens the next, re-announcing into it.
 *
 * The header events are **re-timed**, to a second before the part opens and a
 * millisecond apart. Left at their original stamps a replay would sit through
 * the gap between the enumeration and the part, because it plays gaps
 * faithfully — and a reader that sorts on `t` would interleave them with the
 * previous part. Timing of everything after them is untouched, which is the
 * whole point: proximity ranking is a claim about milliseconds.
 *
 * This is the rule `scripts/slice-capture.ts` already applies, so there is one
 * meaning in the repo of a capture that stands alone.
 */
function roll(current: Live): void {
  const { announcements, aircraft, dir, userData, limits, stamp: at } = current
  const part = current.part + 1
  const file = path.join(dir, nameFor(at, null, part))

  void closePart(current)

  const stream = openPart(file)
  if (!stream) {
    live = null
    return
  }

  newest = file

  const next: Live = {
    stream,
    limits,
    file,
    dir,
    userData,
    stamp: at,
    part,
    bytes: 0,
    aircraft,
    announcements,
  }
  live = next

  const header = [
    announcements.open,
    announcements.aircraft,
    announcements.inputEvents,
    ...announcements.vars,
  ].filter((event): event is CapturedEvent => event !== null)

  const base = Date.now() - 1_000 - header.length
  for (const [index, event] of header.entries())
    write(next, { ...event, t: base + index })
}

/** One line out, and the accounting the roll is decided on. */
function write(current: Live, captured: CapturedEvent): void {
  const line = `${JSON.stringify(captured)}\n`

  // Not awaited. Backpressure on a local append is not a thing worth making
  // the event path asynchronous for, and dropping an event to keep the stream
  // tidy would be the wrong trade in a file whose entire purpose is evidence.
  current.stream.write(line)
  current.bytes += Buffer.byteLength(line)
}

/**
 * Records one event, stamping and attributing it on the way through.
 *
 * Returns what it wrote so the caller can push the same object at anything else
 * that wants it — there is one construction of a `CapturedEvent` in the app,
 * and it is this one, so what the renderer eventually sees and what a fixture
 * replays can never drift apart.
 */
export function record(event: SimEvent, via: SimVia): CapturedEvent {
  const captured: CapturedEvent = { t: Date.now(), via, ...event }
  const current = live
  if (!current) return captured

  if (event.kind === "aircraft") current.aircraft = event.key

  announce(current, captured)
  write(current, captured)

  // After the write rather than before it, so a part never ends one event short
  // of the size that justified rolling.
  if (current.bytes >= current.limits.partBytes) roll(current)

  return captured
}

/**
 * Closes one part, and only then renames it to include the aircraft.
 *
 * The rename happens last because Windows will not rename a file with an open
 * handle. Everything needed to identify a session is inside the file already,
 * so a capture left with its timestamp name by a crash has lost nothing but
 * convenience.
 *
 * Resolves when the part is finished with — flushed, named and accounted for.
 * Nothing in the app waits on that; the tests do, and a capture that lands on
 * the OS's schedule is otherwise only observable by guessing how long to wait.
 */
function closePart(current: Live): Promise<void> {
  const {
    stream,
    file,
    dir,
    userData,
    limits,
    stamp: at,
    aircraft,
    part,
  } = current

  return new Promise((closed) => {
    stream.end(() => {
      if (aircraft)
        try {
          const named = path.join(dir, nameFor(at, aircraft, part))
          fs.renameSync(file, named)
          // The part carries its aircraft now, so anything holding the old
          // name is holding a path that no longer exists — `newest` included,
          // and it is the one name below that has to still mean a file.
          if (newest === file) newest = named
        } catch {
          // Keeping the timestamp name is a fine outcome; the aircraft is in
          // the file's first lines either way.
        }

      /*
       * Here rather than at the roll, because Windows will not delete a file
       * whose handle is still open — and at the moment a roll decides to
       * evict, the part it wants gone is the one that has just been asked to
       * close. Both attempts failed silently and the directory grew without
       * limit, which is the whole thing this cap exists to prevent.
       *
       * `newest` rather than a captured name: by the time this runs the
       * session may be on its next part, or over, and what must survive is the
       * last part there is — see the declaration for why `captureFile()` is
       * not that.
       */
      prune(userData, newest, limits)
      closed()
    })
  })
}

/** Ends the session. Resolves once the last part has landed on disk. */
export function stopCapture(): Promise<void> {
  if (!live) return Promise.resolve()

  const current = live
  live = null
  return closePart(current)
}

/** Where the current session is being written, for the chip. Null when not. */
export function captureFile(): string | null {
  return live?.file ?? null
}
