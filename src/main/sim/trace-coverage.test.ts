/**
 * The Trace panel's whole surface, walked once.
 *
 * Two different jobs live here and they are worth keeping apart, because one
 * of them is a test and the other is not.
 *
 * ## The test: every branch stays reachable
 *
 * `fixtures/trace-coverage.yaml` exists so that between its entries the model
 * takes every branch it has. This asserts the set of `phase/id/label/state`
 * triples the walk produces against an explicit list — so **adding a branch
 * without adding a fixture entry fails**, and so does deleting the entry that
 * was the only one reaching some row. That is the point: a panel with thirty
 * row shapes cannot be eyeballed, and a fixture nobody checks drifts out of
 * date silently.
 *
 * It is deliberately not a test of *what the rows say*. `trace.test.ts` is
 * that, and it is written from the C# rather than from `trace.ts`.
 *
 * ## The review aid: the rendered columns, committed
 *
 * The last case writes every distinct column out as text and compares it with
 * `fixtures/trace-coverage.txt`. **This proves nothing** — it is read off the
 * implementation, which `trace.test.ts`'s own header warns is worthless as
 * evidence. It is here because this panel is almost entirely *copy*, and a
 * copy change is reviewable only when you can see it: a one-word edit in
 * `trace.ts` surfaces as a diff across every shape it touches, instead of
 * being checked by rendering things by hand one at a time.
 *
 * Update it deliberately, and read the diff:
 *
 *     npx vitest run src/main/sim/trace-coverage.test.ts -u
 *
 * ## Why it lives in main
 *
 * `resolveSetter` is main-side — the renderer's CSP has no `unsafe-eval` — so
 * this is the only place the fixture can be traced the way the app traces it,
 * javascript setters included. Walking it through `scanEntries` rather than
 * hand-built `SetterPreview`s is the point: the fixture is a profile, and it
 * is read here exactly as the app reads one.
 */

import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import { scanEntries } from "../../shared/profile/index.ts"
import {
  detailText,
  traceEntry,
  type TraceBindings,
  type TraceStep,
} from "../../shared/trace.ts"
import { resolveSetter } from "./setter.ts"

const FIXTURE = path.join(import.meta.dirname, "fixtures/trace-coverage.yaml")
const GOLDEN = path.join(import.meta.dirname, "fixtures/trace-coverage.txt")

const RULE = "─".repeat(74)
const HEAVY = "═".repeat(74)

/**
 * The three bindings, which are a dimension of the shapes rather than a detail.
 *
 * The toggle guard has three outcomes and they depend on the *bindings*, not
 * on the entry — `current` null before this variable has moved locally, equal,
 * and different. One fixture entry crossed with these reaches all three, which
 * is honest about where the branching actually is.
 */
const BINDINGS: { label: string; bindings: TraceBindings }[] = [
  { label: "no current", bindings: { value: 1, current: null } },
  { label: "current 0", bindings: { value: 1, current: 0 } },
  { label: "current 1", bindings: { value: 1, current: 1 } },
]

interface Walked {
  entry: string
  block: string
  set: string | undefined
  skp: string | undefined
  binding: string
  current: number | string | null
  send: TraceStep[]
  apply: TraceStep[]
}

/** The fixture, traced the way the app traces it. */
function walk(): Walked[] {
  const text = fs.readFileSync(FIXTURE, "utf8")
  const out: Walked[] = []

  for (const entry of scanEntries("trace-coverage.yaml", text))
    for (const { label, bindings } of BINDINGS) {
      const built = resolveSetter(
        { name: entry.name, units: entry.units, set: entry.set },
        { value: bindings.value, current: bindings.current ?? bindings.value }
      )
      const trace = traceEntry(
        {
          block: entry.block,
          name: entry.name,
          units: entry.units,
          ...(entry.skp ? { skp: entry.skp } : {}),
        },
        bindings,
        built
      )
      out.push({
        entry: entry.name,
        block: entry.block,
        set: entry.set,
        skp: entry.skp,
        binding: label,
        current: bindings.current,
        send: trace.send,
        apply: trace.apply,
      })
    }

  return out
}

/** One column, as the panel lays it out: state, label, detail. */
function column(steps: TraceStep[]): string {
  return steps
    .map((s) => `    ${s.state.padEnd(8)}${s.label.padEnd(9)}${detailText(s)}`)
    .join("\n")
}

