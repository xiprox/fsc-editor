/**
 * One parser for variable names, and the only place a colon is ever counted.
 *
 * Before this file, eight call sites each held a private regex or
 * `startsWith` for "what is this name" — each true of a slightly different
 * set of namespaces, and each wrong somewhere the others were not: `L:1:X`
 * filed as an ordinary `L:`, `K:2:EVENT` split at the wrong colon, `Z:` a
 * stranger to the `L:1:` it is a spelling of. Adding a namespace meant
 * finding all eight. Now they ask here, and the answer is a typed reference
 * rather than a string to re-inspect.
 *
 * What the sim actually means by each shape — verified against the SDK docs,
 * Asobo's own templates, and the module 0.4.0 probe — is recorded in
 * docs/sim-vars/build/v1-log.md ("The typed variable API works").
 */

/**
 * The sim's own taxonomy, one id per storage family.
 *
 * `Z` covers both spellings — `Z:NAME` and `L:1:NAME` name the same
 * per-simobject table, which `MSFS_Vars.h` states outright ("ZVar are also
 * called L:1"). `P` is documented as an alias of `E` and kept separate only
 * because a profile could write it and the written form matters to display.
 */
export type NamespaceId =
  | "A"
  | "B"
  | "C"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "K"
  | "L"
  | "M"
  | "O"
  | "P"
  | "R"
  | "W"
  | "X"
  | "Z"

/** The auto-generated input-event operations, plus the common vendor extras. */
export type InputEventOp = "set" | "inc" | "dec" | "toggle" | "on" | "off"

/**
 * A parsed variable name.
 *
 * `full` is always the string as written — the identity every store already
 * keys on, kept verbatim so adopting the parser never rewrites what a profile
 * said. The variants carry what the namespace gives structure to:
 *
 * - `A:` has instance indices — `A:ENG RPM:2` is engine 2 of one variable.
 *   No other namespace does: `L:A32NX_AUTOTHRUST_TLA:1` is a complete name
 *   in the sim's table, and stripping its `:1` produces a variable that does
 *   not exist. That mistake shipped; this type is why it cannot re-ship.
 * - `L:` is the session-global table. `Z:` is the per-simobject one, reached
 *   by two spellings, so the written form is carried for display.
 * - `K:` may carry an arity — `K:2:EVENT` passes two stack parameters.
 * - `B:` writes name an operation suffix; `preset` is the switch itself,
 *   so three generated events can be recognised as one control.
 * - `O:`/`I:` may carry a component path ahead of the final name segment.
 */
export type VarRef =
  | { ns: "A"; full: string; name: string; index: number | null }
  | { ns: "L"; full: string; name: string }
  | { ns: "Z"; full: string; name: string; written: "Z:" | "L:1:" }
  | { ns: "K"; full: string; name: string; params: number }
  | { ns: "B"; full: string; name: string; preset: string; op: InputEventOp | null }
  | { ns: "I" | "O"; full: string; name: string; path: string | null }
  | {
      ns: "C" | "E" | "F" | "G" | "H" | "M" | "P" | "R" | "W" | "X"
      full: string
      name: string
    }
  | { ns: null; full: string; name: string }

const KNOWN = new Set("ABCEFGHIKLMOPRWXZ")

/** `A:NAME:3` — an instance index, an `A:` concept and only an `A:` one. */
const INDEXED = /^(.*):(\d+)$/

/** `K:2:EVENT` — a stack arity ahead of the event name. */
const ARITY = /^(\d+):(.+)$/

/** `B:Switch_Set` — the generated operations, in any of the cases vendors use. */
const INPUT_OP = /_(set|inc|dec|toggle|on|off)$/i

/**
 * Parses one written name.
 *
 * A prefix is a single known letter and a colon with something after it;
 * anything else — an unknown letter, a bare name, an empty rest — is `ns:
 * null` with the whole string as the name. Case is accepted either way and
 * normalised in `ns`; `full` keeps what was written.
 *
 * `ns: null` covers two unlike things, which is why nothing should read a
 * verdict out of it. FS Copilot routes a `get:` by prefix — `L:`, `A:`, `H:`
 * and `K:` each have their own path, and **any** other letter with a colon
 * after it goes to the sim module as a client variable. A name with no colon
 * at the second character reaches neither: see the `bare-name-not-streamed`
 * fact.
 */
