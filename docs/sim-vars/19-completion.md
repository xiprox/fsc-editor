# Completion

    Purpose:    Name completion that knows where the caret is, what the entry
                around it says and what each source of evidence knows at that
                position — designed once, measured rather than argued.
    Depends on: 05-data-model, 18-language-core, the shared parser and
                descriptor table (src/shared/vars/)
    Decides:    positions, evidence per position, identity versus written
                form, the document as evidence, aircraft scope, two-stage B:,
                the ranking and how it is measured, who filters

> **Status, 2026-09-25.** Built, all five stages. The name half of
> `src/renderer/src/lib/completions.ts` is now an adapter over
> `src/shared/completion/`, and `set-completions.ts` is gone. Numbers are from
> the committed corpus (`corpus/profiles`: 58 profiles and 11 modules, 26,781
> entries); `npm run check:completion` reproduces the ranking ones.

> **Amended by the build.** The sweep overturned three parts of the ranking
> below and added a fourth; see "Completion rebuilt; the file, not the corpus,
> is the evidence" in [build/v1-log.md](build/v1-log.md). In short: `skp:`
> offers the entry's own variable **first** (228 of 235 name it), not never;
> `get:` leads with the name that follows the previous entry in the most
> similar profile, then that profile's names, then the file's families,
> before the evidence bands; a read leads with its own entry's variable; and
> the write position's first tier is what the most similar profile's setter
> writes for the same `get:`. Also changed in building: `B:` controls are
> labelled `ID_…` with the bare ID beside them in step one rather than after
> the underscore; shapes live in `src/shared/completion/shapes.ts`, not
> `src/shared/vars/`; `inputEventOf` replaces `inputEventGroups`; profile
> summaries carry every `get:` in order rather than `sharedGets`.
>
> Measured, right name first with only the namespace typed (old order in
> brackets): write 68% (40%), `get:` 61% (0.2%), read 92% (none), `skp:`
> 97% (none).

## Why this exists

A user wrote `- get: B:SOME_VAR` and, one line down at `set: (>B:`, was
offered three `B:` names from other people's profiles and not the one above
the caret, with the simulator connected. Tracing it found that the fault is the
shape of the system, not a missing case:

| Finding | Consequence | Measured |
| --- | --- | --- |
| The write list never reads the document | The entry's own variable has no standing; it appears only if the index happens to hold it | 369 of 381 `B:` setters write their own name or its input event |
| The first tier is global write frequency | Other profiles' most-written names lead every list | 73 of 12,676 written references are reachable *only* that way (0.6%) |
| Writes are counted from display samples | Five samples are kept per variable, so the sixth setter onwards is never counted | 75 of 1,880 written names never appear after `(>`; "written by N" is low for 650 of them, in hover too |
| The corpus is read at workspace open | A `get:` written this session is unknown until the app restarts; saving does not rescan | — |
| The sim's `B:` names are IDs | `EnumerateInputEvents` lists `AIRLINER_FCU_CHRONO_2`; profiles write `…_Push`. The sim never supplies the name in the getter | A220: 464 IDs, 1 ending in an operation |
| Aircraft evidence ranks in every file | Editing the Baron's profile with the A220 in the sim puts the A220's controls first | — |
| `skp:` offers the whole index | FS Copilot matches `skp:` exactly against `shared:` `get:` text; ~19,000 names are offered where a few dozen can work | 232 of the 236 values that are not `skp: true` name a `shared:` get in the same file |
| Reads inside expressions get nothing | Only `(>` is recognised; `(A:`, `(L:`, `(B:` offer no names | 545 reads |
| Setter samples miss indexed gets | `setSuggestions` compares the raw `get:` text with an identity, so `get: A:LIGHT BEACON:1` never finds `A:LIGHT BEACON` | — |
| `replace` ranges apply only on Shift+Enter | Monaco's `insertMode` defaults to `insert`, so accepting over `A:OLD, Bool` splices rather than replaces | — |
| Scores are not comparable in one list | `K:` snippets reach back over `(>`, so Monaco scores them against a longer filter word and they outrank the rest whatever `sortText` says | — |
| Trigger characters are wrong | The letters in the list never act as triggers — quick suggest already fires on word characters — and `(` and `>` are missing | — |
| Documentation is built eagerly | Every request builds markdown for ~19,000 candidates; Monaco reads it for the one focused item | — |

