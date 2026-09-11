# The addon report

    Purpose:    What Analysis produces per addon, and what it is for.
    Depends on: 11-static-analysis, 05-data-model
    Decides:    structured storage, the cold-start case, entry candidates, update diffs

> **Amended by the build.** The "implementation profile" section proposes
> predicting discoverability from the input-event count. That count is not a
> predictor as described — see the log entry "The runtime input-event list is a
> superset of the aircraft's own" in [build/v1-log.md](build/v1-log.md).

## Structured data, never a document

The report is **a saved query over the database**, not a generated file. Any
markdown or PDF export is one renderer over it, and never the storage.

That is what makes everything downstream possible: one-click insert, generated
starter profiles, update diffs, and Variables filtering by anything the report
shows.

## The primary use case is cold start

Not "what is my profile missing" — that is the second one. The first is: **an
addon was just bought and installed, and there is no profile at all.**

That changes the requirements. A coverage delta only needs names, because it
compares sets. Starting from an empty file needs enough to *emit entries*, and
the hard part is not the variable list — it is the organization.

So the report speaks in the profile format's own structure
([docs/profile-format.md](../profile-format.md)): proposed sections, with
variables assigned to them, in the shape a profile is actually written in.

## Contents

- **Identity** — package, creator, version, sim version, size, last modified,
  variants and liveries from `[FLTSIM.N]`
- **Systems map** — named circuits and buses from `systems.cfg`, so indexed
  `A:` variables get labels rather than numbers
- **Interaction map** — elements, tooltip labels resolved through `locPak`,
  the variables each reads and writes, the events each fires
- **Variable inventory** by namespace, with per-source confidence
- **Implementation profile** — XML-driven, JS-driven or WASM-driven, derived
  from where the code lives, plus the input-event count. This predicts *how
  discoverable the aircraft will be*, which sets expectations before somebody
  spends an hour concluding the tool is broken when it is the aircraft
- **Naming convention** — `ASCRJ_`, `INI_`, `XMLVAR_`, A2A's bare CamelCase.
  Groups the catalogue and attributes unknown variables to a family
- **Coverage delta** against the existing profile, if there is one

## Coverage delta, measured

On the installed PA-24: **524 distinct `L:` variables in the model XML, 295
bound by `pa24-250.yaml`, 327 unbound.** Filter the animation outputs using the
direction rule from [11-static-analysis](11-static-analysis.md) and what remains
is a ranked work list.

## Entry candidates

Each candidate carries the five fields from
[05-data-model](05-data-model.md) — name, units, section, block, `set:` — with
these sources:

- **units**: inline in the XML's RPN (`(L:FOO, Bool)`), else corpus consensus,
  else inferred from observed range
- **section**: `systems.cfg` groupings, tooltip labels, naming prefixes
- **block**: probe's cause-versus-symptom result ([10-probe](10-probe.md))
- **`set:`**: corpus patterns for structurally similar variables

With those, one-click insert is a formatting problem — the existing formatter
already knows the canonical shape — and "generate a starter profile" is that
loop plus the same formatter.

## Update diffs

Key the report to the package version and `layout.json` hash. When an addon
updates, re-analyse and diff:

> This update added 12 variables, removed 3, and one of the removed ones is
> bound in your profile.

A maintenance feature that falls out for nothing, addressing a problem that is
genuinely painful today and currently only discovered mid-flight.
