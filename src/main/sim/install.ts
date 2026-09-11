/**
 * Putting the Link module into somebody's Community folder, and taking it out
 * again.
 *
 * No SimConnect and no electron: this is filesystem work that runs before the
 * module exists and keeps running after it is gone, and keeping it importable
 * without a running app is what makes it testable without a simulator.
 *
 * The rule the whole file is built around is
 * [04-connection](../../../docs/sim-vars/04-connection.md)'s: **do not guess.**
 * `UserCfg.opt` holds `InstalledPackagesPath` and is authoritative across MS
 * Store, Steam, 2020, 2024 and relocated installs. The guess exists only as the
 * last thing tried, and says so when it is what got used.
 *
 * The other rule is quieter and is about not doing damage. We are writing into
 * a game install that other people's packages already live in — this machine's
 * Community folder holds 60-odd of them, two of which are junctions to
 * `Program Files` — so every write is confined to one folder named after us,
 * and every removal checks whether it is about to follow a link somewhere it
 * does not own.
 */

import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import {
  COMMUNITY_DIRS,
  LINK_PACKAGE,
  parseInstalledPackagesPath,
  type CommunityFolder,
  type CommunitySource,
  type InstalledPackage,
  type LinkInstallResult,
  type LinkInstallState,
  type LinkUninstallResult,
} from "@shared/link-install"

/** The module file inside the package, and the only one whose content matters. */
const MODULE_FILE = path.join("modules", `${LINK_PACKAGE}.wasm`)

/**
 * Where the simulators keep their config, newest first.
 *
 * `sim` is what the folder is called, which is also what a user with 2020 and
 * 2024 side by side needs to see: their two `Community` paths are otherwise
 * identical apart from four characters in the middle.
 *
 * MS Store installs put the same file under a package family name instead, and
 * those are included because a Store user has no `%APPDATA%` copy at all —
 * discovery that only looked in the obvious place would find nothing and fall
 * through to a guess that is wrong for exactly the users who most need it read.
 */
const CONFIG_LOCATIONS: { sim: string; parts: [keyof Roaming, ...string[]] }[] = [
  {
    sim: "Microsoft Flight Simulator 2024",
    parts: ["appData", "Microsoft Flight Simulator 2024"],
  },
  {
    sim: "Microsoft Flight Simulator 2024",
    parts: [
      "localAppData",
      "Packages",
      "Microsoft.Limitless_8wekyb3d8bbwe",
      "LocalCache",
    ],
  },
  {
    sim: "Microsoft Flight Simulator",
    parts: ["appData", "Microsoft Flight Simulator"],
  },
  {
    sim: "Microsoft Flight Simulator",
    parts: [
      "localAppData",
      "Packages",
      "Microsoft.FlightSimulator_8wekyb3d8bbwe",
      "LocalCache",
    ],
  },
]

interface Roaming {
  appData: string
  localAppData: string
}

/**
 * The two profile directories, from the environment.
 *
 * Read here rather than through electron's `app.getPath` so this file stays
 * importable outside a running app. `link/build.sh` learned the hard way that
 * `%APPDATA%` is not always present — running through `npm run` from PowerShell
 * drops it — so `USERPROFILE` is the fallback, and both are allowed to be empty
 * rather than throwing. An empty answer means discovery finds nothing, which is
 * a state the dialog already has to render.
 */
function roaming(): Roaming {
  const home = process.env.USERPROFILE ?? ""

  return {
    appData: process.env.APPDATA ?? (home ? path.join(home, "AppData", "Roaming") : ""),
    localAppData:
      process.env.LOCALAPPDATA ?? (home ? path.join(home, "AppData", "Local") : ""),
  }
}

async function readText(file: string): Promise<string | null> {
  return fs.readFile(file, "utf8").catch(() => null)
}

async function isDirectory(target: string): Promise<boolean> {
  // `stat`, not `lstat` — a Community folder reached through a junction is a
  // perfectly good Community folder, and this machine has two packages inside
  // one arranged exactly that way.
  const info = await fs.stat(target).catch(() => null)
  return info?.isDirectory() ?? false
}

/**
 * Every `Packages` root the installed simulators name, in config order.
 *
 * Deduplicated on the path, because 2020 and 2024 can be pointed at the same
 * root and the user should be offered one folder rather than the same one
 * twice under two names.
 */