Each was a reasonable local decision. What they share is that no part of the
system could see the whole question: where the caret is, what the entry around
it says, what the file says, which aircraft the file is for, and what each
source knows *at this position*. This part answers that question once.

## Principles

The load-bearing decisions. A change that breaks one is the wrong change,
whatever it fixes.

1. **Identity is what a variable is; a written form is how it is called
   here.** The index is keyed by identity — `A:GENERAL ENG RPM`,
   `K:KOHLSMAN_SET`. Completion inserts a written form — `A:GENERAL ENG RPM:1`,
   `K:2:KOHLSMAN_SET`, `B:…_Push`. Units, indices, arity and an input event's
   suffix are one idea: how a name is called at a position, decided by one
   function per namespace.
2. **Evidence is counted, never sampled.** Every count comes from every row.
   Samples exist to be shown and nothing counts from them. No cap sits in data;
   caps belong to display.
3. **Position is part of every question.** A name twelve profiles read and none
   write is strong evidence in `get:` and weak after `(>`. Counts, candidates,
   shapes and ranking are all per position.
4. **The document is evidence, and the strongest there is.** The entry around
   the caret and the rest of the file are read live from the buffer. The open
   file's saved copy is left out of the corpus, so the buffer alone speaks for
   it.
5. **Aircraft evidence applies to files for that aircraft**, and to no others.
6. **Monaco filters; we rank.** Monaco's fuzzy match decides what matches and
   orders by match quality; our rank decides every tie. It is the Variables
   panel's rule — evidence "applied after match quality, never before it" —
   kept for the popup.
7. **The ranking is a measured claim.** A leave-one-file-out sweep over the
   committed corpus scores it, and a ranking change lands with its before and
   after.
8. **Decisions are headless; Monaco is an adapter.** Everything that decides
   lives in `src/shared/completion/` and is tested without an editor. The
   Monaco side maps decisions onto items and does nothing else.

### One authority per question

| Question | Authority |
| --- | --- |
| What is this name — namespace, index, arity, preset and operation | `parseVar`, `src/shared/vars/parse.ts` |
| What a namespace can do in each position | `NAMESPACES`, which gains the access columns `ns-access` keeps privately today; both read them |
| Is this stretch of a setter RPN or JavaScript | the highlighter's frame walk, `src/shared/highlight/paint.ts` |
| What the line is — key, value, comment | the line grammar in `src/shared/profile/cursor.ts` |
| What the corpus knows | the index, counted in main from every row |
| What this file says right now | document facts, from the live buffer |
| Which `B:` names are one control | `inputEventGroups`, beside `inputEventIds` |
| Whether aircraft evidence applies to a file | `fileIsFor`, beside `profileIsFor` |
| The order | `rank.ts`, scored by `check:completion` |
| The words | `docs/copy.md`, through one evidence formatter that hover uses too |

## Positions

| Position | The caret is | Offered | Inserted as |
| --- | --- | --- | --- |
| `get` | after `- get:`, before any comma | namespaces FS Copilot streams or subscribes to | the written form and its unit — the whole value |
| `skp` | after `skp:` in a `shared:` entry | the exact `get:` text of the `shared:` entries in this file's include trees, this entry's own left out | as written, never with a unit |
| `write` | inside `(>` in RPN — a literal setter, or a JavaScript string or template body | writable namespaces | the written form; `K:` as its calling shape; `B:` in two stages |
| `read` | inside `(` in RPN | readable namespaces — not `K:`, `H:`, `W:` | the written form; `B:` as the bare ID |
| `units` | after the comma of a `get:` or a reference | by the namespace's `units` column | see *Units* |

