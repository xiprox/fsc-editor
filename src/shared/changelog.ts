/**
 * `CHANGELOG.md`, read back as releases.
 *
 * release-please writes the file from commit titles, and the release commit
 * carries it — so the build a tag produces always holds its own entry, and the
 * app can show what changed without asking the network.
 *
 * Deliberately dumb. It knows the shape release-please writes and nothing about
 * what the words mean: a scope is shown as written, whether or not it is one
 * the app still uses, and a heading is whatever the file says it is. A line it
 * does not recognise is skipped rather than guessed at.
 */

export interface ChangelogEntry {
  /** The part of the app, as the commit title named it. Null when it named none. */
  scope: string | null
  text: string
}

export interface ChangelogSection {
  /** As written — "Features", "Bug Fixes". */
  title: string
  entries: ChangelogEntry[]
}

export interface Release {
  version: string
  /** `YYYY-MM-DD`, or null when the heading carries none. */
  date: string | null
  sections: ChangelogSection[]
}

/** `## [0.2.0](https://…) (2026-09-21)` and the unlinked `## 0.1.0 (2026-09-20)`. */
const RELEASE = /^##\s+(?:\[([^\]]+)\]\([^)]*\)|(\S+))(?:\s+\((\d{4}-\d{2}-\d{2})\))?\s*$/

const SECTION = /^###\s+(.+?)\s*$/

const ENTRY = /^[*-]\s+(.+?)\s*$/

/** `**radar:** ` at the start of an entry. */
const SCOPE = /^\*\*([^*:]+):\*\*\s+/

/**
 * The commit and pull request links release-please appends — `([f266ba7](…))`,
 * `([#12](…))` — which point at the repository rather than saying anything.
 */
const TRAILING_LINKS = /(?:\s+\(\[[^\]]+\]\([^)]*\)\))+$/

export function parseChangelog(markdown: string): Release[] {
  const releases: Release[] = []
  let release: Release | null = null
  let section: ChangelogSection | null = null

  for (const line of markdown.split(/\r?\n/)) {
    const heading = RELEASE.exec(line)
    if (heading) {
      release = {
        version: heading[1] ?? heading[2],
        date: heading[3] ?? null,
        sections: [],
      }
      releases.push(release)
      section = null
      continue
    }

    if (!release) continue

    const title = SECTION.exec(line)
    if (title) {
      section = { title: title[1], entries: [] }
      release.sections.push(section)
      continue
    }

    const entry = ENTRY.exec(line)
    if (!entry || !section) continue

    let text = entry[1].replace(TRAILING_LINKS, "")
    const scope = SCOPE.exec(text)
    if (scope) text = text.slice(scope[0].length)

    section.entries.push({ scope: scope ? scope[1] : null, text })
  }

  return releases
}

/**
 * Orders two `x.y.z` versions. A pre-release suffix is ignored, which is wrong
 * in general and right here: the app has never shipped one.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (version: string) =>
    version
      .replace(/^v/, "")
      .split(/[-+]/)[0]
      .split(".")
      .map((part) => Number(part) || 0)

  const left = parts(a)
  const right = parts(b)

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0)
    if (difference) return Math.sign(difference)
  }

  return 0
}

/**
 * Whether a release arrived with the update from `from` to `to`.
 *
 * `from` is null when the app ran before without recording which version it
 * was, which is every copy that predates the record — so only the release it
 * updated into counts, since that is the one thing known to be new.
 */
export function isNewSince(
  version: string,
  from: string | null,
  to: string
): boolean {
  if (compareVersions(version, to) > 0) return false
  if (from === null) return compareVersions(version, to) === 0
  return compareVersions(version, from) > 0
}
