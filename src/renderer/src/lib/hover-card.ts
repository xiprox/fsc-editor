/**
 * The ref-specific half of a hover, built without Monaco in the room.
 *
 * `refCard` is what the hover shows, and it is deliberately four parts and
 * no more: what the name is, what it does, the **one** thing that matters
 * about it in the position it is written in, and how much company it has.
 *
 * It used to be two stacked sections — this file's header, then everything
 * `documentation()` in completions.ts knows — and ran a screen tall, which
 * is a way of saying nothing. `documentation()` still assembles the samples,
 * the file list and the headings for completion's panel, a venue with room
 * for them; they return to the hover through the Reference panel when there
 * is one.
 *
 * `refHeader` is the older, everything-it-can-think-of form. Nothing in the
 * app renders it now; it stays as the pieces `refCard` picks from, and
 * because a card is easier to judge against the thing it replaced.
 */

import { documentedParams, type IrNode, type TokenHit } from "@shared/lang"
import { parameterLabel } from "@shared/completion"
import { NAMESPACES } from "@shared/vars"
import type { VarEntry } from "@shared/types"

type RefNode = Extract<IrNode, { kind: "ref" }>

export interface RefHoverContext {
  /** Which position the name sits in — meaning differs per position. */
  where: "get" | "skp" | "expression"
  entry?: VarEntry
  /** Corpus entries writing this exact name, when in write position. */
  writeCount?: number
}

/**
 * What `skp:` does, for the one position it means anything in.
 *
 * Said once because `refHeader` and `refCard` both show it, and a sentence
 * kept in two places is how this one came to be wrong in four.
 */
const SKP_NOTE =
  "_`skp:` names another variable whose next change is not sent when this " +
  "entry sends — from a `shared:` entry only, within 2 seconds_"

/** The one-line nature of each namespace, scope included where it bites. */
function natureOf(node: RefNode): string {
  const ns = node.ref.ns
  if (ns === null) return "a bare name — with no prefix it reaches neither the sim nor the calculator"

  const label = NAMESPACES[ns].label
  switch (ns) {
    case "L":
      return `${label} — session-global, shared by every add-on`
    case "Z":
      return `${label} — per-aircraft (\`Z:\` and \`L:1:\` are the same table)`
    case "B":
      return node.ref.op === null
        ? `${label} — preset \`${node.ref.preset}\``
        : `${label} — preset \`${node.ref.preset}\`, operation \`_${node.ref.op}\``
    case "K":
      return node.ref.name.startsWith("#")
        ? `${label} — fired by numeric id`
        : label
    default:
      return label
  }
}

/**
 * Notes about the *direction* of use — the mistakes hover can head off
 * before a diagnostic ever needs to. Mirrors the ns-access and b-write-op
 * rules; same facts, gentler venue.
 */
function accessNotes(node: RefNode, context: RefHoverContext): string[] {
  const notes: string[] = []
  const ns = node.ref.ns
  if (ns === null) return notes

  if (context.where === "expression") {
    if (node.access === "read") {
      if (ns === "K") notes.push("_a key event is fired, not read — `(K:…)` reads nothing_")
      if (ns === "H")
        notes.push("_a one-way message into the aircraft's JavaScript — there is no value to read_")
      if (ns === "W") notes.push("_a sound trigger is fired, not read_")
      if (ns === "B" && node.ref.op !== null)
        notes.push(
          `_reads the \`_${node.ref.op}\` operation — the switch's value lives on \`B:${node.ref.preset}\`_`
        )
    }

    if (node.access === "write") {
      if (ns === "B" && node.ref.op === null)
        notes.push(
          "_whether a bare write lands is up to the aircraft — most state presets take `_Set`, `_Inc`, `_Dec`, but a preset named for an action often is the write_"
        )
      if (ns === "E" && node.ref.name.toUpperCase() !== "SIMULATION RATE")
        notes.push("_environment variables are read-only — SIMULATION RATE is the one exception_")
      if (entryNotSettable(context))
        notes.push("_documented as not settable — set it by firing its key event_")
    }
  }

  if (context.where === "get" && ns === "K")
    notes.push("_in a `get:`, a key event is the sync itself: fired here when the other side fires it_")
  if (context.where === "get" && ns === "B" && node.ref.op !== null)
    notes.push("_in a `get:`, a suffixed input event subscribes to that operation firing_")

  return notes
}

function entryNotSettable(context: RefHoverContext): boolean {
  return context.entry?.sdk?.doc?.settable === false
}

/** The K: arity against the catalogue — confirmation or a heads-up. */
function arityNote(node: RefNode, context: RefHoverContext): string | null {
  if (node.ref.ns !== "K") return null

  const parameters = context.entry?.sdk?.doc?.parameters
  if (!parameters) return null

  const documented = documentedParams(parameters)
  if (documented === 0) return null
  const written = node.ref.params

  if (written === documented) {
    return documented >= 2
      ? `takes ${documented} parameters, pushed **reversed** — \`[0]\` last, nearest the call`
      : null
  }

  if (written < documented)
    return `⚠ documented with ${documented} parameters — this call passes ${written}; missing \`K:${documented}:\`?`

  return `⚠ documented with ${documented} parameter${documented === 1 ? "" : "s"} — the \`K:${written}:\` form passes ${written}`
}

