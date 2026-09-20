import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import type { CandidateSource, DetectResult } from "@shared/types"

import { isYaml } from "./paths"

const execFileAsync = promisify(execFile)

const DEFINITIONS = "Definitions"
export const EXE = "FsCopilot.exe"
const EXE_LOWER = EXE.toLowerCase()

/** A folder that turned out to be usable, before anyone decides to use it. */
export interface Resolved {
  /** The directory profiles are read from. */
  root: string
  /** The FS Copilot install `root` sits inside, or null when there isn't one. */
  installRoot: string | null
}

/**
 * The two things detection needs from Electron.
 *
 * Injected rather than imported so this file stays plain Node and can be run by
 * the test suite. Both are genuinely Electron's to answer: reading a `.lnk`
 * needs the Windows shell, and the user's Desktop and Documents may have been
 * redirected into OneDrive, which `app.getPath` knows about and string
 * concatenation does not.
 */
export interface DetectDeps {
  /** A shortcut's target path, or null if it cannot be read. */
  readShortcut: (lnkPath: string) => string | null
  folders: { desktop: string; documents: string; downloads: string }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fs.stat(dir)).isDirectory()
  } catch {
    return false
  }
}

/**
 * A directory holds profiles when at least one YAML file sits at its top level —
 * the same check FS Copilot itself uses to decide whether its profile pack has
 * been installed.
 */
async function hasProfiles(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return entries.some((entry) => entry.isFile() && isYaml(entry.name))
  } catch {
    return false
  }
}

/** The executable beside `Definitions` is what makes a folder an install. */
async function isInstall(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, EXE))
    return true
  } catch {
    return false
  }
}

/**
 * What a folder someone pointed at actually is, or null if it is nothing to us.
 *
 * Three shapes are accepted, in the order somebody is likely to hand them over:
 * an FS Copilot install directory, the `Definitions` folder inside one, and a
 * plain folder of profile files belonging to no install at all.
 *
 * That last one is deliberate. Editing a profile does not require owning the
 * program that reads it — someone was sent a YAML file and wants to look at it —
 * and refusing the folder would make an editor demand an install it never
 * touches. The FS Copilot features that genuinely need one can ask for it when
 * they exist, which is what `installRoot` is for.
 *
 * Every layer below proposes paths and this decides which of them count, so a
 * shortcut, a registry key and a folder walk cannot disagree about what an
 * install is.
 */
export async function resolveFolder(dir: string): Promise<Resolved | null> {
  const definitions = path.join(dir, DEFINITIONS)

  // `Definitions` counts even while empty: a fresh install has the folder
  // before it has any profiles, and rejecting it would mean setup turning down
  // the very folder it went looking for.
  if (await isDirectory(definitions))
    return {
      root: definitions,
      installRoot: (await isInstall(dir)) ? dir : null,
    }

  if (!(await hasProfiles(dir))) return null

  // Pointed straight at `Definitions`, so the install is one level up — when
  // there is one at all.
  const parent = path.dirname(dir)
  const named = path.basename(dir).toLowerCase() === DEFINITIONS.toLowerCase()

  return {
    root: dir,
    installRoot: named && (await isInstall(parent)) ? parent : null,
  }
}

/**
 * Whether a directory has no files of its own.
 *
 * Subfolders do not count. A `Definitions` whose profiles were all moved into
 * `modules/` is a workspace someone is in the middle of reorganising, not a
 * folder they pointed at by mistake, and the file that decides between those
 * two readings is a *file*.
 *
 * The three names Windows and macOS leave behind are ignored, because a folder
 * made thirty seconds ago in Explorer can already hold a `desktop.ini` and the
 * user has no idea it is there. Refusing their new folder over a file they
 * cannot see is the worst possible answer.
 */
