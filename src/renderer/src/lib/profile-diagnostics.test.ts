/**
 * The pure half of diagnostics: document text in, positioned verdicts out.
 * The store's rendering is Monaco's business; whether the squiggle lands on
 * the right characters is decided — and pinned — here.
 */

import { describe, expect, it } from "vitest"

import type { RuleContext } from "@shared/lang"

import { analyzeProfile, type FileDiagnostic } from "./profile-diagnostics"

const CATALOG: RuleContext = {
  keyEventParams: (event) =>
    event === "KOHLSMAN_SET" ? "[0]: Value to set [1]: Altimeter index" : null,
}

/**
 * A date header, for fixtures whose subject is something else.
 *
 * `header-updated` is an error on any profile that has entries and no
 * `# Updated:` line, so a fixture without one is testing that rule whether
 * it meant to or not.
 */
const DATED = "# Updated: 2026-08-29"

/** Applies a fix to the document, line/column edits right to left. */
function apply(text: string, diagnostic: FileDiagnostic): string {
  const lines = text.split("\n")
  const edits = [...diagnostic.fix!.edits].sort(
    (a, b) =>
      b.start.lineNumber - a.start.lineNumber || b.start.column - a.start.column
  )
  for (const edit of edits) {
    const line = lines[edit.start.lineNumber - 1]!
    lines[edit.start.lineNumber - 1] =
      line.slice(0, edit.start.column - 1) +
      edit.newText +
      line.slice(edit.end.column - 1)
  }
  return lines.join("\n")
}

