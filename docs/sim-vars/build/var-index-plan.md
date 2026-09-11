# Variable index — build plan

    Status:     built and verified in the app — all four stages landed
    Extends:    05-data-model, 06-variables-panel
    Log:        v1-log.md — one log for the whole effort, whatever the plan
                being worked is called

**Start here**, then read the top of [v1-log.md](v1-log.md). Between them that is
enough to build this without any of the conversation that produced it.

## What it is

The Variables panel becomes a view over **every variable anything knows about**,
rather than over the corpus alone. Names from the profiles, names the simulator
enumerated, names the SDK documents, and whatever source comes next — one list,
one row per variable, no duplicates.

## Why the current shape cannot absorb it

One line, [vars.ts:311](../../../src/main/vars.ts):

```sql
FROM corpus_entry e JOIN variable v ON v.id = e.variable_id
```

The corpus is not *a* source of evidence there — it is the **definition of
existence**. `VarEntry` is a corpus row with corpus-shaped fields, so every new
source has to be smuggled in beside it. The first attempt at exactly that (a
`sim:confirmed` IPC channel carrying the enumeration to the renderer so a
checkmark could be drawn) was written and deleted the same day; it worked, and
it was the first of the hacks this plan exists to prevent.

Meanwhile `variable` is already pure identity — `full_name UNIQUE`, no units, no
source — and every writer already funnels through `variableId()`. **The schema
anticipated this. The query did not.**

## The sources

| source | scope | lifetime | asserts |
| --- | --- | --- | --- |
| corpus (`corpus_entry`) | workspace | rescanned from disk | somebody wrote this, how they wrote it, their comment |
| enumeration (`sim_variable`) | install | persisted, refreshed per session | the sim has this name |
| observation (`sim_observation`) | **aircraft** | accumulates | it moves in this aircraft |
| SDK catalogue (`sdk-var-catalog.json`) | app version | shipped in the binary | it exists, its unit, its docs |
| `B:` input events | **aircraft** | received and discarded today | ~318 events the aircraft defines |

The last row is not built, and is **not planned work**. It stays in the table
because the design has to have a place to put it, and it does: another facet,
aircraft-scoped. Nothing has asked for it since — the panel answers the
question it exists to answer without it — so it is a slot the shape leaves
open rather than a gap somebody is meant to close.

## The design

**Identity spine.** Query `FROM variable`, LEFT JOIN each evidence source.
A variable exists because *some* source knows it.

**Facets, not fields.** `VarEntry` becomes identity plus optional per-source
objects:

```ts
interface VarEntry {
  name: string
  corpus?: { count, fileCount, files, samples, doc, units[], indices[] }
  sim?: { firstSeen, lastSeen }
  aircraft?: { changes, rate }
  sdk?: SdkVar["doc"] & { uses, usedUnits }
}
```

Adding a source is a new optional key. It cannot break the existing ones, and
the panel renders whichever facets a row has. That property is the whole point
of this plan; if a change would violate it, the change is wrong.

## Decisions

Each of these was argued and settled. **Do not re-open without a reason that is
not in this list.**

1. **Identity is the bare, namespaced, un-indexed name.** `A:ADF ACTIVE
   FREQUENCY`, never `…:1`. The corpus holds 824 indexed names and the SDK
   catalogue strips indices, so keying on the written form would split ~5% of
   the table into an indexed row with no description beside a bare row with no
   usage. The index becomes a corpus fact; the SDK's `doc.index` says what it
   *means* (`Engine Index`), which is more useful than one row per engine.
   Hover documentation and completion can spend that information later.
2. **Units leave identity.** Rows are one per variable, not per `name|units`.
   The same variable read as `Number` in one profile and `Bool` in another is
   one variable and two corpus facts.
3. **The SDK catalogue ships as a file, not a table.** The database holds what a
   machine *learned*; the catalogue is what the build *knows*. In the database
   it could disagree with the binary across an upgrade with no honest way to
   resolve it, and it would need a version marker, a reconciliation pass and a
   migration per regeneration — all to support a `JOIN` that is never needed,
   because ranking happens in the renderer. See `src/shared/sdk-catalog.ts`.
4. **Aircraft-scoped evidence belongs in the index.** It was going to be left
   out on the grounds that it changes underneath you; it changes *rarely* — a
   deliberate swap, a few times a session — and it is the strongest signal
   available. The `onVarIndexChanged` push carries a swap. That the design
   absorbed this without needing a new channel is the test it had to pass.
5. **Evidence ranks after match quality, never before it.** A poor name match
   must not float up because it happens to move.

   ```
   match tier → evidence rank → fileCount → count → name
                 ├─ 0  moves in this aircraft
                 ├─ 1  named in this aircraft's profile
                 ├─ 2  attested in the corpus
                 └─ 3  exists only (enumeration / SDK catalogue)
   ```
