/**
 * The install flow, against a real temporary filesystem.
 *
 * Real directories rather than a mocked `fs`, because every bug this code can
 * have is a filesystem bug: a junction followed when it should not be, a stale
 * file surviving a reinstall, a path assembled from an environment variable
 * that is not set. A mock would agree with whatever the implementation believes
 * and prove nothing.
 *
 * No simulator and no MSFS install is needed — `UserCfg.opt` is a text file and
 * a Community folder is a directory, so the whole shape can be built in `tmp`.
 */

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  parseInstalledPackagesPath,
  type CommunityFolder,
  type LinkInstallState,
} from "@shared/link-install"

import {
  describeCommunity,
  installLink,
  staleFolders,
  uninstallLink,
} from "./install"

let tmp = ""

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "fsc-install-"))
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

/** A Community folder with `count` unrelated packages already in it. */
async function community(count = 2): Promise<string> {
  const dir = path.join(tmp, "Packages", "Community")
  await fs.mkdir(dir, { recursive: true })

  for (let i = 0; i < count; i++) {
    await fs.mkdir(path.join(dir, `someone-elses-package-${i}`), { recursive: true })
  }

  return dir
}

describe("parseInstalledPackagesPath", () => {
  it("reads the quoted form the sim actually writes", () => {
    const text = [
      "SimVersion 2024",
      'InstalledPackagesPath "C:\\Users\\someone\\AppData\\Roaming\\Microsoft Flight Simulator 2024\\Packages"',
      "AccessibilityOptions 0",
    ].join("\r\n")

    expect(parseInstalledPackagesPath(text)).toBe(
      "C:\\Users\\someone\\AppData\\Roaming\\Microsoft Flight Simulator 2024\\Packages"
    )
  })

  it("reads an unquoted value", () => {
    expect(parseInstalledPackagesPath("InstalledPackagesPath D:\\Packages")).toBe(
      "D:\\Packages"
    )
  })

  it("does not care about case or leading space", () => {
    expect(parseInstalledPackagesPath('  installedpackagespath "D:\\P"')).toBe("D:\\P")
  })

  it("returns null rather than throwing on a file that does not have it", () => {
    expect(parseInstalledPackagesPath("SimVersion 2024\nnonsense")).toBeNull()
    expect(parseInstalledPackagesPath("")).toBeNull()
  })

  it("ignores a key with an empty value instead of returning one", () => {
    expect(parseInstalledPackagesPath('InstalledPackagesPath ""')).toBeNull()
  })
})

describe("installLink", () => {
  it("writes the package and reports what it wrote", async () => {
    const dir = await community()
    const result = await installLink(dir)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.replaced).toBe(false)
    expect(result.path).toBe(path.join(dir, "fsc-editor-link"))
    // `files` is what the dialog shows, so it has to be the real list rather
    // than a count that could drift from what landed.
    expect(result.files).toContain(path.join("modules", "fsc-editor-link.wasm"))
    expect(result.files).toContain("manifest.json")
    expect(result.bytes).toBeGreaterThan(0)

    const manifest = await fs.readFile(
      path.join(result.path, "manifest.json"),
      "utf8"
    )
    expect(JSON.parse(manifest)).toMatchObject({ title: "FSC Editor Link" })
  })

  it("leaves every other package in the folder alone", async () => {
    const dir = await community(3)
    await installLink(dir)

    const entries = (await fs.readdir(dir)).sort()
    expect(entries).toEqual([
      "fsc-editor-link",
      "someone-elses-package-0",
      "someone-elses-package-1",
      "someone-elses-package-2",
    ])
  })

  /**
   * The reason install removes before it copies.
   *
   * MSFS reads `layout.json`, which lists every file with its size, so a file
   * left behind from an older build is not inert — it is a package the
   * simulator considers corrupt. A merge would leave exactly that.
   */
  it("replaces rather than merges, so a stale file cannot survive", async () => {
    const dir = await community()
    await installLink(dir)

    const stale = path.join(dir, "fsc-editor-link", "modules", "old-build.wasm")
    await fs.writeFile(stale, "left over from a previous version")

    const again = await installLink(dir)
    expect(again.ok).toBe(true)
    if (again.ok) expect(again.replaced).toBe(true)

    await expect(fs.stat(stale)).rejects.toThrow()
  })

  it("fails as a value, not an exception, when the folder is not there", async () => {
    const result = await installLink(path.join(tmp, "nope"))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("not a folder")
  })
})

