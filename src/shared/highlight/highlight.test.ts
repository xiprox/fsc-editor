/**
 * The highlighter, driven headless — one case per row of the taxonomy tables
 * in *Highlighting v2* (docs/sim-vars/18-language-core.md), plus the corpus
 * mistakes it must survive.
 *
 * Scopes are asserted at the columns that matter, not exhaustively: the
 * painter collapses runs, and pinning every boundary would turn each
 * cosmetic tweak into test surgery.
 */

import { describe, expect, it } from "vitest"

import {
  highlightLine,
  initialHighlightState,
  isScope,
  type HighlightState,
  type Span,
} from "./index.ts"

/** Highlights lines in order, returning the last line's spans. */
function spansOf(...lines: string[]): Span[] {
  let state: HighlightState = initialHighlightState()
  let spans: Span[] = []

  for (const line of lines) {
    const result = highlightLine(line, state)
    spans = result.spans
    state = result.state
  }

  return spans
}

/** The scope painting the given column, by the last span at or before it. */
function scopeAt(spans: Span[], column: number): string {
  let scope = ""
  for (const span of spans) {
    if (span.start > column) break
    scope = span.scope
  }
  return scope
}

/** The scope at the first occurrence of `needle` in the last line. */
function at(lines: string[], needle: string): string {
  const last = lines[lines.length - 1]!
  const column = last.indexOf(needle)
  if (column === -1) throw new Error(`${JSON.stringify(needle)} not in line`)
  return scopeAt(spansOf(...lines), column)
}

const ENTRY = ["shared:", "  - get: A:PLANE ALTITUDE, feet"]
const set = (value: string): string[] => [...ENTRY, `    set: ${value}`]

describe("the YAML skeleton", () => {
  it("paints block keys, entry keys and their punctuation", () => {
    expect(at(["shared:"], "shared")).toBe("yaml.block")
    expect(at(["shared:"], ":")).toBe("yaml.delimiter")
    expect(at(ENTRY, "-")).toBe("yaml.delimiter")
    expect(at(ENTRY, "get")).toBe("yaml.key")
    expect(at(ENTRY, ": A")).toBe("yaml.delimiter")
  })

  it("paints an include path and an unknown block plainly", () => {
    expect(at(["include:", "  - base.yaml"], "base")).toBe("yaml.path")
    expect(at(["bogus:"], "bogus")).toBe("")
  })

  it("keeps a parked block scalar's body parked", () => {
    const lines = [
      "shared:",
      "# - get: A:AUTOPILOT HEADING LOCK DIR, Degrees",
      "#   set: >",
      "#     (() => {",
      "#       let delta = value - current;",
    ]
    expect(at(lines.slice(0, 3), "set")).toBe("comment.code")
    expect(at(lines.slice(0, 4), "(() =>")).toBe("comment.code")
    expect(at(lines, "delta")).toBe("comment.code")
    expect(at([...lines, "# a remark at the margin"], "remark")).toBe("comment")
  })

  it("paints headings, dividers, parked entries and header meta", () => {
    expect(at(["# ═══ Lights ═══"], "Lights")).toBe("comment.section")
    expect(at(["# ─── Landing ───"], "Landing")).toBe("comment.subsection")
    expect(at(["# ────────────"], "─")).toBe("comment")
    expect(at(["#   - get: L:OLD"], "L:OLD")).toBe("comment.code")
  })
})

describe("get: and skp: lines", () => {
  it("colours prefix, name, units", () => {
    expect(at(ENTRY, "A:")).toBe("ref.prefix")
    expect(at(ENTRY, "PLANE")).toBe("ref.name")
    expect(at(ENTRY, ", feet")).toBe("ref.unit")
  })

  it("measures a long prefix with the parser, not the first letter", () => {
    const lines = ["shared:", "  - get: L:1:MyVar"]
    expect(at(lines, "L:1:")).toBe("ref.prefix")
    expect(at(lines, "1:")).toBe("ref.prefix")
    expect(at(lines, "MyVar")).toBe("ref.name")
  })

  it("paints a skp: value as a name, not as JavaScript", () => {
    const lines = [...ENTRY, "    skp: L:XMLVAR_Foo"]
    expect(at(lines, "L:")).toBe("ref.prefix")
    expect(at(lines, "XMLVAR")).toBe("ref.name")
  })

  it("keeps a trailing comment a comment", () => {
    const lines = ["shared:", "  - get: A:LIGHT LANDING, Bool  # note"]
    expect(at(lines, "# note")).toBe("comment")
    expect(at(lines, "Bool")).toBe("ref.unit")
  })
})

