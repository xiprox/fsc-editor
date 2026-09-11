/*
 * Keeps the package's version equal to the module's.
 *
 * There are two version numbers for one artifact, in two languages, and until
 * now nothing connected them:
 *
 *   k_version                     src/module.cpp        — sent on the wire
 *   <AssetPackage Version="…">    PackageDefinitions/   — becomes package_version
 *
 * Only the first has any reason to be maintained. It is in the handshake, so a
 * protocol change forces somebody to look at it; the XML is read by
 * fspackagetool and by nobody else, so it sat at the value it was created with
 * while the module went 0.1.0, 0.2.0, 0.3.0. By the time anyone noticed, the
 * same bytes were announcing themselves as 0.3.0 on the wire and 0.0.1 in
 * `manifest.json`.
 *
 * Nothing depends on either number today — install compares the module's bytes,
 * which is the only comparison that cannot be lied to. That is precisely why
 * this drifted for three releases without a symptom, and why it is worth
 * closing now rather than after something does depend on it.
 *
 * Two modes, both called by `build.sh`:
 *
 *   sync            before packaging — rewrite the XML from `k_version`
 *   check <pkg>     after packaging  — assert the manifest came out right
 *
 * `check` is not redundant. `sync` proves what we asked for; `check` proves
 * what fspackagetool did, and this build has already been surprised once by a
 * tool silently not writing a file it was expected to write (see layout.mjs).
 */
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// `fileURLToPath`, not the URL's `pathname`, which on Windows is
// `/C:/Users/...` and has to be de-slashed by hand to be a path at all.
const HERE = path.dirname(fileURLToPath(import.meta.url))
const MODULE = path.join(HERE, "..", "src", "module.cpp")
const DEFINITION = path.join(HERE, "..", "PackageDefinitions", "fsc-editor-link.xml")

/**
 * The version the module announces.
 *
 * A miss throws rather than defaulting. Every failure mode this script could
 * have ends in "the versions silently disagree again", which is the thing it
 * exists to prevent, so it says so loudly instead.
 */
function moduleVersion() {
  const source = fs.readFileSync(MODULE, "utf8")
  const found = /\bk_version\b\s*=\s*"([^"]+)"/.exec(source)

  if (!found) throw new Error(`no k_version in ${MODULE}`)
  return found[1]
}

function sync() {
  const version = moduleVersion()
  const xml = fs.readFileSync(DEFINITION, "utf8")

  // The attribute rather than the whole tag, so an AssetPackage that grows
  // another attribute later does not quietly stop matching.
  const attribute = /(<AssetPackage\b[^>]*\bVersion=")([^"]*)(")/
  const found = attribute.exec(xml)
  if (!found) throw new Error(`no AssetPackage Version in ${DEFINITION}`)

  if (found[2] === version) {
    console.log(`  version ${version} — package definition already agrees`)
    return
  }

  // Written only when it differs: an unchanged file keeps its mtime, and a
  // rebuild that changed nothing leaves nothing in `git status` to explain.
  fs.writeFileSync(DEFINITION, xml.replace(attribute, `$1${version}$3`))
  console.log(`  version ${found[2]} -> ${version} in the package definition`)
}

function check(pkg) {
  const version = moduleVersion()
  const file = path.join(pkg, "manifest.json")

  if (!fs.existsSync(file)) throw new Error(`no manifest.json in ${pkg}`)

  const manifest = JSON.parse(fs.readFileSync(file, "utf8"))
  if (manifest.package_version !== version) {
    throw new Error(
      `manifest.json says ${manifest.package_version}, the module says ${version}`
    )
  }

  console.log(`  manifest.json and the module both say ${version}`)
}

const mode = process.argv[2]

try {
  if (mode === "sync") sync()
  else if (mode === "check") check(process.argv[3])
  else {
    console.error("usage: version.mjs sync | version.mjs check <package>")
    process.exit(2)
  }
} catch (error) {
  console.error(`  ${error.message}`)
  process.exit(1)
}
