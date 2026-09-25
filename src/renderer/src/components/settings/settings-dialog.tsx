import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { AppearanceGroup } from "@/components/settings/groups/appearance"
import { EditorGroup } from "@/components/settings/groups/editor"
import { HotkeysSettings } from "@/components/settings/groups/hotkeys"
import { SimModuleGroup } from "@/components/settings/groups/sim-module"
import { WorkspaceGroup } from "@/components/settings/groups/workspace"
import { SettingsSection } from "@/components/settings/rows"

/**
 * Settings — one dialog, one scrolling column of sections.
 *
 * Every change applies as it is made, which is why there is no footer: a Save
 * button over instantly-applied settings is a question with no answer, and it
 * is also what lets the sim and hotkey groups appear here *and* in their own
 * focused dialogs without the two containers disagreeing about chrome.
 *
 * No section nav and no search, on purpose, at this size — five sections fit
 * one scroll. The group-per-file structure is what makes either a retrofit
 * rather than a rewrite when the list earns them.
 */
export function SettingsDialog({
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
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        {/*
          The body scrolls, not the dialog: the title stays put, and the cap
          keeps the dialog from reaching the screen edges on a short window.
          Margins swallow the content padding so the scrollbar sits at the
          dialog's own edge rather than a padding-width inside it.
        */}
        <div className="scrollbar-overlay -mx-5 -mb-5 max-h-[min(38rem,70vh)] overflow-y-auto px-5 pb-5">
          <div className="flex flex-col gap-5">
            <SettingsSection title="Appearance">
              <AppearanceGroup />
            </SettingsSection>

            <SettingsSection title="Workspace">
              <WorkspaceGroup />
            </SettingsSection>

            <SettingsSection title="Editor">
              <EditorGroup />
            </SettingsSection>

            <SettingsSection title="Simulator">
              <SimModuleGroup showPitch />
            </SettingsSection>

            <SettingsSection title="Radar hotkeys">
              <HotkeysSettings />
            </SettingsSection>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
