import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, test } from "vitest"

import {
  resolveFolder,
  walkFolders,
  walkRoots,
  type Resolved,
  type WalkRoot,
} from "./detect"

/**
 * Which folders the app accepts is the whole of setup's promise, so it is
 * pinned against real directories rather than a mocked `fs`: the rules are
 * about what is on disk — a file beside a folder, a name one level up — and a
 * fake filesystem would only be testing that the fake agrees with itself.
 */
let temp: string

beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "fsc-detect-"))
})

afterEach(async () => {
  await fs.rm(temp, { recursive: true, force: true })
})

/** Builds a tree from `path → contents`, where a trailing `/` means a folder. */
async function tree(spec: Record<string, string>): Promise<void> {
  for (const [relPath, contents] of Object.entries(spec)) {
    const full = path.join(temp, relPath)

    if (relPath.endsWith("/")) {
      await fs.mkdir(full, { recursive: true })
      continue
    }

    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, contents, "utf8")
  }
}

const at = (...parts: string[]) => path.join(temp, ...parts)

describe("resolveFolder", () => {
  test("an install directory resolves to the Definitions inside it", async () => {
    await tree({
      "FsCopilot/FsCopilot.exe": "",
      "FsCopilot/Definitions/A350.yaml": "shared:\n",
    })

    expect(await resolveFolder(at("FsCopilot"))).toEqual({
      root: at("FsCopilot", "Definitions"),
      installRoot: at("FsCopilot"),
    })
  })

  test("the Definitions folder itself resolves, and finds its install", async () => {
    await tree({
      "FsCopilot/FsCopilot.exe": "",
      "FsCopilot/Definitions/A350.yaml": "shared:\n",
    })

    expect(await resolveFolder(at("FsCopilot", "Definitions"))).toEqual({
      root: at("FsCopilot", "Definitions"),
      installRoot: at("FsCopilot"),
    })
  })

  test("an install with no profiles yet is still an install", async () => {
    await tree({
      "FsCopilot/FsCopilot.exe": "",
      "FsCopilot/Definitions/": "",
    })

    expect(await resolveFolder(at("FsCopilot"))).toEqual({
      root: at("FsCopilot", "Definitions"),
      installRoot: at("FsCopilot"),
    })
  })

  // The point of the whole rule: somebody was sent a profile and wants to open
  // it, and the editor never touches the program that reads it.
  test("a bare folder of profiles is accepted, with no install", async () => {
    await tree({ "profiles/A350.yaml": "shared:\n" })

    expect(await resolveFolder(at("profiles"))).toEqual({
      root: at("profiles"),
      installRoot: null,
    })
  })

  test("a Definitions folder with no FS Copilot beside it has no install", async () => {
    await tree({ "somewhere/Definitions/A350.yaml": "shared:\n" })

    expect(await resolveFolder(at("somewhere", "Definitions"))).toEqual({
      root: at("somewhere", "Definitions"),
      installRoot: null,
    })
  })

  test("a folder with neither profiles nor Definitions is refused", async () => {
    await tree({ "empty/readme.txt": "" })

    expect(await resolveFolder(at("empty"))).toBeNull()
  })

  test("a folder that does not exist is refused", async () => {
    expect(await resolveFolder(at("nope"))).toBeNull()
  })
})

/** Runs the walk to completion and collects what it reported. */
async function walk(roots: WalkRoot[]): Promise<Resolved[]> {
  const found: Resolved[] = []
  await walkFolders(roots, new AbortController().signal, (resolved) =>
    found.push(resolved)
  )
  return found
}

