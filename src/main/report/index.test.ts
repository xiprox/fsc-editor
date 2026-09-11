/**
 * The report as a package, not as a set of collectors.
 *
 * What is worth covering here is the promise the dialog makes on this module's
 * behalf: something lands, it lands somewhere findable, it is readable without
 * this app, and the parts that could not be collected say so instead of quietly
 * not being there. The individual files are their sources' business, and the
 * redaction rules have their own tests.
 *
 * Run with no database, no workspace and no simulator — which is not a corner
 * case, it is the state of an app somebody launched, hit a bug in, and reported
 * from before setting anything up. Half the collectors fail, and the point is
 * that the other half still arrive.
 */

import fs from "node:fs"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const paths: Record<string, string> = {}

vi.mock("electron", () => ({
  app: {
    getVersion: () => "0.0.1",
    getLocale: () => "en-GB",
    getPath: (name: string) => paths[name] ?? paths.userData!,
    isPackaged: true,
  },
  screen: {
    getAllDisplays: () => [
      {
        size: { width: 2560, height: 1440 },
        scaleFactor: 1.5,
        internal: false,
      },
    ],
  },
}))

// Discovery reads the simulator's own config and the registry. Neither exists
// here, and neither is what this test is about.
vi.mock("../sim/install", () => ({
  linkInstallState: () => Promise.resolve({ folders: [], shipped: null }),
  linkInstalled: () => false,
  refreshLinkInstalled: () => Promise.resolve(false),
}))

const { collectReport } = await import("./index")

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "fsc-report-"))
  paths.userData = join(root, "userData")
  paths.downloads = join(root, "downloads")
  paths.home = root
  fs.mkdirSync(paths.userData, { recursive: true })
  fs.mkdirSync(paths.downloads, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function folderOf(report: { ok: true; folder: string }): string[] {
  return fs.readdirSync(report.folder)
}

describe("collectReport", () => {
  it("writes a stamped folder into Downloads with a zip beside the files", async () => {
    const report = await collectReport(null)
    expect(report.ok).toBe(true)
    if (!report.ok) return

    expect(report.folder).toMatch(
      /fsc-editor-report-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/
    )
    expect(report.folder.startsWith(paths.downloads!)).toBe(true)

    // The zip carries the folder's whole name, because it is the half that
    // leaves the machine and lands among a dozen other attachments.
    const name = basename(report.folder)
    expect(folderOf(report)).toContain(`${name}.zip`)
    expect(report.zip).toBe(join(report.folder, `${name}.zip`))
    expect(report.bytes).toBeGreaterThan(0)
  })

  /**
   * The only file a reader is promised. Everything else may be absent, and the
   * manifest is what turns "absent" into a fact rather than a guess.
   */
  it("always writes a manifest, describing what it managed to collect", async () => {
    const report = await collectReport(null)
    if (!report.ok) throw new Error("expected a report")

    const manifest = JSON.parse(
      fs.readFileSync(join(report.folder, "manifest.json"), "utf8")
    ) as {
      version: number
      files: { name: string; bytes: number }[]
      captures: { files: string[]; live: string | null }
      errors: number
    }

    expect(manifest.version).toBe(1)
    expect(manifest.files.length).toBeGreaterThan(0)

    // Every file it claims is a file that is there.
    for (const entry of manifest.files)
      expect(fs.existsSync(join(report.folder, entry.name))).toBe(true)
  })

  /**
   * The failure mode this whole design is arranged against: a report missing
   * exactly the subsystem that broke, with nothing anywhere saying so. With no
   * database and no workspace, several collectors throw — and the package has
   * to arrive anyway, naming them.
   */
  it("names what it could not collect instead of arriving quietly short", async () => {
    const report = await collectReport(null)
    if (!report.ok) throw new Error("expected a report")

    expect(report.errors).toBeGreaterThan(0)

    const errors = fs.readFileSync(join(report.folder, "errors.txt"), "utf8")
    expect(errors.trim().split("\n")).toHaveLength(report.errors)

    // And the ones that do not depend on any of that still landed.
    expect(folderOf(report)).toContain("environment.json")
    expect(folderOf(report)).toContain("log.ndjson")
  })

  /** Which build, and whether it was talking to a simulator or to a fixture. */
  it("records the environment, including the development gates", async () => {
    const report = await collectReport(null)
    if (!report.ok) throw new Error("expected a report")

    const environment = JSON.parse(
      fs.readFileSync(join(report.folder, "environment.json"), "utf8")
    ) as { app: string; dev: { packaged: boolean; replay: string | null } }

    expect(environment.app).toBe("0.0.1")
    expect(environment.dev.packaged).toBe(true)
    expect(environment.dev).toHaveProperty("replay")
  })

  /**
   * The claim on the dialog. `userData` is under the home directory here, the
   * same way it is on a real machine, so this covers the ordering rule too:
   * both roots match and the longer one has to win.
   */
  it("takes the user's directories out of what it writes", async () => {
    const report = await collectReport(null)
    if (!report.ok) throw new Error("expected a report")

    for (const name of folderOf(report)) {
      if (name.endsWith(".zip")) continue

      const text = fs.readFileSync(join(report.folder, name), "utf8")
      expect(text).not.toContain(paths.userData)
      expect(text).not.toContain(paths.home)
    }
  })
})