Everything else a profile completes — top-level and entry keys, headings,
header keys, `include:` paths, whole-setter templates — is line structure. It
stays where it is and is outside this part.

The weights, from the corpus. `get:` names: `L:` 20,863, `A:` 2,959, `H:`
2,218, `B:` 674, `K:` 34, `Z:` 13. References inside setters: writes `K:`
7,950, `L:` 2,552, `B:` 1,832, `H:` 180, `A:` 158; reads `A:` 435, `B:` 62,
`L:` 48. The corpus is written, not read, which is why reads are built last.

What FS Copilot's source (`~/dev/fsc/src`) fixes in this table:

- `get:` routes by a **case-sensitive** prefix, so `a:` misses the `A:` path.
  Completion always inserts the namespace in upper case, whatever was typed.
- `get: K:2:FOO` subscribes to an event named `2:FOO`: the arity is stripped
  only in setters. `K:N:` is never offered in `get:`.
- `skp:` matches exactly — case- and index-sensitive — against the text before
  the first comma of every `shared:` entry in the flattened tree, includes
  included. It is not split on commas, so `skp: A:FOO, Bool` matches nothing.
  A `skp:` in a `master:` entry does nothing, so nothing is offered there.
- Units are ignored on `K:` and `H:`.

## Where the caret is

Two grammars, as today, with the second replaced.

**Line structure** stays with `cursor.ts`: which key the line holds, whether
the caret is in its value, before or after the comma. That grammar is
permissive on purpose, and it is right.

**Inside a setter** the question is whether the caret is in RPN, and the
answer already exists. The highlighter's frame walk (`paintCode`) tells RPN
from JavaScript, string and template bodies from code, and holes from both,
across the lines of a block scalar. Completion asks the same walk: it is
extracted into a generator of RPN stretches — text and base offset — which the
painter paints and completion searches for the reference at the caret. One
walk, two consumers, so highlighting and completion cannot disagree about where
a reference is.

That is not tidiness. `collectRefs` tokenizes a whole JavaScript setter as
RPN, so every JavaScript parenthesis reads as a reference: the corpus has
1,346 namespace-less "reads", every one in a JavaScript setter — `(value ==
100)`, `(value)`, `Math.abs(current - value`. A completion that asked the
tokenizer directly would offer variable names after `Math.abs(`.

Within an RPN stretch, the reference at the caret is the `ref` token that
contains the caret or, unterminated, ends at it. `tokenAt` excludes a token's
end, which is right for hover and wrong here — the caret at the end of
`(>B:FO` is the case that matters — so `refAt` is the inclusive variant beside
it in `refs.ts`.

The slot that comes out carries the position; the typed text, from the name's
start to the caret; the covered prefix as typed (`(>`, `( >`, or nothing); the
span of the whole name, to its comma, `)` or end; whether the reference is
closed; and the entry the caret sits in.

## The evidence

### What main counts

References are counted where the corpus is scanned, and stored like every
other corpus fact.

```sql
-- One row per reference inside an entry's set: expression.
corpus_ref (workspace_id, rel_path, ordinal, variable_id, written, access)

-- One row per include: line, so a file's trees can be walked either way.
profile_include (workspace_id, rel_path, target)
```

`corpus_ref` joins `corpus_entry` on `(rel_path, ordinal)`, which gives the
pairing no sample can: an entry's `get:` and what its setter writes. `written`
keeps the form as written — `K:2:KOHLSMAN_SET`, `A:X:1` — while `variable_id`
holds the identity. References are found through the frame walk, so no
JavaScript parenthesis lands in the table.

### What the index carries

The corpus facet becomes explicit about position. A sketch:

