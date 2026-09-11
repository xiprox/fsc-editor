import { useCallback, useSyncExternalStore } from "react"

import * as monaco from "monaco-editor"
import { CircleX, Info, TriangleAlert, Wrench } from "lucide-react"

import type { FileDiagnostic } from "@shared/analysis"

import { BottomRailButton } from "@/components/rail"
import { Button } from "@/components/ui/button"
import { PanelHeader } from "@/components/panel-header"
import { diagnosticsFor, onDiagnosticsChange } from "@/lib/diagnostics-store"
import { sortIssues, worstSeverity } from "@/lib/issues"
import { existingModel } from "@/lib/monaco-setup"
import { editingEditor } from "@/lib/editor-bridge"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

/**
 * The Issues panel: what the language rules say about the file being edited.
 *
 * **The current file only**, by design rather than by v1 laziness — the
 * corpus is written by many hands, and as a user of this editor you care
 * about the profile in front of you. The store still analyzes every open
 * model (markers need it); this panel and its rail count read one.
 *
 * Rows are the same verdicts the squiggles show — the store is the single
 * authority — with the fix a squiggle can only offer through a lightbulb
 * promoted to a visible button.
 */

/** The active file's diagnostics, live against store and tab changes. */
function useActiveIssues(): { issues: FileDiagnostic[]; path: string | null } {
  const path = useStore((state) => state.activePath)

  const subscribe = useCallback(
    (onChange: () => void) => onDiagnosticsChange(onChange),
    []
  )
  const snapshot = useCallback(() => {
    const model = path ? existingModel(path) : null
    return model ? diagnosticsFor(model) : EMPTY
  }, [path])

  return { issues: useSyncExternalStore(subscribe, snapshot), path }
}

const EMPTY: FileDiagnostic[] = []

export function IssuesRailButton() {
  const { issues } = useActiveIssues()
  const worst = worstSeverity(issues)

  return (
    <BottomRailButton
      panel="issues"
      label="Issues"
      active="border-issues-border bg-issues-surface text-issues-foreground"
      tone="issues"
      dot={
        worst && (
          <span
            className={cn(
              "text-[10px] font-medium tabular-nums",
              worst === "error"
                ? "text-destructive"
                : worst === "warning"
                  ? "text-warning"
                  : "text-muted-foreground"
            )}
          >
            {issues.length}
          </span>
        )
      }
    />
  )
}

const SEVERITY_ICON: Record<FileDiagnostic["severity"], React.ReactNode> = {
  error: <CircleX className="size-4 shrink-0 text-destructive" />,
  warning: <TriangleAlert className="size-4 shrink-0 text-warning" />,
  info: <Info className="size-4 shrink-0 text-muted-foreground" />,
}

/** Puts the cursor on the issue, which is what clicking a row means. */
function reveal(issue: FileDiagnostic): void {
  const editor = editingEditor()
  if (!editor) return

  editor.setPosition({
    lineNumber: issue.start.lineNumber,
    column: issue.start.column,
  })
  editor.revealLineInCenterIfOutsideViewport(issue.start.lineNumber)
  editor.focus()
}

/**
 * The same edits the lightbulb applies, through the same undo stack —
 * `executeEdits` on the shared model, so panel and editor cannot disagree
 * about what a fix does.
 */
function applyFix(path: string, issue: FileDiagnostic): void {
  const fix = issue.fix
  const model = existingModel(path)
  if (!fix || !model) return

  const editor = editingEditor()
  const target = editor?.getModel() === model ? editor : null

  const edits: monaco.editor.IIdentifiedSingleEditOperation[] = fix.edits.map(
    (edit) => ({
      range: {
        startLineNumber: edit.start.lineNumber,
        startColumn: edit.start.column,
        endLineNumber: edit.end.lineNumber,
        endColumn: edit.end.column,
      },
      text: edit.newText,
    })
  )

  if (target) target.executeEdits("fsc-issues", edits)
  else model.pushEditOperations([], edits, () => null)
}

export function IssuesPanel() {
  const { issues, path } = useActiveIssues()
  const sorted = sortIssues(issues)
  const name = path?.split(/[\\/]/).pop() ?? null

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <PanelHeader title="Issues">
        {name && <span className="text-xs text-muted-foreground">{name}</span>}
      </PanelHeader>

      {sorted.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {path ? "No issues in this file." : "No file open."}
        </div>
      ) : (
        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {sorted.map((issue, index) => (
            <div
              key={`${issue.ruleId}:${issue.start.lineNumber}:${issue.start.column}:${index}`}
              className="flex h-7 cursor-pointer items-center gap-2 rounded-sm px-2 text-xs hover:bg-accent"
              onClick={() => reveal(issue)}
            >
              {SEVERITY_ICON[issue.severity]}
              {/* A row is one line, and the verdict is written to be one. A
                  rule not yet converted has only its message, which the row
                  cuts where it must. */}
              <span className="min-w-0 flex-1 truncate">
                {issue.verdict ?? issue.message}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                {issue.ruleId} · {issue.start.lineNumber}:{issue.start.column}
              </span>
              {issue.fix && path && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Apply fix: ${issue.fix.title}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    applyFix(path, issue)
                  }}
                >
                  <Wrench />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
