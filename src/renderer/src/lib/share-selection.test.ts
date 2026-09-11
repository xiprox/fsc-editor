import { beforeEach, describe, expect, it, vi } from "vitest"

import { loadShared, saveShared } from "./share-selection"

const store = new Map<string, string>()

vi.stubGlobal("localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
})

const ROOT = "C:\\Users\\pilot\\Definitions"
const ALL = ["a320.yaml", "b738.yaml", "modules/fuel.yaml"]

beforeEach(() => store.clear())

describe("remembering what was shared", () => {
  it("has nothing to offer a folder that has never hosted", () => {
    expect(loadShared(ROOT, ALL)).toEqual([])
  })

  it("gives back what was saved", () => {
    saveShared(ROOT, ["a320.yaml", "modules/fuel.yaml"])
    expect(loadShared(ROOT, ALL)).toEqual(["a320.yaml", "modules/fuel.yaml"])
  })

  it("keeps folders apart", () => {
    saveShared(ROOT, ["a320.yaml"])
    expect(loadShared("D:\\Other", ALL)).toEqual([])
  })

  it("matches a root however Windows spelled it this run", () => {
    saveShared(ROOT, ["a320.yaml"])
    expect(loadShared(ROOT.toLowerCase(), ALL)).toEqual(["a320.yaml"])
  })
})

describe("profiles that are no longer there", () => {
  it("drops them rather than offering a tick on a missing file", () => {
    saveShared(ROOT, ["a320.yaml", "deleted.yaml"])
    expect(loadShared(ROOT, ALL)).toEqual(["a320.yaml"])
  })

  it("comes back empty when none of them survive", () => {
    saveShared(ROOT, ["gone.yaml"])
    expect(loadShared(ROOT, ALL)).toEqual([])
  })
})

describe("storage that cannot be trusted", () => {
  it("ignores unparseable content", () => {
    store.set(`shared:${ROOT.toLowerCase()}`, "{not json")
    expect(loadShared(ROOT, ALL)).toEqual([])
  })

  it("ignores a value that is not a list", () => {
    store.set(`shared:${ROOT.toLowerCase()}`, '{"a320.yaml":true}')
    expect(loadShared(ROOT, ALL)).toEqual([])
  })

  it("ignores entries that are not paths", () => {
    store.set(`shared:${ROOT.toLowerCase()}`, '["a320.yaml",7,null]')
    expect(loadShared(ROOT, ALL)).toEqual(["a320.yaml"])
  })
})
