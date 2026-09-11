/**
 * `key-unknown` — a `key: value` whose key is not one the format defines.
 *
 * The sibling of `block-unknown`, and it costs exactly the same thing, for
 * exactly the same reason: FS Copilot builds **one** deserializer for the
 * whole document with `.IgnoreUnmatchedProperties()` commented out
 * (Definitions.cs), so an unmatched property on an entry throws just as one
 * on the document does. `TryLoadTree` catches it, logs a line, and hands back
 * an empty definitions set. `sett:` does not disable a setter — it disables
 * the profile, and everything the profile includes.
 *
 * Why this is a rule and not a schema: it used to be neither. monaco-yaml's
 * `additionalProperties: false` was supposed to catch it and never did — the
 * worker has not started since monaco-editor 0.53 — so a probe with `sett:`
 * in an entry drew no squiggle of any kind. This is the same verdict said by
 * something that runs.
 *
 * Two vocabularies, one rule. Inside an entry the keys are `get:`, `set:` and
 * `skp:`; at the top level they are the five blocks. Both are closed, so a
 * suggestion is safe here in the way it is not for a variable name.
 */

import { nearest } from "../nearest.ts"
import type { ProfileDiagnostic, ProfileRule } from "../profile.ts"
import { diagnose } from "../rules.ts"

/**
 * The suggestion vocabularies. As in `block-unknown`, detection does not use
 * these — the view has already decided the key is not one of them — so the
 * two cannot drift on the question that matters.
 */
const ENTRY_KEYS = ["get", "set", "skp"]
const BLOCK_KEYS = ["shared", "master", "include", "ignore", "pointer"]

export const keyUnknown: ProfileRule = {
  id: "key-unknown",
  family: "dialect",
  run({ mappings }): ProfileDiagnostic[] {
    const out: ProfileDiagnostic[] = []

    for (const mapping of mappings) {
      const vocabulary = mapping.inEntry ? ENTRY_KEYS : BLOCK_KEYS

      /*
       * A name the format *does* define is not this rule's finding, whatever
       * line kind it arrived as. Written as a guard rather than assumed,
       * because the first corpus sweep proved the assumption wrong: two
       * modules open with a UTF-8 BOM, which leaves `shared:` classified as
       * a mapping rather than a block key, and the rule called a real block
       * key unknown. `shared: x` — the right name carrying the wrong shape —
       * is a genuine error and still not this one; it wants a rule about
       * shape, which does not exist yet.
       */
      if (vocabulary.includes(mapping.text)) continue

      /*
       * One edit inside an entry, `nearest`'s default of two at the top
       * level — which is the same budget `block-unknown` uses, so the
       * siblings agree wherever they overlap.
       *
       * Not a tweak to get a nicer answer out of one example: two edits on a
       * three-letter key is two-thirds of the word, and it shows. `sett`
       * reaches both `set` (1) and `get` (2), so the tie rule correctly
       * refuses to choose between them and the most obvious typo in the
       * format ships without a fix. At one edit the neighbourhood is
       * genuinely unambiguous.
       */
      const suggestion = nearest(
        mapping.text,
        vocabulary,
        mapping.inEntry ? 1 : 2
      )

      out.push(
        diagnose({
          ruleId: "key-unknown",
          line: mapping.line,
          severity: "error",
          confidence: "certain",
          basis: "source",
          why: ["unknown-key-fails-load"],
          start: 0,
          end: mapping.text.length,
          verdict: `${mapping.text}: is not a key FS Copilot knows.`,
          // The same consequence as block-unknown, and for the same reason.
          // Saying "this entry will not load" would be the reassuring
          // version and the wrong one.
          consequence:
            "This whole file will fail to load — none of its entries will " +
            "sync, and nothing it includes will either.",
          ...(suggestion
            ? {
                fix: {
                  title: `Change to ${suggestion}:`,
                  edits: [
                    { start: 0, end: mapping.text.length, newText: suggestion },
                  ],
                },
              }
            : {
                remedy: mapping.inEntry
                  ? "The keys inside an entry are get:, set: and skp:."
                  : "The blocks are shared:, master:, include:, ignore: and " +
                    "pointer:.",
              }),
        })
      )
    }

    return out
  },
}
