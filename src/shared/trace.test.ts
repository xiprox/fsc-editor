/**
 * The trace, held against the C# it mirrors.
 *
 * Written from `Definition.ParseSet`, `Definition.ApplyTo`, `SimClient.Set`,
 * `SimClient.TransmitKEvent`, `SimClient.Stream`, `Coordinator.AddLink` and
 * `SimConnectExtensions.InferDataType` — not from `trace.ts`. A test that
 * agrees with the implementation because it was read off the implementation
 * proves nothing, and §3's third hard part is that a trace which lies is worse
 * than no trace.
 */

import { describe, expect, it } from "vitest"

import {
  bareEventName,
  detailText,
  clrTypeOf,
  normalizeK,
  OUTCOME_ID,
  parseSet,
  parseWrite,
  splitArgs,
  traceEntry,
  type TraceEntry,
  type TraceStep,
} from "./trace.ts"
import type { SetterPreview } from "./setter.ts"

const shared = (over: Partial<TraceEntry> = {}): TraceEntry => ({
  block: "shared",
  name: "A:LIGHT LANDING",
  units: "Bool",
  ...over,
})

const built = (
  code: string,
  kind: SetterPreview["kind"] = "prepended"
): SetterPreview => ({ ok: true, kind, code })

const ids = (steps: TraceStep[]) => steps.map((s) => s.id)
/** A step's detail as words, which is what these assert on. */
const text = (step: TraceStep | undefined) =>
  step ? detailText(step) : undefined
const find = (steps: TraceStep[], id: string) => steps.find((s) => s.id === id)
/**
 * The outcome row.
 *
 * More of these assert on it than used to, and that is the shape of the
 * change rather than a habit: the rows above it stopped restating it, so the
 * fact each test is about now lives in exactly one row.
 */
const last = (steps: TraceStep[]) => steps[steps.length - 1]!

describe("clrTypeOf — InferDataType + ToClrType", () => {
  it("reads an L: var as a float whatever its units claim", () => {
    // SetLVar hardcodes FLOAT32 and Stream passes it explicitly.
    expect(clrTypeOf("L:X", "Percent")).toBe("float")
    expect(clrTypeOf("L:X", "")).toBe("float")
  })

  it("makes Bool, Percent and Feet ints", () => {
    // All three are in the INT32 switch — the last two look wrong and are not.
    expect(clrTypeOf("A:X", "Bool")).toBe("int")
    expect(clrTypeOf("A:X", "Percent")).toBe("int")
    expect(clrTypeOf("A:X", "Feet")).toBe("int")
  })

  it("makes Number a double, because it is commented out of the int list", () => {
    expect(clrTypeOf("A:X", "Number")).toBe("double")
  })

  it("makes an unknown unit a double", () => {
    expect(clrTypeOf("A:X", "Knots")).toBe("double")
  })

  it("makes empty units a string, not a number", () => {
    // `if (string.IsNullOrWhiteSpace(unit)) return STRING256;`
    expect(clrTypeOf("A:X", "")).toBe("string")
    expect(clrTypeOf("A:X", "  ")).toBe("string")
  })

  it("makes the text-ish unit names strings", () => {
    expect(clrTypeOf("A:X", "Title")).toBe("string")
    expect(clrTypeOf("A:X", "string32")).toBe("string")
  })
})

describe("splitArgs — Split(' ', RemoveEmptyEntries).Trim()", () => {
  it("splits on the space character only, so a tab stays inside an operand", () => {
    expect(splitArgs("1\t2")).toEqual(["1\t2"])
    expect(splitArgs("1 2")).toEqual(["1", "2"])
  })

  it("trims each part after splitting, so a leading tab comes off", () => {
    expect(splitArgs("\t1 2")).toEqual(["1", "2"])
  })

  it("drops the empties a run of spaces produces", () => {
    expect(splitArgs("  1   2 ")).toEqual(["1", "2"])
  })
})

