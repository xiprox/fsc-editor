/**
 * The language core, layer by layer, on shapes lifted from the corpus.
 *
 * The full-corpus sweep is `npm run lang:sweep` — machine-dependent, since
 * it reads the configured workspace. These are the distilled cases: every
 * one is a pattern some real profile writes, or a mistake a rule exists to
 * catch.
 */

import { describe, expect, it } from "vitest"

import {
  analyze,
  analyzeEntry,
  analyzeProfileView,
  blockConflict,
  blockUnknown,
  bPresetUnknown,
  bWriteBare,
  bWriteOp,
  collectRefs,
  deadSet,
  defaultRules,
  duplicateGet,
  documentedParams,
  getPresetUnknown,
  bValueConstant,
  refUnresolved,
  getUnitMeaningless,
  headerUpdated,
  ignoreDuplicate,
  includeMissing,
  kArity,
  masterSetShape,
  nearest,
  notSettable,
  noWrite,
  prependedUnused,
  paramSlots,
  parseRpn,
  simulate,
  tokenAt,
  valueWord,
  tokenize,
  type Diagnostic,
  type EntryDiagnostic,
  type EntryView,
  type ProfileView,
  type RuleContext,
} from "./index.ts"

// ---------------------------------------------------------------- tokens

describe("tokenize", () => {
  it("splits the classic setter shape", () => {
    const tokens = tokenize("1 (>L:XMLVAR_Battery)")
    expect(tokens.map((t) => t.kind)).toEqual(["number", "ref"])
    expect(tokens[1]!.text).toBe("(>L:XMLVAR_Battery)")
  })

  it("carries spans that reproduce the source", () => {
    const text = "${value} 16384 min (>K:THROTTLE_SET)"
    for (const token of tokenize(text)) {
      expect(text.slice(token.start, token.end)).toBe(token.text)
    }
  })

  it("keeps a hole with nested braces whole", () => {
    const tokens = tokenize("${on ? {a:1}.a : 0} (>L:X)")
    expect(tokens[0]!.kind).toBe("hole")
    expect(tokens[0]!.text).toBe("${on ? {a:1}.a : 0}")
  })

  it("marks an unterminated ref instead of throwing", () => {
    // Half-typed code, mid-keystroke: the normal case for an editor.
    const tokens = tokenize("1 (>L:Half")
    expect(tokens[1]!.kind).toBe("ref")
    expect(tokens[1]!.unterminated).toBe(true)
  })

  it("surfaces invisible characters as their own tokens", () => {
    // A non-breaking space pasted from a forum, invisible in any editor.
    const tokens = tokenize("1 (>L:X)")
    expect(tokens.map((t) => t.kind)).toEqual(["number", "invisible", "ref"])
  })

  it("reads numbers the way RPN writes them, and leaves words alone", () => {
    expect(tokenize("-1 0.5 1e-4 40kias +").map((t) => t.kind)).toEqual([
      "number",
      "number",
      "number",
      "word",
      "word",
    ])
  })
})

// -------------------------------------------------------------------- ir

describe("parseRpn", () => {
  it("reads access, name and unit out of a ref", () => {
    const doc = parseRpn("(A:NAV OBS:1, degrees) (>L:Target)")
    const [read, write] = doc.nodes

    expect(read).toMatchObject({
      kind: "ref",
      access: "read",
      unit: "degrees",
      ref: { ns: "A", name: "NAV OBS", index: 1 },
    })
    expect(write).toMatchObject({
      kind: "ref",
      access: "write",
      unit: null,
      ref: { ns: "L", name: "Target" },
    })
  })

  it("meets the shared parser inside the parens", () => {
    const doc = parseRpn("1 2 (>K:2:KOHLSMAN_SET)")
    expect(doc.nodes[2]).toMatchObject({
      kind: "ref",
      ref: { ns: "K", name: "KOHLSMAN_SET", params: 2 },
    })
  })
})

// ----------------------------------------------------------------- stack

describe("simulate", () => {
  it("tracks depth through a real expression", () => {
    // (A:X, y) 100 * (>L:Z) — read, literal, multiply, write: ends empty.
    const doc = parseRpn("(A:PLANE ALTITUDE, feet) 100 * (>L:Scaled)")
    const { points, end } = simulate(doc)

    expect(points.map((p) => p.before)).toEqual([0, 1, 2, 1])
    expect(end).toBe(0)
  })

  it("counts a hole as one value", () => {
    const doc = parseRpn("${value} (>L:X)")
    expect(simulate(doc).points.map((p) => p.before)).toEqual([0, 1])
  })

  it("goes blind at an unknown word rather than guessing", () => {
    const doc = parseRpn("1 mystery-op (>L:X)")
    const { points, end } = simulate(doc)

    expect(points[1]!.before).toBe(1)
    expect(points[2]!.before).toBe(null)
    expect(end).toBe(null)
  })

  it("walks a branch linearly and goes blind at els{", () => {
    const doc = parseRpn("(L:A) 1 == if{ 1 els{ 0 } (>L:B)")
    const { points, end } = simulate(doc)

    // Depth known through the if-arm, unknown from els{ on.
    expect(points[3]!.before).toBe(1) // before if{
    expect(end).toBe(null)
  })
})

// ----------------------------------------------------------------- rules

/** The catalogue as the tests know it: four real entries, nothing else. */
const CATALOG: RuleContext = {
  keyEventParams(event) {
    if (event === "KOHLSMAN_SET")
      return "[0]: Value to set [1]: Altimeter index"
    if (event === "TOGGLE_ICS") return "[0]: unused"
    // The reversed slot order — [0] is the index — and the no-verdict case.
    if (event === "FUELSYSTEM_PUMP_SET")
      return "[0]: The pump index [1]: A value between 0 and 16384"
    if (event === "ELECTRICAL_BUS_TO_BUS_CONNECTION_TOGGLE")
      return "[0]: Source bus.N name (or index) [1]: Target bus.N name (or index)"
    return null
  },
}

function apply(text: string, diagnostic: Diagnostic): string {
  let out = text
  // Applied right to left so earlier offsets stay true.
  const edits = [...diagnostic.fix!.edits].sort((a, b) => b.start - a.start)
  for (const edit of edits)
    out = out.slice(0, edit.start) + edit.newText + out.slice(edit.end)
  return out
}

function diagnose(text: string, context: RuleContext = CATALOG): Diagnostic[] {
  const doc = parseRpn(text)
  return analyze(defaultRules, doc, simulate(doc), context)
}

