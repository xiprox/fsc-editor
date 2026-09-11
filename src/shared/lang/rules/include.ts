/**
 * `include-missing` — an `include:` naming a file the workspace does not
 * have.
 *
 * The block itself is optional and most profiles have none; an absent
 * `include:` is never a finding. This is only about a target that will not
 * resolve, and FS Copilot is silent when one does not: `LoadModule` catches
 * `FileNotFoundException` and logs at information level, `TryLoadTree`
 * returns false, and `Collect` skips the child. The include simply does
 * nothing, and every entry the author expected from it is absent — which
 * looks exactly like a profile that never covered those controls.
 *
 * Paths resolve from the **Definitions root**, not from the including file:
 * `Path.Combine([AppContext.BaseDirectory, "Definitions", ..path.Split('/')])`.
 * So the workspace listing is directly comparable, and comparison is
 * case-insensitive because the filesystem underneath is.
 *
 * ## The nearest match, which is safe here and was not before
 *
 * 18-language-core struck nearest-match suggestions for unknown *variable*
 * names: they cluster in numbered families, so edit distance confidently
 * proposes a sibling that is not what the author meant. A filename against a
 * directory listing has no such trap — the candidate set is small, closed,
 * and sitting on disk next to the typo. The corpus's one real instance is
 * `bksq-aircraft-tbm850.yaml` including `modules/paload.yaml` while
 * `modules/payload.yaml` sits beside it. The one-candidate-only policy lives
 * in `nearest`; here it is applied to the files of the target's own
 * directory, so an ambiguous neighbourhood produces the diagnostic and no
 * fix.
 *
 * Evidence-gated: no listing means silence, not a guess.
 */

import { distance } from "../nearest.ts"
import type { ProfileDiagnostic, ProfileRule } from "../profile.ts"
import { diagnose } from "../rules.ts"

/** Everything up to the last slash, "" at the top level. */
function directoryOf(path: string): string {
  const at = path.lastIndexOf("/")
  return at === -1 ? "" : path.slice(0, at + 1)
}

export const includeMissing: ProfileRule = {
  id: "include-missing",
  family: "dialect",
  run({ includes }, context): ProfileDiagnostic[] {
    if (!includes.length) return []

    const files = context.workspaceFiles?.()
    if (!files) return []

    const present = new Set(files.map((file) => file.toLowerCase()))

    const out: ProfileDiagnostic[] = []
    for (const item of includes) {
      const target = item.text.trim()
      if (!target || present.has(target.toLowerCase())) continue

      const directory = directoryOf(target).toLowerCase()
      const near = files.filter(
        (file) =>
          directoryOf(file).toLowerCase() === directory &&
          distance(file.toLowerCase(), target.toLowerCase(), 2) <= 2
      )

      const base = item.text.indexOf(target)
      const suggestion = near.length === 1 ? near[0]! : null

      out.push(
        diagnose({
          ruleId: "include-missing",
          line: item.line,
          severity: "warning",
          confidence: "certain",
          basis: "source",
          why: ["include-missing-skipped"],
          start: base,
          end: base + target.length,
          verdict: `${target} was not found in the workspace.`,
          consequence:
            "FS Copilot will skip it without an error, and none of its " +
            "entries will sync.",
          ...(suggestion
            ? {
                fix: {
                  title: `Change to ${suggestion}`,
                  edits: [
                    {
                      start: base,
                      end: base + target.length,
                      newText: suggestion,
                    },
                  ],
                },
              }
            : {}),
        })
      )
    }

    return out
  },
}