async function hasNoFiles(dir: string): Promise<boolean> {
  const junk = new Set(["desktop.ini", "thumbs.db", ".ds_store"])

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return !entries.some(
      (entry) => entry.isFile() && !junk.has(entry.name.toLowerCase())
    )
  } catch {
    // Missing, or unreadable. Either way it is not an empty folder we can use.
    return false
  }
}

/**
 * What a folder somebody pointed at **on purpose** is — the native picker, an
 * `FSCE_WORKSPACE`, or the folder they settled on last time.
 *
 * `resolveFolder` above is detection's gate, and it has to stay strict: it is
 * asked about every directory a folder walk reaches, and a rule that accepted
 * blank folders there would offer the user a list of every empty directory on
 * the machine. Nothing about that reasoning applies to a folder a person
 * navigated to and pressed *Use this folder* on.
 *
 * So this adds exactly one case: a folder with no files in it is accepted, as
 * a workspace with nothing in it yet. That is the whole of starting a profile
 * from scratch — make a folder, choose it, name a profile — and it used to be
 * the one thing setup would not let you do, which left somebody who does not
 * own FS Copilot and has not been sent a profile with no way past the first
 * screen.
 *
 * A folder full of *something else* is still refused, and that is the line: the
 * check exists to catch `C:\Windows` chosen by accident, and a directory with
 * files in it that are not profiles is the only shape that has ever been.
 */
export async function resolveChosenFolder(
  dir: string
): Promise<Resolved | null> {
  const resolved = await resolveFolder(dir)
  if (resolved) return resolved

  return (await hasNoFiles(dir)) ? { root: dir, installRoot: null } : null
}

/**
 * Absolute Windows paths mentioned anywhere in a blob of text.
 *
 * `reg.exe` output and shortcut targets both arrive as lines with a path
 * somewhere in them, often quoted and often with an icon index or command-line
 * arguments stuck on the end. Pulling paths out by pattern and handing every
 * one of them to `resolveFolder` is shorter than parsing each format, and wrong
 * guesses cost a failed `stat`.
 */