```ts
interface PositionEvidence {
  /** Entries or references at this position. */
  uses: number
  /** Every file, uncapped — the rank leaves the open file out by path. */
  files: string[]
}

interface CorpusFacet {
  get?: PositionEvidence & { shared: number; master: number }
  read?: PositionEvidence
  write?: PositionEvidence
  skp?: PositionEvidence
  /** How the corpus spells this identity, commonest first, per position. */
  written: { form: string; at: Position; uses: number }[]
  /** For a variable a `get:` reads: what its setters write, by written form. */
  setsWrite?: { form: string; uses: number; files: string[] }[]
  units: string[]
  indices: string[]
  doc?: string
  /** For showing. Nothing counts from these. */
  samples: VarSample[]
}
```

What follows from it:

- A name that is only ever written — most `K:` events — becomes an index entry
  with corpus evidence. Today it has none unless the catalogue knows it, and
  the renderer rebuilt it from samples.
- `count`, `fileCount`, `sharedCount` and `masterCount` are today's `get:`
  numbers under older names. Their readers move to `get.*` in the same change:
  `var-search.ts`, `hover-card.ts`, the Variables panel popover,
  `byCorpusThenName` and `vars.test.ts`. Having a corpus facet stops meaning
  "some profile reads this", and `evidenceRank` is the one place that assumes
  it.
- `writeTargetCount` goes. Hover's "Written by N" reads `write.uses` and
  becomes exact.
- Completion stops reading the order of `entries`. After this, nothing but
  `vars.test.ts` does.

The index also carries one summary per profile file — what `skp:` and aircraft
scope need, and what the open buffer overrides for itself:

```ts
interface ProfileSummary {
  relPath: string
  /** `include:` targets, resolved against the workspace root as FS Copilot does. */
  includes: string[]
  /** Every `shared:` entry's `get:`, exactly as FS Copilot will match it. */
  sharedGets: string[]
}
```

### When it is read

The file watcher rescans. On a change, main runs `scanVars` — already
incremental by size and modified time — and pushes `vars:changed`, which the
renderer already answers by fetching the index. A save reaches completion
within one debounce instead of at the next launch. The cost is one file's parse
and one rebuild of the index, which `projectIndex`'s own comment measures at
131 ms on a working database.

## The document

`documentFacts(model)` replaces `linesOf` as the per-model cache, keyed by the
model's version:

- lines and entries (`scanLines`, `entriesFromLines`)
- for each line, the entry around it: its `get:` as written and as identity,
  its block, the keys it already has
- this file's names by position, with counts
- this file's `include:` targets and `shared:` gets, overriding its saved
  `ProfileSummary`

The open file's saved copy is left out of corpus evidence at rank time. Every
`files` list is complete, so leaving one path out is exact. Without it, a name
deleted from the buffer would go on ranking on the strength of the copy on
disk.

Other tabs contribute through disk, not through their buffers: a dirty tab's
unsaved names are not evidence until it is saved. The gain is small and the
invalidation is not.

Hover shares `linesOf` today and moves with it. Diagnostics, the trace panel
and several others keep their own scans for now; moving them onto
`documentFacts` is its own change.

Remote Connect is unaffected. The host's copy is read-only, so nothing
completes there, and a guest's own files complete from the guest's index.

## Aircraft scope

`fileIsFor(relPath, aircraft, summaries)` is true when the file is the
aircraft's profile (`profileIsFor`), or when a profile for the aircraft
includes it, transitively. A module is for every aircraft whose profile
includes it.

Completion applies the `aircraft` facet — input events, movement, firings,
`inProfile` — only where `fileIsFor` holds. Elsewhere, a candidate whose only
evidence is the aircraft (an enumerated `B:` ID, mostly) is not offered at all:
another aircraft's IDs are wrong suggestions, not weak ones.

`aircraft-evidence.ts` asks the same question for diagnostics with
`profileIsFor` alone, so modules get no aircraft evidence there. It should
adopt `fileIsFor`, separately. The `AircraftFacet.inProfile` comment in
`types.ts` says a `-default` suffix is stripped; `profileKey` deliberately does
not, and its own comment is the right one.