describe("parseWrite — Definition.ParseSet, without the fallback", () => {
  it("reverses the operands, so index 0 is the event's [0]", () => {
    expect(parseWrite("1 2 (>K:FOO)")?.values).toEqual([2, 1])
  })

  it("turns a non-number into 0 rather than failing", () => {
    expect(parseWrite("abc 2 (>K:FOO)")?.values).toEqual([2, 0])
  })

  it("sends a tab-joined pair as one zero, not as two numbers", () => {
    // The consequence of splitArgs, at the level a rule would ask about.
    expect(parseWrite("1\t2 (>K:FOO)")?.values).toEqual([0])
  })

  it("rewrites K:2:EVENT to K:EVENT", () => {
    expect(parseWrite("1 2 (>K:2:FOO)")?.name).toBe("K:FOO")
  })

  it("does not rewrite K:12:EVENT, because the check is on one character", () => {
    expect(parseWrite("1 (>K:12:FOO)")?.name).toBe("K:12:FOO")
  })

  it("takes the units out of the write", () => {
    const write = parseWrite("1 (>L:FOO, Percent)")
    expect(write?.name).toBe("L:FOO")
    expect(write?.units).toBe("Percent")
  })

  it("is anchored, so trailing text after the write does not match", () => {
    expect(parseWrite("1 (>K:FOO) rubbish")).toBeNull()
    // A trailing space is trailing text: the regex's \s* sits before the ).
    expect(parseWrite("1 (>K:FOO) ")).toBeNull()
  })

  it("will not let the operands span a newline, because the dot does not", () => {
    // `(.*?)` cannot cross one in .NET or here, so a block-scalar setter
    // whose args run over two lines does not match in either.
    expect(parseWrite("1 2\n3 (>K:FOO)")).toBeNull()
  })

  it("but tolerates one between the operands and the write", () => {
    // The `\s*` that follows the args does cross a newline, in both
    // regexes. Worth pinning rather than assuming: the two halves of the
    // pattern disagree about newlines, and only one of them is a dot.
    expect(parseWrite("1\n(>K:FOO)")?.values).toEqual([1])
  })
})

describe("parseSet — the fallback", () => {
  it("writes the incoming value to the get: name when there is no write", () => {
    const entry = shared({ name: "A:GENERAL ENG THROTTLE", units: "Percent" })
    const parsed = parseSet("K:THROTTLE1_SET", entry, 50)

    expect(parsed.matched).toBe(false)
    expect(parsed.name).toBe("A:GENERAL ENG THROTTLE")
    expect(parsed.values).toEqual([50])
  })

  it("sends the incoming value when the write has no operands", () => {
    expect(parseSet("(>K:FOO)", shared(), 7).values).toEqual([7])
  })
})

describe("normalizeK — TransmitKEvent's NormalizeValue", () => {
  it("rounds away from zero, not to even and not toward +infinity", () => {
    expect(normalizeK(0.5)).toBe(1)
    expect(normalizeK(1.5)).toBe(2)
    expect(normalizeK(2.5)).toBe(3)
  })

  it("wraps a negative into a uint rather than clamping it", () => {
    expect(normalizeK(-1)).toBe(4294967295)
    expect(normalizeK(-0.5)).toBe(4294967295)
  })

  it("leaves a whole positive alone", () => {
    expect(normalizeK(3)).toBe(3)
  })
})

