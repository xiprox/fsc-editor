/**
 * `key-unknown` — the rule that replaced monaco-yaml's
 * `additionalProperties: false`, which never ran.
 *
 * The cases worth pinning are the two it must *not* fire on, because both
 * came out of the corpus rather than out of imagination.
 */

import { describe, expect, it } from "vitest"

import { analyzeProfileView } from "../index.ts"
import { keyUnknown } from "./key-unknown.ts"
import type { ProfileMapping, ProfileView } from "../profile.ts"

const view = (mappings: ProfileMapping[]): ProfileView => ({
  entries: [],
  includes: [],
  ignores: [],
  pointers: [],
  blocks: [],
  mappings,
  updated: { line: 1, text: "2026-09-19" },
})

const run = (mappings: ProfileMapping[]) =>
  analyzeProfileView([keyUnknown], view(mappings), {})

describe("key-unknown", () => {
  it("says the file fails to load, not the entry", () => {
    const [found] = run([{ line: 3, text: "sett", inEntry: true }])

    expect(found?.severity).toBe("error")
    expect(found?.verdict).toBe("sett: is not a key FS Copilot knows.")
    expect(found?.consequence).toContain("This whole file will fail to load")
  })

  it("offers set: for sett:, which two edits could not", () => {
    // At `nearest`'s default budget `sett` reaches `get` as well, and the
    // tie rule refuses both. One edit is the honest budget for a key this
    // short.
    expect(run([{ line: 3, text: "sett", inEntry: true }])[0]?.fix?.title).toBe(
      "Change to set:"
    )
  })

  it("suggests from the block vocabulary at the top level", () => {
    expect(run([{ line: 1, text: "sharedd", inEntry: false }])[0]?.fix?.title).toBe(
      "Change to shared:"
    )
  })

  it("names the vocabulary when it cannot choose", () => {
    const [found] = run([{ line: 3, text: "qqqq", inEntry: true }])

    expect(found?.fix).toBeUndefined()
    expect(found?.remedy).toBe("The keys inside an entry are get:, set: and skp:.")
  })

  /*
   * Two modules in the corpus open with a UTF-8 BOM. FS Copilot reads them
   * with `File.ReadAllText`, which strips it, so they load; our grammar does
   * not, so `shared:` arrives classified as a mapping. The rule must not call
   * a real block key unknown on the strength of somebody else's bug.
   */
  it("does not flag a name the format defines, however it was classified", () => {
    expect(run([{ line: 1, text: "shared", inEntry: false }])).toEqual([])
    expect(run([{ line: 4, text: "set", inEntry: true }])).toEqual([])
  })
})
