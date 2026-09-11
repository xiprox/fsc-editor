# Data model

    Purpose:    What gets stored, how it is identified, and where it lives.
    Depends on: 02-namespaces
    Decides:    SQLite, evidence-per-source, variable identity, aircraft key, entry candidates

> **Amended by the build.** Variable identity is now computed by the shared
> parser (`src/shared/vars/`) — `varIdentity(parseVar(name))` — and instance
> indices are an `A:`-only concept: `L:FOO:1` is a complete name, `L:1:X` folds
> to `Z:X`, `K:2:E` to `K:E`. Migration 5 re-derives the cached columns. See
> "One parser, one descriptor table" in [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** Schema migration 2 adds three things the design did
> not anticipate: `corpus_entry.units_explicit`, because 73% of `L:` lines write
> no unit and a resolved `Number` is usually nobody's decision; `sim_variable`,
> keyed on the variable alone — **not** by aircraft, since enumeration returns
> the same names whichever aircraft is loaded; and `sim_observation`, keyed by
> variable *and* aircraft, which is what `in sim` means now. See "The corpus
> barely knows what units are" in [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** Two rules about *writing* sim evidence that the
> design did not anticipate. An aircraft change flushes first, because changes
> accumulate in memory and a swap is just another event — without it, one
> aircraft's changes are credited to the next. And **a replay writes no
> evidence at all**: the same capture played twenty times would inflate every
> change count twentyfold. See "Sim evidence lands in the database" in
> [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** The aircraft key is confirmed correct against a live
> sim. But the loaded-aircraft path is *relative to the package root*, so the key
> names the aircraft without locating it — "the same string locates the files to
> analyse" below needs a package index to be true. See the log entry "Stage 0
> complete. Aircraft key confirmed; two findings about layout." in
> [build/v1-log.md](build/v1-log.md).

> **Refined by the build (stage 1).** Evidence is a table per source rather than
> one table with a `source` column; and corpus tables are scoped to a
> `workspace` row, which sim evidence will not be. See the log entry "Stage 1
> complete. The dictionary is database-backed."

## One database, many sources

Four writers with different lifetimes land in one dataset: the corpus scan, sim
enumeration, Activity findings, and addon Analysis. That is a database, not a
JSON blob — a blob means rewriting the world on every flush, and recordings are
append-heavy.

**SQLite through `node:sqlite`.** Built into Node, so no native module and no
rebuild-for-Electron. Verified loading on this machine's Node 22.19 with an
experimental warning and no flag; confirm under Electron 43 before committing
(see [17-open-questions](17-open-questions.md)).

**Search does not go through SQLite.** FTS5 ranks prose with bm25 and these are
identifiers. 20–50k strings is nothing to score in memory. SQLite is the system
of record; the search index is built on load. See
[06-variables-panel](06-variables-panel.md).

## Evidence, not a source flag

A `source` column on a variable row breaks the moment a variable has two
sources, which most will. A variable is not *from* the corpus — it *has
evidence* from the corpus, and separately from the sim, and separately from a
file scan.

    variable      identity: namespace, name, index
    evidence      one row per (variable, source, where, when)
                    corpus  → profile file, line, block, comment, set expression
                    sim     → aircraft, session, first/last seen, value range
                    static  → package, file, extraction method, confidence
                    probe   → writable, holds, reverted, moved these others
    observation   recorded values, per session
    finding       an anchor and the changes attached to it
    aircraft      the dimension everything sim-side hangs off
    package       an addon, versioned, for incremental re-analysis
    rule          extraction rules, see 12-rules

This is what makes the three-state filter a *query* rather than a flag somebody
has to maintain:

- corpus evidence **and** sim evidence → known good, sorts to the top
- corpus evidence only → other profiles use it, this aircraft lacks it → a
  diagnostic, not an error
- sim evidence only → **undocumented, nobody has bound it.** The discovery list

## Variable identity

**Not `name|units`,** which is what `src/main/vars.ts` buckets on today.

- **Units are an observed attribute.** The same `L:` variable appears as
  `Number` in one profile and `Bool` in another; that is a fact about the
  usages. Fold units into evidence with counts, and the panel can show
  "usually Bool (14), sometimes Number (2)" — information currently discarded.
- **Index is separate from definition.** `A:CIRCUIT CONNECTION ON:23` is the
  definition `CIRCUIT CONNECTION ON` plus instance `23`, so "which circuits
  does anything use" is one row rather than forty.

## Aircraft identity

**The SimObject container folder name.** Confirmed three ways on this machine:

- the package folder: `…/SimObjects/Airplanes/pa24-250`
- FS Copilot's log: `[SimConnect] Loaded aircraft: pa24-250`
- the profile: `Definitions/pa24-250.yaml`

Matched case-insensitively — `ASOBO_C172SP_G1000.yaml` against
`asobo_c172sp_g1000`.

Not `TITLE`, which is per-livery and would fragment the catalogue across paint
schemes. Using the same key FS Copilot uses means our catalogue and its profile
selection agree about what aircraft is loaded, and the same string locates the
files to analyse. One identifier, three jobs.

Edge cases to settle: variant families such as `FNX_320_CFM` versus `FNX_32X`.
See [17-open-questions](17-open-questions.md).

## Staleness

Every observation carries `capturedAt`, sim build and module version. Aircraft
update and variables disappear. **Never delete — mark last-seen.** "Seen in the
last scan" versus "seen once, in March" is a filter, and the second is still
evidence.

## Entry candidates

The schema has to carry enough to *emit* a profile entry, not just a name.
That is five things per candidate, and where each comes from:

| Field | Source |
| --- | --- |
| name | discovery |
| units | RPN in model XML carries them inline — `(L:FOO, Bool)`; else corpus consensus; else inferred from observed range (only 0 and 1 → Bool) |
| section | `systems.cfg` groupings, tooltip labels, naming prefixes — see [13-report](13-report.md) |
| block (`shared`/`master`) | probe's cause-vs-symptom result — see [10-probe](10-probe.md) |
| `set:` expression | corpus patterns for structurally similar variables |

Deciding this now is what makes one-click insert and generated starter profiles
possible later without a migration.

## Location

Under `%APPDATA%/fsc-editor/`, alongside the existing `settings.json`.
Per-aircraft data is a dimension inside the database, not a file per aircraft.