6. **`scanVars()` splits into a write and a read.** It currently means both
   "re-read the disk" and "give me the list". After: `scanVars()` refreshes
   corpus evidence, `varIndex()` returns the merge, `onVarIndexChanged` pushes.
   This is what lets an enumeration landing mid-session reach the panel through
   the same door as a file edit.

## What is already known

Measured during the design. **None of it needs re-deriving.**

| | |
| --- | --- |
| Profile ↔ aircraft | **Profile basename == SimObject folder name, exactly.** 16 of 16 profiles whose aircraft is installed match; all 38 non-matches are aircraft not installed. Case-insensitive, spaces literal (`PMDG 777-200ER`). One rule: strip a `-default` suffix |
| Coverage | **20 of 33 installed aircraft have no profile at all.** The corpus covers under half of what can be flown — which is the gap the enumeration and the catalogue fill |
| The catalogue | 3,235 variables — `A:` 1,585, `K:` 1,524, `L:` 83, `B:` 32, `E:` 11. 351 in both sources, 140 templates-only, 2,744 docs-only, 1,564 with a `settable` flag, 113 deprecated |
| **Key events were the biggest gap** | `K:` is the most-written namespace in the corpus — **7,865 `set:` references**, more than `L:` (2,513), `B:` (1,649) and `A:` (592) combined — and only **23** `K:` rows existed in `variable`, because a key event lives inside a `set:` expression and never becomes a `get:` entry. The catalogue now carries 1,524 of them with descriptions, parameters and SimConnect event ids |
| Namespaces worth documenting | Settled by measurement, not taste. `K:` yes. `C:` GPS variables are documented, legacy, and referenced **zero** times by the corpus. `E:` environment variables are the sim's clock and weather, not what a cockpit profile drives. `B:` has no list to fetch — its page is the XML schema for *defining* input events, and the names are per-aircraft |
| This machine's evidence | 16,811 variables, 25,622 corpus entries from 64 profiles, 5,053 enumerated `L:` names |
| `L:` needs no subscription | the module streams every variable that moves; the watch set only decides what main *forwards*. See `watchSimVars` |
| The live-value cost | Two terms, both since dealt with. `recordValue` scanned the watch list per arriving value — `O(stream × watch)` — and now asks a `Set`. The IPC message carries the whole watched set at 15 Hz, which no debounce can shrink, so the watch set follows the **viewport** rather than the result list: bounded by the size of the panel, not the size of the search |
| Blast radius | `projectIndex` + `VarEntry`, then three consumers: `var-search.ts` (`fileCount`), `completions.ts` (`samples`, `files`, `doc`, `count`), the panel |

## The stages

Each leaves the app working.

| | | risk |
| --- | --- | --- |
| 1 | `VarEntry` facets, inverted query, catalogue merge; consumers adapted minimally | the big one. `vars.test.ts` covers `projectIndex`. Identity change lands here, so `L:Foo` stops appearing twice |
| 2 | API split and the push | low |
| 3 | evidence ranking in `var-search` | low, but it changes how the panel feels |
| 4 | panel: aircraft filter, facet rendering | joins up with the live values already built |

## Already built

- `scripts/build-sdk-var-catalog.ts` and `src/main/catalog/sdk-var-catalog.json`
  — the templates pass and a docs pass over two namespaces, committed output.
  Adding a third documented namespace is one entry in `SECTIONS`; the row parser
  reads columns by header name, because the two shapes already disagree.
- The panel's search-first empty states, `VarChip` rows, and the `LIVE_LIMIT`
  notice. Nothing there depends on the old `VarEntry` beyond `fileCount`.

## Open

- ~~**`schema_version` stuck at 2.**~~ **Resolved 2026-08-25** — the runner was
  never broken; the database had not been opened by the app since the
  post-corruption rebuild. Launching it migrated 2 → 4 on the spot. See the log
  entry, which also records the fingerprint that settles this class of question
  in one query.
- ~~**The database corrupted twice in one evening.**~~ **Resolved 2026-08-25** —
  `PRAGMA integrity_check` with the app closed returns `ok`, so the second
  reading was the artifact it was suspected of being. The first was real: the
  rebuild it prompted is why `sim_observation` is empty, and aircraft evidence
  accumulates again from the next connected session.
- **`B:` names still come only from the templates**, which parameterise most of
  them away — 32 survive. The real source is the sim's own per-aircraft
  enumeration of ~318 input events, which the app receives and discards today.
  That is an aircraft-scoped facet, not a catalogue pass — and it is **not
  being built**. Recorded here as a known limit of the index rather than as
  pending work, so that a later session finding 32 `B:` names knows why.