describe("the apply side — Definition.ApplyTo", () => {
  it("skips a TOGGLE event write when value equals current", () => {
    const trace = traceEntry(
      shared(),
      { value: 1, current: 1 },
      built("1 (>K:LANDING_LIGHTS_TOGGLE)")
    )

    expect(find(trace.apply, "guard")?.state).toBe("skipped")
    // The echo below it is marked rather than dropped — see the next test.
    expect(find(trace.apply, "echo")?.state).toBe("skipped")
    expect(last(trace.apply).state).toBe("failed")
  })

  it("marks the echo skipped when the guard closed, rather than dropping it", () => {
    // `if (…) return;` sits above `if (fromPeer) Skip.Next(Get);`, so the mark
    // genuinely does not happen — and the row stays, because the panel lets
    // you type a value and watch the path change, and a vanishing row would
    // reflow the box under the pointer.
    const trace = traceEntry(
      shared(),
      { value: 1, current: 1 },
      built("1 (>K:LANDING_LIGHTS_TOGGLE)")
    )

    expect(find(trace.apply, "echo")?.state).toBe("skipped")
  })

  it("keeps the same steps either side of the guard, so nothing reflows", () => {
    const open = traceEntry(
      shared(),
      { value: 1, current: 0 },
      built("1 (>K:A_TOGGLE)")
    )
    const closed = traceEntry(
      shared(),
      { value: 1, current: 1 },
      built("1 (>K:A_TOGGLE)")
    )

    expect(ids(closed.apply)).toEqual(ids(open.apply))
  })

  it("carries on past a setter that threw, because Set returns an empty string", () => {
    // The exception is caught and logged; ApplyTo continues with "". So the
    // echo is still registered and Execute returns early — stopping at the
    // failed build would hide the one thing that still happens.
    const trace = traceEntry(shared(), { value: 1, current: 0 }, {
      ok: false,
      kind: "javascript",
      reason: "ReferenceError: foo",
    })

    expect(find(trace.apply, "builds")?.state).toBe("failed")
    expect(find(trace.apply, "echo")?.state).toBe("ok")
    expect(last(trace.apply).state).toBe("failed")
  })

  it("never guards the first apply, because current is null until a local read", () => {
    // `value.Equals(null)` is false. ApplyTo tests the raw parameter, not the
    // `current ?? value` it used to build the expression.
    const trace = traceEntry(
      shared(),
      { value: 1, current: null },
      built("1 (>K:LANDING_LIGHTS_TOGGLE)")
    )

    expect(find(trace.apply, "guard")?.state).toBe("ok")
    expect(text(last(trace.apply))).toContain("the calculator runs")
  })

  it("guards on the expression's text, not on the event's name", () => {
    /*
     * `Definitions.cs:325` searches the **built expression** for `>K:`/`>B:`
     * and for `TOGGLE`, both as plain substrings. Two consequences a reader
     * gets wrong if the row says "the name":
     *
     *  - an expression holding a variable called `L:ToggleGuard` alongside
     *    any event write trips the guard with nothing toggle-ish in it;
     *  - `K:AP_MASTER`, which really is a toggle, does not trip it at all.
     */
    const incidental = traceEntry(
      shared(),
      { value: 1, current: 1 },
      built("(L:ToggleGuard) 1 (>K:FOO)")
    )
    const realToggle = traceEntry(
      shared(),
      { value: 1, current: 1 },
      built("1 (>K:AP_MASTER)")
    )

    expect(find(incidental.apply, "guard")?.state).toBe("skipped")
    expect(find(realToggle.apply, "guard")).toBeUndefined()

    /*
     * The row itself no longer states the trigger — that moved to the
     * tooltip on `is on`, because naming the condition explained nothing
     * without the purpose beside it, and the purpose needs more room than a
     * clause. What the row keeps is the comparison and the verdict.
     */
    expect(text(find(incidental.apply, "guard"))).toBe(
      "is on — value 1 = current 1, so it is skipped"
    )
  })

  it("says there is no current rather than explaining at length", () => {
    // Was 190 characters across two sentences. `no current yet` carries it:
    // there is no local value, so the comparison cannot match.
    const trace = traceEntry(
      shared(),
      { value: 1, current: null },
      built("1 (>K:LANDING_LIGHTS_TOGGLE)")
    )

    expect(text(find(trace.apply, "guard"))).toBe(
      "is on — value 1 and no current, so it runs"
    )
  })

  it("does not guard a write that is not an event", () => {
    const trace = traceEntry(
      shared(),
      { value: 1, current: 1 },
      built("1 (>L:TOGGLE_ME)")
    )

    expect(find(trace.apply, "guard")).toBeUndefined()
    expect(text(last(trace.apply))).toContain("the calculator runs")
  })

  it("still marks the echo when the expression is empty", () => {
    // Skip.Next(Get) runs before sim.Execute, and Execute returns early on a
    // blank string — so nothing reaches the sim and the mark stands anyway.
    const trace = traceEntry(shared(), { value: 1, current: 0 }, built(""))

    expect(find(trace.apply, "echo")).toBeDefined()
    expect(last(trace.apply).state).toBe("failed")
  })

  it("puts the echo before the run, in the order the C# does it", () => {
    // `Skip.Next(Get)` is registered before `sim.Execute`, and the run is now
    // the outcome itself — so the echo has to sit above the last row.
    const trace = traceEntry(
      shared(),
      { value: 1, current: 0 },
      built("1 (>L:X)")
    )
    const order = ids(trace.apply)

    expect(order.indexOf("echo")).toBeLessThan(order.indexOf(OUTCOME_ID))
  })

  it("never guards or echoes a master: entry", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 1 },
      built("1 (>K:SOMETHING_TOGGLE)")
    )

    expect(find(trace.apply, "guard")).toBeUndefined()
    expect(find(trace.apply, "echo")).toBeUndefined()
  })

  it("routes a shared setter containing >K:# the master way, and still echoes", () => {
    const trace = traceEntry(
      shared(),
      { value: 1, current: 1 },
      built("1 2 (>K:#SOMETHING_TOGGLE)")
    )

    expect(ids(trace.apply)).toContain("hash")
    expect(find(trace.apply, "guard")).toBeUndefined()
    expect(find(trace.apply, "echo")).toBeDefined()
  })

  it("shows dead-set as a failed match and names what is written instead", () => {
    const entry = shared({
      block: "master",
      name: "A:GENERAL ENG THROTTLE LEVER POSITION:1",
      units: "Percent",
    })
    const trace = traceEntry(
      entry,
      { value: 50, current: 0 },
      built("K:THROTTLE1_SET", "literal")
    )

    // No `instead` row: it restated an outcome that says it better, because
    // the outcome also names the event the fallback swallowed.
    expect(find(trace.apply, "match-write")?.state).toBe("failed")
    expect(find(trace.apply, "instead")).toBeUndefined()
    expect(text(last(trace.apply))).toBe(
      "50 is written to A:GENERAL ENG THROTTLE LEVER POSITION:1, Percent, " +
        "and K:THROTTLE1_SET never fires"
    )
  })

  it("names the operands that became zero", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("(L:FOO) 2 (>K:BAR)")
    )

    expect(text(find(trace.apply, "args"))).toContain("not a number")
  })
})