async function packageRoots(): Promise<{ root: string; sim: string }[]> {
  const dirs = roaming()
  const found: { root: string; sim: string }[] = []
  const seen = new Set<string>()

  for (const location of CONFIG_LOCATIONS) {
    const [base, ...rest] = location.parts
    const dir = dirs[base]
    if (!dir) continue

    const text = await readText(path.join(dir, ...rest, "UserCfg.opt"))
    if (!text) continue

    const root = parseInstalledPackagesPath(text)
    if (!root) continue

    const key = path.resolve(root).toLowerCase()
    if (seen.has(key)) continue

    seen.add(key)
    found.push({ root, sim: location.sim })
  }

  return found
}

/**
 * What is installed under our name in a Community folder.
 *
 * Null means nothing is there. It does *not* mean nothing is wrong — a folder
 * that exists but holds no readable manifest comes back with a null version and
 * `current: false`, which is the state a reinstall is for and is worth telling
 * the user apart from a clean slate.
 */
async function inspect(community: string, shippedHash: string | null): Promise<InstalledPackage | null> {
  const target = path.join(community, LINK_PACKAGE)

  const link = await fs.lstat(target).catch(() => null)
  if (!link) return null

  const linked = link.isSymbolicLink()
  // Through the link deliberately: what matters here is what the simulator will
  // read, and the simulator follows it too.
  if (!(await isDirectory(target))) return null

  const manifest = await readText(path.join(target, "manifest.json"))
  let version: string | null = null

  if (manifest) {
    try {
      const parsed: unknown = JSON.parse(manifest)
      const field =
        typeof parsed === "object" && parsed !== null
          ? (parsed as { package_version?: unknown }).package_version
          : null

      if (typeof field === "string") version = field
    } catch {
      // A manifest we cannot parse is a package we should offer to replace,
      // not a reason to fail discovery. `version` stays null and says so.
    }
  }

  const installedHash = await hashFile(path.join(target, MODULE_FILE))

  return {
    version,
    current:
      shippedHash === null || installedHash === null
        ? "unknown"
        : installedHash === shippedHash
          ? "same"
          : "different",
    linked,
  }
}

async function hashFile(file: string): Promise<string | null> {
  const bytes = await fs.readFile(file).catch(() => null)
  if (!bytes) return null

  return crypto.createHash("sha256").update(bytes).digest("hex")
}

/**
 * Where this app's copy of the built package is.
 *
 * Two locations and no flag distinguishing them, because the packaged path
 * simply does not exist in a checkout and the checkout path does not exist in
 * an install. Asking the filesystem is both shorter and harder to get wrong
 * than asking which build we are.
 *
 * `link/Packages/` is committed and shipped through `extraResources` for one
 * reason: the module cannot be built on a hosted runner. The SDK has no
 * unattended install and `fspackagetool` drives the game executable, so a
 * package built by a maintainer is the only package there will ever be. See
 * `link/README.md`.
 */
async function shippedPath(): Promise<string | null> {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, "link", LINK_PACKAGE)
    if (await isDirectory(path.join(packaged, "modules"))) return packaged
  }

  // The checkout, found by walking up rather than by counting `..`. This file
  // sits at `src/main/sim/` under vitest and is bundled into `out/main/` by
  // electron-vite, so any fixed number of levels is wrong for one of them —
  // which is exactly the bug this replaced, and it would have shown up only in
  // `npm run dev`, where the tests could not see it.
  let dir = import.meta.dirname

  for (let up = 0; up < 5; up++) {
    const candidate = path.join(dir, "link", "Packages", LINK_PACKAGE)
    if (await isDirectory(path.join(candidate, "modules"))) return candidate

    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  return null
}

