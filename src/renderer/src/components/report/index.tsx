import { useCallback, useState } from "react"

import { Bug, FolderOpen, Loader2 } from "lucide-react"

import type { DebugReport } from "@shared/types"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/**
 * The one way a tester hands over what went wrong.
 *
 * Alpha builds have no telemetry and will not get any. What they have instead
 * is one action that packages everything the app knows about itself and puts it
 * in Downloads, for a person to attach to a message they were going to send
 * anyway. Nothing leaves the machine that they did not send themselves.
 *
 * ## Why the dialog explains rather than lists
 *
 * An earlier shape offered a file list and checkboxes. Both are worse than they
 * look: a list of twelve filenames is not information anyone can act on, and a
 * checkbox invites turning off the file that would have explained the bug. The
 * honest version is a paragraph saying what kind of thing is collected and what
 * is deliberately left out, and then the folder itself — which opens with the
 * loose files sitting beside the zip, so anybody who wants to check can read
 * every byte before they send it.
 *
 * ## Two buttons, never three
 *
 * Collect, and then Open folder in the same place. The report is written before
 * the second one appears, so there is no state where a button promises
 * something that has not happened yet.
 */
export function ReportButton() {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<DebugReport | null>(null)

  const collect = useCallback(async () => {
    setBusy(true)
    setReport(await window.api.collectReport())
    setBusy(false)
  }, [])

  const done = report?.ok === true

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Debug report"
              onClick={() => {
                // A fresh dialog each time. Reopening onto the result of a
                // report collected ten minutes ago would offer to open a folder
                // for a session that has since moved on.
                setReport(null)
                setOpen(true)
              }}
            >
              <Bug />
            </Button>
          }
        />
        <TooltipContent side="top">Debug report</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="mb-2">Debug report</DialogTitle>
            <DialogDescription>
              Writes a diagnostic bundle to your Downloads folder, for attaching
              to a bug report. Nothing is uploaded.
            </DialogDescription>
          </DialogHeader>

          <div className="mb-1 flex flex-col gap-3 text-xs/relaxed text-muted-foreground">
            <p>
              It collects the app log, what Radar was showing and how it ranked
              it, the versions of the app and the sim module, and recordings of
              recent sim sessions (within the limits of what was observed by
              FSCE).
            </p>
            <p>
              {/*
                Named specifically rather than as a promise. "Privacy-friendly"
                is a claim; "your Windows username is replaced" is something a
                reader can check by opening the folder, which they can.
              */}
              It does not collect the contents of your profiles, anything shared
              with you over Remote Connect, or your Windows username — folder
              paths are replaced with placeholders. Aircraft and addon names are
              kept.
            </p>

            {report?.ok === false && (
              <p className="text-destructive">
                Could not write the report — {report.reason}
              </p>
            )}

            {report?.ok === true && (
              <p className="font-mono text-[11px] break-all text-foreground">
                {report.folder}
                {report.errors > 0 && (
                  <span className="text-muted-foreground">
                    {" "}
                    · {report.errors}{" "}
                    {report.errors === 1 ? "section" : "sections"} failed, see
                    errors.txt
                  </span>
                )}
              </p>
            )}
          </div>

          <DialogFooter showCloseButton>
            {done && report.zip ? (
              <Button onClick={() => void window.api.revealReport(report.zip!)}>
                <FolderOpen />
                Open folder
              </Button>
            ) : (
              <Button disabled={busy} onClick={() => void collect()}>
                {busy && <Loader2 className="animate-spin" />}
                Write report
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
