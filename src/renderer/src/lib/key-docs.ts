/**
 * What each key in the format is, said once.
 *
 * This used to be a JSON Schema handed to monaco-yaml, which rendered the
 * `markdownDescription`s as key hovers and enforced `additionalProperties:
 * false`. Neither ever reached a reader: monaco-yaml's worker has not started
 * since monaco-editor 0.53 changed how one is created, so the schema was bound
 * to a language service that answered every question with *Missing
 * requestHandler*. The prose here was written, registered and unreachable.
 *
 * So the schema is gone and the two things it was for are ours: `profileHover`
 * renders these on a key, and `key-unknown` in lang/ says what an unrecognised
 * one costs. Both were already the kind of thing this codebase does — it owns
 * the grammar, the hover and 29 rules — which is what made dropping a
 * dependency cheaper than adapting one.
 *
 * `summary` is the line completion shows beside the key; the hover shows
 * `detail` under it. One table rather than three: block descriptions used to
 * exist here *and* as `BLOCK_DOCS` in completions.ts, and the entry keys had a
 * short wording in completions and a long one in the schema, which is how a
 * reader ended up with two accounts of `skp:` depending on which surface they
 * touched.
 */

import { CONTINUATION_KEYS, ENTRY_KEY, type BlockName } from "@shared/profile"

export interface KeyDoc {
  /** One line. Completion shows this, and the hover leads with it. */
  summary: string
  /** What the hover adds under the summary. Markdown. */
  detail?: string
}

export const BLOCK_DOCS: Record<BlockName, KeyDoc> = {
  shared: {
    summary: "Entries either pilot can drive.",
    detail:
      "A change on either side is sent to the other, and the setter runs in " +
      "the simulator's calculator exactly as built.",
  },
  master: {
    summary: "Entries only the pilot in control drives.",
    detail:
      "Sampled about 33 times a second and sent unreliably, so a dropped " +
      "update is overtaken rather than resent. The setter is **not** run as " +
      "RPN — see `set:`.",
  },
  include: {
    summary: "Other profiles to merge in.",
    detail:
      "Paths are relative to the workspace. A missing file is skipped " +
      "silently, so a typo here costs you the whole module.",
  },
  ignore: {
    summary: "Instruments whose interactions are never sent.",
    detail:
      "Names are matched exactly, including case. A name that matches no " +
      "panel does nothing, and there is no error either way.",
  },
  pointer: {
    summary: "Instruments whose clicks and drags are sent by position.",
    detail:
      "An item is an instrument identifier (`DisplayUnits`), which takes " +
      "every panel that reports it, or a full panel key " +
      "(`DisplayUnits|config=Default`).",
  },
}

/** The keys inside an entry: `get:`, and the two that continue it. */
export type EntryDocKey = typeof ENTRY_KEY | (typeof CONTINUATION_KEYS)[number]

export const ENTRY_KEY_DOCS: Record<EntryDocKey, KeyDoc> = {
  get: {
    summary: "The variable to watch, optionally `NAME, units`. Required.",
    detail:
      "The common prefixes: `A:` simulation variable, `L:` local " +
      "variable, `K:` key event, `B:` input event, `H:` HTML event. " +
      "Seventeen are recognised in all — hover a name to see which it " +
      "is.\n\n" +
      "A name with no prefix reaches neither the simulator nor the " +
      "calculator, and the entry does nothing.\n\n" +
      "Units default to `Number`, or nothing for `K:` and `H:`.",
  },
  set: {
    summary:
      "How to apply an incoming value. Omit to write the variable directly.",
    detail:
      "Which of three things happens is decided by the characters in the " +
      "value:\n\n" +
      "- Contains any of `'` `` ` `` `?` `{` `}` — evaluated as JavaScript, " +
      "with `value` and `current` in scope. The result is the complete " +
      "string to execute.\n" +
      "- Otherwise, starts with `(` — the incoming value is prepended, so " +
      "`(>K:EVENT)` is sent as `<value> (>K:EVENT)`.\n" +
      "- Otherwise — sent exactly as written.\n\n" +
      "A double quote is *not* a trigger: YAML strips its own quoting before " +
      "FS Copilot sees the value.",
  },
  skp: {
    summary:
      "Another variable whose next change will not be sent when this entry " +
      "sends. `shared:` only.",
    detail:
      "For a control whose one press moves two synced variables.\n\n" +
      "The mark is registered on the **sending** side, and only from a " +
      "`shared:` entry. In a `master:` entry `skp:` does nothing, and " +
      "neither does a name that no `shared:` entry watches. The echo after " +
      "applying an incoming value is automatic and needs no `skp:`.\n\n" +
      "`skp: true` registers a counter under the literal string `true` and " +
      "does nothing.",
  },
}

function isBlock(name: string): name is BlockName {
  return name in BLOCK_DOCS
}

function isEntryKey(name: string): name is EntryDocKey {
  return name in ENTRY_KEY_DOCS
}

/** The documentation for a key, whichever of the two families it is in. */
export function docFor(name: string): KeyDoc | null {
  if (isBlock(name)) return BLOCK_DOCS[name]
  if (isEntryKey(name)) return ENTRY_KEY_DOCS[name]

  return null
}

/** The two joined, for a venue with room for both. */
export function keyDoc(name: string): string | null {
  const doc = docFor(name)
  if (!doc) return null

  return doc.detail ? `${doc.summary}\n\n${doc.detail}` : doc.summary
}