describe("SimClient.Set — the four branches with no else", () => {
  it("writes an L: var and then executes it a second time", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>L:FOO)")
    )

    // Two writes is two rows, twins with the same label — and the ending
    // states the net, which is the count. No step states a count.
    expect(find(trace.apply, "route")?.label).toBe("writes")
    expect(find(trace.apply, "execute")?.label).toBe("writes")
    // `float` as a type token, so it carries the colour, the dotted underline
    // and `TYPE_DOC.float` — the same treatment the `A:` branch gets, which
    // the prose "as a 32-bit float" did not.
    expect(text(find(trace.apply, "route"))).toContain("— as float")
    expect(text(find(trace.apply, "execute"))).toBe(
      "L:FOO again, from the calculator — the name matches two write routes " +
        "and FS Copilot takes both"
    )
    expect(text(last(trace.apply))).toBe(
      "1 is written to L:FOO — twice, with the same value"
    )
  })

  it("claims nothing about that second write, which was never probed", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>L:FOO)")
    )

    expect(find(trace.apply, "execute")?.state).toBe("unknown")
  })

  it("does not call it a second write when it is the only one", () => {
    // `B:`/`H:`/`Z:` reach none of the first three branches, so the catch-all
    // is the whole write. The row said *a second write* for every prefix,
    // which was false here — and with nothing to be second to, its only
    // content was the route, which the ending already carries.
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>B:SOMETHING)")
    )

    expect(find(trace.apply, "execute")).toBeUndefined()
    expect(last(trace.apply).state).toBe("unknown")
  })

  it("states the net in the ending, and sharpens it for a toggle", () => {
    const plain = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>K:LANDING_LIGHTS_SET)")
    )
    const toggle = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>K:LANDING_LIGHTS_TOGGLE)")
    )

    // The twin is a row, not a sentence about a row — and it says *why*,
    // which naming the route never did.
    expect(text(find(plain.apply, "execute"))).toBe(
      "K:LANDING_LIGHTS_SET again, from the calculator — the name matches " +
        "two write routes and FS Copilot takes both"
    )

    /*
     * `_SET` is **absolute**, so twice comes to the same as once — the same
     * finding as a doubled `L:` write, and said the same way. The
     * event/variable split was the wrong axis; absolute/relative is the
     * right one.
     */
    expect(text(last(plain.apply))).toBe(
      "K:LANDING_LIGHTS_SET fires twice with [0] 1 — the same value both times"
    )

    /*
     * The shape where a doubled write is not harmless, and the one sentence
     * no step can carry: each firing is fine on its own and the defect is
     * only in the pair.
     */
    expect(text(last(toggle.apply))).toBe(
      "K:LANDING_LIGHTS_TOGGLE fires twice — the toggle reverses itself"
    )
  })

  it("reads the op from the event name, absolute and relative apart", () => {
    const ending = (event: string) =>
      text(
        last(
          traceEntry(
            shared({ block: "master" }),
            { value: 1, current: 0 },
            built(`1 (>K:${event})`)
          ).apply
        )
      )

    // `parse.ts`'s INPUT_OP vocabulary — set|inc|dec|toggle|on|off — read on
    // a `K:` name, where the op may lead as well as trail.
    // **The** toggle, not **a** toggle — the definite article points at the
    // event on the row rather than at toggles in general.
    expect(ending("TOGGLE_STARTER1")).toContain("the toggle reverses itself")
    expect(ending("AP_ALT_VAR_INC")).toContain("the value moves two steps")
    expect(ending("ADF_VOLUME_DEC")).toContain("the value moves two steps")
    expect(ending("LANDING_LIGHTS_ON")).toContain("the same value both times")

    /*
     * `AP_MASTER` **is** a toggle and does not say so, which the app cannot
     * know. It falls through to the count alone and claims nothing — the
     * honest answer for a name that carries no op.
     */
    expect(ending("AP_MASTER")).toBe("K:AP_MASTER fires twice with [0] 1")
  })

  it("never claims the calculator is skipped, because the twin says it is not", () => {
    /*
     * The `reads` row used to end *not run by the calculator*, three rows
     * above a twin reading *again, from the calculator*. Both were true —
     * `ApplyTo` does not hand the author's expression over, while
     * `SimClient.Set`'s catch-all reassembles one and runs that — and on
     * screen it read as the panel arguing with itself. The row makes no
     * claim about the calculator now.
     */
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>K:TOGGLE_STARTER1)")
    )

    expect(find(trace.apply, "parse")?.label).toBe("parses")
    expect(text(find(trace.apply, "parse"))).toBe(
      "the name and the numbers manually, because the entry is master:"
    )
    expect(text(find(trace.apply, "parse"))).not.toContain("calculator")
    expect(text(find(trace.apply, "execute"))).toContain("from the calculator")
  })

  it("shows the rebuilt expression only when the operands come out reordered", () => {
    // `Execute` is handed the reversed array, so `16256 1 (>K:2:KOHLSMAN_SET)`
    // reaches the calculator as `1 16256 (>K:KOHLSMAN_SET)` — a different
    // program, and the only place the author is told.
    const reordered = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("16256 1 (>K:2:KOHLSMAN_SET)")
    )
    // One operand cannot be reordered, so nothing is added and the row does
    // not repeat the `builds` line two rows above it.
    const plain = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>L:FOO)")
    )

    const why = " — the name matches two write routes and FS Copilot takes both"

    expect(text(find(reordered.apply, "execute"))).toBe(
      `K:KOHLSMAN_SET again, from the calculator${why}, rebuilt as ` +
        "1 16256 (>K:KOHLSMAN_SET)"
    )
    expect(text(find(plain.apply, "execute"))).toBe(
      `L:FOO again, from the calculator${why}`
    )
  })

  it("writes A: with the last operand, not the first", () => {
    // `SetSimVar(name[2..], sUnits, values[^1])`
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 9, current: 0 },
      built("1 2 (>A:FOO, Percent)")
    )

    // values are reversed to [2, 1], so the last is 1.
    expect(text(find(trace.apply, "route"))).toBe(
      "A:FOO = 1 in Percent — as int"
    )
    expect(text(last(trace.apply))).toBe(
      "1 is written to A:FOO, Percent — twice, with the same value"
    )
  })

  it("fires a K: event with every operand, normalized", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("-1 2 (>K:FOO)")
    )

    // Slot-labelled, so the reversal has no order left to be misread as.
    expect(text(find(trace.apply, "route"))).toBe(
      "K:FOO with [0] 2, [1] 4294967295"
    )
    expect(text(last(trace.apply))).toBe(
      "K:FOO fires twice with [0] 2, [1] 4294967295"
    )
  })

  it("shows the K:n: arity being stripped, and both names", () => {
    // `ParseSet` writes to `K:FOO` where the line says `K:2:FOO`. The step
    // exists because the name FS Copilot targets is not on the page.
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 2 (>K:2:FOO)")
    )

    expect(text(find(trace.apply, "arity"))).toContain("K:2:FOO → K:FOO")
  })

  it("says nothing about an arity when there was none to strip", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 2 (>K:FOO)")
    )

    expect(find(trace.apply, "arity")).toBeUndefined()
  })

  it("drops a sixth K: operand, because an event carries five", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 2 3 4 5 6 (>K:FOO)")
    )

    expect(find(trace.apply, "dropped")?.state).toBe("failed")
  })

  it("says nothing is written when the name has no namespace", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>BARE)")
    )

    // No `nowhere` row — the outcome is the only place it is said.
    expect(find(trace.apply, "route")).toBeUndefined()
    expect(last(trace.apply).state).toBe("failed")
    expect(find(trace.apply, "execute")).toBeUndefined()
  })
})

