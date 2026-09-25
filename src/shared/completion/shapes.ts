/**
 * How a variable is called at a position — what completion inserts for it.
 *
 * The index is keyed by identity: what a variable *is*, `K:KOHLSMAN_SET`,
 * `A:GENERAL ENG RPM`. A profile writes a form of it: `K:2:KOHLSMAN_SET` with
 * its operands in front, `A:GENERAL ENG RPM:1, rpm`, `B:…_Push`. Units,
 * indices, arity and an input event's suffix are one idea — the calling shape
 * at a position — and this is the one place that decides it, a row per
 * namespace, rather than four places each deciding a part.
 *
 * Which namespaces belong in which position at all is the descriptor table's
 * answer (`NAMESPACES`: `get`, `readable`, `writable`), the same answer the
 * `ns-access` diagnostic gives, so completion never offers what a squiggle
 * would then flag.
 */

import { documentedParams } from "../lang/rules/k-arity.ts"
import type { CorpusPosition, VarEntry } from "../types.ts"
import { NAMESPACES } from "../vars/namespaces.ts"
import { parseVar } from "../vars/parse.ts"

/** Where in an entry a name is being completed. */
export type NamePosition = CorpusPosition

export interface Shape {
  /** The text that replaces the name. */
  text: string
  /**
   * A snippet replacing the whole reference from its `(`, operands first —
   * a key event's calling shape. Monaco snippet syntax.
   */
  snippet?: string
  /** The unit inserted after the name on a `get:` line: `, Bool`. */
  units?: string
  /**
   * The name as a snippet, where part of it is the author's to choose — an
   * instance index, `A:GENERAL ENG RPM:${1:1}`. `text` is the same name with
   * the placeholder filled in.
   */
  template?: string
}

/** Snippet metacharacters that would be read as placeholders, escaped. */
function snippetText(text: string): string {
  return text.replace(/[\\$}]/g, "\\$&")
}

/**
 * The label for one documented parameter — `[1]: Altimeter index` becomes
 * `Altimeter index`, trimmed to something a placeholder can wear.
 */
export function parameterLabel(parameters: string, slot: number): string {
  const at = parameters.indexOf(`[${slot}]`)
  if (at === -1) return `p${slot}`

  const start = parameters.indexOf(":", at)
  if (start === -1) return `p${slot}`

  const next = parameters.indexOf("[", start)
  const raw = parameters.slice(start + 1, next === -1 ? undefined : next).trim()

  // First clause only, and short: this rides inside a placeholder, not a doc.
  const clause = raw.split(/[.,(]/)[0]!.trim()
  const label =
    clause.length > 32 ? `${clause.slice(0, 32).trimEnd()}…` : clause
  return label || `p${slot}`
}

/**
 * The whole calling shape for a multi-parameter key event.
 *
 * Operand order is the reversed documentation order — `[0]` is pushed last,
 * nearest the call — which FS Copilot's own ParseSet confirms by reversing
 * the args before transmission (docs/fscopilot-behavior.md). The final
 * placeholder is the `[0]` value, so tabbing runs outside-in.
 */
export function kEventSnippet(event: string, parameters: string): string {
  const count = documentedParams(parameters)

  const operands = []
  for (let slot = count - 1; slot >= 0; slot -= 1) {
    operands.push(
      `\${${count - slot}:${snippetText(parameterLabel(parameters, slot))}}`
    )
  }

  return `${operands.join(" ")} (>K:${count}:${event}`
}

/**
 * The corpus's commonest spelling of a variable at a position, or its name.
 *
 * `written` is absent when every use spells it as its name, so the name is
 * the answer then too. A spelling used only in another position is not
 * borrowed: `K:2:` belongs in a setter and would subscribe to an event named
 * `2:NAME` on a `get:` line.
 */
export function writtenForm(entry: VarEntry, position: NamePosition): string {
  const here = entry.corpus?.written?.find(
    (spelling) => spelling.at === position
  )
  return here?.form ?? entry.name
}

/**
 * The unit to write when a completion carries one.
 *
 * The commonest reading in the corpus, falling back to what the SDK documents.
 * For the thousands of names no profile has ever read, the documented unit is
 * the only one there has ever been.
 */
export function unitFor(entry: VarEntry): string | undefined {
  return entry.corpus?.units[0] ?? entry.sdk?.doc?.units
}

/**
 * Whether a written name belongs in a position at all.
 *
 * The namespace's row first, then the per-name exceptions the row cannot
 * carry: a variable the SDK documents as not settable, and the one writable
 * environment variable. A name with no namespace is left to the caller —
 * FS Copilot ignores it everywhere, and completion never offers one.
 */
export function belongsAt(
  form: string,
  position: NamePosition,
  entry?: VarEntry
): boolean {
  const ref = parseVar(form)
  if (ref.ns === null) return false

  const table = NAMESPACES[ref.ns]
  switch (position) {
    case "get":
    case "skp":
      return table.get !== null
    case "read":
      return table.readable
    case "write":
      if (!table.writable) return false
      // Documented and not settable: writing it is a no-op the sim never
      // reports. Undocumented A: names stay — absence of evidence.
      if (ref.ns === "A" && entry?.sdk?.doc?.settable === false) return false
      if (ref.ns === "E") return ref.name.toUpperCase() === "SIMULATION RATE"
      return true
  }
}

/**
 * What completion inserts for a variable at a position, or null to withhold
 * it.
 *
 * `form` is a spelling the caller already has — the one this file or this
 * entry wrote — and wins over the corpus's commonest.
 */
export function shape(
  entry: VarEntry,
  position: NamePosition,
  form = writtenForm(entry, position)
): Shape | null {
  if (!belongsAt(form, position, entry)) return null

  const ref = parseVar(form)

  if (ref.ns === "K") {
    // FS Copilot strips an arity only in setters: `get: K:2:FOO` subscribes
    // to an event named `2:FOO`.
    if (position === "get") return { text: `K:${ref.name}` }

    if (position === "write") {
      const parameters = entry.sdk?.doc?.parameters
      const count = parameters ? documentedParams(parameters) : 0
      if (parameters && count >= 2)
        return {
          text: `K:${count}:${ref.name}`,
          snippet: kEventSnippet(ref.name, parameters),
        }
    }
  }

  const indexed = instanceIndex(entry, form)

  if (position === "get" && ref.ns !== null) {
    // K: and H: take no unit: FS Copilot ignores one there.
    const units =
      NAMESPACES[ref.ns].units === "none" ? undefined : unitFor(entry)
    return { ...indexed, ...(units ? { units } : {}) }
  }

  return indexed
}

/**
 * An `A:` name the SDK documents with an instance index, completed with one.
 *
 * Only for a name no profile has spelled: the corpus's commonest spelling
 * already carries its index where profiles write one, and a documented index
 * that profiles leave off is evidence it can be left off. What is left is the
 * catalogue's indexed names — it documents an index for 449 — that nobody
 * here has used, offered with the index as a placeholder to tab to rather
 * than without one.
 */
function instanceIndex(entry: VarEntry, form: string): Shape {
  const ref = parseVar(form)
  if (
    ref.ns !== "A" ||
    ref.index !== null ||
    entry.corpus ||
    !entry.sdk?.doc?.index
  )
    return { text: form }

  return {
    text: `${form}:1`,
    template: `${snippetText(form)}:\${1:1}`,
  }
}