describe("k-arity", () => {
  it("catches the missing :2 and the fix writes it", () => {
    // One operand for a two-parameter event: underspecified, not proven
    // broken — the probe showed the missing index defaults to 0.
    const text = "1013 (>K:KOHLSMAN_SET)"
    const [diagnostic] = diagnose(text)

    expect(diagnostic).toMatchObject({ ruleId: "k-arity", severity: "warning" })
    expect(apply(text, diagnostic!)).toBe("1013 (>K:2:KOHLSMAN_SET)")
  })

  it("escalates to error when the operands are laid out", () => {
    // Both operands on the stack, bare call: the probe proved the sim pops
    // only the top one. The layout shows intent; the sim drops it.
    const [diagnostic] = diagnose("3 16240 (>K:KOHLSMAN_SET)")

    expect(diagnostic).toMatchObject({ ruleId: "k-arity", severity: "error" })

    // A computed operand keeps it a warning — the layout proves nothing.
    const [computed] = diagnose("(L:Idx) 16240 (>K:KOHLSMAN_SET)")
    expect(computed).toMatchObject({ ruleId: "k-arity", severity: "warning" })
  })

  it("catches an arity the event does not take, and removes it", () => {
    const text = "1 0 (>K:2:TOGGLE_ICS)"
    const [diagnostic] = diagnose(text)

    expect(diagnostic!.severity).toBe("warning")
    expect(apply(text, diagnostic!)).toBe("1 0 (>K:TOGGLE_ICS)")
  })

  it("accepts the correct corpus form", () => {
    expect(diagnose("3 ${value * 16} (>K:2:KOHLSMAN_SET)")).toEqual([])
  })

  it("stays silent without the catalogue", () => {
    // Absence of evidence is silence — the confidence-tier contract. An
    // undocumented event must never produce a guessed complaint.
    expect(diagnose("1013 (>K:KOHLSMAN_SET)", {})).toEqual([])
    expect(diagnose("(>K:SOME_UNDOCUMENTED_EVENT)")).toEqual([])
  })
})

describe("k-operand-order", () => {
  const orderOnly = (text: string): Diagnostic[] =>
    diagnose(text).filter((d) => d.ruleId === "k-operand-order")

  it("catches the corpus shape and the fix swaps the operands", () => {
    // The thirteen broken lines: value pushed first, index last — the sim
    // pops the index as [0]. Fires beside k-arity, each proving its own
    // defect.
    const text = "${value * 16} 1 (>K:KOHLSMAN_SET)"
    const [diagnostic] = orderOnly(text)

    expect(diagnostic).toMatchObject({
      ruleId: "k-operand-order",
      severity: "warning",
    })
    expect(diagnostic!.consequence).toContain("1 as the Value to set")
    expect(apply(text, diagnostic!)).toBe("1 ${value * 16} (>K:KOHLSMAN_SET)")
  })

  it("fires independently of arity — :2 present, order still wrong", () => {
    const text = "${value * 16} 1 (>K:2:KOHLSMAN_SET)"
    const diagnostics = diagnose(text)

    // Arity is correct, so k-arity stays quiet; order alone speaks.
    expect(diagnostics.map((d) => d.ruleId)).toEqual(["k-operand-order"])
    expect(apply(text, diagnostics[0]!)).toBe(
      "1 ${value * 16} (>K:2:KOHLSMAN_SET)"
    )
  })

  it("respects a catalogue that puts the index in [0]", () => {
    // FUELSYSTEM_PUMP_SET documents "[0]: The pump index" — there the hole
    // belongs FIRST, and hole-last is the swap.
    expect(orderOnly("${value} 2 (>K:2:FUELSYSTEM_PUMP_SET)")).toHaveLength(0)
    expect(orderOnly("2 ${value} (>K:2:FUELSYSTEM_PUMP_SET)")).toHaveLength(1)
  })

  it("accepts the correct corpus form", () => {
    expect(orderOnly("3 ${value * 16} (>K:2:KOHLSMAN_SET)")).toHaveLength(0)
  })

  it("stays silent wherever the heuristic loses its footing", () => {
    // Two index-like slots — no home for the value, no verdict.
    expect(
      orderOnly("1 2 (>K:2:ELECTRICAL_BUS_TO_BUS_CONNECTION_TOGGLE)")
    ).toHaveLength(0)
    // No hole, two holes, a computed operand — the layout tells no story.
    expect(orderOnly("16240 1 (>K:2:KOHLSMAN_SET)")).toHaveLength(0)
    expect(orderOnly("${index} ${value} (>K:2:KOHLSMAN_SET)")).toHaveLength(0)
    expect(orderOnly("${value} (L:Idx) (>K:2:KOHLSMAN_SET)")).toHaveLength(0)
    // No catalogue — the confidence-tier contract.
    expect(
      diagnose("${value * 16} 1 (>K:KOHLSMAN_SET)", {}).filter(
        (d) => d.ruleId === "k-operand-order"
      )
    ).toHaveLength(0)
  })
})

describe("paramSlots", () => {
  it("splits descriptions by slot, colon or not", () => {
    expect(paramSlots("[0]: Value to set [1]: Altimeter index")).toEqual([
      "Value to set",
      "Altimeter index",
    ])
    expect(
      paramSlots("[0] Door name (or index) [1] Skip Animation (Bool)")
    ).toEqual(["Door name (or index)", "Skip Animation (Bool)"])
    expect(paramSlots("The event takes no parameters.")).toEqual([])
  })
})

describe("b-write-op", () => {
  it("holds its tongue on a bare preset write, pending the probe", () => {
    // 529 corpus counterexamples (CRJ presets named as actions, written
    // bare) muted the warning until an in-sim probe decides the premise.
    expect(diagnose("1 (>B:LANDING_GEAR_PARKINGBRAKE)")).toEqual([])
  })

  it("questions a read of an operation and strips the suffix", () => {
    const text = "(B:ENGINE1_Throttle_Set, Percent)"
    const [diagnostic] = diagnose(text)

    expect(diagnostic!.severity).toBe("warning")
    // The unit after the comma survives the edit untouched.
    expect(apply(text, diagnostic!)).toBe("(B:ENGINE1_Throttle, Percent)")
  })

  it("accepts the two correct forms", () => {
    expect(diagnose("(B:ENGINE1_Throttle)")).toEqual([])
    expect(diagnose("1 (>B:ENGINE1_Throttle_Set)")).toEqual([])
  })
})

describe("documentedParams", () => {
  it("counts the bracketed slots", () => {
    expect(documentedParams("[0]: Value to set [1]: Altimeter index")).toBe(2)
    expect(documentedParams("[0]: unused")).toBe(1)
    expect(documentedParams("The event takes no parameters.")).toBe(0)
  })
})

describe("engine", () => {
  it("runs only the rules it is handed", () => {
    // The read branch, since the bare-write one is muted pending the probe.
    const text = "1013 (>K:KOHLSMAN_SET) (B:X_Set)"
    const doc = parseRpn(text)

    const both = analyze([kArity, bWriteOp], doc, simulate(doc), CATALOG)
    const one = analyze([bWriteOp], doc, simulate(doc), CATALOG)

    expect(both.map((d) => d.ruleId).sort()).toEqual(["b-write-op", "k-arity"])
    expect(one.map((d) => d.ruleId)).toEqual(["b-write-op"])
  })
})

// ------------------------------------------------------- the rule batch

