/**
 * The claim the dialog makes, tested.
 *
 * The report tells a user their username does not leave the machine and their
 * profiles are not in the package. Those are the two things worth a test:
 * everything else in a report is variable names and numbers, and a mistake
 * there costs a reader some confusion rather than costing a person something
 * they cannot take back.
 */

import { describe, expect, it } from "vitest"

import { redactText, scrub } from "./redact"

const ROOTS = {
  home: "C:\\Users\\someone",
  userData: "C:\\Users\\someone\\AppData\\Roaming\\fsc-editor",
  workspace: "C:\\Users\\someone\\Documents\\FS Copilot\\Definitions",
  community: "D:\\MSFS\\Community",
}

describe("paths", () => {
  it("replaces a root with its token", () => {
    expect(redactText("D:\\MSFS\\Community\\fsc-editor-link", ROOTS)).toBe(
      "<community>\\fsc-editor-link"
    )
  })

  /**
   * The form that actually appears. Every one of these files is JSON, so a
   * path inside one has already had its separators doubled by `stringify` —
   * matching the literal string would catch nothing that ships.
   */
  it("matches a path that JSON has escaped", () => {
    const json = JSON.stringify({ root: ROOTS.workspace })
    expect(redactText(json, ROOTS)).toBe('{"root":"<workspace>"}')
  })

  it("matches forward slashes, which normalized paths arrive as", () => {
    expect(
      redactText("C:/Users/someone/AppData/Roaming/fsc-editor/vars.db", ROOTS)
    ).toBe("<userData>/vars.db")
  })

  it("ignores case, because Windows does", () => {
    expect(redactText("c:\\users\\SOMEONE\\Documents", ROOTS)).toBe(
      "<home>\\Documents"
    )
  })

  /**
   * The ordering rule. Both roots match this string and only one of them is the
   * useful answer — a report that says `<home>\Documents\FS Copilot\Definitions`
   * has redacted nothing and lost the ability to say "this is the workspace".
   */
  it("prefers the longest root when several match", () => {
    expect(redactText(`${ROOTS.workspace}\\A2A.yaml`, ROOTS)).toBe(
      "<workspace>\\A2A.yaml"
    )
  })

  /**
   * The one that matters most, because it covers the paths nobody declared: a
   * `.lnk` target, a OneDrive-redirected Documents, a second Community folder
   * on a drive the app never asked about.
   */
  it("takes the username out of a path no root covers", () => {
    expect(redactText("E:\\Games\\x", { ...ROOTS, community: null })).toBe(
      "E:\\Games\\x"
    )
    expect(redactText("C:\\Users\\someone-else\\Desktop\\x.lnk", {})).toBe(
      "C:\\Users\\<user>\\Desktop\\x.lnk"
    )
  })

  it("takes the username out on its own, when it is long enough to be one", () => {
    expect(redactText("saved by someone", {}, "someone")).toBe("saved by <user>")
  })

  /**
   * Deliberate. A two-character username is a substring of ordinary English and
   * of half the variable names in a capture, and it is already covered by the
   * path rules — replacing it everywhere would corrupt evidence to protect
   * nothing.
   */
  it("leaves a very short username alone rather than corrupting evidence", () => {
    expect(redactText("L:ApBankHold", {}, "ap")).toBe("L:ApBankHold")
  })

  it("leaves variable names and aircraft keys alone", () => {
    const text = '{"name":"L:Battery1Switch","aircraft":"pa24-250"}'
    expect(redactText(text, ROOTS, "someone")).toBe(text)
  })
})

describe("structure", () => {
  /**
   * The leak this exists for. Remote Connect logs every event with the whole
   * event as its detail, and a `file` event carries the entire text of a peer's
   * profile — their work, arriving here because that is what sharing means, and
   * with no diagnostic value at all beyond its size.
   */
  it("drops a shared file's contents and keeps its length", () => {
    const scrubbed = scrub({
      kind: "file",
      relPath: "A2A PA-24.yaml",
      content: "shared:\n  - get: A:BATTERY VOLTAGE\n",
    }) as Record<string, unknown>

    expect(scrubbed.content).toBeUndefined()
    expect(scrubbed.contentBytes).toBe(35)
    expect(scrubbed.relPath).toBe("A2A PA-24.yaml")
  })

  it("reduces a session code to its shape, and a resume token to nothing", () => {
    const scrubbed = scrub({
      state: { phase: "hosting", code: "K7RM2Q", resume: "abc123" },
    }) as { state: Record<string, unknown> }

    expect(scrubbed.state.code).toBe("XXX-XXX")
    expect(scrubbed.state.resume).toBe("<redacted>")
  })

  it("reaches into arrays, which is where a manifest lives", () => {
    const scrubbed = scrub({
      files: [{ relPath: "a.yaml", content: "x" }],
    }) as { files: Record<string, unknown>[] }

    expect(scrubbed.files[0]!.content).toBeUndefined()
    expect(scrubbed.files[0]!.contentBytes).toBe(1)
  })

  it("passes ordinary values through untouched", () => {
    expect(scrub({ n: 1, s: "L:Foo", b: true, z: null })).toEqual({
      n: 1,
      s: "L:Foo",
      b: true,
      z: null,
    })
  })

  /**
   * A detail object is whatever a producer handed the logger. Recursing without
   * a bound is a way to hang the report on a shape nobody predicted, and a
   * report that hangs is worse than one with a truncated field in it.
   */
  it("stops rather than recursing forever on something deeply nested", () => {
    let deep: unknown = "bottom"
    for (let i = 0; i < 40; i++) deep = { deep }

    expect(() => scrub(deep)).not.toThrow()
    expect(JSON.stringify(scrub(deep))).toContain("<deep>")
  })
})
