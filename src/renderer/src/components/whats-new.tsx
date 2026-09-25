import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useStore } from "@/store"
import {
  parseChangelog,
  type ChangelogEntry,
  type Release,
} from "@shared/changelog"

import changelog from "../../../../CHANGELOG.md?raw"

/**
 * Every release, from the changelog this build was made with.
 *
 * Bundled rather than fetched: the release commit carries the changelog, so the
 * build a tag produces always holds its own entry, and this works offline and
 * always describes exactly what is installed. Parsed once, when the module
 * loads — it is the same text for as long as the app runs.
 */
const RELEASES = parseChangelog(changelog)

/**
 * The headings release-please writes, as this dialog names them. Anything else
 * it writes is shown as written.
 */
const SECTIONS: Record<string, string> = {
  "Bug Fixes": "Fixes",
}

/**
 * Only the scopes plain capitalisation gets wrong. Every other scope — a new
 * one, a retired one — gets its first letter raised and its hyphens turned to
 * spaces, and is shown whether or not the app still has such a part.
 */
const SCOPE_NAMES: Record<string, string> = {
  simconnect: "SimConnect",
  "remote-connect": "Remote Connect",
}

const capitalise = (text: string) =>
  text.charAt(0).toUpperCase() + text.slice(1)

const scopeName = (scope: string) =>
  SCOPE_NAMES[scope] ?? capitalise(scope.replace(/-/g, " "))

/**
 * Commit titles are written lower case after the colon. Read as a list of
 * sentences, they want the capital back — but only over a lower-case letter, so
 * a title that opens on a name or a symbol keeps it exactly.
 */
const sentence = (text: string) =>
  /^[a-z]/.test(text) ? capitalise(text) : text

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
})

/** `2026-09-21` as `21 September 2026`, without the local time zone moving it a day. */
function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number)
  return DATE.format(Date.UTC(year, month - 1, day))
}

/** Entries under their scope, scopes in the order they first appear. */
function byScope(entries: ChangelogEntry[]) {
  const groups = new Map<string | null, string[]>()
  for (const { scope, text } of entries) {
    groups.set(scope, [...(groups.get(scope) ?? []), text])
  }
  return [...groups].map(([scope, texts]) => ({ scope, texts }))
}

/**
 * What changed, release by release.
 *
 * Opened from the app menu.
 */
export function WhatsNewDialog() {
  const open = useStore((state) => state.dialog === "whats-new")
  const setDialog = useStore((state) => state.setDialog)
  const about = useStore((state) => state.about)

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => setDialog(next ? "whats-new" : null)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
          {about && (
            <DialogDescription>Version {about.version}</DialogDescription>
          )}
        </DialogHeader>

        {/* The body scrolls and the title stays put, as in Settings. */}
        <div className="scrollbar-overlay -mx-5 -mb-5 max-h-[min(38rem,70vh)] overflow-y-auto px-5 pb-5">
          <Releases releases={RELEASES} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Releases({ releases }: { releases: Release[] }) {
  return (
    <div className="flex flex-col gap-6">
      {releases.map((release) => (
        <ReleaseNotes key={release.version} release={release} />
      ))}
    </div>
  )
}

/**
 * One release, as a document rather than a table: the version, then Features
 * and Fixes, then each part of the app with its changes as a list under it.
 *
 * Four steps of type, loudest first — the version, the kind of change, the
 * part of the app, the change itself — and nothing indents the list but its
 * own bullets, so every line starts at the same edge and is read down, not
 * across.
 */
function ReleaseNotes({ release }: { release: Release }) {
  return (
    <section className="flex flex-col gap-4 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <div className="flex items-baseline gap-2">
        <h3 className="text-base/5 font-semibold tabular-nums">
          {release.version}
        </h3>
        {release.date && (
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDate(release.date)}
          </span>
        )}
      </div>

      {release.sections.map((section) => (
        <div key={section.title} className="flex flex-col gap-3">
          <h4 className="text-[13px]/5 font-semibold">
            {SECTIONS[section.title] ?? section.title}
          </h4>

          {byScope(section.entries).map(({ scope, texts }) => (
            <div key={scope ?? ""} className="flex flex-col gap-1">
              {scope && (
                <h5 className="text-xs/relaxed text-muted-foreground">
                  {scopeName(scope)}
                </h5>
              )}
              <ul className="flex list-disc flex-col gap-1 ps-4 text-xs/relaxed marker:text-muted-foreground">
                {texts.map((text, index) => (
                  <li key={index}>{sentence(text)}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  )
}