describe("rpn-unterminated", () => {
  it("flags the Albatross bug and the fix closes the paren", () => {
    // Verbatim from microsoft_grumman_albatross.yaml — found by the first
    // corpus sweep, shipped broken for however long nobody noticed.
    const text = "(>B:INSTRUMENT_IE_HU16_CB_NAV_2_Toggle"
    const diagnostics = diagnose(text)
    const unterminated = diagnostics.find(
      (d) => d.ruleId === "rpn-unterminated"
    )

    expect(unterminated).toBeDefined()
    expect(apply(text, unterminated!)).toBe(
      "(>B:INSTRUMENT_IE_HU16_CB_NAV_2_Toggle)"
    )
  })
})

describe("rpn-braces", () => {
  it("flags an if{ never closed, and a stray }", () => {
    expect(diagnose("(L:A) if{ 1 (>L:B)").map((d) => d.ruleId)).toContain(
      "rpn-braces"
    )
    expect(diagnose("} 1 (>L:B)").map((d) => d.ruleId)).toContain("rpn-braces")
    // The alternative opens its own block, so a bare els{ is unclosed too.
    expect(diagnose("(L:A) if{ 1 } els{").map((d) => d.ruleId)).toContain(
      "rpn-braces"
    )
  })

  it("accepts the balanced corpus shape", () => {
    expect(
      diagnose("(L:A) 1 == if{ 1 (>L:B) } els{ 0 (>L:B) }").filter(
        (d) => d.ruleId === "rpn-braces"
      )
    ).toEqual([])
  })
})

describe("invisible-chars", () => {
  it("names the character and the fix substitutes what was meant", () => {
    const text = "1 (>L:X)"
    const [diagnostic] = diagnose(text).filter(
      (d) => d.ruleId === "invisible-chars"
    )

    expect(diagnostic!.message).toContain("non-breaking space")
    expect(apply(text, diagnostic!)).toBe("1 (>L:X)")
  })
})

describe("ns-access", () => {
  it("questions a read of something fired and a write to something read-only", () => {
    expect(diagnose("(K:TOGGLE_ICS)").map((d) => d.ruleId)).toContain(
      "ns-access"
    )
    expect(diagnose("1 (>E:ZULU TIME)").map((d) => d.ruleId)).toContain(
      "ns-access"
    )
  })

  it("leaves the legal directions alone", () => {
    expect(diagnose("(E:ZULU TIME, seconds) (>L:T)")).toEqual([])
    expect(diagnose("2 (>E:SIMULATION RATE)")).toEqual([])
    expect(diagnose("(F:KeyEvent)")).toEqual([])
  })
})

describe("unit-meaningless", () => {
  it("flags a unit on an event and the fix removes exactly it", () => {
    const text = "1 (>K:TOGGLE_ICS, Bool)"
    const [diagnostic] = diagnose(text).filter(
      (d) => d.ruleId === "unit-meaningless"
    )

    expect(diagnostic!.severity).toBe("info")
    expect(apply(text, diagnostic!)).toBe("1 (>K:TOGGLE_ICS)")
  })

  it("leaves raw and converted namespaces alone", () => {
    expect(diagnose("(L:Foo, Bool) (A:PLANE ALTITUDE, feet) (>L:T)")).toEqual(
      []
    )
  })
})

describe("stack-balance", () => {
  it("catches a prepended setter that never consumes its value", () => {
    const diagnostics = diagnose("(A:LIGHT LANDING, Bool) (>L:Copy)", {
      ...CATALOG,
      setterKind: "prepended",
    })

    expect(diagnostics.map((d) => d.ruleId)).toContain("stack-balance")
    expect(diagnostics[0]!.consequence).toContain("puts in front")
  })

  it("accepts the prepended setter that consumes it", () => {
    expect(
      diagnose("(>L:Target)", { ...CATALOG, setterKind: "prepended" })
    ).toEqual([])
  })

  it("catches an underflow in a literal setter", () => {
    const diagnostics = diagnose("+ (>L:X)", {
      ...CATALOG,
      setterKind: "literal",
    })

    expect(diagnostics.map((d) => d.ruleId)).toContain("stack-balance")
  })

  it("stays silent for JS fragments and unclassified text", () => {
    // A template fragment used as a condition legitimately ends at depth 1.
    expect(
      diagnose("(L:Cond, Bool)", { ...CATALOG, setterKind: "javascript" })
    ).toEqual([])
    expect(diagnose("(L:Cond, Bool)")).toEqual([])
  })
})

// ------------------------------------------------------------- collectRefs

describe("collectRefs", () => {
  it("finds refs inside JS strings, where setters keep them", () => {
    const refs = collectRefs("value ? '(>K:AP_VS_ON)' : '(>K:AP_VS_OFF)'")

    expect(refs.map((r) => r.ref.full)).toEqual(["K:AP_VS_ON", "K:AP_VS_OFF"])
    expect(refs.every((r) => r.access === "write")).toBe(true)
  })

  it("descends through YAML quotes, templates and holes", () => {
    // A stale pre-unquoting corpus row: quotes still on, template inside.
    const refs = collectRefs('"`${(L:Guard) ? 1 : 0} (>K:2:KOHLSMAN_SET)`"')

    expect(refs.map((r) => `${r.access} ${r.ref.full}`)).toEqual([
      "read L:Guard",
      "write K:2:KOHLSMAN_SET",
    ])
  })

  it("does not count JavaScript's own parens", () => {
    expect(collectRefs("Math.round(value)").map((r) => r.ref.ns)).toEqual([
      null,
    ])
  })
})

// ---------------------------------------------------------------- tokenAt

describe("tokenAt", () => {
  it("finds a ref through a JS string, offsets exact", () => {
    const text = "value ? '(>K:AP_VS_ON)' : '(>K:AP_VS_OFF)'"
    const hit = tokenAt(text, text.indexOf("AP_VS_OFF"))

    expect(hit?.kind).toBe("ref")
    if (hit?.kind !== "ref") return
    expect(hit.node.ref.full).toBe("K:AP_VS_OFF")
    expect(text.slice(hit.start, hit.end)).toBe("(>K:AP_VS_OFF)")
  })

  it("finds a ref inside a hole inside a template", () => {
    const text = "`${(L:Guard) ? 1 : 0} (>L:X)`"
    const hit = tokenAt(text, text.indexOf("Guard"))

    expect(hit?.kind).toBe("ref")
    if (hit?.kind !== "ref") return
    expect(hit.node.ref.full).toBe("L:Guard")
    expect(text.slice(hit.start, hit.end)).toBe("(L:Guard)")
  })

  it("answers a word with its effect, and whitespace with nothing", () => {
    const word = tokenAt("1 2 + (>L:X)", 4)
    expect(word?.kind).toBe("word")
    if (word?.kind === "word")
      expect(word.effect).toEqual({ pops: 2, pushes: 1 })

    expect(tokenAt("1 2 + (>L:X)", 1)).toBeNull()
  })
})

