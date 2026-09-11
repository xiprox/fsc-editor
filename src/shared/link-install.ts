/**
 * Getting the Link module into a Community folder.
 *
 * Deliberately not in [`link.ts`](link.ts). That file is the wire, and its one
 * invariant is that it agrees byte for byte with `link/src/module.cpp` —
 * "change one, change the other". Nothing here is on the wire: this is the
 * filesystem, it runs before the module exists, and folding it in would blunt
 * an invariant that is currently literal.
 *
 * No runtime imports: main parses, the renderer renders, and this is what they
 * agree on.
 */

/**
 * How a Community folder was arrived at, strongest first.
 *
 * Shown to the user, for the same reason `CandidateSource` is in
 * [`types.ts`](types.ts): somebody choosing between two folders deserves to
 * know which one the simulator's own config named and which one is a guess.
 */
export type CommunitySource = "config" | "guess" | "chosen"

/** What is sitting in a Community folder under our package name. */
export interface InstalledPackage {
  /**
   * `package_version` from `manifest.json`, or null when it could not be read.
   *
   * Null is not a fault: a half-copied folder, a package from a much older
   * build, or a junction pointing at nothing all land here, and all of them
   * are things a reinstall fixes.
   */
  version: string | null
  /**
   * How the installed module compares with the one this app ships.
   *
   * Compared by content rather than by version string, because the two
   * versions in this project do not agree and never will on their own: the
   * manifest's `package_version` comes from `PackageDefinitions`, and the
   * `k_version` the module reports on the wire is a constant in the C++. A
   * hash cannot be forgotten during a release the way a number can.
   *
   * **`unknown` is not `different`.** A build with no package to compare
   * against knows nothing about what is installed, and an early version of this
   * collapsed the two into a boolean — which put a "needs updating" badge on a
   * perfectly good install, on no evidence at all. Telling somebody their
   * software is stale is a claim, and it needs a reason.
   */
  current: "same" | "different" | "unknown"
  /**
   * The entry is a junction or symlink, not a real folder.
   *
   * AddonLinker and junction farms are normal in this folder — this machine's
   * Community has two — and it changes what uninstall must do. Removing a
   * junction recursively would delete whatever it points at, which is
   * somebody's actual package living somewhere else.
   */
  linked: boolean
}

/** One place the module could be installed. */
export interface CommunityFolder {
  path: string
  source: CommunitySource
  /**
   * Which simulator's config named this folder, e.g. `Microsoft Flight
   * Simulator 2024`. A user with 2020 and 2024 side by side sees two
   * `Community` folders whose paths differ only deep in the middle.
   */
  sim: string
  /** What is installed here now, or null. */
  installed: InstalledPackage | null
}

/** What the install dialog needs to know before it can offer anything. */
export interface LinkInstallState {
  /** Community folders found, best first. Empty means discovery came up dry. */
  folders: CommunityFolder[]
  /**
   * The package this app ships, or null when there is not one.
   *
   * Null in a checkout that has never run `npm run link:build`, which is a
   * state worth rendering rather than crashing on — the rest of the app works
   * fine without a module, and a developer should be told why the button is
   * disabled rather than left guessing.
   */
  shipped: { version: string | null; bytes: number } | null
}

export type LinkInstallResult =
  | {
      ok: true
      path: string
      /** What was written, relative to the package root. For "reports what it wrote". */
      files: string[]
      bytes: number
      /** Something was already there and has been replaced. */
      replaced: boolean
    }
  | { ok: false; reason: string }

export type LinkUninstallResult =
  | { ok: true; path: string }
  | { ok: false; reason: string }

/** The folder name the package installs under, in Community and in resources. */
export const LINK_PACKAGE = "fsc-editor-link"

/**
 * Pulls `InstalledPackagesPath` out of a `UserCfg.opt`.
 *
 * The file is a flat list of `Key "value"` and `Key value` lines. Only this one
 * key is wanted, and 04-connection is emphatic about why it is read at all
 * rather than guessed: it is authoritative across MS Store, Steam, 2020, 2024
 * and relocated installs, and every one of those puts `Packages` somewhere
 * different.
 *
 * Returns null rather than throwing. A config file that has been hand-edited,
 * truncated by a crash, or written by a version that renamed the key is a
 * reason to fall back to the guess, not to fail.
 */
export function parseInstalledPackagesPath(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*InstalledPackagesPath\s+(.*)$/i.exec(line)
    if (!match) continue

    const rest = match[1]!.trim()
    // Quoted is the only form seen in the wild, but the file's other keys use
    // both and there is no reason to be the one reader that cannot cope.
    const quoted = /^"([^"]*)"/.exec(rest)
    const value = (quoted ? quoted[1]! : rest).trim()

    if (value) return value
  }

  return null
}

/**
 * The two folder names a `Packages` directory can offer.
 *
 * Both are candidates and a user may have either or both — this machine has
 * both, with content in each. Which one MSFS 2024 actually reads is not a
 * question this app should be answering on the user's behalf, so both are
 * offered and the one already holding the module sorts first.
 */
export const COMMUNITY_DIRS = ["Community", "Community2024"] as const
