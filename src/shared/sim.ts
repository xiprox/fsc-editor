/**
 * The simulator event contract, shared by main, preload, the renderer and the
 * replay script.
 *
 * Two layers live here and are deliberately not mixed.
 *
 * `SimEvent` is **what the simulator did** — the raw, unranked, uninterpreted
 * record. It is what gets written to a capture file and what stage 4's Activity
 * logic will be developed and tested against. Its shape has to survive being
 * read back a year from now by code that does not exist yet, so it says what
 * happened and nothing about what it means.
 *
 * `SimState` is **what the footer chip shows** — a summary, derived, thrown away
 * and recomputed freely. Nothing persists it.
 *
 * Keeping the split honest is what lets the interpretation change without
 * invalidating a single capture on disk.
 *
 * No runtime imports: this file is a contract between parts that are bundled
 * separately.
 */

/**
 * How an event reached us, not where it came from.
 *
 * Both are the simulator — `client` is SimConnect from the app, `link` is our
 * module inside the sim — and at the level of what an event *means* that
 * distinction is an implementation detail. A value is a value.
 *
 * It is kept because it answers one question nothing else can: which half of
 * the pipeline went quiet. That is a diagnostic, so it travels as `via` rather
 * than as the source, and the source of all of it is the sim.
 *
 * `app` is the exception that proves it: a mark did not come from the simulator
 * at all, it came from somebody pressing a key. It rides the same stream
 * because the whole point of a mark is *when* it happened relative to
 * everything else, and a separate list with its own clock would have to be
 * merged back against this one at every use.
 */
export type SimVia = "client" | "link" | "app"

/** The protocol MSFS answered on. Recorded because 2020 and 2024 differ. */
export type SimProtocol = "SunRise" | "KittyHawk"

/** One input event as enumeration describes it. */
export interface InputEventName {
  name: string
  /**
   * The sim's own id for the event, as a decimal string.
   *
   * A string rather than the `bigint` node-simconnect hands back, because this
   * crosses both JSON and the structured-clone boundary of IPC, and `bigint`
   * does not survive `JSON.stringify` at all — it throws. Converted at the two
   * edges that care.
   */
  hash: string
}

/**
 * One thing the simulator did.
 *
 * Every variant is a fact with a timestamp, never a conclusion. In particular
 * input events are recorded exactly as they arrive, **including the duplicate
 * that every interaction produces** — the pair 25-55 ms apart that stage 0
 * found. Collapsing them is Activity's job at read time, and doing it here
 * would destroy the evidence needed to ever find out whether the second event
 * is an echo or a genuine release.
 */
export type SimEvent =
  /** Connected. First line of every capture, and its de facto header. */
  | {
      kind: "open"
      protocol: SimProtocol
      /** e.g. "KittyHawk" or "SunRise", as the sim names itself. */
      app: string
      appVersion: string
      simConnectVersion: string
    }
  /**
   * Which aircraft is loaded. `key` is the SimObject folder name, which is what
   * profiles are named after; `path` is what the sim actually said, kept
   * because it is package-relative and the layout resolver will need it.
   */
  | { kind: "aircraft"; key: string | null; path: string }
  /** The full enumerated input-event list, right after connect. */
  | { kind: "input-events"; events: InputEventName[] }
  /**
   * An input event fired. Raw — see the note above about duplicates.
   *
   * `value` is `number | string` because that is what the sim sends: most
   * input events are numeric, and a few carry text. Narrowing it here would
   * mean a capture that cannot represent what actually happened.
   */
  | { kind: "input"; name: string; hash: string; value: number | string }
  /** A watched `A:` variable was delivered. */
  | { kind: "simvar"; name: string; units: string; value: number }
  /**
   * The Link module said hello, and how many `L:` variables it found.
   *
   * `protocol` is checked rather than logged: a module older than the app
   * expects is a state 04-connection has the chip render, not something to
   * discover from a wire that stopped making sense.
   */
  | { kind: "link"; version: string; protocol: number; variables: number }
  /**
   * A chunk of the `L:` enumeration, names indexed from `from`.
   *
   * Carried into the capture in full — ~6,150 names once — because a capture
   * has to be readable without the simulator that produced it. Values arrive
   * afterwards by id, and an id means nothing without this.
   */
  | { kind: "vars"; from: number; names: string[] }
  /**
   * One `L:` variable changed.
   *
   * By name rather than id, unlike the wire. The wire is talking to something
   * holding the enumeration; a capture is talking to a reader a year from now
   * who is not, and 03-link's principle that evidence stands alone outranks the
   * bytes.
   */
  | { kind: "var"; name: string; value: number }
  /**
   * A calculator expression the app asked the module to run, and what came
   * back.
   *
   * In the event stream rather than in a reply the caller keeps to itself,
   * because a run is an **anchor**: what a setter did is read off the
   * variables that moved after it, by the same ranking that reads an input
   * event. A capture missing its runs could not be replayed against that.
   *
   * `ok` is the calculator's verdict on the code — it parsed and ran — and
   * says nothing about whether the aircraft kept the value.
   */
  | { kind: "exec"; token: number; ok: boolean; value: number }
  /**
   * Somebody pressed the mark hotkey.
   *
   * In the capture rather than only in `marks.ts` because a capture is supposed
   * to be a complete record of a session, and a marking session without its
   * marks cannot be replayed — which is exactly the session where the ranking
   * needs work, since a mark is what anchors a control the sim never reported.
   * The mark carries no fields: `t` on the captured event is the whole of it.
   */
  | { kind: "mark" }
  /** The sim exited, or the connection dropped. Not an error state. */
  | { kind: "closed"; reason: string }