// ------------------------------------------------------------ entry rules

/**
 * Level 2 — the `get:`/`set:` pair rather than one expression. Every case
 * here is a fact read out of FS Copilot's `ApplyTo`/`ParseSet`, so the
 * shapes are written the way the corpus writes them and the verdicts are
 * what the source says will happen.
 */

const brakes: EntryView = {
  line: 1,
  get: "A:BRAKE LEFT POSITION, Position",
  name: "A:BRAKE LEFT POSITION",
  units: "Position",
  unitsExplicit: true,
  block: "master",
  set: "K:AXIS_LEFT_BRAKE_SET",
}

const master = (set: string): EntryView => ({ ...brakes, set })
const shared = (set: string): EntryView => ({ ...brakes, block: "shared", set })

const LITERAL: RuleContext = { setterKind: "literal" }
const PREPENDED: RuleContext = { setterKind: "prepended" }

describe("dead-set", () => {
  it("catches JF_RJ_100's bare event name, and offers the write", () => {
    const [diagnostic] = analyzeEntry([deadSet], brakes, LITERAL)

    expect(diagnostic?.target).toBe("set")
    expect(diagnostic?.start).toBe(0)
    expect(diagnostic?.end).toBe("K:AXIS_LEFT_BRAKE_SET".length)
    // Names where the value actually goes — the fallback is why the entry
    // looks like it works.
    expect(diagnostic?.consequence).toContain("A:BRAKE LEFT POSITION")
    expect(diagnostic?.verdict).toBe("This setter never runs.")
    expect(diagnostic?.fix?.edits[0]?.newText).toBe("(>K:AXIS_LEFT_BRAKE_SET)")
  })

  it("is silent once the setter ends in a write", () => {
    expect(
      analyzeEntry([deadSet], master("(>K:AXIS_LEFT_BRAKE_SET)"), PREPENDED)
    ).toEqual([])
  })

  it("leaves shared: alone, where the expression really is executed", () => {
    expect(
      analyzeEntry([deadSet], shared("K:AXIS_LEFT_BRAKE_SET"), LITERAL)
    ).toEqual([])
  })

  it("mutes on a javascript setter, whose expression is Jint's output", () => {
    expect(
      analyzeEntry([deadSet], master("`${value} (>K:X)`"), {
        setterKind: "javascript",
      })
    ).toEqual([])
  })

  it("sees that the match cannot cross a line, as .NET's `.` cannot", () => {
    // Whitespace may span lines; anything else before the write may not, so
    // a block-scalar setter written over two lines is dead text.
    const [diagnostic] = analyzeEntry(
      [deadSet],
      master("(A:FOO, percent)\n2 * (>K:BAR)"),
      PREPENDED
    )

    expect(diagnostic?.ruleId).toBe("dead-set")
    // Not a lone name, so nothing to correct it to.
    expect(diagnostic?.fix).toBeUndefined()
  })
})

describe("master-set-shape", () => {
  it("names the words that silently become zeros", () => {
    const set = "(A:FOO, percent) 2 * (>K:BAR)"
    const [diagnostic] = analyzeEntry([masterSetShape], master(set), PREPENDED)

    expect(diagnostic?.ruleId).toBe("master-set-shape")
    expect(diagnostic?.consequence).toContain("(A:FOO, and")
    expect(diagnostic?.message).toContain("(>K:BAR)")
    // The args, not the write that is doing exactly what it says.
    expect(diagnostic?.start).toBe(0)
    expect(diagnostic?.end).toBe("(A:FOO, percent) 2 *".length)
  })

  it("passes the shape a master: entry is supposed to have", () => {
    // Index then value, the order ParseSet's reversal expects.
    expect(
      analyzeEntry(
        [masterSetShape],
        master("1 16160 (>K:2:KOHLSMAN_SET)"),
        LITERAL
      )
    ).toEqual([])
  })

  it("quotes the name the author wrote, not the one FS Copilot writes to", () => {
    /*
     * `ParseSet` strips a `K:n:` arity before writing, so the name it targets
     * is not the name on the line. Moving this rule onto the shared parser
     * silently swapped one for the other for a few minutes — the message read
     * `(>K:BAR)` at somebody who had typed `K:2:BAR`, pointing at text that is
     * not in their file.
     */
    const [diagnostic] = analyzeEntry(
      [masterSetShape],
      master("(A:FOO, percent) 2 * (>K:2:BAR)"),
      LITERAL
    )

    expect(diagnostic?.consequence).toContain("(>K:2:BAR)")
    expect(diagnostic?.consequence).not.toContain("(>K:BAR)")
  })

  it("reads a tab as part of an operand, not as a separator", () => {
    // `Split(' ')` is the space character only, so this is one operand, it is
    // not a number, and it is sent as 0.
    expect(
      analyzeEntry([masterSetShape], master("1	2 (>K:BAR)"), LITERAL)
    ).toHaveLength(1)
  })

  it("does not count an operand that trims away to nothing", () => {
    // `splitArgs` keeps it, because ParseParam reads it as 0 like any other
    // non-number. The rule drops it, because naming an empty string in the
    // message helps nobody — and the two numbers either side are fine.
    expect(
      analyzeEntry([masterSetShape], master("1 	 2 (>K:BAR)"), LITERAL)
    ).toEqual([])
  })

  it("takes ParseParam's idea of a number, not JavaScript's", () => {
    // `-1.5` and `2e3` parse; `0x10` is 0 to FS Copilot and 16 to `Number()`.
    expect(
      analyzeEntry([masterSetShape], master("-1.5 2e3 (>K:BAR)"), LITERAL)
    ).toEqual([])
    expect(
      analyzeEntry([masterSetShape], master("0x10 (>K:BAR)"), LITERAL)
    ).toHaveLength(1)
  })
})

describe("no-write", () => {
  it("catches WBSIM's bare H: press, and offers the write", () => {
    const [diagnostic] = analyzeEntry(
      [noWrite],
      shared("H:KAP140_NAV_PRESS"),
      LITERAL
    )

    // Error, not warning: a shared: setter has no fallback to save it.
    expect(diagnostic?.severity).toBe("error")
    expect(diagnostic?.fix?.edits[0]?.newText).toBe("(>H:KAP140_NAV_PRESS)")
  })

  it("catches the f406 shape, which is not a lone name to correct", () => {
    const [diagnostic] = analyzeEntry(
      [noWrite],
      shared("NAV SWAP:2 = 1"),
      LITERAL
    )

    expect(diagnostic?.ruleId).toBe("no-write")
    expect(diagnostic?.fix).toBeUndefined()
  })

  it("is silent whenever a write is there at all", () => {
    for (const set of [
      "(>B:PARKBRAKE_Set)",
      "(L:Guard) 1 == if{ 1 (>L:X) }",
      "(>K:#84132)",
    ])
      expect(analyzeEntry([noWrite], shared(set), PREPENDED)).toEqual([])
  })

  it("leaves an unterminated write to rpn-unterminated", () => {
    // The Albatross bug. One mistake deserves one squiggle, and the
    // unterminated ref still parses as the write it was meant to be.
    expect(
      analyzeEntry(
        [noWrite],
        shared("(>B:INSTRUMENT_IE_HU16_CB_NAV_2_Toggle"),
        PREPENDED
      )
    ).toEqual([])
  })

  it("does not judge master:, whose fallback dead-set explains instead", () => {
    expect(
      analyzeEntry([noWrite], master("H:KAP140_NAV_PRESS"), LITERAL)
    ).toEqual([])
  })
})