describe("analyzeProfile", () => {
  it("marks the Albatross bug at its real columns, and the fix closes it", () => {
    const text = [
      "shared:",
      "  - get: B:INSTRUMENT_IE_HU16_CB_NAV_2, Bool",
      "    set: (>B:INSTRUMENT_IE_HU16_CB_NAV_2_Toggle",
    ].join("\n")

    const diagnostics = analyzeProfile(text, {})
    const unterminated = diagnostics.find(
      (d) => d.ruleId === "rpn-unterminated"
    )!

    expect(unterminated.start.lineNumber).toBe(3)
    // The `(` sits at column 10 on that line.
    expect(unterminated.start.column).toBe(10)

    expect(apply(text, unterminated)).toContain(
      "set: (>B:INSTRUMENT_IE_HU16_CB_NAV_2_Toggle)"
    )
  })

  it("carries the k-arity verdict through a quoted template, offset intact", () => {
    const text = [
      "shared:",
      "  - get: A:KOHLSMAN SETTING MB:1, Millibars",
      '    set: "`${value * 16} (>K:KOHLSMAN_SET)`"',
    ].join("\n")

    const [diagnostic] = analyzeProfile(text, CATALOG).filter(
      (d) => d.ruleId === "k-arity"
    )

    expect(diagnostic!.start.lineNumber).toBe(3)
    // The squiggle covers the ref, not the quote: the raw line's `(` of the
    // ref is at column 27.
    expect(text.split("\n")[2]!.slice(diagnostic!.start.column - 1)).toMatch(
      /^\(>K:KOHLSMAN_SET\)/
    )

    expect(apply(text, diagnostic!)).toContain("(>K:2:KOHLSMAN_SET)")
  })

  it("squiggles the Baron's dead Z: line on the name, comment excluded", () => {
    // Verbatim from bksq-aircraft-baronpro.yaml:181 — one of the twelve
    // corpus lines reading a variable the 2024 NavCom template no longer
    // defines. The trailing comment is the point: the `get:` value the rules
    // see is the name alone, and the squiggle must not run into `# MIC`.
    const text = [
      DATED,
      "shared:",
      "  - get: Z:AUDIO_Knob_Selector_1 # MIC",
    ].join("\n")

    const [diagnostic] = analyzeProfile(text, {
      refResolved: (name) =>
        name === "Z:AUDIO_Knob_Selector_1" ? false : null,
    }).filter((d) => d.ruleId === "ref-unresolved")

    expect(diagnostic!.start.lineNumber).toBe(3)
    expect(text.split("\n")[2]!.slice(diagnostic!.start.column - 1)).toMatch(
      /^Z:AUDIO_Knob_Selector_1 #/
    )
    // Ends at the name, not at the comment.
    expect(diagnostic!.end.column - diagnostic!.start.column).toBe(
      "Z:AUDIO_Knob_Selector_1".length
    )
  })

  it("stays silent on that same line with no module answering", () => {
    // Every other profile in the corpus, and every session with MSFS closed.
    const text = [DATED, "shared:", "  - get: Z:AUDIO_Knob_Selector_1"].join(
      "\n"
    )

    expect(
      analyzeProfile(text, {}).filter((d) => d.ruleId === "ref-unresolved")
    ).toEqual([])
  })

  it("maps positions into a block scalar body", () => {
    const text = [
      "shared:",
      "  - get: A:TRANSPONDER STATE:1, Enum",
      "    set: |",
      "      switch (value) {",
      "        case 0: return '(>K:KOHLSMAN_SET)'",
      "      }",
    ].join("\n")

    const [diagnostic] = analyzeProfile(text, CATALOG).filter(
      (d) => d.ruleId === "k-arity"
    )

    expect(diagnostic!.start.lineNumber).toBe(5)
    expect(text.split("\n")[4]!.slice(diagnostic!.start.column - 1)).toMatch(
      /^\(>K:KOHLSMAN_SET\)/
    )
  })

  it("skips a value whose escapes would shift every offset", () => {
    const text = [
      DATED,
      "shared:",
      "  - get: L:X",
      '    set: "1 \\" (>B:PARKBRAKE)"',
    ].join("\n")

    // A missing squiggle is a gap; one on the wrong characters is a lie.
    expect(analyzeProfile(text, {})).toEqual([])
  })

  it("carries an entry-level verdict, which needs the block to be reached", () => {
    // JF_RJ_100's shape: the same text is dead under `master:` and fine
    // under `shared:`, so the diagnostic proves the entry — not just the
    // expression — arrived at the rule.
    const text = [
      "master:",
      "  - get: A:BRAKE LEFT POSITION, Position",
      "    set: K:AXIS_LEFT_BRAKE_SET",
    ].join("\n")

    const [diagnostic] = analyzeProfile(text, {}).filter(
      (entry) => entry.ruleId === "dead-set"
    )

    expect(diagnostic!.start.lineNumber).toBe(3)
    // The value starts at column 10, past `    set: `.
    expect(diagnostic!.start.column).toBe(10)
    expect(apply(text, diagnostic!)).toContain("set: (>K:AXIS_LEFT_BRAKE_SET)")
  })

  it("positions an entry verdict through a block scalar's body", () => {
    const text = [
      "master:",
      "  - get: A:BRAKE LEFT POSITION, Position",
      "    set: >",
      "      K:AXIS_LEFT_BRAKE_SET",
    ].join("\n")

    const [diagnostic] = analyzeProfile(text, {}).filter(
      (entry) => entry.ruleId === "dead-set"
    )

    // Keyed on line 3, bodied on line 4 — the squiggle belongs on the text.
    expect(diagnostic!.start.lineNumber).toBe(4)
    expect(diagnostic!.start.column).toBe(7)
  })

  it("places a get:-line verdict on an entry that has no setter", () => {
    // The level-2 pass has to reach entries the expression walk never
    // visits — 60% of the corpus — and land on the `get:` line itself.
    const text = ["shared:", "  - get: H:KNS81_RNAV_DMERADIALMODE, Bool"].join(
      "\n"
    )

    const [diagnostic] = analyzeProfile(text, {}).filter(
      (entry) => entry.ruleId === "get-unit-meaningless"
    )

    expect(diagnostic!.start.lineNumber).toBe(2)
    expect(apply(text, diagnostic!)).toBe(
      ["shared:", "  - get: H:KNS81_RNAV_DMERADIALMODE"].join("\n")
    )
  })

  it("places a level-3 verdict on the second declaration's own line", () => {
    const text = [
      "shared:",
      "  - get: L:INI_ATC_MSG",
      "  - get: L:Other",
      "  - get: L:INI_ATC_MSG",
    ].join("\n")

    const [diagnostic] = analyzeProfile(text, {}).filter(
      (entry) => entry.ruleId === "duplicate-get"
    )

    expect(diagnostic!.start.lineNumber).toBe(4)
    // The whole `get:` value is the span, starting past `  - get: `.
    expect(diagnostic!.start.column).toBe(10)
    expect(diagnostic!.message).toContain("line 2")
  })

  it("reads an include path past its trailing comment", () => {
    // YAML strips ` # comment` from a plain scalar, so FS Copilot never sees
    // one. Two corpus includes carry an `# ADDED BY …` note, and counting it
    // as part of the path reported both as missing.
    const text = [
      "include:",
      "  - modules/fuel.yaml # ADDED BY SOMEBODY",
      "  - modules/paload.yaml",
    ].join("\n")

    const found = analyzeProfile(text, {
      workspaceFiles: () => ["modules/fuel.yaml", "modules/payload.yaml"],
    }).filter((entry) => entry.ruleId === "include-missing")

    expect(found).toHaveLength(1)
    expect(found[0]!.start.lineNumber).toBe(3)
    expect(apply(text, found[0]!)).toContain("  - modules/payload.yaml")
  })

  it("never nags about a block that is not there", () => {
    /*
     * `shared:`, `master:`, `include:` and `ignore:` are all optional, and a
     * profile may carry any combination of them — including none, which is
     * simply a file somebody has started. Nothing may read an absent block
     * as a finding. Pinned here because it is one line of carelessness away
     * in any future block-key or header rule.
     */
    for (const text of [
      "",
      "# FS Copilot profile",
      "shared:",
      "master:",
      "include:\n  - modules/fuel.yaml",
      "ignore:\n  - Barometer",
      "pointer:\n  - DisplayUnits\n  - DisplayUnits|config=Default",
      `${DATED}\nshared:\n  - get: L:A\nmaster:\n  - get: L:B`,
    ])
      expect(
        analyzeProfile(text, { workspaceFiles: () => ["modules/fuel.yaml"] })
      ).toEqual([])
  })

  it("reads the date line the way FS Copilot's own regex does", () => {
    const entries = ["shared:", "  - get: L:Battery"]
    const dated = (header: string) =>
      analyzeProfile([header, ...entries].join("\n"), {}).filter(
        (entry) => entry.ruleId === "header-updated"
      )

    // Multiline over the whole file and case-sensitive, both of which the
    // corpus depends on: the line need not sit in the comment header.
    expect(dated("# Updated: 2026-08-29")).toEqual([])
    expect(dated("#Updated:2026-08-29")).toEqual([])
    expect(dated("# updated: 2026-08-29")).toHaveLength(1)
    expect(dated("# Last Updated: 2026-08-29")).toHaveLength(1)

    // And the verdict lands at the top of the profile, as an error.
    const [missing] = dated("# nothing useful")
    expect(missing!.severity).toBe("error")
    expect(missing!.start.lineNumber).toBe(2)
  })

  it("puts the widest-blast-radius error on a typo'd block key", () => {
    // The whole file stops loading, so this one has to land right.
    const text = [DATED, "sharde:", "  - get: L:Battery"].join("\n")

    const [diagnostic] = analyzeProfile(text, {}).filter(
      (entry) => entry.ruleId === "block-unknown"
    )

    expect(diagnostic!.severity).toBe("error")
    expect(diagnostic!.start.lineNumber).toBe(2)
    expect(diagnostic!.start.column).toBe(1)
    expect(apply(text, diagnostic!)).toContain("shared:")
  })

  it("stays quiet on a clean corpus-shaped profile", () => {
    const text = [
      DATED,
      "shared:",
      "  - get: A:NAV OBS:1, Degrees",
      "    set: (>K:VOR1_SET)",
      "  - get: L:Battery, Bool",
      '    set: "`${value} (>L:Battery)`"',
    ].join("\n")

    expect(analyzeProfile(text, {})).toEqual([])
  })
})