function pathsIn(text: string): string[] {
  const found = text.match(/[a-zA-Z]:\\[^\r\n"*?<>|,]+/g) ?? []
  return found.map((match) => match.trim()).filter(Boolean)
}

/** A path from a registry value or a shortcut, as a folder worth resolving. */
function folderOf(candidate: string): string {
  return candidate.toLowerCase().endsWith(".exe")
    ? path.dirname(candidate)
    : candidate.replace(/[\\/]+$/, "")
}

// ---------------------------------------------------------------------------
// Layer 1 — the running process
// ---------------------------------------------------------------------------

/**
 * Locates a running FS Copilot and reads its install directory off the process.
 *
 * `Get-CimInstance` rather than `wmic`, which is deprecated and gone from
 * Windows 11 24H2, and rather than `tasklist`, which knows the process exists
 * but not where it lives.
 */
async function fromProcess(signal: AbortSignal): Promise<string[]> {
  const stdout = await powershell(
    `(Get-CimInstance Win32_Process -Filter "Name='${EXE}'").ExecutablePath`,
    signal
  )

  return pathsIn(stdout)
}

// ---------------------------------------------------------------------------
// Layer 2 — shortcuts
// ---------------------------------------------------------------------------

/**
 * Where Windows keeps shortcuts, which is the best evidence there is about a
 * portable app.
 *
 * FS Copilot ships as an archive, so it has no installer, no uninstall entry
 * and no fixed home — but somebody who uses it has almost certainly pinned it,
 * put it on the desktop, or had a Start Menu entry made for them. The shortcut
 * names the exact path, which beats any amount of guessing at folder names.
 */
function shortcutDirs(folders: DetectDeps["folders"]): Array<{
  dir: string
  depth: number
}> {
  const appData = process.env.APPDATA
  const programData = process.env.ProgramData
  const quickLaunch =
    appData && path.join(appData, "Microsoft", "Internet Explorer", "Quick Launch")

  const dirs: Array<{ dir: string | undefined; depth: number }> = [
    // Start Menus nest by publisher, so they are the one place worth recursing.
    {
      dir: appData && path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
      depth: 4,
    },
    {
      dir:
        programData &&
        path.join(programData, "Microsoft", "Windows", "Start Menu", "Programs"),
      depth: 4,
    },
    { dir: quickLaunch && path.join(quickLaunch, "User Pinned", "TaskBar"), depth: 1 },
    { dir: quickLaunch && path.join(quickLaunch, "User Pinned", "StartMenu"), depth: 1 },
    { dir: appData && path.join(appData, "Microsoft", "Windows", "Recent"), depth: 1 },
    { dir: folders.desktop, depth: 1 },
    { dir: process.env.PUBLIC && path.join(process.env.PUBLIC, "Desktop"), depth: 1 },
  ]

  return dirs.filter(
    (entry): entry is { dir: string; depth: number } => !!entry.dir
  )
}

async function fromShortcuts(
  deps: DetectDeps,
  signal: AbortSignal
): Promise<string[]> {
  const found: string[] = []

  for (const { dir, depth } of shortcutDirs(deps.folders)) {
    for (const lnk of await filesUnder(dir, depth, ".lnk", signal)) {
      if (signal.aborted) return found

      const target = deps.readShortcut(lnk)
      if (!target) continue

      // The exe by name, or anything whose path says FS Copilot — which catches
      // a shortcut somebody made to the folder itself rather than the program.
      if (
        path.basename(target).toLowerCase() === EXE_LOWER ||
        FOLDER_NAME.test(path.basename(target)) ||
        FOLDER_NAME.test(path.basename(path.dirname(target)))
      )
        found.push(target)
    }
  }

  return found
}

/** Every file with `extension` under `dir`, to `depth` levels. */
async function filesUnder(
  dir: string,
  depth: number,
  extension: string,
  signal: AbortSignal
): Promise<string[]> {
  if (depth <= 0 || signal.aborted) return []

  const entries = await readDir(dir)
  if (!entries) return []

  const found: string[] = []

  for (const entry of entries) {
    const full = path.join(dir, entry.name)

    if (entry.isDirectory() && !entry.isSymbolicLink())
      found.push(...(await filesUnder(full, depth - 1, extension, signal)))
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(extension))
      found.push(full)
  }

  return found
}

// ---------------------------------------------------------------------------
// Layer 3 — the registry
// ---------------------------------------------------------------------------

/**
 * Everywhere Windows records a program's location, asked through `reg.exe`.
 *
 * `reg.exe` rather than PowerShell because it is a plain native console
 * program: it starts in about fifteen milliseconds where PowerShell has to boot
 * the CLR and its own host first, which is a quarter of a second every time.
 *
 * The uninstall keys and App Paths are for installed programs, which FS Copilot
 * currently is not — they are here because they are nearly free and because the
 * day it ships an installer, this keeps working with no changes. MuiCache and
 * UserAssist are the ones that earn their place today: the shell writes to them
 * for anything the user has actually run, portable or not.
 */
const REGISTRY_QUERIES: Array<{ key: string; rot13: boolean }> = [
  ...[
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
    "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
    "HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\App Paths",
    "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths",
    "HKCU\\Software\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache",
  ].map((key) => ({ key, rot13: false })),

  // UserAssist records what the user has launched, with the paths ROT13'd —
  // an obfuscation, not encryption, but enough that a search for "copilot"
  // finds nothing and the whole key has to be read back and decoded.
  ...[
    "{CEBFF5CD-ACE2-4F4F-9178-9926F41749EA}",
    "{F4E57C4B-2036-45F0-A9AB-443BCFE33D9F}",
  ].map((guid) => ({
    key: `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\UserAssist\\${guid}\\Count`,
    rot13: true,
  })),
]

function rot13(text: string): string {
  return text.replace(/[a-zA-Z]/g, (character) => {
    const base = character <= "Z" ? 65 : 97
    return String.fromCharCode(
      ((character.charCodeAt(0) - base + 13) % 26) + base
    )
  })
}

async function fromRegistry(signal: AbortSignal): Promise<string[]> {
  if (process.platform !== "win32") return []

  const found: string[] = []

  for (const { key, rot13: encoded } of REGISTRY_QUERIES) {
    if (signal.aborted) return found

    // A ROT13 key cannot be filtered by `reg` and has to come back whole.
    const args = encoded
      ? ["query", key]
      : ["query", key, "/s", "/f", "*opilot*"]

    let stdout: string
    try {
      const result = await execFileAsync("reg.exe", args, {
        windowsHide: true,
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
        signal,
      })
      stdout = result.stdout
    } catch {
      // No matches is a non-zero exit, and a missing key is an error. Both are
      // ordinary answers here.
      continue
    }

    const text = encoded ? rot13(stdout) : stdout
    for (const candidate of pathsIn(text))
      if (FOLDER_NAME.test(path.basename(folderOf(candidate))) ||
          candidate.toLowerCase().endsWith(EXE_LOWER))
        found.push(candidate)
  }

  return found
}

// ---------------------------------------------------------------------------
// Layer 4 — the Windows Search index
// ---------------------------------------------------------------------------

/**
 * Asks the index Windows has already built, which is the closest thing to a
 * real filesystem search that does not need administrator rights.
 *
 * Everything-style tools read the NTFS master file table directly and are
 * instant and complete, but opening a raw volume handle requires elevation —
 * which is why they ask for it, and why this cannot.
 *
 * The index is not a guarantee: its default scope is the user profile and Start
 * Menu rather than whole drives, Windows 11's "Enhanced" mode covers the whole
 * PC, and the service can be turned off entirely. So it is a strong layer, not
 * the answer, and the folder walk still runs behind it.
 */
async function fromSearchIndex(signal: AbortSignal): Promise<string[]> {
  const script = [
    "$ErrorActionPreference='Stop'",
    "try {",
    "  $c = New-Object -ComObject ADODB.Connection",
    "  $c.Open(\"Provider=Search.CollatorDSO;Extended Properties='Application=Windows'\")",
    `  $r = $c.Execute("SELECT System.ItemPathDisplay FROM SystemIndex WHERE System.FileName='${EXE}'")`,
    "  while (-not $r.EOF) { $r.Fields.Item(0).Value; $r.MoveNext() }",
    "  $c.Close()",
    "} catch { }",
  ].join("; ")

  return pathsIn(await powershell(script, signal))
}

// ---------------------------------------------------------------------------
// Layer 5 — the folder walk
// ---------------------------------------------------------------------------

/** Anything a person would recognise as the FS Copilot folder. */
const FOLDER_NAME = /fs[ ._-]?copilot/i

/** Folders worth an extra level, because this is a flight sim tool. */
const SIM_NAME = /flight|msfs|simulator|fs20|^sim$/i

/**
 * Never descended into.
 *
 * `WindowsApps` throws on access, the recycle bin and volume-information
 * folders are noise, and `Windows` itself is a hundred thousand directories
 * that will never contain a third-party flight sim tool.
 *
 * Build folders are deliberately *not* here. `bin` and `obj` look like junk
 * right up until you meet somebody running a fork out of `~/dev/fscopilot/bin`,
 * which is exactly where a forked install lives.
 */
const SKIP = new Set([
  "$recycle.bin",
  "$windows.~bt",
  "$windows.~ws",
  ".git",
  "config.msi",
  "msocache",
  "node_modules",
  "perflogs",
  "recovery",
  "system volume information",
  "windows",
  "windowsapps",
])

/** How deep a bonus can push a branch, so `sim/sim/sim` cannot run away. */
const MAX_DEPTH = 6

export interface WalkRoot {
  dir: string
  depth: number
}

/**
 * The fixed disks, asked of Windows rather than guessed.
 *
 * Flight sim installs sprawl, and the second drive is where they sprawl to, so
 * a walk that only knows about `C:` misses a case closer to normal than to
 * unusual. Probing letters A through Z would find the same drives and would
 * also poke every empty optical and card reader on the machine, each of which
 * can take seconds to answer. `DriveType=3` asks for the disks already
 * spinning.
 */
async function fixedDrives(signal: AbortSignal): Promise<string[]> {
  const stdout = await powershell(
    "(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3').DeviceID",
    signal
  )

  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[a-zA-Z]:$/.test(line))
    .map((drive) => drive + path.sep)
}

