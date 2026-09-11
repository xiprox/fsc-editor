# FS Copilot profile format

A comment convention for organizing a profile into sections, so that one file
can carry what would otherwise be a folder of files.

FS Copilot's YAML parser discards comments, so nothing here changes what a
profile does. It exists for authors and for tooling.

## Tiers

| Tier | Form | Meaning |
| --- | --- | --- |
| Header | `# Key: value` at the top of the file | Metadata about the profile |
| Section | `# ═══ TITLE ═══…` | Level 1 — the equivalent of a file |
| Subsection | `# ── Title ──…` | Level 2 — a division within a section |
| Entry doc | A comment directly above `- get:` | Documentation for that entry |
| Note | Any other comment | Prose, ignored structurally |

```yaml
# A2A Simulations PA-24 Comanche
# Author: xip
# Version: 0.0.1
# Updated: 2026-08-15

# Free prose. Anything that is neither a heading nor directly above an entry
# is a note.

shared:
  # ═══ ELECTRICAL ══════════════════════════════════════════════════════════

  # ── Hot Battery Bus ──────────────────────────────────────────────────────
  # CB - Starter Relay — Circuit 1 / HotBatteryBus(1)
  - get: A:CIRCUIT CONNECTION ON:1, Bool

  # ═══ TRIMS ═══════════════════════════════════════════════════════════════
  - get: A:AILERON TRIM PCT
```

## Rules

**Headings.** A heading is a comment whose body is a run of rule characters, a
space, a title, and an optional closing run. The rule character carries the
level:

- Section: `═` (2 or more) or `=` (3 or more)
- Subsection: `─` (2 or more) or `-` (3 or more)

The ASCII forms parse identically, so `# === ELECTRICAL ===` and
`# --- Hot Battery Bus ---` are valid input. The editor writes the box-drawing
forms. Trailing rule length is ignored when reading; a comment that is only
rule characters is a divider, not a heading.

**Sections are not required.** A profile with no headings is valid — most
existing ones have none. Entries before the first heading belong to their
enclosing block.

**Scope.** Headings live inside a top-level block (`shared:`, `master:`), and
a section ends at the next section, the end of its block, or end of file.

A concern whose entries are mostly shared with a few master ones has to be
written twice, once per block, because an entry's block is the only thing that
decides whether it is master-authoritative. The same section name under both
blocks is the same concern.

**`Updated:` is load-bearing.** FS Copilot parses it with a regex anchored to
`#` followed immediately by `Updated:`, so `# Last Updated:` does not match and
leaves the profile with no date at all. Use `# Updated: YYYY-MM-DD`.

## Canonical form

The editor formats every file it saves. There are no options.

- Headings are padded to **78 columns** including indentation, with `# ` + 3
  `═` for a section and `# ` + 2 `─` for a subsection, then the title, then a
  closing run. They sit at the same column as the entries they label.
- Section titles are upper-cased. Subsection titles are left as written, and no
  title is ever re-worded.
- Sequence entries are indented 2 spaces, continuation keys 4.
- A `# Last Updated:` in the header block is rewritten to `# Updated:`, the
  only spelling FS Copilot reads.
- Units on a `get:` entry are re-cased to their canonical spelling — `bool`
  becomes `Bool`. SimConnect matches unit names case-insensitively, so this
  cannot change which unit is resolved. Spellings that differ by more than
  case, such as `ft` for `Feet`, are offered as completions and never
  rewritten.
- Trailing whitespace is removed; the file ends with exactly one newline.
- Runs of 3 or more blank lines collapse to 2.

Never touched, because each would change what the profile does or destroy
authorship:

- **Quoting.** `set:` values contain `#`, backticks and `${}`.
- **Entry order.**
- **Block scalar contents.** Nothing inside a `>` or `|` block is rewritten,
  not even trailing whitespace, which is part of the value in a literal block.
  When the key line is re-indented the whole block moves with it by the same
  number of columns, so indentation relative to the block — the part that is
  semantic — never changes. The body is re-based so its outermost line sits two
  columns in from its key, and it can never be shifted out past that key, which
  would end the block and change the document's shape. A block carrying an
  explicit indentation indicator (`|2`) is never moved at all, because that
  number makes its columns absolute rather than relative.
- **Single blank lines.** A blank line separates a note from an entry's
  documentation, so inserting or removing one re-attaches documentation to a
  different variable.

Reading is lenient, writing is strict: profiles from other authors parse in
whatever shape they arrive, and are only normalized if you save them. A line
the grammar does not recognize is passed through untouched rather than
rejected.

## Where the caret goes

The columns above are not only what the formatter writes — they are also where
Enter puts you, computed from the same function. Pressing Enter asks the
grammar what construct most likely comes next and places the caret at that
construct's column.

**Enter continues the entry you are writing.** An entry is one mapping and its
keys are contiguous, so after `- get: X` the caret lands under `get`, ready for
a `set:`, and after a `set:` it lands under `set`, ready for a `skp:`.

**A blank line concludes the entry.** That is the whole convention, and it is
what the editor reads to decide the caret is starting a new entry rather than
continuing the last one. After a gap, an indented word offers `- get:` again
instead of `set:`/`skp:`.

**A finished block scalar exits.** A `set:` block holds a single JavaScript
expression, so once its brackets balance there is nothing further the field can
contain. Enter at the end of the closing `})()` line returns to the column of
the key that opened the block rather than staying inside it.

**A comment continues as a comment.** Enter at the end of a `#` line starts the
next one with `# ` at the same column. Headings and dividers are structure, not
prose, so what follows one is content.

The prediction is a guess and is allowed to be wrong; nothing depends on it
being right. Every key is also offered as a whole-line completion that places
itself, and a save corrects the column either way. It only decides how often
the caret is already where you were about to type.

## `skp:` takes a variable name

FS Copilot registers the value into a table keyed by variable name
(`Skip.Next(def.Skip)`) and looks it up with another entry's `get:` name
(`Skip.Should(getVar)`). So `skp:` names *the variable whose next change is
suppressed*, and anything that is not a variable name never matches anything.

`skp: true` — which 24 of the installed profiles write — registers a counter
under the literal string `"true"` and silently does nothing.