describe("the send side — SimClient.Stream and Coordinator.AddLink", () => {
  it("does not let the apply half contradict a bare get:", () => {
    /*
     * `get-no-prefix` reports this as an **error** at **certain**
     * confidence, in these words: *the entry is inert in both directions.
     * Nothing is read, nothing is sent, nothing is applied.* The panel used
     * to show the send half all red and the apply half all green, ending on
     * *the calculator runs 1 (>LANDING_GEAR_POSITION, Number)* — the shape of
     * seventeen dead lines in the corpus, described as working.
     */
    const trace = traceEntry(
      shared({ name: "LANDING_GEAR_POSITION", units: "Number" }),
      { value: 1, current: 0 },
      built("1 (>LANDING_GEAR_POSITION, Number)")
    )

    expect(find(trace.send, "read")?.state).toBe("failed")
    expect(text(last(trace.apply))).toBe(
      "nothing is applied — LANDING_GEAR_POSITION has no X: prefix"
    )
    expect(last(trace.apply).state).toBe("failed")
  })

  it("still ends on the calculator when the write has a namespace", () => {
    // The guard is the *write target*, not the `get:` name: a bare `get:`
    // whose setter writes somewhere real is inert on the send side and
    // working on this one, and the two halves should say so independently.
    const trace = traceEntry(
      shared({ name: "LANDING_GEAR_POSITION", units: "Number" }),
      { value: 1, current: 0 },
      built("1 (>L:RealVariable)")
    )

    expect(find(trace.send, "read")?.state).toBe("failed")
    expect(text(last(trace.apply))).toBe(
      "the calculator runs 1 (>L:RealVariable)"
    )
    expect(last(trace.apply).state).toBe("ok")
  })

  it("says a bare name is never read at all", () => {
    // `return Observable.Empty<object>();`
    const trace = traceEntry(
      shared({ name: "NO_PREFIX", units: "Number" }),
      { value: 1, current: 0 },
      built("1")
    )

    expect(find(trace.send, "read")?.state).toBe("failed")
  })

  it("names the type an A: value is read as", () => {
    const trace = traceEntry(shared(), { value: 1, current: 0 }, built("1"))
    expect(text(find(trace.send, "read"))).toContain("as int")
  })

  it("samples a master entry, and does not draw a transport row", () => {
    // `SendAll(..., unreliable: master)` is real and is deliberately not
    // shown: the block already decided it, the author can do nothing with
    // it, and the claim the row carried — *a dropped update is overtaken* —
    // is false for the last sample of a movement, because `Sample(30ms)`
    // over a CHANGED subscription emits nothing when nothing changed.
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1")
    )

    expect(ids(trace.send)).toContain("sample")
    expect(ids(trace.send)).not.toContain("send")
  })

  it("does neither for a shared entry", () => {
    const trace = traceEntry(shared(), { value: 1, current: 0 }, built("1"))

    expect(ids(trace.send)).not.toContain("sample")
    expect(ids(trace.send)).not.toContain("send")
  })

  it("delays an H: name by half a second on the way out", () => {
    const trace = traceEntry(
      shared({ name: "H:MyEvent", units: "" }),
      { value: 1, current: 0 },
      built("1")
    )

    expect(text(find(trace.send, "delay"))).toContain("half a second")
  })

  it("registers skp: from a shared entry", () => {
    const trace = traceEntry(
      shared({ skp: "L:MIRROR" }),
      { value: 1, current: 0 },
      built("1")
    )

    expect(find(trace.send, "skp")?.state).toBe("ok")
  })

  it("says a master: skp: does nothing, because the guard is !master", () => {
    const trace = traceEntry(
      shared({ block: "master", skp: "L:MIRROR" }),
      { value: 1, current: 0 },
      built("1")
    )

    expect(find(trace.send, "skp")?.state).toBe("skipped")
  })

  it("claims nothing about whether a skip counter is standing", () => {
    const trace = traceEntry(shared(), { value: 1, current: 0 }, built("1"))
    expect(find(trace.send, "skip-check")?.state).toBe("unknown")
  })
})