## Candidates and shapes

### Which namespaces, where

`NAMESPACES` gains what each namespace can do in each position:

```ts
interface Namespace {
  // …
  /** How FS Copilot treats it in a `get:` — streamed, subscribed as an event, or neither. */
  get: "stream" | "event" | null
  /** Whether a reference may read it. */
  readable: boolean
  /** Whether a reference may write it. */
  writable: boolean
}
```

`ns-access` holds `NEVER_READ` and `NEVER_WRITTEN` as private sets today. It
reads these columns instead, so the diagnostic and the completion list are one
fact. The values come from FS Copilot's routing — its own paths for `L:`,
`A:`, `H:` and `K:`, calculator code for the rest — and from those two sets,
decided row by row in the build.

What depends on a name rather than its namespace stays per name: a documented
non-settable `A:` is not offered in write position, and `E:` is writable only
as `SIMULATION RATE`. Both move out of `writeOffer` into the shapes unchanged.

### Shapes

`shape(entry, position, facts)` returns an offer or nothing, one row per
namespace, in `src/shared/vars/shapes.ts` beside the table. It absorbs
`unitFor`, `writeOffer`, `kEventSnippet`, `parameterLabel` and the `K:` join
inside `writeTargetSuggestions`.

```ts
interface Offer {
  /** Plain text or a snippet. */
  insert: string
  snippet: boolean
  /** Replace from the covered prefix rather than from the name — K: operands. */
  from: "name" | "prefix"
  /** Open the list again after inserting — the B: first stage. */
  next?: true
  /** Why it is here, for the detail line and the rank. */
  evidence: EvidenceKey
}
```

- **The written form** is the corpus's commonest spelling of the identity at
  this position. That is how `K:2:KOHLSMAN_SET` wins over `K:KOHLSMAN_SET`
  without a special join, and how `L:1:` or `Z:` is chosen for a per-simobject
  name.
- **`K:` with two or more documented parameters**, in write position, is its
  calling shape as a snippet: operands reversed, `[0]` tabbed last. Today's
  `kEventSnippet`, unchanged.
- **An indexed `A:`** — the catalogue documents an index for 449 names — gets
  `:${1:n}`, where `n` is the corpus's commonest index for it.
- **An open reference is closed.** `(>B:X_Set` becomes `(>B:X_Set)` with the
  caret after it; an unterminated reference runs to the end of the line in the
  tokenizer and garbles everything after it. A reference that already has its
  `)` keeps it.

### Units

By the namespace's `units` column:

- `none` (`K:`, `H:`): nothing. FS Copilot ignores units there.
- `converted`: this variable's corpus units by use, then its catalogue unit,
  then every unit by corpus frequency.
- `raw`: this variable's corpus units, then `Number`.

In `get:` a name is inserted with its first unit, since the value is one thing
and a unit belongs to its variable. Offering "the other length units" needs
categories in `src/shared/units.ts`, which it does not have yet.

## `B:` input events

The enumeration is the aircraft's own account of its controls, and it is IDs.
What profiles write is an ID with a suffix: a generated operation (`_Set`,
`_Toggle`, …) or a preset of the vendor's own (`_Push`, `_Release`,
`_BUTTON`). Nothing enumerates the suffixes. So `B:` completes in two stages,
the way `K:` completes its calling shape.

**Stage one, the control.** One row per input event ID. IDs come from the
enumeration when the file is for the aircraft in the sim, and from the corpus
and this file always, grouped by `inputEventGroups`. Accepting
`B:AIRLINER_FCU_CHRONO_2` inserts `B:AIRLINER_FCU_CHRONO_2_` and opens the
list again. The forms the first three rank tiers hold — this entry's own name,
what its variable's setters write, what the file already writes — are offered
whole in stage one as well: their suffix is already decided, and choosing it
again would be busywork.