/**
 * Where to walk, and how far down each one.
 *
 * Depth is per root rather than global because the roots are not alike. A drive
 * root holds a handful of top-level folders and one level is enough to spot
 * `D:\FsCopilot`; `~/dev` holds repositories whose interesting directory is
 * three levels in, past a checkout and a build folder.
 */
export function walkRoots(
  drives: string[],
  folders: DetectDeps["folders"]
): WalkRoot[] {
  const home = os.homedir()
  const system = `${process.env.SystemDrive ?? "C:"}${path.sep}`

  const roots: Array<{ dir: string | undefined; depth: number }> = []
  const add = (dir: string | undefined, depth: number) =>
    roots.push({ dir, depth })

  for (const drive of new Set([system, ...drives])) {
    add(drive, 1)
    for (const name of [
      "Games",
      "Program Files",
      "Program Files (x86)",
      "Apps",
      "Tools",
      "Portable",
      "Software",
    ])
      add(path.join(drive, name), 2)
  }

  add(home, 1)
  add(folders.downloads, 2)
  add(folders.desktop, 2)
  add(folders.documents, 2)
  add(process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Programs"), 2)
  add(process.env.LOCALAPPDATA, 1)
  add(process.env.APPDATA, 1)
  add(process.env.ProgramData, 1)
  add(process.env.PUBLIC, 1)

  // Where people keep things they build or unpack themselves, which is where a
  // fork or a hand-placed copy ends up.
  for (const name of [
    "dev",
    "tools",
    "software",
    "src",
    "projects",
    "repos",
    "code",
    "workspace",
  ])
    add(path.join(home, name), 3)

  // One entry per directory, at the deepest reach anything asked for.
  const deepest = new Map<string, WalkRoot>()
  for (const { dir, depth } of roots) {
    if (!dir) continue

    const key = dir.toLowerCase()
    const existing = deepest.get(key)
    if (!existing || existing.depth < depth) deepest.set(key, { dir, depth })
  }

  return [...deepest.values()]
}

async function readDir(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return null
  }
}

