/**
 * What can be done with each namespace — a table, not branches.
 *
 * Every entry here used to be a private opinion at some call site: the
 * variables panel knew `A:` and `L:` were readable, the session knew `A:`
 * went into a data definition, the store knew which watch asked for a unit.
 * Each was true of a slightly different set. This table is those opinions
 * written once. It was seeded with exactly what the call sites believed;
 * protocol 4 then changed two rows in place — `Z:` and `E:` gained the
 * module's typed-id watch reader — which is the table doing its job: a
 * namespace's capability is one row, not a hunt.
 *
 * `why` is not documentation — it is UI copy. Wherever `read` is null, the
 * value cell renders the sentence instead of a blank, which is what turns an
 * unreadable namespace from a hole into a supported case.
 */

import { parseVar, type NamespaceId } from "./parse.ts"

export interface Namespace {
  id: NamespaceId
  /** Short lowercase noun for tooltips and reports. */
  label: string
  /**
   * How a live value arrives, or null when one cannot (yet).
   *
   * `definition` — a SimConnect data definition, read per sim frame.
   * `stream`     — the Link module's enumerated table, diffed at 15 Hz.
   * `watch`      — the Link module reads it by typed id, because the app
   *                asked — same tick, same deadband, same wire as the stream.
   * `input`      — one `getInputEvent` when the name enters the watch set,
   *                and `subscribeInputEvent` for everything after. The only
   *                mode whose updates were already arriving before the app
   *                asked for them: the whole table is subscribed on every
   *                aircraft load, for Activity's sake.
   */
  read: "definition" | "stream" | "watch" | "input" | null
  /**
   * Shown wherever `read` is null. Written for a person, not a log.
   *
   * `B:` carries one while being readable, which is the exception that proves
   * the rule: its read covers every value the simulator has ever produced, and
   * `why` names the one case it drops rather than the whole namespace.
   */
  why?: string
  /** Where the list of names comes from, when one exists at all. */
  enumerable: "catalog" | "runtime" | "none"
  /** Who owns the value's lifetime. */
  scope:
    | "simobject"
    | "session"
    | "instrument"
    | "component"
    | "global"
    | "gauge"
    | "mission"
  /**
   * Units the panel requests when watching one without a profile line.
   * `Number` asks SimConnect to convert; `""` reads raw, which is what the
   * module streams and the only honest request for everything else.
   */
  watchUnits: "Number" | ""
  /**
   * What a units argument means on a reference to this namespace.
   * `converted` — the sim converts on request; `raw` — storage is a bare
   * number and a unit is at most a display hint; `none` — the reference is
   * an event or lookup and a unit is meaningless on it.
   */
  units: "converted" | "raw" | "none"
}

export const NAMESPACES: Record<NamespaceId, Namespace> = {
  A: {
    id: "A",
    label: "simulation variable",
    read: "definition",
    enumerable: "catalog",
    scope: "simobject",
    watchUnits: "Number",
    units: "converted",
  },
  L: {
    id: "L",
    label: "local variable",
    read: "stream",
    enumerable: "runtime",
    scope: "session",
    watchUnits: "",
    units: "raw",
  },
  Z: {
    id: "Z",
    label: "simobject variable",
    read: "watch",
    enumerable: "none",
    scope: "simobject",
    watchUnits: "",
    units: "raw",
  },
  K: {
    id: "K",
    label: "key event",
    read: null,
    why: "a key event is fired, not read",
    enumerable: "catalog",
    scope: "global",
    watchUnits: "",
    units: "none",
  },
  B: {
    id: "B",
    label: "input event",
    read: "input",
    /*
     * `why` is kept for the remainder the read does not cover. The A220's 464
     * events all declare `DOUBLE` and all answered numerically, so nothing has
     * ever exercised this — see step 5 of b-values-plan.md.
     */
    why: "an input-event value that is not a number is ignored",
    enumerable: "runtime",
    scope: "simobject",
    watchUnits: "",
    /*
     * `raw`, not `converted`: nothing converts an input-event value. The old
     * `converted` was inherited from a row nobody could read, so no call site
     * had ever acted on it.
     */
    units: "raw",
  },
  H: {
    id: "H",
    label: "HTML event",
    read: null,
    why: "a one-way message into the aircraft's JavaScript — observable when it fires, never readable",
    enumerable: "none",
    scope: "simobject",
    watchUnits: "",
    units: "none",
  },
  E: {
    id: "E",
    label: "environment variable",
    read: "watch",
    enumerable: "catalog",
    scope: "global",
    watchUnits: "",
    units: "converted",
  },
  P: {
    id: "P",
    label: "environment variable",
    read: null,
    why: "an alias of E: nothing reads — write it as E: for a live value",
    enumerable: "catalog",
    scope: "global",
    watchUnits: "",
    units: "converted",
  },
  I: {
    id: "I",
    label: "instrument variable",
    read: null,
    why: "instrument-scoped storage the sim module does not read yet",
    enumerable: "none",
    scope: "instrument",
    watchUnits: "",
    units: "raw",
  },
  O: {
    id: "O",
    label: "component variable",
    read: null,
    why: "component-scoped storage the sim module does not read yet",
    enumerable: "none",
    scope: "component",
    watchUnits: "",
    units: "raw",
  },
  M: {
    id: "M",
    label: "mouse variable",
    read: null,
    why: "only exists inside a mouse callback, in the aircraft's own code",
    enumerable: "none",
    scope: "component",
    watchUnits: "",
    units: "raw",
  },
  G: {
    id: "G",
    label: "gauge variable",
    read: null,
    why: "gauge-to-gauge transfer, unreachable from outside the gauge system",
    enumerable: "none",
    scope: "gauge",
    watchUnits: "",
    units: "none",
  },
  C: {
    id: "C",
    label: "GPS variable",
    read: null,
    why: "a legacy GPS callback, unreachable from outside the gauge system",
    enumerable: "catalog",
    scope: "gauge",
    watchUnits: "",
    units: "converted",
  },
  F: {
    id: "F",
    label: "function",
    read: null,
    why: "a calculator function, not storage",
    enumerable: "catalog",
    scope: "global",
    watchUnits: "",
    units: "none",
  },
  R: {
    id: "R",
    label: "resource string",
    read: null,
    why: "a localisation lookup, not a value",
    enumerable: "none",
    scope: "global",
    watchUnits: "",
    units: "none",
  },
  W: {
    id: "W",
    label: "sound event",
    read: null,
    why: "a Wwise audio trigger, fired rather than read",
    enumerable: "none",
    scope: "global",
    watchUnits: "",
    units: "none",
  },
  X: {
    id: "X",
    label: "mission variable",
    read: null,
    why: "a mission-script parameter, meaningless outside its mission",
    enumerable: "none",
    scope: "mission",
    watchUnits: "",
    units: "raw",
  },
}

/** The descriptor for a written name, or null for one with no namespace. */
export function namespaceOf(name: string): Namespace | null {
  const ns = parseVar(name).ns
  return ns === null ? null : NAMESPACES[ns]
}

/**
 * How a live value for this name arrives, or null when it cannot.
 *
 * Null for a bare name too: with no namespace there is nothing to ask the
 * simulator for, which is the same answer as a namespace nothing serves.
 */
export function readOf(
  name: string
): "definition" | "stream" | "watch" | "input" | null {
  return namespaceOf(name)?.read ?? null
}

/** Units for a panel-initiated watch — see `Namespace.watchUnits`. */
export function watchUnitsOf(name: string): string {
  return namespaceOf(name)?.watchUnits ?? ""
}
