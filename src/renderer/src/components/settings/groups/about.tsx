import { useEffect, useState } from "react"

import { Loader2 } from "lucide-react"

import { SettingsRow } from "@/components/settings/rows"
import { Button } from "@/components/ui/button"
import type { About, ManualCheck } from "@shared/types"

/**
 * Which version this is, and whether it can replace itself.
 *
 * The app updates on its own — quietly, and the title bar offers a restart when
 * a new version has finished downloading. This exists for the two cases that
 * are not covered by that: somebody who wants to know *now* rather than within
 * four hours, and somebody running a build that cannot update at all, who would
 * otherwise be left wondering why they have never been offered one.
 *
 * The answer to a manual check is returned rather than published, so asking
 * here changes nothing about what the title bar shows. See
 * `main/updates.ts` and docs/pipeline/06-updater.md.
 */

const ANSWERS: Record<ManualCheck, string> = {
  "up-to-date": "This is the newest version.",
  downloading:
    "A new version is downloading — the title bar will offer to restart when it is ready.",
  ready: "A new version is ready — the title bar will restart the app into it.",
  failed: "Could not reach the update server — the app will try again later.",
  // Unreachable: the button is not offered when updates are unavailable. Here
  // so the map stays total rather than because anybody should see it.
  unavailable: "This build cannot update itself.",
}

const WHY: Record<About["updates"], string> = {
  on: "New versions download in the background. The title bar will offer to restart when one is ready.",
  portable:
    "This is a portable build, so it cannot replace itself — download a new version to update.",
  development: "Updates are off in a development build.",
}

export function AboutGroup() {
  const [about, setAbout] = useState<About | null>(null)
  const [checking, setChecking] = useState(false)
  const [answer, setAnswer] = useState<ManualCheck | null>(null)

  useEffect(() => {
    void window.api.about().then(setAbout)
  }, [])

  if (!about) return null

  return (
    <div className="flex flex-col gap-3">
      <SettingsRow label="Version">
        <span className="font-mono text-xs text-muted-foreground">
          {about.version}
        </span>
      </SettingsRow>

      <SettingsRow
        label="Updates"
        // The answer to a check replaces the standing explanation, because
        // after asking a question the explanation is not what is wanted.
        description={answer ? ANSWERS[answer] : WHY[about.updates]}
      >
        {about.updates === "on" && (
          <Button
            variant="outline"
            size="sm"
            tone="update"
            disabled={checking}
            onClick={() => {
              setChecking(true)
              setAnswer(null)

              void window.api
                .checkForUpdates()
                .then(setAnswer)
                .finally(() => setChecking(false))
            }}
          >
            {checking && <Loader2 className="animate-spin" />}
            Check now
          </Button>
        )}
      </SettingsRow>
    </div>
  )
}
