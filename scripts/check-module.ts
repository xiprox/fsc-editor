/**
 * Checks that the committed Link package matches the source beside it.
 *
 * The module cannot be built by CI — `fspackagetool` drives the game executable
 * and the MSFS SDK has no unattended install — so `link/Packages/` is committed,
 * and the relationship between that binary and `link/src/module.cpp` is
 * otherwise a matter of trust. These three guards replace the trust with a
 * check. All of them read only this repository, so they run in the ordinary PR
 * job rather than a workflow of their own.
 *
 *   1. Protocol   `LINK_PROTOCOL` (the app) equals `k_protocol` (the module).
 *   2. Version    `k_version` (the module) equals `package_version` (the
 *                 committed manifest).
 *   3. Freshness  the committed source hashes to what `build.sh` recorded when
 *                 it last produced the package.
 *
 * The first is the one that bites. The app negotiates — it reports `outdated`
 * when the module's protocol is below `LINK_PROTOCOL`, and gates features on
 * their own thresholds — so raising `LINK_PROTOCOL` while the committed wasm
 * still announces the old number is a change that typechecks, passes every
 * test, and degrades silently in the simulator. That is the failure mode
 * `link/build.sh` was written to eliminate on the other side of the boundary.
 *
 * A failure here means somebody with MSFS and the SDK has to run
 * `npm run link:build` and commit the result. There is no other remedy, and
 * saying so plainly is better than a merge that ships a binary which does not
 * match its source.
 *
 * Usage: npm run check:module
 *        npm run check:module -- --hash     print the source hash and exit
 *
 * The second form is what `link/build.sh` calls to record the hash, so that the
 * number this compares against is written by the build rather than by a person
 * who has to remember.
 *
 * See docs/pipeline/08-module.md.
 */

import { createHash } from "node:crypto"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dirname, "..")

/**
 * The inputs that decide the module's bytes.
 *
 * `build.sh` itself is deliberately absent. It changes for reasons that have
 * nothing to do with the compiled output — which shell it insists on, how it
 * finds a Community folder — and a false positive here costs a maintainer a
 * full SDK rebuild. The four files below are the ones whose contents reach the
 * compiler or the packager.
 */
const SOURCES = [
  "link/src/module.cpp",
  "link/fsc-editor-link.vcxproj",
  "link/link.xml",
  "link/PackageDefinitions/fsc-editor-link.xml",
]

const HASH_FILE = "link/Packages/source.sha256"
const MANIFEST = "link/Packages/fsc-editor-link/manifest.json"
const MODULE_CPP = "link/src/module.cpp"
const APP_LINK = "src/shared/link.ts"

const problems: string[] = []

function read(relative: string): string | null {
  const path = join(root, relative)
  return existsSync(path) ? readFileSync(path, "utf8") : null
}

/** The hash `build.sh` records, and that this recomputes. */
function sourceHash(): string {
  const hash = createHash("sha256")

  for (const relative of SOURCES) {
    const text = read(relative)
    if (text === null) {
      problems.push(`${relative} is missing — cannot hash the module's source.`)
      continue
    }

    // Newline-normalized, so that a checkout on a runner and a checkout on a
    // maintainer's machine agree. The compiler does not care and git might.
    hash.update(relative)
    hash.update(text.replace(/\r\n/g, "\n"))
  }

  return hash.digest("hex")
}

// `--hash` is the build's entry point: print what should be recorded, and say
// nothing else, so `build.sh` can redirect it straight into the file.
if (process.argv.includes("--hash")) {
  const hash = sourceHash()
  if (problems.length > 0) {
    console.error(problems.join("\n"))
    process.exit(1)
  }

  console.log(hash)
  process.exit(0)
}

function one(text: string | null, pattern: RegExp, what: string): string | null {
  if (text === null) return null

  const match = pattern.exec(text)
  if (!match?.[1]) {
    problems.push(`Could not read ${what}. The guard needs updating, not the code.`)
    return null
  }

  return match[1]
}

// 1 — protocol
const appProtocol = one(
  read(APP_LINK),
  /export const LINK_PROTOCOL\s*=\s*(\d+)/,
  `LINK_PROTOCOL from ${APP_LINK}`
)
const modProtocol = one(
  read(MODULE_CPP),
  /constexpr\s+int\s+k_protocol\s*=\s*(\d+)/,
  `k_protocol from ${MODULE_CPP}`
)

if (appProtocol && modProtocol && appProtocol !== modProtocol) {
  problems.push(
    `Protocol mismatch: the app speaks ${appProtocol}, the committed module speaks ${modProtocol}.\n` +
      `    The module has to be rebuilt and committed — npm run link:build.`
  )
}

// 2 — version
const modVersion = one(
  read(MODULE_CPP),
  /constexpr\s+auto\s+k_version\s*=\s*"([^"]+)"/,
  `k_version from ${MODULE_CPP}`
)
const manifest = read(MANIFEST)
let pkgVersion: string | null = null

if (manifest === null) {
  problems.push(`${MANIFEST} is missing — there is no committed package to check.`)
} else {
  try {
    const parsed: unknown = JSON.parse(manifest)
    const field =
      typeof parsed === "object" && parsed !== null
        ? (parsed as { package_version?: unknown }).package_version
        : null

    if (typeof field === "string") pkgVersion = field
    else problems.push(`${MANIFEST} has no package_version.`)
  } catch {
    problems.push(`${MANIFEST} is not valid JSON.`)
  }
}

if (modVersion && pkgVersion && modVersion !== pkgVersion) {
  problems.push(
    `Version mismatch: k_version is ${modVersion}, the committed manifest says ${pkgVersion}.\n` +
      `    build.sh syncs these; the package predates the source.`
  )
}

// 3 — freshness
const recorded = read(HASH_FILE)?.trim() ?? null
const actual = sourceHash()

if (recorded === null) {
  problems.push(
    `${HASH_FILE} is missing. It is written by link/build.sh — rebuild the module once to create it.`
  )
} else if (recorded !== actual) {
  problems.push(
    `The committed module was built from different source.\n` +
      `    recorded ${recorded}\n` +
      `    now      ${actual}\n` +
      `    Run npm run link:build and commit link/Packages/.`
  )
}

if (problems.length === 0) {
  console.log(
    `Module guards pass — protocol ${appProtocol}, version ${modVersion}, source ${actual.slice(0, 12)}.`
  )
  process.exit(0)
}

console.error("Module guards failed:\n")
for (const problem of problems) console.error(`  - ${problem}`)
console.error("")
process.exit(1)