/** Every file in a package, relative to its root, sorted. */
async function walk(root: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(path.join(root, prefix), { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const rel = path.join(prefix, entry.name)
    if (entry.isDirectory()) files.push(...(await walk(root, rel)))
    else files.push(rel)
  }

  return files.sort()
}

async function totalBytes(root: string, files: string[]): Promise<number> {
  let bytes = 0

  for (const file of files) {
    const info = await fs.stat(path.join(root, file)).catch(() => null)
    bytes += info?.size ?? 0
  }

  return bytes
}

/**
 * Everything the install dialog needs, in one call.
 *
 * Ordered so the folder already holding the module comes first: on a machine
 * with both `Community` and `Community2024`, where the module is already
 * decides the question and the user should not have to re-answer it.
 */
export async function linkInstallState(): Promise<LinkInstallState> {
  const shipped = await shippedPath()
  const shippedHash = shipped ? await hashFile(path.join(shipped, MODULE_FILE)) : null

  const folders: CommunityFolder[] = []

  for (const { root, sim } of await packageRoots()) {
    for (const name of COMMUNITY_DIRS) {
      const community = path.join(root, name)
      if (!(await isDirectory(community))) continue

      folders.push({
        path: community,
        source: "config",
        sim,
        installed: await inspect(community, shippedHash),
      })
    }
  }

  /*
   * Best first, and the dialog installs into the first one without asking.
   *
   * Where the module already is outranks everything — that question has been
   * answered once and re-asking it would be rude. Failing that, plain
   * `Community` beats `Community2024`: MSFS 2024 scans both, and `Community` is
   * the one this module has actually been observed working from, which is a
   * better reason than a guess about which folder a 2024-SDK module belongs in.
   */
  folders.sort((a, b) => {
    const installed = Number(Boolean(b.installed)) - Number(Boolean(a.installed))
    if (installed !== 0) return installed

    return (
      COMMUNITY_DIRS.indexOf(path.basename(a.path) as (typeof COMMUNITY_DIRS)[number]) -
      COMMUNITY_DIRS.indexOf(path.basename(b.path) as (typeof COMMUNITY_DIRS)[number])
    )
  })

  return {
    folders,
    shipped: shipped
      ? {
          version: await shippedVersion(shipped),
          bytes: await totalBytes(shipped, await walk(shipped)),
        }
      : null,
  }
}

async function shippedVersion(root: string): Promise<string | null> {
  const manifest = await readText(path.join(root, "manifest.json"))
  if (!manifest) return null

  try {
    const parsed: unknown = JSON.parse(manifest)
    const field =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { package_version?: unknown }).package_version
        : null

    return typeof field === "string" ? field : null
  } catch {
    return null
  }
}

/**
 * Describes a folder the user picked themselves.
 *
 * The picker gives us a directory and no context, and it may or may not be a
 * Community folder — 04-connection's instruction is to accept anything that
 * looks right, which is the same latitude `detect.ts` gives the workspace
 * picker. So nothing is rejected here; the folder is described and the dialog
 * shows what it found.
 */
export async function describeCommunity(
  community: string,
  source: CommunitySource = "chosen"
): Promise<CommunityFolder | null> {
  if (!(await isDirectory(community))) return null

  const shipped = await shippedPath()
  const shippedHash = shipped ? await hashFile(path.join(shipped, MODULE_FILE)) : null

  return {
    path: community,
    source,
    sim: path.basename(path.dirname(community)) || community,
    installed: await inspect(community, shippedHash),
  }
}

/**
 * Removes whatever is at `target`, without following it anywhere.
 *
 * The junction case is the whole reason this is not one call to `fs.rm`. A
 * junction in Community points at a real package somewhere else — on this
 * machine, at two folders under `Program Files (x86)` — and recursing into one
 * would delete somebody's scenery to uninstall ours. `rmdir` takes the reparse
 * point away and leaves the other end alone, which is what Windows does for a
 * directory junction and what we want in every case where one is present.
 */
async function removeEntry(target: string): Promise<void> {
  const info = await fs.lstat(target).catch(() => null)
  if (!info) return

  if (info.isSymbolicLink()) {
    await fs.rmdir(target).catch(() => fs.unlink(target))
    return
  }

  await fs.rm(target, { recursive: true, force: true })
}

/**
 * Copies the package into a Community folder, replacing anything already there.
 *
 * Replace rather than merge. A package left over from an older build can hold
 * files this one no longer ships, and MSFS reads `layout.json` — which lists
 * every file with its size — so a stale entry is not inert, it is a package the
 * simulator considers corrupt. Removing first is the only way to be sure what
 * is on disk is what we meant to put there.
 *
 * Never throws: a failure comes back as a value the dialog can render, because
 * every plausible cause here — the sim holding the file open, a read-only
 * folder, a OneDrive-synced profile mid-upload — is something the user can act
 * on and none of them is a reason to take down the app.
 */