/**
 * Breadth-first so the shallow, likely hits surface first — someone watching
 * the list wants `D:\FsCopilot` before a fork buried three levels into a
 * checkout, and with results streaming out as they are found, the order they
 * are found in is the order they appear.
 *
 * A directory qualifies by holding the executable, not by being called the
 * right thing. The listing is already in hand for the recursion, so checking it
 * costs nothing — and it finds an install in a folder somebody renamed to `FSC`
 * or dropped into `sim tools`, which no amount of pattern-matching on folder
 * names ever will. The name is still worth something as a hint about where to
 * look *deeper*, which is what the bonus below is for.
 */
export async function walkFolders(
  roots: WalkRoot[],
  signal: AbortSignal,
  onFound: (resolved: Resolved) => void
): Promise<void> {
  /**
   * Where the walk has been, and how much budget it had left on arrival.
   *
   * The depth has to be part of this. `C:\Program Files` is reached twice —
   * once as a child of the `C:\` root with nothing left to spend, and once as a
   * root of its own with two levels to go — and a plain set of visited paths
   * lets the first arrival lock out the second. That silently reduces every
   * deep root to a single directory listing, which is exactly as broken as it
   * sounds and looks from the outside like a very fast search that finds
   * nothing.
   */
  const visited = new Map<string, number>()

  for (const root of roots) {
    if (signal.aborted) return

    const queue: WalkRoot[] = [{ dir: root.dir, depth: root.depth }]

    while (queue.length) {
      if (signal.aborted) return

      const { dir, depth } = queue.shift()!

      const key = dir.toLowerCase()
      const before = visited.get(key)
      if (before !== undefined && before >= depth) continue
      visited.set(key, depth)

      const entries = await readDir(dir)
      if (!entries) continue

      const hasExe = entries.some(
        (entry) => entry.isFile() && entry.name.toLowerCase() === EXE_LOWER
      )

      if (hasExe || FOLDER_NAME.test(path.basename(dir))) {
        const resolved = await resolveFolder(dir)
        if (resolved) onFound(resolved)
      }

      if (depth <= 0) continue

      for (const entry of entries) {
        // Junctions loop, and two of Windows' own — `Documents and Settings`,
        // `Application Data` — loop straight back into their own parent.
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue
        if (SKIP.has(entry.name.toLowerCase())) continue

        const bonus = SIM_NAME.test(entry.name) ? 1 : 0
        queue.push({
          dir: path.join(dir, entry.name),
          depth: Math.min(depth - 1 + bonus, MAX_DEPTH),
        })
      }
    }
  }
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

async function powershell(script: string, signal: AbortSignal): Promise<string> {
  if (process.platform !== "win32") return ""

  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, timeout: 20_000, maxBuffer: 4 * 1024 * 1024, signal }
    )
    return stdout
  } catch {
    return ""
  }
}

