/**
 * `block-unknown` and `ignore-duplicate` — the two top-level list rules.
 *
 * Zero corpus hits between them, which is the point of writing them: a rule
 * that only appears after somebody's file breaks in the wild is a rule that
 * arrived too late to help them.
 *
 * ## Why an unknown block key is the most expensive mistake in the format
 *
 * It looks like the cheapest. It is not. FS Copilot builds its YAML reader
 * with `.IgnoreUnmatchedProperties()` **commented out** (Definitions.cs, the
 * `DeserializerBuilder` at the top), so YamlDotNet throws on a key that does
 * not map to a `Config` property. `TryLoadTree` catches the exception, logs
 * one information-level line, sets `node = DefinitionNode.Empty` and returns
 * false — and `Load` hands back a definitions set with **no entries at all**.
 *
 * So `sharde:` does not disable a block. It disables the profile: every
 * entry in the file, plus everything the file includes, and the only symptom
 * is that nothing syncs. Error, and the one with the widest blast radius in
 * the whole rule set.
 *
 * The keys are a closed vocabulary, so a suggestion is safe here in the
 * way it is not for variable names — see `nearest`.
 *
 * ## Why a duplicate `ignore:` is not
 *
 * `Coordinator._ignore` is a `HashSet<string>` and `Load` does
 * `foreach (var i in definitions.Ignore) _ignore.Add(i)`, so adding a name
 * twice is a no-op. Nothing breaks and nothing changes. It is worth saying
 * once, at info, because a repeat is usually a leftover from an edit — and
 * it is worth saying honestly, which means saying it costs nothing.
 */

import { nearest } from "../nearest.ts"
import type { ProfileDiagnostic, ProfileRule } from "../profile.ts"
import { diagnose } from "../rules.ts"

/**
 * The suggestion vocabulary. Detection does *not* use this — it reads the
 * `known` flag the grammar already computed, so the two cannot drift on the
 * question that matters. `BLOCKS` in profile/grammar.ts is the authority;
 * this list exists because `lang/` does not import the file format.
 */
const KEYS = ["shared", "master", "include", "ignore", "pointer"]

export const blockUnknown: ProfileRule = {
  id: "block-unknown",
  family: "dialect",
  run({ blocks }): ProfileDiagnostic[] {
    const out: ProfileDiagnostic[] = []

    for (const block of blocks) {
      if (block.known) continue

      const suggestion = nearest(block.text, KEYS)

      out.push(
        diagnose({
          ruleId: "block-unknown",
          line: block.line,
          severity: "error",
          confidence: "certain",
          basis: "source",
          why: ["unknown-key-fails-load"],
          start: 0,
          end: block.text.length,
          verdict: `${block.text}: is not a block FS Copilot knows.`,
          // Not this block — the file. That is the whole reason this is the
          // widest error in the rule set, so it is the one thing said.
          consequence:
            "This whole file will fail to load — none of its entries will " +
            "sync, and nothing it includes will either.",
          // With a suggestion the fix says what to do. Without one the
          // reader needs the vocabulary, since nothing else will supply it.
          ...(suggestion
            ? {
                fix: {
                  title: `Change to ${suggestion}:`,
                  edits: [
                    { start: 0, end: block.text.length, newText: suggestion },
                  ],
                },
              }
            : {
                remedy:
                  "The blocks are shared:, master:, include:, ignore: and " +
                  "pointer:.",
              }),
        })
      )
    }

    return out
  },
}

export const ignoreDuplicate: ProfileRule = {
  id: "ignore-duplicate",
  family: "dialect",
  run({ ignores }): ProfileDiagnostic[] {
    const first = new Map<string, number>()
    const out: ProfileDiagnostic[] = []

    for (const item of ignores) {
      // FS Copilot trims each name (`Select(i => i.Trim())`) and drops the
      // blank ones, so those are what a repeat is measured between.
      const name = item.text.trim()
      if (!name) continue

      const seen = first.get(name)
      if (seen === undefined) {
        first.set(name, item.line)
        continue
      }

      out.push(
        diagnose({
          ruleId: "ignore-duplicate",
          line: item.line,
          severity: "info",
          confidence: "certain",
          basis: "source",
          why: ["ignore-is-a-set"],
          start: 0,
          end: item.text.length,
          verdict: `${name} is already ignored, at line ${seen}.`,
          consequence: "The repeat changes nothing.",
        })
      )
    }

    return out
  },
}
