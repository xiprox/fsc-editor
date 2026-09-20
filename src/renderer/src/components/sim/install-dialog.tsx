import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  SimModuleGroup,
  SimModulePitch,
} from "@/components/settings/groups/sim-module"

/**
 * The install flow, focused.
 *
 * The flow itself — discovery, the proposed folder, install/repair/uninstall,
 * what happens next — is `SimModuleGroup`, which the Settings dialog embeds
 * under its Simulator section. This wrapper is what the footer chip opens: the
 * same body with the pitch promoted to a header, because here it is the whole
 * reason the dialog appeared.
 *
 * The chip gives this component a new `key` each time it opens it, so every
 * opening is a fresh mount with fresh state — a dialog reopened after a failed
 * install should not still be showing the failure.
 */
export function SimInstallDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Install the sim module</DialogTitle>
          <DialogDescription>
            <SimModulePitch />
          </DialogDescription>
        </DialogHeader>

        <SimModuleGroup />

        <DialogFooter>
          <DialogClose render={<Button variant="outline" size="sm" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