describe("get-unit-meaningless", () => {
  /** An entry as the Black Square profiles write it: no setter at all. */
  const event = (get: string, name: string, units: string): EntryView => ({
    line: 1,
    get,
    name,
    units,
    unitsExplicit: true,
    block: "shared",
  })

  it("catches the Black Square shape and removes just the unit", () => {
    const get = "H:KNS81_RNAV_DMERADIALMODE, Bool"
    const [diagnostic] = analyzeEntry(
      [getUnitMeaningless],
      event(get, "H:KNS81_RNAV_DMERADIALMODE", "Bool"),
      // No setter kind at all — the rule judges the `get:` line, so it must
      // not depend on one. This is 60% of the corpus.
      {}
    )

    expect(diagnostic?.target).toBe("get")
    expect(diagnostic?.severity).toBe("info")
    expect(get.slice(diagnostic!.start, diagnostic!.end)).toBe(", Bool")

    const edit = diagnostic!.fix!.edits[0]!
    expect(get.slice(0, edit.start) + get.slice(edit.end)).toBe(
      "H:KNS81_RNAV_DMERADIALMODE"
    )
  })

  it("says nothing about a unit nobody typed", () => {
    // `K:`/`H:` resolve to no units by default; that is not a decision.
    expect(
      analyzeEntry(
        [getUnitMeaningless],
        { ...event("H:FOO", "H:FOO", ""), unitsExplicit: false },
        {}
      )
    ).toEqual([])
  })

  it("leaves namespaces that really do take units alone", () => {
    for (const [get, name, units] of [
      ["A:BATTERY VOLTAGE, Volts", "A:BATTERY VOLTAGE", "Volts"],
      ["L:Battery, Percent", "L:Battery", "Percent"],
    ])
      expect(
        analyzeEntry([getUnitMeaningless], event(get!, name!, units!), {})
      ).toEqual([])
  })
})

// ---------------------------------------------------------- profile rules

describe("duplicate-get and block-conflict", () => {
  /** A file that declares nothing but these entries — both list blocks
   * optional, and absent is the normal case. */
  const view = (entries: EntryView[]): ProfileView => ({
    entries,
    includes: [],
    ignores: [],
    pointers: [],
    blocks: [{ line: 1, text: "shared", known: true }],
    mappings: [],
    updated: { line: 1, text: "2026-08-29" },
  })

  const at = (
    line: number,
    name: string,
    block: "shared" | "master",
    set?: string
  ): EntryView => ({
    line,
    get: name,
    name,
    units: "Number",
    unitsExplicit: false,
    block,
    ...(set === undefined ? {} : { set }),
  })

  it("catches a name declared twice, identically, and names the first line", () => {
    const entries = [
      at(3, "L:INI_ATC_MSG", "shared"),
      at(56, "L:INI_ATC_MSG", "shared"),
    ]
    const [diagnostic] = analyzeProfileView([duplicateGet], view(entries), {})

    // The verdict lands on the second one, pointing back.
    expect(diagnostic?.line).toBe(56)
    expect(diagnostic?.message).toContain("line 3")
  })

  it("stays silent when the copies differ, which is the CRJ fan-out", () => {
    // One variable driving the captain's button and the first officer's:
    // 161 corpus groups do this deliberately, and both are meant to run.
    const entries = [
      at(64, "L:ASCRJ_MASTER_WARN", "shared", "'(>B:GSC_MASTER_WARN_Push)'"),
      at(66, "L:ASCRJ_MASTER_WARN", "shared", "'(>B:GSF_MASTER_WARN_Push)'"),
    ]

    expect(analyzeProfileView([duplicateGet], view(entries), {})).toEqual([])
  })

  it("keeps the blocks apart — one name in each is not a duplicate", () => {
    const entries = [at(3, "L:X", "shared"), at(9, "L:X", "master")]

    expect(analyzeProfileView([duplicateGet], view(entries), {})).toEqual([])
  })

  it("reports a cross-block name once, on whichever line is later", () => {
    // The corpus's CRJ pairs declare master: first and shared: second.
    const entries = [
      at(43, "L:ASCRJ_TQ_TOGA_1", "master"),
      at(252, "L:ASCRJ_TQ_TOGA_1", "shared"),
    ]
    const found = analyzeProfileView([blockConflict], view(entries), {})

    expect(found).toHaveLength(1)
    expect(found[0]!.line).toBe(252)
    expect(found[0]!.message).toContain("line 43")
  })

  it("compares names exactly, as Coordinator does", () => {
    // `update.Name == getVar` is an ordinal match, so these are two names to
    // FS Copilot whatever the simulator would make of them.
    const entries = [
      at(3, "L:P180_Upper_front_door", "shared"),
      at(9, "L:P180_upper_front_door", "shared"),
    ]

    expect(analyzeProfileView([duplicateGet], view(entries), {})).toEqual([])
  })
})

describe("include-missing", () => {
  const LISTING = [
    "bksq-aircraft-tbm850.yaml",
    "modules/payload.yaml",
    "modules/fuel.yaml",
  ]
  const workspace: RuleContext = { workspaceFiles: () => LISTING }

  const including = (...targets: string[]): ProfileView => ({
    entries: [],
    ignores: [],
    pointers: [],
    includes: targets.map((text, index) => ({ line: index + 10, text })),
    blocks: [],
    mappings: [],
    updated: { line: 1, text: "2026-08-29" },
  })

  it("catches the corpus typo and offers the file sitting beside it", () => {
    const [diagnostic] = analyzeProfileView(
      [includeMissing],
      including("modules/paload.yaml"),
      workspace
    )

    expect(diagnostic?.line).toBe(10)
    expect(diagnostic?.fix?.edits[0]?.newText).toBe("modules/payload.yaml")
  })

  it("says nothing about an include that resolves", () => {
    expect(
      analyzeProfileView(
        [includeMissing],
        including("modules/fuel.yaml"),
        workspace
      )
    ).toEqual([])
  })

  it("says nothing about a profile with no include: block", () => {
    // The block is optional and most profiles have none. An absent
    // `include:` is not a finding and never becomes one.
    expect(
      analyzeProfileView([includeMissing], including(), workspace)
    ).toEqual([])
  })

  it("stays silent without a listing, rather than calling everything missing", () => {
    expect(
      analyzeProfileView(
        [includeMissing],
        including("modules/anything.yaml"),
        {}
      )
    ).toEqual([])
  })

  it("reports without a fix when the neighbourhood is ambiguous", () => {
    // Equidistant from payload.yaml and fuel.yaml? No — but two candidates
    // within two edits must produce no suggestion at all.
    const [diagnostic] = analyzeProfileView(
      [includeMissing],
      including("modules/uel.yaml"),
      { workspaceFiles: () => [...LISTING, "modules/duel.yaml"] }
    )

    expect(diagnostic?.ruleId).toBe("include-missing")
    expect(diagnostic?.fix).toBeUndefined()
  })

  it("matches case-insensitively, as the filesystem does", () => {
    expect(
      analyzeProfileView(
        [includeMissing],
        including("MODULES/Fuel.YAML"),
        workspace
      )
    ).toEqual([])
  })
})

