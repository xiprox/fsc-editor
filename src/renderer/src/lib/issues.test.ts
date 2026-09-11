import { describe, expect, it } from "vitest"

import type { FileDiagnostic } from "@shared/analysis"

import { sortIssues, worstSeverity } from "./issues"

function issue(
  severity: FileDiagnostic["severity"],
  lineNumber: number,
  column = 1
): FileDiagnostic {
  return {
    ruleId: "r",
    severity,
    message: "",
    start: { lineNumber, column },
    end: { lineNumber, column: column + 1 },
  }
}

describe("sortIssues", () => {
  it("puts errors first, then document order within a severity", () => {
    const sorted = sortIssues([
      issue("info", 1),
      issue("warning", 9),
      issue("error", 40),
      issue("warning", 3),
      issue("error", 12),
    ])

    expect(
      sorted.map((entry) => `${entry.severity}:${entry.start.lineNumber}`)
    ).toEqual(["error:12", "error:40", "warning:3", "warning:9", "info:1"])
  })
})

describe("worstSeverity", () => {
  it("names the worst, and null for none — the rail count's colour and gate", () => {
    expect(worstSeverity([issue("info", 1), issue("warning", 2)])).toBe(
      "warning"
    )
    expect(worstSeverity([])).toBeNull()
  })
})
