/**
 * Reading `CHANGELOG.md` back into releases.
 *
 * The fixture is release-please's own output, trimmed, including the two
 * heading shapes it writes: a linked one for every release after the first,
 * and an unlinked one for the first.
 */

import { describe, expect, it } from "vitest"

import { compareVersions, isNewSince, parseChangelog } from "./changelog"

const CHANGELOG = `# Changelog

## [0.2.0](https://github.com/xiprox/fsc-editor/compare/v0.1.2...v0.2.0) (2026-09-21)


### Features

* **radar:** right-click a captured control to copy its name ([2863ddf](https://github.com/xiprox/fsc-editor/commit/2863ddf))
* **variables:** quoted search terms match literally ([8d08907](https://github.com/xiprox/fsc-editor/commit/8d08907))


### Bug Fixes

* **editor:** the mouse wheel scrolls the tab bar ([6a5ca99](https://github.com/xiprox/fsc-editor/commit/6a5ca99))

## [0.1.1](https://github.com/xiprox/fsc-editor/compare/v0.1.0...v0.1.1) (2026-09-20)


### Bug Fixes

* **sim:** upadte sim module pitch ([4afcca3](https://github.com/xiprox/fsc-editor/commit/4afcca3))

## 0.1.0 (2026-09-20)


### Features

* write new profiles immediately ([#3](https://github.com/xiprox/fsc-editor/issues/3)) ([8af4840](https://github.com/xiprox/fsc-editor/commit/8af4840))
`

describe("parseChangelog", () => {
  const releases = parseChangelog(CHANGELOG)

  it("reads both heading shapes, newest first", () => {
    expect(releases.map(({ version, date }) => [version, date])).toEqual([
      ["0.2.0", "2026-09-21"],
      ["0.1.1", "2026-09-20"],
      ["0.1.0", "2026-09-20"],
    ])
  })

  it("keeps sections and their order as written", () => {
    expect(releases[0].sections.map((section) => section.title)).toEqual([
      "Features",
      "Bug Fixes",
    ])
  })

  it("splits the scope off and drops the commit links", () => {
    expect(releases[0].sections[0].entries[0]).toEqual({
      scope: "radar",
      text: "right-click a captured control to copy its name",
    })
  })

  it("shows any scope as written, and the words as written", () => {
    expect(releases[1].sections[0].entries).toEqual([
      { scope: "sim", text: "upadte sim module pitch" },
    ])
  })

  it("takes an entry with no scope, and strips every trailing link", () => {
    expect(releases[2].sections[0].entries).toEqual([
      { scope: null, text: "write new profiles immediately" },
    ])
  })

  it("reads a checkout with Windows line endings", () => {
    expect(parseChangelog(CHANGELOG.replace(/\n/g, "\r\n"))).toEqual(releases)
  })
})

describe("compareVersions", () => {
  it("orders numerically, not as text", () => {
    expect(compareVersions("0.10.0", "0.9.0")).toBe(1)
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0)
    expect(compareVersions("0.1.2", "0.2.0")).toBe(-1)
  })
})

describe("isNewSince", () => {
  it("is every release after the one run before, up to this one", () => {
    const fresh = ["0.3.0", "0.2.0", "0.1.1"].filter((version) =>
      isNewSince(version, "0.1.1", "0.3.0")
    )
    expect(fresh).toEqual(["0.3.0", "0.2.0"])
  })

  it("is only this release when the one before is unknown", () => {
    expect(isNewSince("0.3.0", null, "0.3.0")).toBe(true)
    expect(isNewSince("0.2.0", null, "0.3.0")).toBe(false)
  })

  it("is never a release newer than the one running", () => {
    expect(isNewSince("0.4.0", "0.2.0", "0.3.0")).toBe(false)
  })
})