describe("header-updated", () => {
  const profile = (
    updated: ProfileView["updated"],
    entries: EntryView[]
  ): ProfileView => ({
    entries,
    includes: [],
    ignores: [],
    pointers: [],
    blocks: [{ line: 3, text: "shared", known: true }],
    mappings: [],
    updated,
  })

  const entry: EntryView = {
    line: 4,
    get: "L:Battery",
    name: "L:Battery",
    units: "Number",
    unitsExplicit: false,
    block: "shared",
  }

  it("is an error, because the profile is offered for replacement forever", () => {
    const [diagnostic] = analyzeProfileView(
      [headerUpdated],
      profile(null, [entry]),
      {}
    )

    expect(diagnostic?.severity).toBe("error")
    // At the top of the profile proper, not on a line that does not exist.
    expect(diagnostic?.line).toBe(3)
  })

  it("says nothing once the date is there", () => {
    expect(
      analyzeProfileView(
        [headerUpdated],
        profile({ line: 1, text: "2026-08-29" }, [entry]),
        {}
      )
    ).toEqual([])
  })

  it("does not nag a file that is not a profile yet", () => {
    // No entries: somebody has opened a blank file or written a header and
    // stopped. The absence rule holds — a missing date costs nothing yet.
    expect(analyzeProfileView([headerUpdated], profile(null, []), {})).toEqual(
      []
    )
  })
})

describe("block-unknown and ignore-duplicate", () => {
  const file = (over: Partial<ProfileView>): ProfileView => ({
    entries: [],
    includes: [],
    ignores: [],
    pointers: [],
    blocks: [],
    mappings: [],
    updated: { line: 1, text: "2026-08-29" },
    ...over,
  })

  it("treats a typo'd block key as an error, because the file stops loading", () => {
    const [diagnostic] = analyzeProfileView(
      [blockUnknown],
      file({ blocks: [{ line: 4, text: "sharde", known: false }] }),
      {}
    )

    expect(diagnostic?.severity).toBe("error")
    expect(diagnostic?.fix?.edits[0]?.newText).toBe("shared")
  })

  it("reports without a guess when nothing is close", () => {
    const [diagnostic] = analyzeProfileView(
      [blockUnknown],
      file({ blocks: [{ line: 4, text: "aircraft", known: false }] }),
      {}
    )

    expect(diagnostic?.ruleId).toBe("block-unknown")
    expect(diagnostic?.fix).toBeUndefined()
  })

  it("leaves the four real keys alone", () => {
    expect(
      analyzeProfileView(
        [blockUnknown],
        file({
          blocks: [
            { line: 1, text: "shared", known: true },
            { line: 9, text: "master", known: true },
          ],
        }),
        {}
      )
    ).toEqual([])
  })

  it("calls a repeated ignore: harmless, and says so", () => {
    const [diagnostic] = analyzeProfileView(
      [ignoreDuplicate],
      file({
        ignores: [
          { line: 3, text: "Barometer" },
          { line: 4, text: "Altimeter" },
          { line: 5, text: "Barometer" },
        ],
      }),
      {}
    )

    // A HashSet on the other side: it costs nothing, so it is not a warning.
    expect(diagnostic?.severity).toBe("info")
    expect(diagnostic?.line).toBe(5)
    expect(diagnostic?.message).toContain("line 3")
  })
})

describe("nearest", () => {
  it("refuses to choose between two equally close candidates", () => {
    // The lesson from the struck variable-name rule, kept in one place.
    expect(nearest("fuel", ["fuse", "duel", "payload"])).toBeNull()
    expect(nearest("payl0ad", ["payload", "fuel"])).toBe("payload")
    expect(nearest("something-else-entirely", ["payload"])).toBeNull()
  })
})

// ------------------------------------------------------------ setter shape

describe("value-word", () => {
  it("catches an identifier that only exists inside JavaScript", () => {
    // No quote, backtick, `?` or brace anywhere, so FS Copilot reads this as
    // a literal — and the calculator ignores the bare word `value`.
    const set = "value 2 * (>L:Target)"
    const [diagnostic] = analyzeEntry(
      [valueWord],
      { ...brakes, block: "shared", set },
      LITERAL
    )

    expect(diagnostic?.ruleId).toBe("value-word")
    expect(set.slice(diagnostic!.start, diagnostic!.end)).toBe("value")
  })

  it("leaves a real javascript setter alone", () => {
    expect(
      analyzeEntry(
        [valueWord],
        { ...brakes, block: "shared", set: "`${value * 2} (>L:Target)`" },
        { setterKind: "javascript" }
      )
    ).toEqual([])
  })

  it("does not match a name that merely contains the word", () => {
    expect(
      analyzeEntry(
        [valueWord],
        { ...brakes, block: "shared", set: "(L:RawValue) (>L:Target)" },
        PREPENDED
      )
    ).toEqual([])
  })
})

describe("prepended-unused", () => {
  it("catches a setter that supplies all its own operands", () => {
    const [diagnostic] = analyzeEntry(
      [prependedUnused],
      { ...brakes, block: "shared", set: "(L:Source) (>L:Target)" },
      PREPENDED
    )

    expect(diagnostic?.ruleId).toBe("prepended-unused")
  })

  it("stays silent on the shape 1,940 corpus setters actually use", () => {
    // The bare write pops the prepended value. The shared simulator softens
    // this pop, which is why the rule walks the stack itself.
    for (const set of [
      "(>K:RUDDER_TRIM_SET_EX1)",
      "(>L:Battery)",
      "(>K:2:KOHLSMAN_SET)",
      "(A:X, percent) *  (>L:Y)",
    ])
      expect(
        analyzeEntry([prependedUnused], { ...brakes, set }, PREPENDED)
      ).toEqual([])
  })

  it("refuses to judge past an unknown word", () => {
    expect(
      analyzeEntry(
        [prependedUnused],
        { ...brakes, set: "(L:A) mystery-op (>L:B)" },
        PREPENDED
      )
    ).toEqual([])
  })
})

