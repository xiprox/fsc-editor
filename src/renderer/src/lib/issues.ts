/**
 * The Issues panel's pure decisions — order and summary, testable headless.
 */

import type { FileDiagnostic } from "@shared/analysis"

const RANK: Record<FileDiagnostic["severity"], number> = {
  error: 0,
  warning: 1,
  info: 2,
}

/**
 * Errors first, then warnings, then info — the panel answers "what is
 * wrong" before "what is worth knowing". Within a severity, document
 * order: the reader is about to go there.
 */
export function sortIssues(issues: FileDiagnostic[]): FileDiagnostic[] {
  return [...issues].sort(
    (a, b) =>
      RANK[a.severity] - RANK[b.severity] ||
      a.start.lineNumber - b.start.lineNumber ||
      a.start.column - b.start.column
  )
}

/** The count's colour follows the worst thing in the file. */
export function worstSeverity(
  issues: FileDiagnostic[]
): FileDiagnostic["severity"] | null {
  if (issues.length === 0) return null
  return sortIssues(issues)[0]!.severity
}