**Stage two, the suffix.** Served whenever the typed text is a known ID and an
underscore, whether reached by accepting or by typing. In order:

1. suffixes this file already writes for the ID
2. suffixes the corpus writes for it — with this entry's variable first, then
   anywhere — by profiles
3. the generated operations not already listed — `Set`, `Toggle`, `Inc`,
   `Dec`, `On`, `Off` — in the corpus's commonest casing, marked as seen in no
   profile. They rank last because a wrong one fails silently: read through
   the calculator, a suffix the control does not define answers 0 with no
   error, which looks exactly like a control at rest. On the CJ4, `_Toggle`
   read its control's value on 19 of 38 controls away from zero and 0 on the
   other 19, and a made-up `_Bogus` read 0 on all 38. Writing one does
   nothing either (`_ARM` on the Baron)
4. the bare ID, when the corpus writes it bare, replacing the underscore. A
   bare write lands only when the vendor's preset is itself the action, and the
   corpus writes hundreds that way

A typed text that also begins another known ID — the A220 has both
`AIRLINER_FCU_SPD_PUSH` and `AIRLINER_FCU_SPD_PUSH_PUSH` — gets that ID offered
beside the suffixes.

The corpus's distinct names show why the generated list alone is not enough.
After `(>B:`: 842 names, 410 ending `_Set`, 125 `_Toggle`, 44 `_Push`, 19
`_Off`, 18 `_BUTTON`, 16 `_Release`, then a long vendor tail. In `get: B:`:
397 names, 216 ending `_Set`, 56 numbered IDs, then vendor words.

**By position.** `write` and `get` use both stages. `read` inserts the bare ID
and stops: all 62 corpus reads name a bare, numbered ID (`…_Alternator_1`).

**Mechanics.** A stage-one list is returned incomplete, so Monaco asks again on
every keystroke, and a typed underscore reaches stage two with no second
trigger — `_` is a word character in the yaml word definition. `B:` lists run
to hundreds, so asking again is cheap. A stage-one row carries Monaco's
retrigger command, which asks at the caret once the row is inserted.

`inputEventGroups(names, enumerated)` sits beside `inputEventIds`. With the
enumeration, a name's ID is the name itself if enumerated, or else the longest
enumerated name it extends by `_`; without it, `inputEventIds`'s strip,
numeric suffixes kept. It is also the one
call the Variables panel needs if it decides to fold operations, the item
18-language-core deferred.

## Ranking

The rank orders candidates within one position; Monaco's match score orders
them by match quality. Where two candidates match the typed text equally —
always the case when only a namespace has been typed, which is the reported
case — ours decides.

### Write position

Measured membership, leaving each file out in turn, over the corpus's 12,676
written references:

| The target is… | Share |
| --- | --- |
| written for the same `get:` variable in another profile | 73% |
| used elsewhere in the same file | 66% |
| either of those | 90% |
| reachable only through global write frequency, today's first tier | 0.6% |
| nowhere else in the corpus: catalogue or sim only | 9% |

For `B:` setters, 97% write their own `get:` name or its input event.

The tiers, in their starting order:

1. this entry's variable; for `B:`, the forms of its ID
2. what this variable's setters write in other profiles (`setsWrite`)
3. names used elsewhere in this file
4. the aircraft in the sim's own — its input events, names that moved — when
   the file is for it
5. names written anywhere in the corpus
6. names known only to exist — seen by the sim, documented in the catalogue

Within a tier: profiles, with the open file left out, then uses, then
`sdk.uses`, then the name. The order of tiers 2 and 3 is the sweep's first
question: both are strong, and neither contains the other.

### `get` and `read`

One definition of evidence strength, shared with the Variables panel.
`evidenceRank` moves to `src/shared/completion/` and learns the `inputEvent`
facet, which `aircraftStrength` in `vars.ts` counts and `evidenceRank` does
not — two definitions of "this aircraft's" that disagree today. With the
file's aircraft scope applied: moved on the aircraft or one of its input
events, then named by its profile, then read by profiles, then known to exist.
Ties by profiles, `sdk.uses`, then the name.

