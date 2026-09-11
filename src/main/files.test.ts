import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  copyName,
  duplicateFile,
  listFiles,
  renameFile,
  saveRefused,
  writeFile,
} from "./files"

let root = ""

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "fsc-files-"))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

async function onDisk(relPath: string, content = "shared: []\n"): Promise<void> {
  await fs.mkdir(path.dirname(path.join(root, relPath)), { recursive: true })
  await fs.writeFile(path.join(root, relPath), content, "utf8")
}

async function names(): Promise<string[]> {
  return (await listFiles(root)).map((file) => file.relPath)
}

describe("copyName", () => {
  it("numbers from the second copy on", () => {
    expect(copyName("a320.yaml", new Set(["a320.yaml"]))).toBe(
      "a320 - Copy.yaml"
    )
    expect(
      copyName("a320.yaml", new Set(["a320.yaml", "a320 - Copy.yaml"]))
    ).toBe("a320 - Copy (2).yaml")
  })

  it("ignores case, the way the filesystem it is naming for does", () => {
    expect(copyName("A320.yaml", new Set(["a320 - copy.YAML"]))).toBe(
      "A320 - Copy (2).yaml"
    )
  })
})

describe("renameFile", () => {
  it("keeps the profile in its folder and adds the extension", async () => {
    await onDisk("modules/fuel.yaml")

    const renamed = await renameFile(root, "modules/fuel.yaml", "fuel system")

    expect(renamed.relPath).toBe("modules/fuel system.yaml")
    expect(await names()).toEqual(["modules/fuel system.yaml"])
  })

  it("refuses a name another profile already has", async () => {
    await onDisk("a320.yaml")
    await onDisk("a321.yaml")

    await expect(renameFile(root, "a320.yaml", "a321.yaml")).rejects.toThrow(
      /already exists/
    )
    expect(await names()).toEqual(["a320.yaml", "a321.yaml"])
  })

  it("refuses a name that would move the profile somewhere else", async () => {
    await onDisk("a320.yaml")

    await expect(
      renameFile(root, "a320.yaml", "../outside.yaml")
    ).rejects.toThrow()
    expect(await names()).toEqual(["a320.yaml"])
  })

  it("changes the case of a name it is otherwise not changing", async () => {
    await onDisk("a320.yaml")

    const renamed = await renameFile(root, "a320.yaml", "A320.yaml")

    expect(renamed.relPath).toBe("A320.yaml")
  })
})

describe("duplicateFile", () => {
  it("copies the contents beside the original", async () => {
    await onDisk("a320.yaml", "shared:\n  - one\n")

    const copy = await duplicateFile(root, "a320.yaml")

    expect(copy.relPath).toBe("a320 - Copy.yaml")
    expect(await fs.readFile(path.join(root, copy.relPath), "utf8")).toBe(
      "shared:\n  - one\n"
    )
  })
})

describe("saveRefused", () => {
  it("names the likely culprit for a locked file", () => {
    expect(saveRefused("a320.yaml", { code: "EBUSY" }).message).toBe(
      "Could not save a320.yaml — another program has it open, most likely FS Copilot."
    )
    expect(saveRefused("a320.yaml", { code: "EPERM" }).message).toBe(
      saveRefused("a320.yaml", { code: "EACCES" }).message
    )
  })

  it("has a sentence for a disk that cannot take the file", () => {
    expect(saveRefused("a320.yaml", { code: "ENOSPC" }).message).toBe(
      "Could not save a320.yaml — the disk is full."
    )
    expect(saveRefused("a320.yaml", { code: "EROFS" }).message).toBe(
      "Could not save a320.yaml — the disk is read-only."
    )
  })

  it("still says which file, and what Windows said, for a code it has never met", () => {
    expect(saveRefused("a320.yaml", { code: "EMFILE" }).message).toBe(
      "Could not save a320.yaml — Windows reported EMFILE."
    )
  })

  it("passes the original text through when there is no code to name", () => {
    expect(saveRefused("a320.yaml", new Error("nothing useful")).message).toBe(
      "Could not save a320.yaml — nothing useful"
    )
  })
})

describe("writeFile", () => {
  it("returns the mtime the write produced", async () => {
    const written = await writeFile(root, "a320.yaml", "shared: []\n")

    expect(written.relPath).toBe("a320.yaml")
    expect(written.mtimeMs).toBeGreaterThan(0)
  })

  it("rewrites a refusal into a sentence naming the file", async () => {
    // A folder standing where the profile should be: a real failure from the
    // filesystem, which is the part the sentence has to survive.
    await fs.mkdir(path.join(root, "a320.yaml"))

    await expect(writeFile(root, "a320.yaml", "shared: []\n")).rejects.toThrow(
      /^Could not save a320\.yaml — /
    )
  })
})