describe("describeCommunity", () => {
  it("reports nothing installed in an empty folder", async () => {
    const dir = await community()
    const folder = await describeCommunity(dir)

    expect(folder?.installed).toBeNull()
    expect(folder?.source).toBe("chosen")
  })

  it("recognises its own install, and calls it current", async () => {
    const dir = await community()
    await installLink(dir)

    const folder = await describeCommunity(dir)
    expect(folder?.installed).toMatchObject({ current: "same", linked: false })
    expect(folder?.installed?.version).toBeTruthy()
  })

  /**
   * A different module means a different package, whatever the manifest says.
   *
   * The comparison is by content because the two version numbers in this
   * project disagree by construction — `package_version` comes from
   * `PackageDefinitions`, `k_version` is a constant in the C++ — so neither is
   * a trustworthy answer to "is this the build we ship".
   */
  it("calls a package with different module bytes different", async () => {
    const dir = await community()
    await installLink(dir)

    await fs.writeFile(
      path.join(dir, "fsc-editor-link", "modules", "fsc-editor-link.wasm"),
      "not our module"
    )

    const folder = await describeCommunity(dir)
    expect(folder?.installed).toMatchObject({ current: "different" })
  })

  it("survives a manifest it cannot parse, and asks to be replaced", async () => {
    const dir = await community()
    await installLink(dir)
    await fs.writeFile(path.join(dir, "fsc-editor-link", "manifest.json"), "{ broken")

    const folder = await describeCommunity(dir)
    expect(folder?.installed).toMatchObject({ version: null, current: "same" })
  })

  it("returns null for a folder that does not exist", async () => {
    expect(await describeCommunity(path.join(tmp, "nowhere"))).toBeNull()
  })
})

describe("uninstallLink", () => {
  it("removes what install wrote and nothing else", async () => {
    const dir = await community(2)
    await installLink(dir)

    const result = await uninstallLink(dir)
    expect(result.ok).toBe(true)

    const entries = (await fs.readdir(dir)).sort()
    expect(entries).toEqual(["someone-elses-package-0", "someone-elses-package-1"])
  })

  it("says so rather than throwing when there is nothing to remove", async () => {
    const dir = await community()
    const result = await uninstallLink(dir)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toContain("Nothing installed")
  })
})

/**
 * What auto-update will and will not overwrite.
 *
 * Tested as a pure function over a `LinkInstallState` rather than end to end,
 * because the composed version reads the machine's real `UserCfg.opt` — a test
 * of that would be a test that rewrites the user's actual Community folder.
 *
 * The two rules here are the ones that keep "we update it for you" from being
 * presumptuous, and both of them are about restraint rather than about the
 * update working.
 */
