/**
 * `get-no-prefix` — a `get:` name with no namespace prefix.
 *
 * FS Copilot routes a `get:` by its first two characters. `L:`, `A:`, `H:`
 * and `K:` each have their own path, and **any** other letter followed by a
 * colon goes to the sim module as a client variable — which is why this rule
 * asks about the shape of the name, not about a list of known letters. A name
 * with no colon at the second character matches nothing: the stream falls
 * through to `Observable.Empty` and a write matches no branch either.
 *
 * So the entry is inert in both directions. Nothing is read, nothing is sent,
 * nothing is applied — and, because FS Copilot loads the file happily, it
 * looks exactly like an entry that works. Seventeen corpus lines are dead
 * this way: `var_HornTest`, `NAV ACTIVE FREQUENCY:2`, `ELT ACTIVATED, Bool`,
 * and `LXPDR_CLR`, plainly a typo for `L:XPDR_CLR`.
 *
 * Error, and certain: it is read from the source line by line, and there is
 * no reading of an unprefixed name on which the entry does something.
 *
 * ## The fix is offered only when it is not a guess
 *
 * `A:` is the right prefix for most of the dead lines, but "most" is not what
 * a one-click fix should rest on — `LXPDR_CLR` wants `L:` and a missing
 * character, not a prefix. So the fix appears only when the catalogue
 * recognises the name as a simulation variable, which `simVarSettable`
 * answers with a boolean rather than null. Everywhere else the verdict stands
 * on its own and the author picks the namespace, which is the one thing they
 * know and we do not.
 */

import type { EntryDiagnostic, EntryRule } from "../entry.ts"
import { diagnose } from "../rules.ts"

/** `NAV ACTIVE FREQUENCY:2` → `NAV ACTIVE FREQUENCY`, the catalogue's key. */
function withoutIndex(name: string): string {
  return name.replace(/:\d+$/, "")
}

export const getNoPrefix: EntryRule = {
  id: "get-no-prefix",
  family: "sim",
  run(entry, context): EntryDiagnostic[] {
    const name = entry.name.trim()
    if (!name) return []

    // The same test FS Copilot makes: a single letter, a colon, something
    // after it. Anything else — including an unknown letter — is prefixed as
    // far as the routing is concerned and is not this rule's business.
    if (/^[A-Za-z]:.+$/.test(name)) return []

    // The name's offsets inside the `get:` value, which is `NAME[, units]`.
    const start = entry.get.indexOf(name)
    if (start === -1) return []

    const settable = context.simVarSettable?.(withoutIndex(name))
    const fix =
      settable === null || settable === undefined
        ? undefined
        : {
            title: `Change to A:${name}`,
            edits: [{ start, end: start, newText: "A:" }],
          }

    return [
      diagnose({
        ruleId: "get-no-prefix",
        target: "get" as const,
        severity: "error",
        confidence: "certain",
        basis: "source",
        why: ["bare-name-not-streamed"],
        start,
        end: start + name.length,
        verdict: "This name has no namespace prefix.",
        consequence:
          "The entry will do nothing — the value is never read, sent or " +
          "applied, and FS Copilot will load the profile without complaint.",
        remedy: fix
          ? undefined
          : "Prefixes are a letter and a colon: A:, L:, K:, B:, H:.",
        fix,
      }),
    ]
  },
}
