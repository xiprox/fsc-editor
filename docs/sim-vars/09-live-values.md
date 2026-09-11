# Live values in the editor

    Purpose:    Showing each entry's current value where the entry is written.
    Depends on: 03-link
    Decides:    inlay hints, the unknown-variable diagnostic, completion detail

> **Amended by the build: they are not inlay hints.** Monaco's
> `InlayHintsController` drops its subscription to a provider's change event
> after the first update and never renews it, so hints froze after exactly two
> repaints — stage 3's long-standing symptom, finally explained. Rendering is
> injected-text decorations now, in `live-decorations.ts`, which also puts the
> update rate under our control. See "Monaco's inlay hints unsubscribe
> themselves after one update" in [build/v1-log.md](build/v1-log.md).
>
> **The `L:` unit question below is settled by measurement**, not by picking an
> API: values are read raw and labelled with whatever the `get:` line asked for,
> because 74% of `L:` lines carry no unit and 99.7% of the rest are `Number`,
> `Bool`, `Percent` or `Enum`. Seventeen lines in the whole corpus would benefit
> from a real conversion. See "`L:` live values: one value store" in the same
> file.

> **Open question from the build.** Which `L:` read to use is unsettled — the
> two APIs disagree by a factor of 264 on dimensioned variables, and a hint
> renders whichever it is handed with nothing on screen to say a conversion
> happened. The test that decides it is in "`fsVarsLVarGet` converts units" in
> [build/v1-log.md](build/v1-log.md).

> **Partly built (stage 3), unverified.** Watch set, transport and inlay hints
> exist; `A:` is the only namespace the client can read until the module lands.
> Nothing has yet confirmed a value *updating* on a line — see the plan's
> outstanding list.

> **Amended by the build.** `A:` values are requested **tagged**, so each record
> carries the datum id it belongs to. A variable the simulator does not have is
> rejected asynchronously and silently, leaving the data definition shorter than
> the watch list — which crashed a positional read, and would have mis-assigned
> values had it merely been bounded. See "The `A:` read crashed the app" in
> [build/v1-log.md](build/v1-log.md).

The cheapest feature here and the one that proves the transport. No new panel,
no database, no persistence — the editor already parses every `get:` line in the
open file.

## What it does

**Inlay hints at end of line.** Watch exactly the `get:` lines of open models,
render the current value after the entry. Nothing else changes about the
editor's chrome.

```yaml
  - get: L:AdfOnOffKnob            ▸ 1
  - get: A:CIRCUIT CONNECTION ON:3 ▸ true
```

This turns the editor into a debugger for the profile actually on screen, which
is the thing being worked on at the moment of doubt.

## The unknown-variable diagnostic

A `get:` whose variable the connected aircraft does not have gets a warning —
**a diagnostic, not an error**, and only while connected to an aircraft we have
enumerated.

This fits the editing model the app already commits to: reading is lenient,
a line the grammar does not recognize is passed through untouched, and a
profile for another aircraft is not wrong just because it is not this one. The
message should say which aircraft it is judging against.

## Completion detail

While connected, completion items carry the live value in their detail line:

    L:APU_SWITCH — 1 · in sim

Small, and it changes the character of the suggest widget: the list stops being
a dictionary and starts being a description of the aircraft in front of you.

## Scope

- Only variables in open models. No speculative watching.
- Watch set updates as tabs open, close and change.
- Activates silently on connect, deactivates silently on disconnect. No prompt,
  no toast, no setting to find.

## Why it comes early

Phase 1 in [16-phasing](16-phasing.md). It exercises the whole pipeline —
module, transport, subscription, value delivery, renderer update — with a UI
surface small enough that if anything is wrong, the wrongness is obviously in
the pipeline rather than in the feature.