describe("not-settable", () => {
  const docs: RuleContext = {
    simVarSettable: (name) => (name === "A:NAV VOLUME" ? false : null),
  }
  const implicit = (name: string): EntryView => ({
    line: 2,
    get: name,
    name,
    units: "Number",
    unitsExplicit: false,
    block: "shared",
  })

  it("notes an implicit write the docs say cannot land", () => {
    const [diagnostic] = analyzeEntry(
      [notSettable],
      implicit("A:NAV VOLUME:1"),
      docs
    )

    // Info, not a warning: 119 corpus entries are in this position and the
    // docs' column is not the path FS Copilot writes through.
    expect(diagnostic?.severity).toBe("info")
    expect(diagnostic?.target).toBe("get")
  })

  it("says nothing once the author has written a setter", () => {
    expect(
      analyzeEntry(
        [notSettable],
        { ...implicit("A:NAV VOLUME"), set: "(>K:NAV1_VOLUME_SET)" },
        docs
      )
    ).toEqual([])
  })

  it("stays silent where the docs said nothing", () => {
    expect(
      analyzeEntry([notSettable], implicit("A:SOMETHING ELSE"), docs)
    ).toEqual([])
    expect(analyzeEntry([notSettable], implicit("A:NAV VOLUME"), {})).toEqual(
      []
    )
  })
})

// ----------------------------------------------------------- evidence tier

describe("b-preset-unknown", () => {
  /** An aeroplane that has these events and no others. */
  const aircraft = (...events: string[]): RuleContext => ({
    hasInputEvent: (name) =>
      events.some((event) => event.toLowerCase() === name.toLowerCase()),
  })

  const judge = (text: string, context: RuleContext): Diagnostic[] => {
    const doc = parseRpn(text)
    return analyze([bPresetUnknown], doc, simulate(doc), context)
  }

  it("names a preset this aircraft does not have", () => {
    const [diagnostic] = judge(
      "(>B:LIGHTING_ASCRJ_EXTL_NAV_Toggle)",
      aircraft("AIRLINER_FCU_SPD_PUSH")
    )

    expect(diagnostic?.ruleId).toBe("b-preset-unknown")
    // Warning, never error: the sim's table fills as add-ons register.
    expect(diagnostic?.severity).toBe("warning")
  })

  it("accepts a name the aircraft knows outright", () => {
    expect(
      judge("(>B:AIRLINER_FCU_SPD_PUSH)", aircraft("AIRLINER_FCU_SPD_PUSH"))
    ).toEqual([])
  })

  it("accepts a name whose preset the aircraft knows", () => {
    // The written name carries an operation the enumeration does not.
    expect(judge("(>B:PARKBRAKE_Toggle)", aircraft("PARKBRAKE"))).toEqual([])
  })

  it("accepts the A220's own both-spellings case", () => {
    // Both are real `<InputEvent ID>`s on that aeroplane — it names two
    // controls that way, as it does for ALT. Not a preset and a preset+op.
    const a220 = aircraft("AIRLINER_FCU_SPD_PUSH", "AIRLINER_FCU_SPD_PUSH_PUSH")
    expect(judge("(>B:AIRLINER_FCU_SPD_PUSH_PUSH)", a220)).toEqual([])
    expect(judge("(B:AIRLINER_FCU_SPD_PUSH)", a220)).toEqual([])
  })

  it("accepts an authored preset the enumeration never lists", () => {
    /*
     * Measured against the running A220 on 2026-09-03: the sim enumerates
     * AIRLINER_FCU_CHRONO_2 and never AIRLINER_FCU_CHRONO_2_Push, which is
     * the name the Behaviors tool shows and the name FS Copilot writes. The
     * rule used to call this the wrong operation on a Baron datapoint.
     */
    const a220 = aircraft(
      "AIRLINER_FCU_CHRONO_1",
      "AIRLINER_FCU_CHRONO_2",
      "AIRLINER_FCU_MASTER_CAUTION_1"
    )

    expect(judge("(>B:AIRLINER_FCU_CHRONO_2_Push)", a220)).toEqual([])
    expect(judge("(B:AIRLINER_FCU_MASTER_CAUTION_1_Push)", a220)).toEqual([])
  })

  it("goes quiet on a vendor word it cannot tell from a real preset", () => {
    /*
     * The Baron's `_ARM` is dead where `_ON` works, and this rule used to say
     * so. It can no longer: `SAFETY_ELT_1_ARM` and the A220's working
     * `..._CHRONO_2_Push` are the same shape, and the 2026-08-28 finding is
     * that only per-preset set-code decides. Running the setter answers it.
     */
    const baron = aircraft("SAFETY_ELT_1")

    expect(judge("(>B:SAFETY_ELT_1_ON)", baron)).toEqual([])
    expect(judge("(>B:SAFETY_ELT_1_ARM)", baron)).toEqual([])
  })

  it("warns when a write names a bare enumerated ID", () => {
    // b-write-op's muted branch, decidable at last: the table holds IDs, so a
    // written name that is in it verbatim is an ID with its action missing.
    const judgeBare = (text: string, context: RuleContext): Diagnostic[] => {
      const doc = parseRpn(text)
      return analyze([bWriteBare], doc, simulate(doc), context)
    }

    const a220 = aircraft("AIRLINER_FCU_CHRONO_2")
    const [diagnostic] = judgeBare("(>B:AIRLINER_FCU_CHRONO_2)", a220)

    expect(diagnostic?.ruleId).toBe("b-write-bare")
    expect(diagnostic?.severity).toBe("warning")
    expect(diagnostic?.message).toContain("AIRLINER_FCU_CHRONO_2_Set")

    // Reading the bare ID is the canonical form — 411 corpus get: lines do it.
    expect(judgeBare("(B:AIRLINER_FCU_CHRONO_2)", a220)).toEqual([])

    // With an action on it there is nothing to say, whether or not the whole
    // name enumerates.
    expect(judgeBare("(>B:AIRLINER_FCU_CHRONO_2_Push)", a220)).toEqual([])

    // Presence is the evidence. No aircraft, no verdict.
    expect(judgeBare("(>B:AIRLINER_FCU_CHRONO_2)", {})).toEqual([])
  })

  it("still catches a base the aircraft does not have", () => {
    const baron = aircraft("SAFETY_ELT_1")
    const [diagnostic] = judge("(>B:SAFETY_ELT_2_Push)", baron)

    expect(diagnostic?.verdict).toContain("no input event SAFETY_ELT_2_Push")
    expect(diagnostic?.remedy).toContain("SAFETY_ELT_2 is not there either")
  })

  it("asks the same question of a get: line, where 643 corpus entries live", () => {
    const baron: RuleContext = {
      hasInputEvent: (name) => name.toLowerCase() === "electrical_battery_1",
    }
    const entry = (name: string): EntryView => ({
      line: 2,
      get: name,
      name,
      units: "Number",
      unitsExplicit: false,
      block: "shared",
    })

    // Legal dialect — a B: get: mirrors the event firing — but only for an
    // event the aeroplane has.
    expect(
      analyzeEntry([getPresetUnknown], entry("B:ELECTRICAL_Battery_1"), baron)
    ).toEqual([])

    const [diagnostic] = analyzeEntry(
      [getPresetUnknown],
      entry("B:NOTHING_LIKE_IT"),
      baron
    )
    expect(diagnostic?.target).toBe("get")
    expect(diagnostic?.message).toContain("never report anything")
  })

  it("says nothing at all with no aircraft loaded", () => {
    // The whole tier's contract: no evidence, no verdict — not a guess that
    // the name is missing.
    expect(judge("(>B:ANYTHING_AT_ALL)", {})).toEqual([])
    expect(
      judge("(>B:ANYTHING_AT_ALL)", { hasInputEvent: () => null })
    ).toEqual([])
  })
})

