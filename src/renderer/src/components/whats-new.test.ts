/**
 * The changelog What's new is built from, imported the way the dialog imports
 * it. Here rather than beside the parser because `src/shared` compiles for
 * both main and the renderer, and only the renderer's build knows `?raw`.
 */

import { describe, expect, it } from "vitest"

import { parseChangelog } from "@shared/changelog"

import changelog from "../../../../CHANGELOG.md?raw"

describe("the bundled changelog", () => {
  const releases = parseChangelog(changelog)

  it("has releases, each with a version and something in it", () => {
    expect(releases.length).toBeGreaterThan(0)

    for (const release of releases) {
      expect(release.version).toMatch(/^\d+\.\d+\.\d+$/)
      expect(release.sections.length).toBeGreaterThan(0)
      for (const section of release.sections) {
        expect(section.entries.length).toBeGreaterThan(0)
      }
    }
  })
})