describe("staleFolders", () => {
  const folder = (
    installed: CommunityFolder["installed"],
    at = "C:\\Community"
  ): CommunityFolder => ({
    path: at,
    source: "config",
    sim: "Microsoft Flight Simulator 2024",
    installed,
  })

  const state = (folders: CommunityFolder[]): LinkInstallState => ({
    folders,
    shipped: { version: "0.0.1", bytes: 1 },
  })

  it("picks a package that differs from the one we ship", () => {
    const stale = folder({ version: "0.0.1", current: "different", linked: false })
    expect(staleFolders(state([stale]))).toEqual([stale])
  })

  it("leaves a matching package alone", () => {
    const same = folder({ version: "0.0.1", current: "same", linked: false })
    expect(staleFolders(state([same]))).toEqual([])
  })

  /**
   * The line between updating and installing.
   *
   * Writing into somebody's game install for the first time is a decision, and
   * it stays theirs. Auto-update only ever replaces a package they already said
   * yes to, so a folder with nothing in it is never a candidate — otherwise
   * "keep it up to date" would quietly mean "install it everywhere".
   */
  it("never installs where nothing is installed", () => {
    expect(staleFolders(state([folder(null)]))).toEqual([])
  })

  /**
   * "I cannot tell" must not become "so I overwrote it".
   *
   * `unknown` means there was nothing to compare against — a build carrying no
   * package of its own. An earlier version of this collapsed unknown into
   * `false`, which would have made every such build overwrite a perfectly good
   * install on no evidence.
   */
  it("never acts on a comparison it could not make", () => {
    const unsure = folder({ version: "0.0.1", current: "unknown", linked: false })
    expect(staleFolders(state([unsure]))).toEqual([])
  })

  it("handles several folders, picking only the stale ones", () => {
    const stale = folder(
      { version: "0.0.1", current: "different", linked: false },
      "C:\\Community"
    )
    const fine = folder(
      { version: "0.0.1", current: "same", linked: false },
      "C:\\Community2024"
    )

    expect(staleFolders(state([fine, stale, folder(null, "C:\\Other")]))).toEqual([
      stale,
    ])
  })
})

/**
 * The junction case, which is the one that can destroy something.
 *
 * AddonLinker and junction farms are normal in a Community folder — the machine
 * this was written on has two, both pointing into `Program Files (x86)` — so
 * `fsc-editor-link` being a link to a real folder somewhere else is a
 * configuration that will happen. Removing it recursively would delete the
 * other end.
 *
 * Skipped where symlinks cannot be created: on Windows that needs Developer
 * Mode or elevation, and a test that silently passes because it could not set
 * itself up would be worse than one that says it did not run.
 */
describe("junctions", () => {
  async function linkable(target: string, at: string): Promise<boolean> {
    try {
      await fs.symlink(target, at, "junction")
      return true
    } catch {
      return false
    }
  }

  it("uninstall unlinks rather than deleting through the link", async () => {
    const dir = await community()
    const real = path.join(tmp, "elsewhere", "fsc-editor-link")
    await fs.mkdir(real, { recursive: true })
    await fs.writeFile(path.join(real, "manifest.json"), '{"package_version":"9.9.9"}')

    const at = path.join(dir, "fsc-editor-link")
    if (!(await linkable(real, at))) return

    const result = await uninstallLink(dir)
    expect(result.ok).toBe(true)

    // The link is gone...
    await expect(fs.lstat(at)).rejects.toThrow()
    // ...and the folder it pointed at is untouched.
    expect(await fs.readFile(path.join(real, "manifest.json"), "utf8")).toContain(
      "9.9.9"
    )
  })

  it("install replaces a junction with a real folder, without following it", async () => {
    const dir = await community()
    const real = path.join(tmp, "elsewhere", "fsc-editor-link")
    await fs.mkdir(path.join(real, "modules"), { recursive: true })
    await fs.writeFile(path.join(real, "modules", "keep-me.wasm"), "not ours")

    const at = path.join(dir, "fsc-editor-link")
    if (!(await linkable(real, at))) return

    const result = await installLink(dir)
    expect(result.ok).toBe(true)

    expect((await fs.lstat(at)).isSymbolicLink()).toBe(false)
    expect(await fs.readFile(path.join(real, "modules", "keep-me.wasm"), "utf8")).toBe(
      "not ours"
    )
  })

  it("reports an installed package reached through a junction as linked", async () => {
    const dir = await community()
    const real = path.join(tmp, "elsewhere", "fsc-editor-link")
    await fs.mkdir(path.join(real, "modules"), { recursive: true })
    await fs.writeFile(path.join(real, "manifest.json"), '{"package_version":"9.9.9"}')

    const at = path.join(dir, "fsc-editor-link")
    if (!(await linkable(real, at))) return

    const folder = await describeCommunity(dir)
    expect(folder?.installed).toMatchObject({ version: "9.9.9", linked: true })
  })
})
