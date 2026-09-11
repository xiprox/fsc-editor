/**
 * Taking the person out of the report.
 *
 * The app handles exactly one piece of personal data, and it is not stored
 * anywhere on purpose: the Windows username, which sits inside almost every
 * absolute path the app touches. `settings.json` keeps a workspace root, the
 * log names files it saved, the Activity dump names the capture beside it, and
 * every one of those reads `C:\Users\<somebody>\…`.
 *
 * ## Two passes, because two different things leak
 *
 * **Structure** is what has to be dealt with before serialization. A Remote
 * Connect `file` event carries the entire text of a peer's profile, and no
 * amount of pattern matching over the finished JSON turns that back into
 * something sendable. Content is dropped and replaced by its length.
 *
 * **Text** is everything else. Paths become tokens, once, over the finished
 * bytes of each file. Doing it there rather than at every producer is the whole
 * argument: there is one function to audit and one place a new collector can
 * forget nothing, because it does not get a say.
 *
 * ## Why the path matching looks the way it does
 *
 * A Windows path reaches this in at least three forms — `C:\Users\a\b` as it
 * came from `app.getPath`, `C:\\Users\\a\\b` once JSON has escaped it, and
 * `C:/Users/a/b` from anything that normalized. Matching the literal string
 * would catch the first and miss the two that actually appear in a file. So a
 * root is split into segments and rejoined with a separator class, which
 * matches all three and does not care how many backslashes are in the way.
 */

import { CODE_GROUP, CODE_LENGTH } from "@shared/remote-connect"

/** What a redacted root is called in the output. */
export type RootToken = "home" | "userData" | "workspace" | "community"

/** The real directories, as the app knows them. Any may be unknown. */
export type Roots = Partial<Record<RootToken, string | null>>

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * A root as a pattern that survives escaping and separator style.
 *
 * Case-insensitive because Windows is: the same folder arrives as `C:\Users`
 * from one API and `C:\users` from another, and a report that redacts one of
 * them is a report that leaks the other.
 */
function pattern(root: string): RegExp {
  const parts = root
    .split(/[\\/]+/)
    .filter(Boolean)
    .map(escape)
  return new RegExp(parts.join("[\\\\/]+"), "gi")
}

/**
 * The username, wherever it appears on its own.
 *
 * Applied last and only to a name long enough to be one. Two characters is a
 * substring of ordinary English and of half the variable names in a capture;
 * replacing that would corrupt evidence to protect nothing, because a
 * two-character username has already been caught by the path rules above.
 */
function username(name: string): RegExp | null {
  return name.length >= 3 ? new RegExp(`\\b${escape(name)}\\b`, "gi") : null
}

/**
 * Replaces every known root with its token, then anything still shaped like a
 * user profile directory.
 *
 * The backstop matters more than the named roots: it catches the path this app
 * never asked for and got anyway — a Community folder on another drive, a
 * OneDrive-redirected Documents, a `.lnk` target read out of a shortcut.
 */
export function redactText(text: string, roots: Roots, user?: string): string {
  let out = text

  // Longest first, so a workspace inside the home directory is named as the
  // workspace rather than reduced to `<home>\Definitions`.
  const ordered = (Object.entries(roots) as [RootToken, string | null][])
    .filter((entry): entry is [RootToken, string] => Boolean(entry[1]))
    .sort(([, a], [, b]) => b.length - a.length)

  for (const [token, root] of ordered)
    out = out.replace(pattern(root), `<${token}>`)

  // Whatever is left that looks like a profile directory: the segment after
  // `Users` is a username by definition, on every Windows install.
  out = out.replace(
    /([A-Za-z]:[\\/]+Users[\\/]+)([^\\/"\s]+)/gi,
    (_match, head: string) => `${head}<user>`
  )

  const bare = user ? username(user) : null
  if (bare) out = out.replace(bare, "<user>")

  return out
}

/** `K7RM2Q` → `XXX-XXX`. The shape says a code was there; nothing else does. */
const CODE_SHAPE = `${"X".repeat(CODE_GROUP)}-${"X".repeat(CODE_LENGTH - CODE_GROUP)}`

/** Keys whose value is a secret whatever it looks like. */
const SECRET_KEYS = new Set(["code", "resume"])

/**
 * Bounded because a detail object is whatever a producer handed the logger, and
 * a recursive walk over an unbounded structure is a way to hang the report on a
 * shape nobody predicted. Nothing in the app nests remotely this far.
 */
const MAX_DEPTH = 12

/**
 * Removes what cannot be tokenized: peer file contents, and session codes.
 *
 * Walks anything, because it is applied to log details and a log detail is by
 * construction "the object the producer had". Arrays and plain objects are
 * rebuilt; everything else is passed through, which includes the numbers and
 * strings that are most of a capture and none of the risk.
 */
export function scrub(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return "<deep>"
  if (Array.isArray(value)) return value.map((one) => scrub(one, depth + 1))
  if (value === null || typeof value !== "object") return value

  const source = value as Record<string, unknown>
  const out: Record<string, unknown> = {}

  for (const [key, one] of Object.entries(source)) {
    /*
     * The one that would actually hurt. A host's profile is their work, it
     * arrives here in full because that is what sharing a file means, and it
     * has no diagnostic value whatsoever — whether the transfer worked is
     * answered by the length.
     */
    if (key === "content" && typeof one === "string") {
      out.contentBytes = Buffer.byteLength(one)
      continue
    }

    if (SECRET_KEYS.has(key) && typeof one === "string") {
      out[key] = key === "code" ? CODE_SHAPE : "<redacted>"
      continue
    }

    out[key] = scrub(one, depth + 1)
  }

  return out
}