describe("walkFolders", () => {
  // The point of matching on the executable rather than the folder name: an
  // install somebody renamed is still an install.
  test("finds an install whose folder is named nothing like FS Copilot", async () => {
    await tree({
      "Games/sim tools/FsCopilot.exe": "",
      "Games/sim tools/Definitions/A350.yaml": "shared:\n",
    })

    expect(await walk([{ dir: at("Games"), depth: 2 }])).toEqual([
      {
        root: at("Games", "sim tools", "Definitions"),
        installRoot: at("Games", "sim tools"),
      },
    ])
  })

  test("finds a versioned archive folder one level down", async () => {
    await tree({
      "Downloads/FsCopilot-1.4.2/FsCopilot/FsCopilot.exe": "",
      "Downloads/FsCopilot-1.4.2/FsCopilot/Definitions/A350.yaml": "shared:\n",
    })

    expect(await walk([{ dir: at("Downloads"), depth: 2 }])).toEqual([
      {
        root: at("Downloads", "FsCopilot-1.4.2", "FsCopilot", "Definitions"),
        installRoot: at("Downloads", "FsCopilot-1.4.2", "FsCopilot"),
      },
    ])
  })

  // Where a fork ends up, and the reason `bin` is not in the skip list.
  test("reaches a fork built into ~/dev/fscopilot/bin at depth 3", async () => {
    await tree({
      "dev/fscopilot/bin/FSCopilot/FsCopilot.exe": "",
      "dev/fscopilot/bin/FSCopilot/Definitions/A350.yaml": "shared:\n",
    })

    expect(await walk([{ dir: at("dev"), depth: 3 }])).toEqual([
      {
        root: at("dev", "fscopilot", "bin", "FSCopilot", "Definitions"),
        installRoot: at("dev", "fscopilot", "bin", "FSCopilot"),
      },
    ])
  })

  test("stops at the given depth", async () => {
    await tree({
      "Downloads/a/b/c/FsCopilot.exe": "",
      "Downloads/a/b/c/Definitions/A350.yaml": "shared:\n",
    })

    expect(await walk([{ dir: at("Downloads"), depth: 2 }])).toEqual([])
  })

  // A flight-sim-shaped folder buys one extra level, since this is a sim tool.
  test("a sim-named folder earns an extra level", async () => {
    await tree({
      "Games/MSFS Addons/tools/copilot/FsCopilot.exe": "",
      "Games/MSFS Addons/tools/copilot/Definitions/A350.yaml": "shared:\n",
    })

    expect(await walk([{ dir: at("Games"), depth: 2 }])).toHaveLength(1)
  })

  test("skipped folders are not descended into", async () => {
    await tree({
      "Downloads/node_modules/FsCopilot/FsCopilot.exe": "",
      "Downloads/node_modules/FsCopilot/Definitions/A350.yaml": "shared:\n",
    })

    expect(await walk([{ dir: at("Downloads"), depth: 3 }])).toEqual([])
  })

  test("reports one install once, however many roots reach it", async () => {
    await tree({
      "Programs/fs-copilot/FsCopilot.exe": "",
      "Programs/fs-copilot/Definitions/A350.yaml": "shared:\n",
    })

    const roots = [
      { dir: at("Programs"), depth: 2 },
      { dir: at("Programs"), depth: 2 },
    ]
    expect(await walk(roots)).toHaveLength(1)
  })

  /**
   * A shallow root reaches `Programs` with nothing left to spend, and a deeper
   * root starts there. Tracking visited paths without their depth lets the
   * first arrival lock out the second, which quietly turns every deep root into
   * a single directory listing.
   */
  test("a shallow visit does not block a later deeper one", async () => {
    await tree({
      "Programs/FsCopilot/bin/app/FsCopilot.exe": "",
      "Programs/FsCopilot/bin/app/Definitions/A350.yaml": "shared:\n",
    })

    const found = await walk([
      { dir: temp, depth: 1 },
      { dir: at("Programs"), depth: 3 },
    ])

    expect(found).toEqual([
      {
        root: at("Programs", "FsCopilot", "bin", "app", "Definitions"),
        installRoot: at("Programs", "FsCopilot", "bin", "app"),
      },
    ])
  })

  test("missing or unreadable roots are skipped, not fatal", async () => {
    await expect(walk([{ dir: at("nope"), depth: 2 }])).resolves.toEqual([])
  })

  test("an aborted walk stops early", async () => {
    await tree({
      "Downloads/FsCopilot/FsCopilot.exe": "",
      "Downloads/FsCopilot/Definitions/A350.yaml": "shared:\n",
    })

    const controller = new AbortController()
    controller.abort()

    const found: Resolved[] = []
    await walkFolders(
      [{ dir: at("Downloads"), depth: 2 }],
      controller.signal,
      (resolved) => found.push(resolved)
    )

    expect(found).toEqual([])
  })
})

describe("walkRoots", () => {
  const folders = {
    desktop: "C:\\Users\\x\\Desktop",
    documents: "C:\\Users\\x\\Documents",
    downloads: "C:\\Users\\x\\Downloads",
  }

  test("covers every fixed drive, not just the system one", async () => {
    const roots = walkRoots(["D:\\"], folders).map((root) => root.dir)

    expect(roots).toContain("D:\\")
    expect(roots).toContain(path.join("D:\\", "Games"))
  })

  test("developer folders get depth 3", async () => {
    const roots = walkRoots([], folders)
    const dev = roots.find((root) => root.dir.endsWith(`${path.sep}dev`))

    expect(dev?.depth).toBe(3)
  })

  test("a directory named twice is walked once, at its deepest reach", async () => {
    const roots = walkRoots([], folders)
    const seen = new Set(roots.map((root) => root.dir.toLowerCase()))

    expect(seen.size).toBe(roots.length)
  })
})
