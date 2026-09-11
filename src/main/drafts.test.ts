import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { clearDraft, loadDrafts, saveDraft } from "./drafts"

let userData = ""
let root = ""

beforeEach(async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "fsc-drafts-"))
  userData = path.join(base, "userData")
  root = path.join(base, "Definitions")
  await fs.mkdir(root, { recursive: true })
})

afterEach(async () => {
  await fs.rm(path.dirname(userData), { recursive: true, force: true })
})

/** Writes a profile into the workspace, as the app or anyone else would. */
async function onDisk(relPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, relPath)), { recursive: true })
  await fs.writeFile(path.join(root, relPath), content, "utf8")
}

describe("drafts", () => {
  it("restores a draft against the file it was taken from", async () => {
    await onDisk("pa24-250.yaml", "shared: []\n")
    await saveDraft(
      userData,
      root,
      "pa24-250.yaml",
      "shared: [1]\n",
      "shared: []\n"
    )

    const [draft, ...rest] = await loadDrafts(userData, root)

    expect(rest).toHaveLength(0)
    expect(draft).toMatchObject({
      relPath: "pa24-250.yaml",
      text: "shared: [1]\n",
      stale: false,
    })
    expect(draft?.disk?.content).toBe("shared: []\n")
  })

  // The never-saved case: a profile scaffolded in the editor and not yet
  // written. There is no file to sit against, and that is not a conflict.
  it("restores a draft that has no file at all", async () => {
    await saveDraft(userData, root, "new.yaml", "shared: []\n", "")

    const [draft] = await loadDrafts(userData, root)
    expect(draft).toMatchObject({ disk: null, stale: false })
  })

  it("marks a draft stale when the file moved underneath it", async () => {
    await saveDraft(userData, root, "pa24-250.yaml", "mine\n", "was\n")
    await onDisk("pa24-250.yaml", "somebody else\n")

    const [draft] = await loadDrafts(userData, root)
    expect(draft?.stale).toBe(true)
    expect(draft?.disk?.content).toBe("somebody else\n")
  })

  // Line endings are not a change. Two Windows installs disagree about them
  // constantly, and a checkout that flips them must not read as a conflict.
  it("does not call a line-ending change stale", async () => {
    await saveDraft(userData, root, "pa24-250.yaml", "mine\n", "a\nb\n")
    await onDisk("pa24-250.yaml", "a\r\nb\r\n")

    const [draft] = await loadDrafts(userData, root)
    expect(draft?.stale).toBe(false)
  })

  it("forgets a draft whose text is now the file", async () => {
    await onDisk("pa24-250.yaml", "same\n")
    await saveDraft(userData, root, "pa24-250.yaml", "same\n", "was\n")

    expect(await loadDrafts(userData, root)).toHaveLength(0)
    // And forgotten for good, not merely hidden from this one read.
    expect(await loadDrafts(userData, root)).toHaveLength(0)
  })

  it("clears a draft on request", async () => {
    await saveDraft(userData, root, "pa24-250.yaml", "mine\n", "")
    await clearDraft(userData, root, "pa24-250.yaml")

    expect(await loadDrafts(userData, root)).toHaveLength(0)
  })

  it("replaces an earlier draft for the same file", async () => {
    await saveDraft(userData, root, "pa24-250.yaml", "first\n", "")
    await saveDraft(userData, root, "pa24-250.yaml", "second\n", "")

    const drafts = await loadDrafts(userData, root)
    expect(drafts).toHaveLength(1)
    expect(drafts[0]?.text).toBe("second\n")
  })

  it("keeps one workspace's drafts out of another's", async () => {
    const other = path.join(path.dirname(root), "Other")
    await fs.mkdir(other, { recursive: true })

    await saveDraft(userData, root, "pa24-250.yaml", "mine\n", "")

    expect(await loadDrafts(userData, other)).toHaveLength(0)
    expect(await loadDrafts(userData, root)).toHaveLength(1)
  })

  it("keeps the draft as a file anyone can open", async () => {
    await saveDraft(userData, root, "modules/lights.yaml", "shared: []\n", "")

    const folders = await fs.readdir(path.join(userData, "drafts"))
    const folder = path.join(userData, "drafts", folders[0]!)

    expect(
      await fs.readFile(path.join(folder, "modules/lights.yaml"), "utf8")
    ).toBe("shared: []\n")

    // Metadata only in the index — the content lives in the file beside it.
    const index = JSON.parse(
      await fs.readFile(path.join(folder, "index.json"), "utf8")
    ) as { root: string; files: Record<string, { baseHash: string }> }

    expect(index.root).toBe(root)
    expect(index.files["modules/lights.yaml"]?.baseHash).toMatch(
      /^[0-9a-f]{64}$/
    )
    expect(JSON.stringify(index)).not.toContain("shared")
  })

  it("survives an index naming a file that is gone", async () => {
    await saveDraft(userData, root, "pa24-250.yaml", "mine\n", "")

    const folders = await fs.readdir(path.join(userData, "drafts"))
    await fs.rm(path.join(userData, "drafts", folders[0]!, "pa24-250.yaml"))

    expect(await loadDrafts(userData, root)).toHaveLength(0)
  })

  it("refuses a path that climbs out of the workspace", async () => {
    await expect(
      saveDraft(userData, root, "../escape.yaml", "x", "")
    ).rejects.toThrow()
  })
})