/**
 * Every `term(...)` the model can emit, so the glossary cannot drift.
 *
 * `TERM_DOC` in `trace-paint.ts` is keyed by the **rendered text**, and it
 * cannot be asserted from here — importing it pulls in `monaco-theme` and
 * Monaco wants a `window`. So this pins the other end: reword a term in
 * `trace.ts` and this fails, which is the reminder to move the key with it.
 * Without it a reworded term falls back to printing itself as its own
 * definition, silently.
 */
describe("glossary terms", () => {
  it("are exactly the ones trace-paint.ts defines", () => {
    const seen = new Set<string>()

    for (const block of ["shared", "master"] as const)
      for (const name of ["A:X", "L:X", "K:X", "B:X", "H:X", "BARE"])
        for (const code of [
          "1 (>K:FOO)",
          "1 (>B:SOMETHING)",
          "1 (>K:A_TOGGLE)",
          "1 (>L:F, Percent)",
          "K:FOO",
          "",
        ])
          for (const current of [0, 1, null]) {
            const trace = traceEntry(
              { block, name, units: "Number" },
              { value: 1, current },
              built(code)
            )
            for (const phase of ["send", "apply"] as const)
              for (const step of trace[phase])
                for (const part of step.detail)
                  if (typeof part !== "string" && part.paint === "term")
                    seen.add(part.text)
          }

    expect([...seen].sort()).toEqual(["calculator", "is on", "manually"])
  })
})

/**
 * The invariant the rules will depend on in phase 2: a step can be named.
 * The first draft had `route` twice on the master path, so `find(…, "route")`
 * silently answered about the wrong one.
 */
describe("step ids", () => {
  it("are unique within a phase, across every shape", () => {
    const clashes: string[] = []

    for (const block of ["shared", "master"] as const)
      for (const name of ["A:X", "L:X", "K:X", "H:X", "BARE"])
        for (const code of [
          "1 (>K:FOO)",
          "K:FOO",
          "1 (>K:#FOO)",
          "1 (>L:F, Percent)",
          "1 2 3 4 5 6 (>K:FOO)",
          "",
          "1 (>K:A_TOGGLE)",
        ])
          for (const skp of [undefined, "L:M"])
            for (const current of [0, 1, null]) {
              const entry: TraceEntry = {
                block,
                name,
                units: "Number",
                ...(skp ? { skp } : {}),
              }
              const trace = traceEntry(
                entry,
                { value: 1, current },
                built(code)
              )

              for (const phase of ["send", "apply"] as const) {
                const seen = new Set<string>()
                for (const each of trace[phase])
                  if (seen.has(each.id))
                    clashes.push(
                      `${phase}:${each.id} — ${block} ${name} ${code}`
                    )
                  else seen.add(each.id)
              }
            }

    expect(clashes).toEqual([])
  })
})

/**
 * The five endings, each held against the branch of the C# that produces it.
 *
 * The outcome is derived rather than authored — every part of it is a value
 * the model already had — so these read the same source the steps above them
 * do. What they add is the claim that the *last* line cannot disagree with
 * the ones over it: an ending saying a value was sent while `read` is red
 * would be the panel contradicting itself on one screen.
 */