/**
 * A `SimEvent` as it is stored and transported: stamped, and attributed.
 *
 * `t` is `Date.now()` at the moment of receipt, in the app's clock. That is
 * explicitly *not* the sim's clock, and 03-link is right that one time base per
 * anchor is what proximity ranking wants — the module will carry its own stamp
 * when it arrives, and this field will stay as the receipt time it already is.
 */
export type CapturedEvent = { t: number; via: SimVia } & SimEvent

/**
 * What the footer chip renders.
 *
 * [04-connection](../../docs/sim-vars/04-connection.md)'s four states, which
 * are not four phases: three of them are about the connection and the fourth is
 * about whether a module is installed, and those two facts are independent. So
 * `installed` rides alongside the phase rather than inside it, the same shape
 * `CapturedEvent` uses above and for the same reason — one axis per question.
 *
 * The states the chip derives from the pair:
 *
 * | | Chip | |
 * | --- | --- | --- |
 * | not installed | `Install sim module` | muted. The pitch for this feature happens elsewhere; here it is a door, not a poster |
 * | installed, offline | `Sim offline` | not the user's problem. Say nothing louder |
 * | live, module silent | `Sim module not responding` | amber. The package is there and the sim has not loaded it |
 * | live, module talking | `Sim connected` | |
 *
 * Note what the first row costs: an app connected to a sim with no module
 * installed still reads `Install sim module`, because `A:` and `B:` working is
 * not the offer being made. That is deliberate — the offer is `L:`, which is
 * 84% of the corpus.
 *
 * ## There is no `connecting`
 *
 * There was, and it was permanent. It was derived from "the retry loop is
 * alive", which is true from launch until quit, so an app that had simply never
 * reached MSFS said `Connecting…` forever — and `offline`, the state this file
 * describes as the ordinary one, was reachable only after `stopSim`.
 *
 * Removing it rather than fixing the condition, because the condition was not
 * the problem. **The client is always trying** — that is 04-connection's rule,
 * and it is why there is no `simConnect()` in the API — so a phase meaning "an
 * attempt is in flight" is true almost always and interesting never. The one
 * moment it could have described honestly is the few milliseconds a local
 * socket takes to refuse a connection, which is a flicker rather than
 * information.
 *
 * Not connected is not connected. The app cannot tell "MSFS is closed" from
 * "MSFS is open and SimConnect refused" anyway — both arrive as ECONNREFUSED —
 * so the quiet, true thing to say is `Sim offline`.
 */
export type SimState = {
  /**
   * The Link module is installed in some Community folder.
   *
   * A fact about the filesystem, not about the connection, and it is what
   * separates an invitation from an instruction. Cached in main and refreshed
   * on startup and after any install — the answer changes about twice in an
   * application's lifetime.
   */
  installed: boolean
} & (
  | { phase: "offline" }
  | {
      phase: "live"
      /** SimObject folder name, e.g. `pa24-250`. Null until the sim says. */
      aircraft: string | null
      /** How many input events the loaded aircraft enumerates. */
      inputEvents: number
      /** Where this session is being written, for the capture indicator. */
      capture: string | null
      /**
       * The Link module, when one is installed and talking.
       *
       * Null is the ordinary case rather than a fault: the module is optional
       * and everything degrades to `A:`/`B:` without it. `outdated` is
       * 04-connection's fifth chip state — a module older than this app expects
       * offers a reinstall instead of failing on a wire that stopped agreeing.
       */
      link: { version: string; variables: number; outdated: boolean } | null
      /**
       * The module is installed, connected, and has not said anything — and
       * long enough has passed that its silence is an answer.
       *
       * The grace matters. The module replies to `start` within a frame or two,
       * so `link === null` is true for the first moment of *every* connection,
       * and a chip that read it directly would flash `Restart sim` at somebody
       * whose module is about to say hello. MSFS scans packages at boot, so
       * this is the one state whose instruction is worth being sure about
       * before giving it.
       */
      silent: boolean
    }
)

/** Pushed to the renderer. State changes only; raw events stay in main. */
export type SimStateEvent = { kind: "state"; state: SimState }

/**
 * One variable the editor wants a live value for.
 *
 * `name` carries its namespace exactly as the profile wrote it — `A:BATTERY
 * VOLTAGE`, `L:AdfOnOffKnob`. The renderer sends every `get:` it can see and
 * main routes by prefix: `A:` to SimConnect, `L:` to the module once there is
 * one, everything else ignored. That split is main's business precisely so the
 * module arriving does not mean touching the renderer.
 */
export interface SimVarWatch {
  name: string
  units: string
}

/** A live value, keyed the way the profile names it. */
export interface SimValue {
  /** Namespaced, as written — the key the editor looks up. */
  name: string
  units: string
  value: number
}

/**
 * How often the client retries while the sim is not running.
 *
 * Flat rather than backing off, unlike the relay's reconnect: "not running" is
 * the expected state here rather than a failure, the attempt is a local socket
 * that costs nothing, and the event worth catching quickly is a person starting
 * MSFS — after which they would like the chip to notice within a few seconds.
 */
export const SIM_RETRY_MS = 5_000

/** Capture files, one per connected session. */
export const CAPTURE_DIR = "captures"
export const CAPTURE_EXT = ".ndjson"
