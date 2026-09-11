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
import { Mono, SimModuleGroup } from "@/components/settings/groups/sim-module"

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
            {/*
              Concrete rather than abstract, which 04 asks for by name. "Live
              values" means nothing on its own; the 84% of a profile written
              against `L:` variables is the actual offer, and it is the reason
              the module exists at all.
            */}
            FSC Editor reads <Mono>A:</Mono> and <Mono>B:</Mono> from MSFS on
            its own. The Link package adds <Mono>L:</Mono> variables — live
            values in the editor, the full list for the aircraft you have
            loaded, and completions that know what the simulator actually has
            rather than only what somebody has already written.
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