describe("layer 1 — the YAML surface of a set:", () => {
  it("plain literal", () => {
    const lines = set("0 (>K:FLIGHT_LEVEL_CHANGE)")
    expect(at(lines, "0")).toBe("rpn.number")
    expect(at(lines, "(")).toBe("ref.delimiter")
    expect(at(lines, ">")).toBe("ref.write")
    expect(at(lines, "K:")).toBe("ref.prefix")
    expect(at(lines, "FLIGHT")).toBe("ref.target")
    expect(at(lines, ")")).toBe("ref.delimiter")
  })

  it("double-quoted JavaScript — the dominant corpus form", () => {
    const lines = set('"`${value} (>B:ENGINE_Throttle_1_Set)`"')
    expect(at(lines, '"')).toBe("yaml.delimiter")
    expect(at(lines, "`")).toBe("js.quote")
    expect(at(lines, "${")).toBe("js.hole")
    expect(at(lines, "value")).toBe("js.injected")
    expect(at(lines, "}")).toBe("js.hole")
    expect(at(lines, "B:")).toBe("ref.prefix")
    expect(at(lines, "ENGINE")).toBe("ref.target")
    expect(at(lines, '`"')).toBe("js.quote")
    expect(scopeAt(spansOf(...lines), lines[2]!.length - 1)).toBe(
      "yaml.delimiter"
    )
  })

  it("single-quoted literal", () => {
    const lines = set("'0 (>B:LIGHTING_ASCRJ_YOKEC_APDISC_BTN_KEY_PUSH)'")
    expect(at(lines, "'")).toBe("yaml.delimiter")
    expect(at(lines, "0")).toBe("rpn.number")
    expect(at(lines, "LIGHTING")).toBe("ref.target")
  })

  it("block scalar header, with its trailing comment", () => {
    const lines = [...ENTRY, "    set: |  #This looks like a better way"]
    expect(at(lines, "|")).toBe("yaml.delimiter")
    expect(at(lines, "#This")).toBe("comment")
  })

  it("block scalar body is JavaScript", () => {
    const lines = [
      ...ENTRY,
      "    set: >",
      "      (() => {",
      "        if (!!value === !!current) return '';",
      "        return '(>H:BKSQ_FAILURE_L_ENGINE_FAILURE)';",
      "      })()",
    ]
    expect(at(lines.slice(0, 4), "(")).toBe("js.delimiter")
    expect(at(lines.slice(0, 4), "=>")).toBe("js.operator")
    expect(at(lines.slice(0, 5), "if")).toBe("js.keyword")
    expect(at(lines.slice(0, 5), "value")).toBe("js.injected")
    expect(at(lines.slice(0, 5), "current")).toBe("js.injected")
    expect(at(lines.slice(0, 6), "return")).toBe("js.keyword")
    expect(at(lines.slice(0, 6), "'")).toBe("js.quote")
    expect(at(lines.slice(0, 6), "H:")).toBe("ref.prefix")
    expect(at(lines.slice(0, 6), "BKSQ")).toBe("ref.target")
    expect(at(lines, "})()")).toBe("js.delimiter")
  })

  it("a comment after a quoted value", () => {
    const lines = set('"1 (>K:TOGGLE_AIRCRAFT_EXIT)"  # door')
    expect(at(lines, "1")).toBe("rpn.number")
    expect(at(lines, "# door")).toBe("comment")
  })
})