// ------------------------------------------------ b-value-constant (evidence)

/**
 * The two zeros, and the only evidence that separates them.
 *
 * A momentary control fires with the value 0 every time it is pressed; a
 * latching control nobody has touched also reads 0. Measured on the A220,
 * 2026-09-04 — `AIRLINER_FCU_ALT_PUSH` fired ten times without moving, and
 * `AIRLINER_LDG_LEVER` sat at 0 because the gear was down.
 */
describe("b-value-constant", () => {
  const line = (name: string): EntryView => ({
    line: 2,
    get: name,
    name,
    units: "Number",
    unitsExplicit: false,
    block: "shared",
  })

  const seen = (
    activity: Record<string, { firings: number; changes: number }>
  ): RuleContext => ({
    inputEventActivity: (name) => activity[name] ?? null,
  })

  it("warns on a control worked repeatedly whose value never moved", () => {
    const [diagnostic] = analyzeEntry(
      [bValueConstant],
      line("B:AIRLINER_FCU_ALT_PUSH"),
      seen({ AIRLINER_FCU_ALT_PUSH: { firings: 10, changes: 0 } })
    )

    expect(diagnostic?.target).toBe("get")
    // Info: it has fired on controls that do carry state — worked against a
    // stop, or while nothing could change — so it reports what it saw.
    expect(diagnostic?.severity).toBe("info")
    expect(diagnostic?.verdict).toContain("fired 10 times")
    expect(diagnostic?.verdict).toContain("has not changed")
  })

  it("stays silent on a control that has moved even once", () => {
    // One change proves the value is state. Nothing else needs deciding.
    expect(
      analyzeEntry(
        [bValueConstant],
        line("B:AIRLINER_OVH_LTS_BEACON"),
        seen({ AIRLINER_OVH_LTS_BEACON: { firings: 8, changes: 4 } })
      )
    ).toEqual([])
  })

  it("stays silent on a control nobody has worked enough", () => {
    // The gear lever case: reads 0 forever on the runway, and is a perfectly
    // good read. One firing could be a simulator stall misread as a press.
    expect(
      analyzeEntry(
        [bValueConstant],
        line("B:AIRLINER_LDG_LEVER"),
        seen({ AIRLINER_LDG_LEVER: { firings: 1, changes: 0 } })
      )
    ).toEqual([])
  })

  it("says nothing at all with no aircraft loaded", () => {
    // The tier's contract, same as every rule beside it.
    expect(analyzeEntry([bValueConstant], line("B:ANYTHING"), {})).toEqual([])
    expect(
      analyzeEntry([bValueConstant], line("B:ANYTHING"), seen({}))
    ).toEqual([])
  })

  it("finds the activity through a preset suffix", () => {
    // Evidence is recorded against the id the simulator enumerates; profiles
    // write `<id>_<Preset>`. Both halves must agree or the rule never fires.
    const [diagnostic] = analyzeEntry(
      [bValueConstant],
      line("B:AIRLINER_FCU_ALT_PUSH_Set"),
      seen({ AIRLINER_FCU_ALT_PUSH: { firings: 5, changes: 0 } })
    )

    expect(diagnostic?.message).toContain("AIRLINER_FCU_ALT_PUSH")
  })

  it("leaves other namespaces alone", () => {
    expect(
      analyzeEntry(
        [bValueConstant],
        line("L:SomeSwitch"),
        seen({ SomeSwitch: { firings: 9, changes: 0 } })
      )
    ).toEqual([])
  })
})

// ------------------------------------------------- ref-unresolved (evidence)

describe("ref-unresolved", () => {
  const entry = (name: string): EntryView => ({
    line: 2,
    get: name,
    name,
    units: "",
    unitsExplicit: false,
    block: "shared",
  })

  /** A module watching one ref and failing to resolve it. */
  const module = (unresolved: string): RuleContext => ({
    refResolved: (name) =>
      name.toLowerCase() === unresolved.toLowerCase() ? false : null,
  })

  const judge = (name: string, context: RuleContext): EntryDiagnostic[] =>
    analyzeEntry([refUnresolved], entry(name), context)

  it("reports the Z: the aircraft does not have", () => {
    // The thirteen corpus lines, and the case protocol 5 was built for.
    const [diagnostic] = judge(
      "Z:AUDIO_Knob_Selector_1",
      module("Z:AUDIO_Knob_Selector_1")
    )

    expect(diagnostic?.ruleId).toBe("ref-unresolved")
    expect(diagnostic?.target).toBe("get")
    // Warning, never error: the retry resolves the moment the variable
    // appears, so an unresolved verdict is a fact about this moment.
    expect(diagnostic?.severity).toBe("warning")
    // The consequence an author can act on — not "it errors", because it
    // does not: FS Copilot's calculator read creates it and syncs a 0.
    expect(diagnostic?.message).toContain("constant 0")
  })

  it("stays silent on a ref that resolved", () => {
    expect(judge("E:ZULU TIME", { refResolved: () => true })).toEqual([])
  })

  it("treats no verdict as no question, not as absence", () => {
    // The tier's contract. Null covers three real states — no module, no tab
    // holding this line, and a watch set still in its debounce — and none of
    // them is evidence that the variable is missing.
    expect(judge("Z:AUDIO_Knob_Selector_1", {})).toEqual([])
    expect(
      judge("Z:AUDIO_Knob_Selector_1", { refResolved: () => null })
    ).toEqual([])
  })

  it("asks only about namespaces the module actually watches", () => {
    // A context that would answer false for anything. `A:` goes through
    // SimConnect and plain `L:` is streamed rather than watched, so neither
    // is ever in the mapping — asking would be inventing evidence.
    const wrong: RuleContext = { refResolved: () => false }

    expect(judge("A:PLANE ALTITUDE", wrong)).toEqual([])
    expect(judge("L:XMLVAR_Battery", wrong)).toEqual([])

    // Indexed `L:` is a typed-id watch, so it does get asked.
    expect(judge("L:1:MyVar", wrong)).toHaveLength(1)
  })

  it("squiggles the name rather than the whole get: value", () => {
    const [diagnostic] = judge("Z:Foo", module("Z:Foo"))
    expect(diagnostic?.start).toBe(0)
    expect(diagnostic?.end).toBe("Z:Foo".length)
  })
})