`get:` names already in this file are not boosted; they are mostly done. The
detail says so, since a repeat with a different setter is a deliberate fan-out
and an identical one is a defect.

### `skp`

This file's `shared:` gets by distance from the caret, since a `skp:` names the
variable a neighbouring control also moves; then those of its include trees.

### Where Monaco's score meets ours

- **One list, one range.** Every item covers the same range, so every item is
  scored against the same typed text. The `K:` snippet's reach back over `(>`
  becomes the rule for the whole write list: all of it replaces from the `(`,
  and every `filterText` begins with the covered prefix as typed. Scores are
  then comparable, and `sortText` means what it says.
- **The scorer changes at 2,000 items.** Monaco uses plain `fuzzyScore` above
  that and the forgiving `fuzzyScoreGracefulAggressive` below. Once a namespace
  is typed the list narrows to it, so `B:` gets the forgiving scorer and a bare
  word over the whole index does not. Accepted; it is how Monaco behaves
  everywhere.
- **The first typed character must land at a word start.** `battery` finds
  `A:ELECTRICAL MASTER BATTERY` and so does `master battery`; `battery master`
  does not. Word-order-free search is the Variables panel's job, and the popup
  does not imitate it.

## Measuring it

`npm run check:completion` runs leave-one-file-out over `corpus/profiles`,
which is committed, so it runs on a fresh clone and can run in CI.

For each file, the evidence is built from the other 68 and the catalogue, with
no sim. Every slot in the held-out file — each `get:` name, each written and
read reference, each `skp:` — is emptied and completed, in two documents: the
whole file around the slot (editing), and only the lines above it (writing
top-down). The typed text is the namespace alone, then the namespace and three
characters. Filtering and ordering use Monaco's own `fuzzyScore`, imported
from `monaco-editor/esm/vs/base/common/filters.js`, which loads in Node, so
the sweep measures what the popup would show.

It reports top-1, top-5 and mean reciprocal rank per position and namespace,
and how long `complete()` took (p50, p95). Its first run puts today's code
through the same harness. That is the number every ranking change is compared
against, and the stage that changes the ranking records both.

Fixtures, headless in vitest: the reported case; samples for an indexed
`get:`; `skp:` in a `master:` entry; a profile for another aircraft; both
`B:` stages, with the bare ID and the overlapping ID; a JavaScript setter with
a reference in a string and a parenthesis in code; comparable scores across a
mixed write list.

The budget is 5 ms at p95 for `complete()` against a 20,000-name index. The
live check is a drive of the built app, reading the popup in the reported case.

## The Monaco adapter

`completions.ts` keeps the provider and becomes a mapping.

- **Range.** One per list: a plain `IRange` from the covered prefix, or the
  name's start, to the end of the name. A plain range always replaces to its
  end, so Enter replaces the old name, not only Shift+Enter. In `get:` it runs
  to the end of the value, before any trailing comment, because the name brings
  its unit.
- **Items.** `label` is the written form; `description` the unit, in `get:`;
  `detail` one evidence line; `filterText` the covered prefix as typed plus the
  written form; `sortText` the rank; `command` the retrigger, on stage-one
  `B:` rows.
- **Documentation** is resolved lazily. `resolveCompletionItem` dispatches on
  origin: the JavaScript service's items to `resolveJavaScript`, ours to the
  evidence formatter.
- **Incomplete** only for stage-one `B:` lists.
- **Trigger characters** `:`, space, `,`, `#`, `-`, `(` and `>`. The letters
  go, since they never fire; `(` and `>` open the read and write lists the
  moment they are typed.

### Copy

Detail lines, drafted here and held to `docs/copy.md` in the build — singulars
handled, "the aircraft in the sim", "input event":