/**
 * Every FS Copilot this machine appears to have, reported as each is found.
 *
 * The layers run in order rather than together. It costs perhaps a second of
 * wall clock and buys the ordering: the layers are sequenced by how far they
 * can be trusted, so results arrive in that order too, and a list that only
 * ever appends is also a list sorted by confidence.
 *
 * The run used to narrate which layer it was on. The whole search turns out to
 * finish in about three seconds, which is too fast to read — the labels went by
 * in a blur that felt like something you were failing to keep up with, rather
 * than like progress. One steady message for the whole run says the same thing
 * and is legible.
 */
export async function detectWorkspaces(
  deps: DetectDeps,
  emit: (event: DetectResult) => void,
  signal: AbortSignal
): Promise<void> {
  const seen = new Set<string>()

  const offer = async (candidate: string, source: CandidateSource) => {
    const resolved = await resolveFolder(folderOf(candidate))
    if (!resolved) return

    const key = resolved.root.toLowerCase()
    if (seen.has(key)) return

    seen.add(key)
    emit({ kind: "found", candidate: { ...resolved, source } })
  }

  // Strongest evidence first, which is also the order results reach the list.
  const layers: Array<() => Promise<void>> = [
    async () => {
      for (const found of await fromProcess(signal)) await offer(found, "process")
    },
    async () => {
      for (const found of await fromShortcuts(deps, signal))
        await offer(found, "shortcut")
    },
    async () => {
      for (const found of await fromRegistry(signal))
        await offer(found, "registry")
    },
    async () => {
      for (const found of await fromSearchIndex(signal))
        await offer(found, "index")
    },
  ]

  try {
    for (const layer of layers) {
      if (signal.aborted) return
      await layer()
    }

    if (signal.aborted) return

    const drives = await fixedDrives(signal)

    // The walk has already resolved what it found, so it reports directly
    // rather than through `offer` — same dedupe, no second trip to disk.
    await walkFolders(
      walkRoots(drives, deps.folders),
      signal,
      (resolved) => {
        const key = resolved.root.toLowerCase()
        if (seen.has(key)) return

        seen.add(key)
        emit({ kind: "found", candidate: { ...resolved, source: "folder" } })
      }
    )
  } finally {
    emit({ kind: "done", stopped: signal.aborted })
  }
}
