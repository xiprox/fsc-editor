# Phasing

    Purpose:    Build order, and what each phase is worth on its own.
    Depends on: everything
    Decides:    sequence, and what each phase proves

> **Superseded for build order by [build/v1-plan.md](build/v1-plan.md).**
> This remains the feature-phase view — what each phase is worth and what it
> proves. The build sequences these differently: the database moves ahead of the
> module, on the reasoning that enumeration widens a watch set without changing
> any design. Read the build plan for what is actually being built.

Each phase ships on its own and proves something the next one depends on. The
ordering deliberately inverts the order these features were first imagined in:
the catalogue was the first idea and is phase 3, because most of it falls out of
the phases before it.

## Phase 0 — Link and connection

[03-link](03-link.md), [04-connection](04-connection.md)

The module, the install flow, the footer chip and its four states. A handshake
that reports a version and an aircraft, and nothing else.

**Proves:** the transport works, the package installs where people actually keep
their Community folder, and the restart-required state is legible.

**Ships as:** a chip that says `Sim · pa24-250`. Nothing else visible.

## Phase 1 — Live values

[09-live-values](09-live-values.md)

Watch the open file's `get:` lines, render values as inlay hints.

**Proves:** subscription, delivery and renderer update, with a UI surface small
enough that any wrongness is obviously in the pipeline.

**Ships as:** the editor becomes a debugger for the profile on screen. This is
already worth having on its own.

## Phase 2 — Activity, without enumeration

[07-activity](07-activity.md), [08-marks](08-marks.md)

Input-event anchors, the hotkey, the findings feed, direct and downstream tiers,
repeat collapse. Watching the corpus's known variables plus whatever the open
profiles reference.

**Proves:** the anchor model, and answers the original motivating question —
which variable does this switch move — with no `L:` enumeration and no database.

**Ships as:** the feature this whole plan started from.

## Phase 3 — Enumeration, database, Variables panel

[05-data-model](05-data-model.md), [06-variables-panel](06-variables-panel.md)

`L:` id-walk enumeration, SQLite, evidence per source, the search index, the
panel.

**Proves:** the evidence model holds three sources at once, and search is
actually better than the tools being replaced.

**Ships as:** the catalogue — which by now is largely a matter of persisting
what phases 1 and 2 already collect, plus one enumeration pass.

## Phase 4 — Probe

[10-probe](10-probe.md)

Write, observe, restore. Cause-versus-symptom classification and the desync
warning.

**Proves:** findings can be confirmed rather than guessed at, and the
`shared`/`master` inference has a basis.

## Phase 5 — Analysis, rules, report

[11-static-analysis](11-static-analysis.md), [12-rules](12-rules.md),
[13-report](13-report.md)

Offline file mining, the rule format and engine, the derivation skill, the
per-addon report and the cold-start flow.

**Proves:** the oracle principle — that low-precision mining is safe when the
sim and the corpus can promote candidates.

**Note:** deliberately after phase 3, because phase 3 supplies the answer key
that makes rule scoring meaningful.

## Phase 6 — Sweep and testing

[14-sweep-and-testing](14-sweep-and-testing.md)

Automated input-event sweep, profile regression against aircraft updates, and
the two-machine end-to-end test.

## Cross-cutting, not a phase

- The `A:` static list and `K:` list can ship any time from phase 2 onward.
- The horizontal splitter and rail buttons ([15-ui-surfaces](15-ui-surfaces.md))
  are needed by phase 2 and phase 3 respectively.
- Everything degrades to today's corpus-only behaviour when disconnected, in
  every phase.