describe("the outcome — the last step of each half", () => {
  const ending = (steps: TraceStep[]) => steps[steps.length - 1]!

  it("is the last step of both halves, and is the only one so named", () => {
    const trace = traceEntry(shared(), { value: 1, current: 0 }, built("1"))

    for (const phase of ["send", "apply"] as const) {
      expect(ending(trace[phase]).id).toBe(OUTCOME_ID)
      expect(ending(trace[phase]).label).toBe("result")
      expect(trace[phase].filter((s) => s.id === OUTCOME_ID)).toHaveLength(1)
    }
  })

  // 1 — sent to the other pilot

  it("ends the send half with the local value, reliably from shared:", () => {
    const trace = traceEntry(shared(), { value: 1, current: 0 }, built("1"))

    expect(text(ending(trace.send))).toBe("0 is sent to the other pilot")
    expect(ending(trace.send).state).toBe("ok")
  })

  it("ends both blocks the same way, because reliability is not the reader's", () => {
    // `SendAll(..., unreliable: master)` is true and is not said. It is not
    // a sync fact the author can act on, and the block already decided it —
    // so the two halves read alike and the block's real consequences stay
    // where they are: `sampled`, the control gate, and the skip rows.
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 22 },
      built("1")
    )

    expect(text(ending(trace.send))).toBe("22 is sent to the other pilot")
  })

  it("goes to the future tense when nothing has been read here yet", () => {
    // `currentValue` starts null in Coordinator.AddLink, so there is no local
    // value to name — and naming one would be a placeholder, not an answer.
    const trace = traceEntry(shared(), { value: 1, current: null }, built("1"))

    expect(text(ending(trace.send))).toBe(
      "the new value is sent to the other pilot"
    )
    expect(ending(trace.send).state).toBe("ok")
  })

  it("says nothing is sent when Stream never reads the name", () => {
    // `SimClient.Stream` falls through to Observable.Empty for a name with no
    // X: prefix, so the entry is inert on this side. The ending has to agree
    // with the red `read` step above it.
    const trace = traceEntry(
      shared({ name: "LANDING" }),
      { value: 1, current: 0 },
      built("1")
    )

    expect(find(trace.send, "read")?.state).toBe("failed")
    expect(text(ending(trace.send))).toBe(
      "nothing is sent — LANDING is never read"
    )
    expect(ending(trace.send).state).toBe("failed")
  })

  // 2 — the calculator runs it

  it("ends a shared: apply with the code the calculator is handed", () => {
    // We do not evaluate RPN, so this is the honest ending even though it
    // restates `builds`.
    const trace = traceEntry(
      shared(),
      { value: 1, current: 0 },
      built("1 (>K:LANDING_LIGHTS_SET)")
    )

    expect(text(ending(trace.apply))).toBe(
      "the calculator runs 1 (>K:LANDING_LIGHTS_SET)"
    )
    expect(ending(trace.apply).state).toBe("ok")
  })

  // 3 — the event fires

  it("ends a master: event with the operands that actually travel", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 2 (>K:2:LANDING_LIGHTS_SET)")
    )

    /*
     * Reversed by ParseSet, and the arity stripped off the name.
     *
     * Slot-labelled rather than `[2, 1]`, and that is the whole point of the
     * notation: `1 2` is what the author wrote and `[2, 1]` is what fires,
     * the same two tokens in opposite orders with a pair of brackets as the
     * only thing telling them apart. Naming the slot leaves no order to
     * misread — see `slots` in trace.ts and `k-operand-order`.
     */
    expect(text(ending(trace.apply))).toBe(
      "K:LANDING_LIGHTS_SET fires twice with [0] 2, [1] 1 — " +
        "the same value both times"
    )
    // `unknown`, not `ok`: the count depends on the catch-all's second write,
    // which is read in the source and never probed.
    expect(ending(trace.apply).state).toBe("unknown")
  })

  it("names the five that fit rather than the six that were written", () => {
    // TransmitClientEvent_EX1 carries dwData0 to dwData4. The event still
    // fires, so the ending is not a failure — `drops` is where that lives.
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 2 3 4 5 6 (>K:FOO)")
    )

    expect(find(trace.apply, "dropped")?.state).toBe("failed")
    expect(text(ending(trace.apply))).toBe(
      "K:FOO fires twice with [0] 6, [1] 5, [2] 4, [3] 3, [4] 2"
    )
    // Still not a failure however many were dropped — `drops` says what was
    // lost, and repeating it here would make the last line argue with itself.
    expect(ending(trace.apply).state).toBe("unknown")
  })

  // 4 — written to a variable

  it("ends a master: write with the value, the name and the units", () => {
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("50 (>A:GENERAL ENG THROTTLE LEVER POSITION:1, Percent)")
    )

    expect(text(ending(trace.apply))).toBe(
      "50 is written to A:GENERAL ENG THROTTLE LEVER POSITION:1, Percent" +
        " — twice, with the same value"
    )
    expect(ending(trace.apply).state).toBe("unknown")
  })

  it("treats the fallback as a success when it swallowed no event", () => {
    // 60% of the corpus has no `set:` at all and this is the whole design
    // there: ParseSet's fallback writes the incoming value to the get: name.
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("", "implicit")
    )

    expect(text(ending(trace.apply))).toBe(
      "1 is written to A:LIGHT LANDING, Bool"
    )
    expect(ending(trace.apply).state).toBe("ok")
  })

  it("names the event a fallback swallowed, and fails on it", () => {
    // JF_RJ_100's `set: K:THROTTLE1_SET` — the corpus's six instances. The
    // throttle moves because the fallback writes the A: var, and the event
    // named in the setter never fires, which is why nobody notices.
    const trace = traceEntry(
      shared({ block: "master", name: "A:THROTTLE", units: "Percent" }),
      { value: 50, current: 0 },
      built("K:THROTTLE1_SET", "literal")
    )

    expect(text(ending(trace.apply))).toBe(
      "50 is written to A:THROTTLE, Percent, and K:THROTTLE1_SET never fires"
    )
    expect(ending(trace.apply).state).toBe("failed")
  })

  // 5 — nothing is applied

  it("says nothing is applied when the toggle guard closed", () => {
    const trace = traceEntry(
      shared(),
      { value: 1, current: 1 },
      built("1 (>K:LANDING_LIGHTS_TOGGLE)")
    )

    expect(text(ending(trace.apply))).toBe(
      "nothing is applied — value already matches current"
    )
    expect(ending(trace.apply).state).toBe("failed")
  })

  it("says nothing is applied when Set threw and Execute returns early", () => {
    const trace = traceEntry(shared(), { value: 1, current: 0 }, built(""))

    expect(text(ending(trace.apply))).toBe(
      "nothing is applied — the expression is empty"
    )
    expect(ending(trace.apply).state).toBe("failed")
  })

  it("says nothing is applied when the parsed name matches no branch", () => {
    // Every `if` in SimClient.Set tests a prefix, and the catch-all wants
    // `name[1] == ':'`. A bare name reaches none of them.
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>NOPREFIX)")
    )

    expect(find(trace.apply, "route")).toBeUndefined()
    expect(text(ending(trace.apply))).toBe(
      "nothing is applied — NOPREFIX matches no branch"
    )
    expect(ending(trace.apply).state).toBe("failed")
  })

  // the branch with no else

  it("stays unknown when only the catch-all claims the write", () => {
    // A `B:` write reaches the simulator through Execute and nowhere else,
    // and that branch is read in the source and never probed — so the ending
    // is no more certain than the step it comes from.
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>B:SOMETHING)")
    )

    expect(text(ending(trace.apply))).toBe(
      "the calculator runs 1 (>B:SOMETHING)"
    )
    expect(ending(trace.apply).state).toBe("unknown")
  })

  it("lets the first matching branch name the ending, not the catch-all", () => {
    // `L:` matches SetLVar *and* the catch-all, because there is no else.
    const trace = traceEntry(
      shared({ block: "master" }),
      { value: 1, current: 0 },
      built("1 (>L:FOO)")
    )

    expect(find(trace.apply, "execute")?.state).toBe("unknown")
    // Still the L: branch's sentence — *written to*, not *the calculator
    // runs* — which is what this test is about.
    expect(text(ending(trace.apply))).toBe(
      "1 is written to L:FOO — twice, with the same value"
    )
    /*
     * `unknown`, not `ok`, and that follows from the ending's new job. It
     * states the **net**, and the net here is a count of two whose second
     * half is the catch-all's unprobed write. A confident `ok` would assert
     * the very thing the row above it hedges.
     */
    expect(ending(trace.apply).state).toBe("unknown")
  })
})

describe("bareEventName — the test dead-set shares", () => {
  it("accepts a lone namespaced name", () => {
    expect(bareEventName("K:THROTTLE1_SET")).toBe("K:THROTTLE1_SET")
    expect(bareEventName("  K:FOO  ")).toBe("K:FOO")
  })

  it("rejects anything holding whitespace or parens", () => {
    // Wrapping real RPN in (> ) would invent a different program, so it is
    // not a swallowed event however namespaced its first word looks.
    expect(bareEventName("1 (>K:FOO)")).toBeNull()
    expect(bareEventName("K:FOO K:BAR")).toBeNull()
    expect(bareEventName("(K:FOO)")).toBeNull()
  })

  it("rejects a name with no namespace, and nothing at all", () => {
    expect(bareEventName("THROTTLE1_SET")).toBeNull()
    expect(bareEventName("")).toBeNull()
    expect(bareEventName("   ")).toBeNull()
  })
})