describe("layer 2 — the kind", () => {
  it("prepended", () => {
    const lines = set("(>K:RUDDER_TRIM_SET_EX1)")
    expect(at(lines, ">")).toBe("ref.write")
    expect(at(lines, "RUDDER")).toBe("ref.target")
  })

  it("literal with two operands and a K:2: arity", () => {
    const lines = set("14 2 (>K:2:ELECTRICAL_BUS_TO_CIRCUIT_CONNECTION_TOGGLE)")
    expect(at(lines, "14")).toBe("rpn.number")
    expect(at(lines, "2 (")).toBe("rpn.number")
    expect(at(lines, "K:2:")).toBe("ref.prefix")
    expect(at(lines, "2:E")).toBe("ref.prefix")
    expect(at(lines, "ELECTRICAL")).toBe("ref.target")
  })

  it("javascript ternary of strings", () => {
    const lines = set(
      "\"value > current ? '(>B:VSPEED_INC)' : '(>B:VSPEED_DEC)'\""
    )
    expect(at(lines, "value")).toBe("js.injected")
    expect(at(lines, ">")).toBe("js.operator")
    expect(at(lines, "current")).toBe("js.injected")
    expect(at(lines, "?")).toBe("js.operator")
    expect(at(lines, "'")).toBe("js.quote")
    expect(at(lines, "B:VSPEED_INC")).toBe("ref.prefix")
    expect(at(lines, "VSPEED_DEC")).toBe("ref.target")
  })

  it("javascript switch on one line", () => {
    const lines = set(
      "\"switch (value) { case 0: return '0 (>B:GUARD_Off)' }\""
    )
    expect(at(lines, "switch")).toBe("js.keyword")
    expect(at(lines, "(value")).toBe("js.delimiter")
    expect(at(lines, "case")).toBe("js.keyword")
    expect(at(lines, "return")).toBe("js.keyword")
    expect(at(lines, "0 (")).toBe("rpn.number")
    expect(at(lines, "GUARD")).toBe("ref.target")
  })

  it("javascript IIFE on one line", () => {
    const lines = set(
      "\"(() => { if (!!value === !!current) return ''; return '(>H:E)'; })()\""
    )
    expect(at(lines, "if")).toBe("js.keyword")
    expect(at(lines, "!!value")).toBe("js.operator")
    expect(at(lines, "H:")).toBe("ref.prefix")
    expect(at(lines, "})()")).toBe("js.delimiter")
  })

  it("keeps JavaScript's own parens as JavaScript", () => {
    const lines = set('"`${Math.round(value)} (>L:X)`"')
    expect(at(lines, "Math")).toBe("js.identifier")
    expect(at(lines, "(")).toBe("js.delimiter")
    expect(at(lines, "value")).toBe("js.injected")
  })

  it("a bare call with no trigger character is literal RPN, honestly", () => {
    // No quote, backtick, `?` or brace: FS Copilot never evaluates this, it
    // sends the text to the calculator as written — so it paints as RPN.
    const lines = set("Math.round(value)")
    expect(at(lines, "Math")).toBe("rpn.word")
    expect(at(lines, "(")).toBe("ref.delimiter")
  })
})

describe("layer 3 — the program", () => {
  it("RPN with operators and flow inside a JavaScript string", () => {
    const lines = set(
      "\"value ? '(A:EXTERNAL POWER ON:1, Bool) 0 == if{ (>K:TOGGLE_EXTERNAL_POWER) }' : ''\""
    )
    expect(at(lines, "A:")).toBe("ref.prefix")
    expect(at(lines, "EXTERNAL")).toBe("ref.name")
    expect(at(lines, ", Bool")).toBe("ref.unit")
    expect(at(lines, "0 ==")).toBe("rpn.number")
    expect(at(lines, "==")).toBe("rpn.operator")
    expect(at(lines, "if{")).toBe("rpn.flow")
    expect(at(lines, "TOGGLE")).toBe("ref.target")
    expect(at(lines, "}'")).toBe("rpn.flow")
    expect(at(lines, ": ''")).toBe("js.operator")
  })

  it("registers and named operators", () => {
    const lines = set("\"`(A:X, Bool) s0 l0 abs min (>L:Y)`\"")
    expect(at(lines, "s0")).toBe("rpn.register")
    expect(at(lines, "l0")).toBe("rpn.register")
    expect(at(lines, "abs")).toBe("rpn.operator")
    expect(at(lines, "min")).toBe("rpn.operator")
  })

  it("a word the operator table does not know is a word", () => {
    expect(at(set("NAV SWAP:2 = 1"), "NAV")).toBe("rpn.word")
    expect(at(set("K:THROTTLE1_SET"), "K:")).toBe("rpn.word")
    // The value of a string is RPN, so `value` inside one is a word too.
    expect(at(set("\"'value'\""), "value")).toBe("rpn.word")
  })

  it("arithmetic in a hole, and a numeric K:# event id", () => {
    const lines = set('"`${value * 0.1} (>K:#70092)`"')
    expect(at(lines, "*")).toBe("js.operator")
    expect(at(lines, "0.1")).toBe("js.number")
    expect(at(lines, "#70092")).toBe("ref.target")
  })

  it("a string nested in a hole, and the hole closing after it", () => {
    const lines = set("\"`${value > 5 ? '109 (>L:VC_TRIGGER)' : ''}`\"")
    expect(at(lines, "'109")).toBe("js.quote")
    expect(at(lines, "109")).toBe("rpn.number")
    expect(at(lines, "L:")).toBe("ref.prefix")
    expect(at(lines, "''}`")).toBe("js.quote")
    expect(at(lines, "}`")).toBe("js.hole")
    expect(at(lines, "`\"")).toBe("js.quote")
  })

  it("a template concatenated to a string", () => {
    const lines = set("\"`${value * 16}` + '(>K:A32NX.FCU_EFIS_L_BARO_SET)'\"")
    expect(at(lines, "16")).toBe("js.number")
    expect(at(lines, "+")).toBe("js.operator")
    expect(at(lines, "A32NX")).toBe("ref.target")
  })

  it("a ref without a namespace is all target", () => {
    expect(at(set("8 (>LIGHT_POTENTIOMETER_8_SET)"), "LIGHT")).toBe(
      "ref.target"
    )
  })

  it("a line comment in a block body", () => {
    const lines = [
      ...ENTRY,
      "    set: |",
      "      (() => {",
      "        // A:DECISION HEIGHT has no absolute setter (>K:X)",
    ]
    expect(at(lines, "//")).toBe("js.comment")
    expect(at(lines, "(>K:X)")).toBe("js.comment")
  })

  it("a block comment carries across lines", () => {
    const lines = [...ENTRY, "    set: |", "      /* one", "      two */ value"]
    expect(at(lines, "two")).toBe("js.comment")
    expect(at(lines, "value")).toBe("js.injected")
  })

  it("a template literal carries across lines", () => {
    const lines = [
      ...ENTRY,
      "    set: >",
      "      value ? `(L:XMLVAR_GPS_DISABLED, bool)",
      "        if{ (A:GPS DRIVES NAV1, Bool) 0 == if{ (>K:TOGGLE_GPS) } }` : ''",
    ]
    expect(at(lines, "if{")).toBe("rpn.flow")
    expect(at(lines, "A:")).toBe("ref.prefix")
    expect(at(lines, "TOGGLE_GPS")).toBe("ref.target")
    expect(at(lines, "` :")).toBe("js.quote")
    expect(at(lines, "''")).toBe("js.quote")
  })

  it("a hole spanning lines keeps its brace depth", () => {
    const lines = [
      ...ENTRY,
      "    set: |",
      "      `${value > 5 ? (() => {",
      "        return 1 })() : 0} (>L:X)`",
    ]
    expect(at(lines, "return")).toBe("js.keyword")
    expect(at(lines, "} (")).toBe("js.hole")
    expect(at(lines, "L:")).toBe("ref.prefix")
  })
})

