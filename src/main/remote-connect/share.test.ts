import { beforeEach, describe, expect, it } from "vitest"

import {
  clearShared,
  isShared,
  pruneShared,
  selectShared,
  sharedPaths,
} from "./share"

beforeEach(() => clearShared())

describe("the share set", () => {
  it("shares nothing until something is selected", () => {
    expect(sharedPaths()).toEqual([])
    expect(isShared("a320.yaml")).toBe(false)
  })

  it("keeps the host's own spelling for display", () => {
    selectShared(["modules/A320-FBW.yaml"])
    expect(sharedPaths()).toEqual(["modules/A320-FBW.yaml"])
  })

  it("replaces the selection rather than adding to it", () => {
    selectShared(["a.yaml", "b.yaml"])
    selectShared(["b.yaml"])

    expect(sharedPaths()).toEqual(["b.yaml"])
    expect(isShared("a.yaml")).toBe(false)
  })

  it("forgets everything when the session ends", () => {
    selectShared(["a.yaml"])
    clearShared()

    expect(isShared("a.yaml")).toBe(false)
  })
})

/**
 * The membership test is a security check against a string chosen by whoever
 * holds the code, and the app runs on Windows. These are the spellings that
 * name the same file to the filesystem, which is the level the answer has to
 * be right at — matching raw strings would let an unshared profile be fetched
 * by asking for it in different case.
 */
describe("paths that name the same file", () => {
  beforeEach(() => selectShared(["modules/A320.yaml"]))

  it("matches regardless of case", () => {
    expect(isShared("modules/a320.yaml")).toBe(true)
    expect(isShared("MODULES/A320.YAML")).toBe(true)
  })

  it("matches either separator", () => {
    expect(isShared("modules\\A320.yaml")).toBe(true)
  })

  it("still refuses a different file", () => {
    expect(isShared("modules/A321.yaml")).toBe(false)
    expect(isShared("A320.yaml")).toBe(false)
  })

  it("does not match a prefix of a shared name", () => {
    expect(isShared("modules/A320.yaml.bak")).toBe(false)
    expect(isShared("modules/A32.yaml")).toBe(false)
  })
})

describe("pruning what no longer exists", () => {
  it("drops selected profiles that have gone", () => {
    selectShared(["a.yaml", "b.yaml"])
    pruneShared(["a.yaml"])

    expect(sharedPaths()).toEqual(["a.yaml"])
  })

  it("compares the same way membership does", () => {
    selectShared(["modules/A320.yaml"])
    // The scan reports what the filesystem gave it, which need not be spelled
    // the way the host ticked it. Pruning on an exact match would delete the
    // selection out from under a file that is still there.
    pruneShared(["modules/a320.yaml"])

    expect(isShared("modules/A320.yaml")).toBe(true)
  })

  it("empties the set when the workspace does", () => {
    selectShared(["a.yaml"])
    pruneShared([])

    expect(sharedPaths()).toEqual([])
  })
})