/**
 * A send column with this entry's own words taken out of it.
 *
 * Used as a **dedupe key only** — the block printed is the real one. Without
 * it the send section ran to 73 blocks for 25 entries, because the column
 * names the entry and ends on the bound value, so every entry and binding
 * pair counted as distinct while carrying no shape the one above it did not.
 * What a reader wants from that section is the shapes: which rows appear, in
 * what order, in what state.
 *
 * The **units are deliberately not masked**. `in Bool — as int` and `, as a
 * 32-bit float` are different branches of `readStep`, not one branch with a
 * different noun in it.
 */
function shape(drawn: string, row: Walked): string {
  const masked = drawn.split(row.entry).join("<name>")
  const withSkp = row.skp ? masked.split(row.skp).join("<skp>") : masked

  return row.current === null
    ? withSkp
    : withSkp.split(`${row.current} is sent`).join("<current> is sent")
}

describe("the trace fixture", () => {
  it("reaches every row the model can draw", () => {
    const seen = new Set<string>()

    for (const row of walk())
      for (const phase of ["send", "apply"] as const)
        for (const step of row[phase])
          seen.add(`${phase} ${step.id} ${step.label} ${step.state}`)

    /*
     * Explicit rather than derived, and that is the mechanism: a new branch
     * produces a triple that is not on this list and the case fails, which is
     * the prompt to add the fixture entry that exercises it. A derived
     * expectation would pass for a fixture covering nothing at all.
     */
    expect([...seen].sort()).toEqual([
      "apply args args ok",
      "apply arity strips ok",
      "apply builds builds failed",
      "apply builds builds ok",
      "apply control applies unknown",
      "apply dropped drops failed",
      "apply echo echo ok",
      "apply echo echo skipped",
      "apply execute fires unknown",
      "apply execute writes unknown",
      "apply guard guard ok",
      "apply guard guard skipped",
      "apply hash route ok",
      "apply kind kind ok",
      "apply match arrives ok",
      "apply match-write match failed",
      "apply parse parses ok",
      "apply result result failed",
      "apply result result ok",
      "apply result result unknown",
      "apply rounds rounds ok",
      "apply route fires ok",
      "apply route writes ok",
      "send control sends unknown",
      "send delay waits ok",
      "send read read failed",
      "send read read ok",
      "send result result failed",
      "send result result ok",
      "send sample sampled ok",
      "send skip-check unless unknown",
      "send skp skp ok",
      "send skp skp skipped",
    ])
  })

  it("reaches all four setter kinds", () => {
    /*
     * `kind` is one triple however many kinds there are, so the coverage
     * assertion above is blind to this. The four are the whole of
     * `setterKind`, and the first is the majority of the corpus.
     */
    const kinds = new Set(
      walk().map(
        (row) =>
          detailText(row.apply.find((s) => s.id === "kind")!).split(" ")[0]
      )
    )

    expect([...kinds].sort()).toEqual([
      "implicit",
      "javascript",
      "literal",
      "prepended",
    ])
  })

  it("renders every distinct column as committed", () => {
    /*
     * **Distinct columns, not whole timelines.** Rendering all 75 entry ×
     * binding pairs came to 1,511 lines, most of it repetition: `current`
     * changes the send half's last line for every entry alive, so nothing
     * deduplicated and a one-word copy edit produced seventy-five diff lines.
     * Collapsing to the set of columns the panel can actually draw is smaller
     * and a better answer to the question the fixture exists for — what are
     * all the shapes?
     *
     * Each block is labelled with the first entry and binding that produced
     * it, so a surprising one can be traced back to a line in the yaml.
     */
    const send = new Map<string, [string, string]>()
    const apply = new Map<string, [string, string]>()

    for (const row of walk()) {
      const where = [
        `${row.block}: ${row.entry}`,
        ...(row.set === undefined ? [] : [`  set: ${row.set}`]),
        `  with ${row.binding}`,
      ].join("\n")

      for (const [into, steps, key] of [
        [send, row.send, shape(column(row.send), row)],
        [apply, row.apply, column(row.apply)],
      ] as const)
        if (!into.has(key)) into.set(key, [where, column(steps)])
    }

    const section = (title: string, cols: Map<string, [string, string]>): string =>
      [
        `${title} — ${cols.size} distinct`,
        "",
        [...cols.values()]
          .map(([where, drawn]) => `${where}\n\n${drawn}`)
          .join(`\n\n${RULE}\n\n`),
      ].join("\n")

    expect(
      [
        "Every column the Trace panel can draw, from fixtures/trace-coverage.yaml.",
        "Generated — see trace-coverage.test.ts. Read the diff; do not edit.",
        "",
        HEAVY,
        "",
        section("WHEN IT CHANGES HERE", send),
        "",
        HEAVY,
        "",
        section("WHEN A VALUE ARRIVES", apply),
        "",
      ].join("\n")
    ).toMatchFileSnapshot(GOLDEN)
  })
})