describe("the corpus mistakes", () => {
  it("a template closed by a quote", () => {
    const lines = set("\"`${value} (>K:COVER_0_SET)'\"")
    expect(at(lines, "K:")).toBe("ref.prefix")
    expect(at(lines, "COVER")).toBe("ref.target")
  })

  it("a write missing its open paren", () => {
    const lines = set('"`5 ${value} >K:2:CABIN_LIGHTS_SET)`"')
    expect(at(lines, "5")).toBe("rpn.number")
    expect(at(lines, ">K:2:")).toBe("rpn.word")
  })

  it("survives an unterminated ref mid-keystroke", () => {
    const lines = set("(>B:INSTRUMENT_IE_HU16_CB_NAV_2_Toggle")
    expect(at(lines, "B:")).toBe("ref.prefix")
    expect(at(lines, "INSTRUMENT")).toBe("ref.target")
  })

  it("a trailing comma is a word", () => {
    expect(at(set("(>K:STARTER1_SET),"), ",")).toBe("rpn.word")
  })

  it("makes invisible characters loud", () => {
    const lines = set("1 (>L:X)")
    expect(at(lines, " ")).toBe("invalid.invisible")
    expect(at(lines, "L:X")).toBe("ref.prefix")
    const js = set("\"`${value} (>L:X)`\"")
    expect(at(js, " ")).toBe("invalid.invisible")
  })

  it("an unterminated YAML quote paints what is there", () => {
    const lines = set("\"`${value} (>K:E)`")
    expect(at(lines, "value")).toBe("js.injected")
    expect(at(lines, "E)")).toBe("ref.target")
  })
})

describe("invariants", () => {
  const SAMPLE = [
    "# Aircraft: Test",
    "# Updated: 2026-09-11",
    "",
    "shared:",
    "  - get: A:PLANE ALTITUDE, feet",
    "    set: 0 (>K:FLIGHT_LEVEL_CHANGE)",
    "  - get: L:X",
    '    set: "`${value * 16} 1 (>K:2:KOHLSMAN_SET)`"',
    "  - get: B:Y",
    "    set: >",
    "      (() => {",
    "        switch (value) { case 0: return '(>B:Off)'; default: return ''; }",
    "      })()",
    "    skp: L:Z",
    "master:",
    "  - get: K:THROTTLE1_SET",
    "    set: K:THROTTLE1_SET",
    "include:",
    "  - base.yaml",
  ]

  it("emits only vocabulary scopes, in order, from column 0", () => {
    let state = initialHighlightState()
    for (const line of SAMPLE) {
      const { spans, state: next } = highlightLine(line, state)
      state = next

      expect(spans[0]!.start).toBe(0)
      let last = -1
      for (const span of spans) {
        expect(isScope(span.scope)).toBe(true)
        expect(span.start).toBeGreaterThan(last)
        last = span.start
      }
    }
  })

  it("ends with no open frames", () => {
    let state = initialHighlightState()
    for (const line of SAMPLE) state = highlightLine(line, state).state
    expect(state.frames).toEqual([])
  })
})