| Evidence | Detail |
| --- | --- |
| this entry | this entry's variable |
| `setsWrite` | written for this variable in 4 profiles |
| this file | used 6 times in this file |
| the aircraft | input event on the aircraft in the sim |
| corpus, write | written by 12 profiles |
| corpus, get | read by 12 profiles |
| catalogue | the SDK category, as today |
| the sim alone | known to the sim |
| generated operation | seen in no profile |
| bare `B:` | written bare in 3 profiles |

One formatter produces these and hover's footer. The block summary is written
twice today, in `completions.ts` and `hover-card.ts`.

## What goes, what stays

**Goes:** `variableSuggestions`, `writeTargetSuggestions`, `unitSuggestions`,
`writeTargets`, `writeTargetCount`, `documentation`, `variableAbove` and
`linesOf` from `completions.ts`, with hover moving to `documentFacts`; `set-completions.ts` whole, its tests moving
with its functions to `shapes.ts`; the `OPEN_WRITE_TARGET` regex and the
block-scalar branch of `cursor.ts`; the `MAX_FILES` cap; the letter trigger
characters.

**Stays:** key, heading, header and `include:` completions;
`set-templates.ts`; whole-setter samples in `set:` values, looked up by
identity; the JavaScript bridge.

## Build order

Each stage ships on its own and ends working.

1. **Evidence.** The migration (`corpus_ref`, `profile_include`); the
   position-explicit facet and its readers; `written`, `setsWrite`, uncapped
   `files`; `ProfileSummary`; the watcher rescan. *Done when* `vars.test.ts`
   covers position counts, the 75 missing names are in the index, and hover's
   "Written by N" equals a direct count.
2. **Core.** `src/shared/completion/`: the extracted frame walk and `refAt`,
   document facts, `fileIsFor`, the access columns with `ns-access` reading
   them, `shapes.ts`, `rank.ts`; and `check:completion` with today's baseline.
   *Done when* the fixtures pass and the baseline is recorded here.
3. **Adapter.** `get:`, `skp:`, write and units through the core; ranges, lazy
   documentation, triggers. *Done when* the sweep beats the baseline in write
   position and a drive of the app shows the reported case right.
4. **`B:` in two stages.** *Done when* the sweep's `B:` numbers beat stage
   3's, and a drive with an aircraft in the sim, with the user at the controls,
   shows both stages.
5. **Reads, units inside references, indexed `A:`.**

## Open questions

1. **Tier 2 or tier 3 first** in write position — the sweep's first question.
2. **Whether `get:` should demote names the file already has** — measured in
   stage 3, not guessed.

### Closed: which `B:` spelling a `get:` should use

This was open question 1: do `get: B:ID` and `get: B:ID_Set` read the same
value? It is not a completion question, and it has no general answer. The
suffixes a control accepts are defined by the aircraft's own behaviour code,
so an answer on one aircraft says nothing about a vendor's, and completion
already ranks suffixes by what the file and the corpus write rather than by
any rule about the simulator.

Measured anyway, on the CJ4 on 2026-09-25 with `npm run sim:probe-reads --
snapshot`, which reads every input event unattended: over the 38 controls
away from zero, `(B:ID, Number)` and `(B:ID_Set, Number)` read the same on
all 38, and `(B:ID_Bogus, Number)` read 0 on all 38. That the suffix is not
simply ignored is what the silent-zero reasoning in stage two rests on. A
snapshot cannot show whether `_Set` reads the control's state or a value of
its own that happens to match; the probe's `move` phase and a write through a
binding other than `_Set` would, if a question ever turns on it.

## Deliberately not

- Word-order-free search in the popup. That is the Variables panel.
- Unsaved names in other tabs as evidence.
- `ignore:` and `pointer:` values, which the panel picker owns.
- Folding `B:` operations in the Variables panel. `inputEventGroups` makes it
  one call when the panel decides to.
- Moving hover, diagnostics and trace onto `documentFacts`. Later, and
  separately.