export async function installLink(community: string): Promise<LinkInstallResult> {
  const shipped = await shippedPath()
  if (!shipped) {
    return {
      ok: false,
      reason:
        "This build does not carry the Link module. Run `npm run link:build` " +
        "in a checkout, or install a release build.",
    }
  }

  if (!(await isDirectory(community))) {
    return { ok: false, reason: `${community} is not a folder.` }
  }

  const target = path.join(community, LINK_PACKAGE)
  const replaced = (await fs.lstat(target).catch(() => null)) !== null

  try {
    await removeEntry(target)
    await fs.cp(shipped, target, { recursive: true })
  } catch (error) {
    return { ok: false, reason: describe(error) }
  }

  const files = await walk(target)

  return {
    ok: true,
    path: target,
    files,
    bytes: await totalBytes(target, files),
    replaced,
  }
}

/**
 * Takes the package back out.
 *
 * 04-connection asks for this in as many words — "we are writing into somebody's
 * game install and should be able to leave it as we found it" — and it is the
 * one operation here that can destroy something, which is why it goes through
 * the same junction-aware removal as a reinstall does.
 */
export async function uninstallLink(community: string): Promise<LinkUninstallResult> {
  const target = path.join(community, LINK_PACKAGE)

  if (!(await fs.lstat(target).catch(() => null))) {
    return { ok: false, reason: `Nothing installed at ${target}.` }
  }

  try {
    await removeEntry(target)
  } catch (error) {
    return { ok: false, reason: describe(error) }
  }

  return { ok: true, path: target }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message || error.name

  const text = String(error)
  return text === "undefined" || text === "" ? "unknown error" : text
}

/**
 * Is the module installed anywhere?
 *
 * Cached, and read synchronously, because the footer chip asks on every state
 * publish and the answer changes about twice in an application's lifetime.
 * 04-connection's first two states differ only by this: an uninstalled app
 * shows an invitation, and an installed one with the sim closed says nothing
 * louder than "Sim offline".
 *
 * Starts false, which is the right way round to be wrong for a moment: the
 * invitation appearing briefly and then resolving to silence is a smaller
 * mistake than a `Restart sim` instruction shown to somebody who has not
 * installed anything.
 */
let installedSomewhere = false

export function linkInstalled(): boolean {
  return installedSomewhere
}

export async function refreshLinkInstalled(): Promise<boolean> {
  const state = await linkInstallState()
  installedSomewhere = state.folders.some((folder) => folder.installed !== null)
  return installedSomewhere
}

/**
 * Replaces any installed package that is not the one this app ships.
 *
 * Nobody should be asked to press a button to make software they already
 * installed match the software that installs it. A version prompt is a
 * question the user has no way to answer — they cannot know what changed in a
 * WASM module, and the only honest answer is always yes — so this does it and
 * says so in the log rather than in a dialog.
 *
 * Two limits keep that from being presumptuous:
 *
 * - **It never installs where nothing is installed.** Writing into somebody's
 *   game install for the first time is a decision, and it stays theirs. This
 *   only ever replaces a package they already said yes to.
 * - **It never acts on `unknown`.** A build carrying no package of its own has
 *   no basis for an opinion about what is on disk, and "I cannot tell" must not
 *   become "so I overwrote it".
 *
 * Returns what it did, for the log. An empty array is the ordinary case.
 */
export async function updateStaleLinks(): Promise<LinkInstallResult[]> {
  const done: LinkInstallResult[] = []

  for (const folder of staleFolders(await linkInstallState())) {
    done.push(await installLink(folder.path))
  }

  return done
}

/**
 * Which folders `updateStaleLinks` will write to. Pure, and separate, because
 * this is the part that decides to overwrite somebody's files without asking —
 * and the composed version reads the machine's real `UserCfg.opt`, so a test of
 * it would be a test that edits the user's actual Community folder.
 */
export function staleFolders(state: LinkInstallState): CommunityFolder[] {
  return state.folders.filter(
    (folder) => folder.installed?.current === "different"
  )
}
