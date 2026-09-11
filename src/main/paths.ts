import path from "node:path"

const YAML_EXTENSIONS = new Set([".yaml", ".yml"])

/**
 * Resolves a caller-supplied relative path inside `root`.
 *
 * Every path that reaches the filesystem goes through here. Once peer sync
 * lands, `relPath` will be attacker-controlled: it arrives over the network and
 * is written into another application's install directory.
 */
export function resolveInside(root: string, relPath: string): string {
  const full = resolveEntryInside(root, relPath)

  if (!YAML_EXTENSIONS.has(path.extname(full).toLowerCase()))
    throw new Error(`Only .yaml and .yml files are allowed: ${relPath}`)

  return full
}

/**
 * The containment half of `resolveInside`, for a path that is not a profile.
 *
 * Showing a module folder in Explorer is the one caller: a folder row has no
 * extension to pass the check above, and being a profile is not a property it
 * could have. Staying inside the workspace is what matters there, and it is
 * what this keeps.
 */
export function resolveEntryInside(root: string, relPath: string): string {
  if (typeof relPath !== "string" || relPath.trim() === "")
    throw new Error("Empty path")

  const normalized = relPath.replace(/\\/g, "/")

  if (path.isAbsolute(normalized) || /^[a-zA-Z]:/.test(normalized))
    throw new Error(`Absolute paths are not allowed: ${relPath}`)

  if (normalized.split("/").some((segment) => segment === ".."))
    throw new Error(`Path traversal is not allowed: ${relPath}`)

  const rootFull = path.resolve(root)
  const full = path.resolve(rootFull, normalized)

  if (full !== rootFull && !full.startsWith(rootFull + path.sep))
    throw new Error(`Path escapes the workspace: ${relPath}`)

  return full
}

/**
 * `resolveInside` as a question rather than an assertion.
 *
 * For paths arriving over the network in bulk — a manifest naming hundreds of
 * files — where one bad entry should be dropped rather than abandoning the
 * whole message. The rule stays in one place; only the reporting differs.
 */
export function isInside(root: string, relPath: string): boolean {
  try {
    resolveInside(root, relPath)
    return true
  } catch {
    return false
  }
}

export function isYaml(fileName: string): boolean {
  return YAML_EXTENSIONS.has(path.extname(fileName).toLowerCase())
}

/** Root-relative, forward-slashed path used as the identity of a file. */
export function toRelPath(root: string, full: string): string {
  return path.relative(root, full).replace(/\\/g, "/")
}
