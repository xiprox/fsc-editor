# Open questions

    Purpose:    What must be verified before it is depended on, and what is already settled.
    Depends on: nothing
    Decides:    nothing — this is the list of things that could invalidate a decision elsewhere

> **Several of these are answered.** This file is the question list, not the
> answer list — by convention the log records resolutions and `Affects:` makes
> them greppable — but read as-is it presents settled things as open. As of
> 2026-08-23:
>
> | Question | Answer |
> | --- | --- |
> | Does `node:sqlite` work under Electron 43? | Yes |
> | Can `B:` be reached from a SimConnect client? | Yes — no module needed |
> | Does id-walking terminate on MSFS 2024? | Yes — 5,364, two APIs agreeing |
> | Do multiple CommBus listeners all receive? | Still open, and still untested |
>
> A question this file never asked turned out to matter more than any of them:
> `L:` cannot be *read* client-side either, which is what put the module on the
> critical path. See [build/v1-log.md](build/v1-log.md).

## Blocking — verify before building on them

**Do multiple CommBus listeners on one channel name all receive?**
The opportunistic observation of FS Copilot's `FSC_GAUGE_EVENT` stream
([03-link](03-link.md)) assumes broadcast semantics. If only one listener wins,
the DOM layer needs a different route or gets dropped. Cheap to test with two
trivial modules.

**Does `node:sqlite` work under Electron 43?**
Confirmed loading on this machine's standalone Node 22.19 with an experimental
warning and no flag. Electron bundles its own Node build and may differ. If it
does not, the fallback is `better-sqlite3` with the native-rebuild cost that was
being avoided ([05-data-model](05-data-model.md)).

**Does walking ids through `get_name_of_named_variable` still terminate cleanly
on MSFS 2024?**
The entire `L:` enumeration rests on it. It is how MobiFlight builds its list,
but confirm against the current SDK rather than precedent
([02-namespaces](02-namespaces.md), [03-link](03-link.md)).

**Can `B:` input events be enumerated and subscribed from a SimConnect client
directly, without the module?**
`FsCopilot.wasm` contains the relevant RECV ids, which shows it works from
inside a module. If it works application-side too, phase 2 could ship before the
module — a significant reordering ([16-phasing](16-phasing.md)).

## Sizing and cost

**What does watching the full `A:` list cost?**
~1,200 names plus indices, polled and diffed alongside a few thousand `L:`
variables. Needs measuring before promising "watch everything". If it is too
expensive, the fallback is un-indexed names plus indices 1–4, configurable
([03-link](03-link.md)).

**How much of the default fleet is not on disk?**
This install has a `StreamedPackages` folder. Content living in the cloud cannot
be analysed offline, which bounds [11-static-analysis](11-static-analysis.md)
for default aircraft specifically. Worth measuring early, since it determines
whether Analysis is a payware-only feature.

## Decisions with unresolved edges

**Aircraft key edge cases.** The SimObject folder name is confirmed correct
([05-data-model](05-data-model.md)), but variant families need a policy:
`FNX_320_CFM`, `FNX_320_IAE`, `FNX_32X` are separate folders that may share most
variables. Do they share a catalogue, or link to a family?

**Default hotkey accelerator.** Must avoid combinations MSFS binds, which
Electron cannot see. Needs picking against the sim's default bindings rather
than guessed ([08-marks](08-marks.md)).

**MSFS 2020 support.** 2024 is what is installed and what the input-event work
leans on. Whether 2020 is supported at all, and at what fidelity, is unanswered
([01-goals](01-goals.md)).

## Settled — recorded so they are not reopened

- **`scanVars()` and "the dictionary" keep their names.** The collision was with
  "Scanner", and calling the live feed **Activity** dissolves it. No rename.
- **Names** — Variables, Activity, Finding, Mark, Probe, Link, Analysis, Report.
  Full table in [index](index.md), with the words already taken by this
  codebase.
- **Our own module**, not FS Copilot's, and **no patching of core sim files**
  ([03-link](03-link.md)).
- **No timeline in v1** ([07-activity](07-activity.md)).
- **No hold-to-record**, because `globalShortcut` has no key-up and the native
  alternative is not worth it ([08-marks](08-marks.md)).
- **Marks, not start/stop** ([08-marks](08-marks.md)).
- **Evidence per source, not a source flag** ([05-data-model](05-data-model.md)).