export function parseVar(full: string): VarRef {
  const prefixed = /^([A-Za-z]):(.+)$/.exec(full)
  if (!prefixed) return { ns: null, full, name: full }

  const letter = prefixed[1].toUpperCase()
  const rest = prefixed[2]
  if (!KNOWN.has(letter)) return { ns: null, full, name: full }

  switch (letter as NamespaceId) {
    case "A": {
      const indexed = INDEXED.exec(rest)
      if (indexed)
        return { ns: "A", full, name: indexed[1], index: Number(indexed[2]) }
      return { ns: "A", full, name: rest, index: null }
    }

    case "L": {
      // `L:1:` is the per-simobject table under its other spelling. `L:2:` is
      // nothing — only the literal 1 marks the scope, so anything else stays
      // part of an ordinary L: name.
      if (rest.startsWith("1:") && rest.length > 2)
        return { ns: "Z", full, name: rest.slice(2), written: "L:1:" }
      return { ns: "L", full, name: rest }
    }

    case "Z":
      return { ns: "Z", full, name: rest, written: "Z:" }

    case "K": {
      const arity = ARITY.exec(rest)
      if (arity)
        return { ns: "K", full, name: arity[2], params: Number(arity[1]) }
      return { ns: "K", full, name: rest, params: 1 }
    }

    case "B": {
      const op = INPUT_OP.exec(rest)
      return {
        ns: "B",
        full,
        name: rest,
        preset: op ? rest.slice(0, -op[0].length) : rest,
        op: op ? (op[1].toLowerCase() as InputEventOp) : null,
      }
    }

    case "I":
    case "O": {
      // `O:Path:To:Component@alias:NAME` — the SimConnect datum form. The
      // final segment is the variable; everything before it is where it
      // lives. A plain `I:NAME`, which is all the corpus writes, has no path.
      const at = rest.lastIndexOf(":")
      if (at > 0)
        return {
          ns: letter as "I" | "O",
          full,
          name: rest.slice(at + 1),
          path: rest.slice(0, at),
        }
      return { ns: letter as "I" | "O", full, name: rest, path: null }
    }

    default:
      return {
        ns: letter as "C" | "E" | "F" | "G" | "H" | "M" | "P" | "R" | "W" | "X",
        full,
        name: rest,
      }
  }
}

/**
 * A variable's identity — what folds usages of one variable into one entry.
 *
 * Two normalisations happen here and nowhere else: an `A:` instance index is
 * stripped (`A:ADF ACTIVE FREQUENCY:1` and `:2` are one variable read twice),
 * and synonymous spellings collapse (`L:1:X` is `Z:X`, `K:2:E` is `K:E` —
 * the arity is how it was called, not what it is).
 *
 * A `B:` operation suffix is deliberately **kept**: folding `_Set`/`_Inc`/
 * `_Dec` into their preset changes what the variables panel lists, which is a
 * product decision the panel has not made yet. When it does, this is the one
 * line that changes.
 */
export function varIdentity(ref: VarRef): string {
  if (ref.ns === null) return ref.full
  if (ref.ns === "I" || ref.ns === "O")
    return `${ref.ns}:${ref.path ? `${ref.path}:` : ""}${ref.name}`
  return `${ref.ns}:${ref.name}`
}

/**
 * The columns the corpus database caches for one written name.
 *
 * Shared by the live insert and the migration that re-derives old rows, so
 * the two cannot disagree. `identity()` on these columns must equal
 * `varIdentity(parseVar(fullName))` — asserted in the tests.
 */
export function varColumns(fullName: string): {
  namespace: string
  name: string
  index: string | null
} {
  const ref = parseVar(fullName)

  if (ref.ns === null) return { namespace: "", name: ref.full, index: null }
  if (ref.ns === "A")
    return {
      namespace: "A",
      name: ref.name,
      index: ref.index === null ? null : String(ref.index),
    }
  if (ref.ns === "I" || ref.ns === "O")
    return {
      namespace: ref.ns,
      name: ref.path ? `${ref.path}:${ref.name}` : ref.name,
      index: null,
    }
  return { namespace: ref.ns, name: ref.name, index: null }
}
