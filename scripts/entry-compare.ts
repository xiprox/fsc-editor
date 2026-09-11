/**
 * Comparison helper shared by the verification passes in `check-format` and
 * `merge-profile`.
 *
 * Both scripts answer the same question: did a rewrite change what the profile
 * does? Neither can compare parsed entries verbatim, because the formatter
 * re-cases a `get:` entry's unit on save. That rewrite is case-only, and
 * SimConnect matches unit names case-insensitively, so it cannot change which
 * unit is resolved — but it does change the string.
 *
 * Folding the unit field to lowercase on both sides normalizes exactly that
 * one difference away. Anything else — an entry moving, vanishing, a variable
 * or `set:` changing, or a unit differing by more than case, such as `ft` for
 * `Feet` — still compares unequal, which is what these checks exist to catch.
 */

/**
 * Only the second comma-separated field is folded, matching FS Copilot, which
 * reads `parts[1]` and discards anything after it.
 */
export function normalizeUnits(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeUnits)
  if (!value || typeof value !== "object") return value

  const entry = { ...(value as Record<string, unknown>) }
  if (typeof entry.get === "string") {
    const fields = entry.get.split(",")
    if (fields.length > 1) {
      fields[1] = fields[1].toLowerCase()
      entry.get = fields.join(",")
    }
  }

  for (const [key, nested] of Object.entries(entry))
    if (typeof nested === "object") entry[key] = normalizeUnits(nested)

  return entry
}

/** True when two entry lists are the same entries, in the same order. */
export function sameEntries(before: unknown, after: unknown): boolean {
  return (
    JSON.stringify(normalizeUnits(before)) ===
    JSON.stringify(normalizeUnits(after))
  )
}