/** The unit argument, judged by the namespace's relationship to units. */
function unitNote(node: RefNode): string | null {
  if (!node.unit) return null
  const ns = node.ref.ns
  if (ns === null) return null

  const units = NAMESPACES[ns].units
  if (units === "none")
    return `_the \`, ${node.unit}\` here decides nothing — a ${NAMESPACES[ns].label} has no units_`
  if (units === "raw")
    return `read raw; \`${node.unit}\` is a display hint`
  return `asked in \`${node.unit}\``
}

export function refHeader(node: RefNode, context: RefHoverContext): string {
  const lines: string[] = []

  lines.push(`**\`${node.ref.full}\`** — ${natureOf(node)}`)

  const arity = arityNote(node, context)
  if (arity) lines.push("", arity)

  const unit = unitNote(node)
  if (unit) lines.push("", unit)

  for (const note of accessNotes(node, context)) lines.push("", note)

  if (context.where === "skp")
    lines.push("", SKP_NOTE)

  if (context.where === "expression" && node.access === "write" && context.writeCount)
    lines.push(
      "",
      `written by ${context.writeCount} corpus ${context.writeCount === 1 ? "entry" : "entries"}`
    )

  return lines.join("\n")
}

/**
 * The description, and where it came from.
 *
 * A comment somebody left in a profile wins: it is about this variable in
 * this aeroplane, where the catalogue's line is about the variable in
 * general. The source is named because the two are worth different amounts.
 */
function describe(entry: VarEntry | undefined): string | null {
  if (entry?.corpus?.doc) return `${entry.corpus.doc}  _· from a profile_`
  const sdk = entry?.sdk?.doc?.description
  return sdk ? `${sdk}  _· SDK_` : null
}

/**
 * The documented operands of a key event, in the order they are written.
 *
 * `[0]` is pushed last — nearest the call — so the documentation's order is
 * the reverse of the writing order, which is the single commonest mistake
 * class in the corpus and the reason this is a list rather than a count.
 */
function operandList(node: RefNode, context: RefHoverContext): string | null {
  if (node.ref.ns !== "K") return null

  const parameters = context.entry?.sdk?.doc?.parameters
  if (!parameters) return null

  const count = documentedParams(parameters)
  if (count < 2) return null

  const lines: string[] = []
  for (let slot = count - 1; slot >= 0; slot -= 1) {
    const where =
      slot === count - 1 ? "pushed first" : slot === 0 ? "pushed last" : ""
    lines.push(
      `\`[${slot}]\` ${parameterLabel(parameters, slot)}${where ? ` — _${where}_` : ""}`
    )
  }

  return lines.join("\n\n")
}

/**
 * The one position-specific fact the card carries, by priority.
 *
 * One, not all of them. The card used to stack every note it could think of
 * and ran a screen tall, which is the same as saying nothing. A problem with
 * the direction of use outranks the shape of the call, which outranks a unit
 * that decides nothing; anything further down is a squiggle's job anyway.
 */
function positionFact(node: RefNode, context: RefHoverContext): string | null {
  if (context.where === "skp") return SKP_NOTE

  const [access] = accessNotes(node, context)
  if (access) return access

  // A mismatch is the fact; a matching arity is not news, and the operand
  // list below says the same thing while also being useful.
  const arity = arityNote(node, context)
  if (arity?.startsWith("⚠")) return arity

  const operands = operandList(node, context)
  if (operands) return operands

  return arity ?? unitNote(node)
}

/** How often the corpus uses this name, in the direction it is being used. */
function footer(node: RefNode, context: RefHoverContext): string | null {
  if (context.where === "expression" && node.access === "write") {
    const count = context.writeCount
    if (!count) return null
    return `_Written by ${count} ${count === 1 ? "entry" : "entries"}_`
  }

  const read = context.entry?.corpus?.get
  if (read) {
    const count = read.files.length
    const profiles = count === 1 ? "profile" : "profiles"
    const blocks = [
      read.shared ? `shared ×${read.shared}` : null,
      read.master ? `master ×${read.master}` : null,
    ]
      .filter(Boolean)
      .join(" · ")
    return `_Read by ${count} ${profiles}${blocks ? ` — ${blocks}` : ""}_`
  }

  const category = context.entry?.sdk?.doc?.category
  return category ? `_${category}_` : null
}

/**
 * The whole ref hover, as one section.
 *
 * Four parts and no more: what this is, what it does, the one thing that
 * matters about it *here*, and how much company it has. The samples, the
 * file list and the section headings that used to ride along are what made
 * the old card a screen tall — `documentation()` still assembles them for
 * completion's panel, which is a venue with room, and they come back to the
 * hover through the Reference panel when there is one.
 */
export function refCard(node: RefNode, context: RefHoverContext): string {
  const parts = [
    `**\`${node.ref.full}\`** — ${natureOf(node)}`,
    describe(context.entry),
    positionFact(node, context),
    footer(node, context),
  ].filter((part): part is string => part !== null)

  return parts.join("\n\n")
}

/** A word's hover: its stack arithmetic, when the table knows it. */
export function wordCard(hit: Extract<TokenHit, { kind: "word" }>): string | null {
  const lower = hit.text.toLowerCase()

  const register = /^(s|sp|l)([0-9]|[1-4][0-9])$/.exec(lower)
  if (register) {
    const what =
      register[1] === "s"
        ? "stores the top value in"
        : register[1] === "sp"
          ? "pops the top value into"
          : "pushes the value of"
    return `**\`${hit.text}\`** — ${what} register ${register[2]}`
  }

  if (!hit.effect) return null

  const { pops, pushes } = hit.effect
  return `**\`${hit.text}\`** — RPN operator · pops ${pops}, pushes ${pushes}`
}
