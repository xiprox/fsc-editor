# Sim variable discovery

Connecting the editor to the simulator so that variables can be discovered
rather than guessed, and the profiles that use them can be written from
evidence instead of from other people's files.

## How this record works

It is in two halves with different lifetimes, and knowing which is which
matters more than anything else here.

**The design record** — `01-17` — is what the feature set _is_: the whole
thing, including parts that are deliberately not being built yet. It is stable.
It is amended only by a pointer line at the top of a file naming the log entry
that overturned something, **never by silent rewriting**, because a design doc
that quietly changed is worse than one that is openly out of date.

**The build record** — `build/` — is what is _actually being built_, in what
order, and what the building has discovered. It is live and it moves.

> **Picking this up fresh?** v1 is built, and so is run setter. Read
> [build/v1-plan.md](build/v1-plan.md) — what shipped, what is deferred, and
> the one thing left to build — then the top of
> [build/v1-log.md](build/v1-log.md), which is one log covering the whole
> effort whatever the plan is called.
> [build/run-setter-plan.md](build/run-setter-plan.md) is now a record rather
> than a queue. Only then reach for the design docs, and treat any of them as
> amended by the log where the two disagree.

Each design part is self-contained. The descriptions below name the decisions
inside so you can tell which parts those are without opening anything. Every
part opens with three lines — `Purpose`, `Depends on`, `Decides` — so a file can
be judged before it is read in full. Cross-links are deliberate and sparse:
following one should be a choice, not a chain that drags the whole plan into
context.

## Build

| File                                 | What is in it                                                                                                                                                                                            |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [build/v1-plan.md](build/v1-plan.md) | **Start here.** What v1 includes, what it deliberately excludes and why, the six stages with exit criteria, and where each one currently stands. Supersedes [16-phasing](16-phasing.md) for build order. |
| [build/run-setter-plan.md](build/run-setter-plan.md) | **Built, and run against a live aircraft.** A play button in front of every `set:` line, running the setter against the live sim. Supersedes [10-probe](10-probe.md) entirely. |
| [build/var-index-plan.md](build/var-index-plan.md) | Turning the Variables panel from a corpus list into a view over every known variable — the identity spine, evidence facets, the SDK catalogue, and the aircraft filter. Extends [05-data-model](05-data-model.md) and [06-variables-panel](06-variables-panel.md). |
| [build/b-values-plan.md](build/b-values-plan.md) | **Not started, measurements taken.** Live values for `B:` input events — the last namespace with a working read the app does not use. Says which SimConnect call is the read and why the subscription cannot be. Extends [09-live-values](09-live-values.md). |
| [build/v1-log.md](build/v1-log.md)   | What the build discovered and what changed as a result, newest first. Including approaches tried and abandoned, which is the part git history cannot tell anyone.                                        |

## Foundation

| Part                              | What is in it                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [01-goals](01-goals.md)           | What problem this solves, for whom, what it is not. Positioning against MSFS's own dev tools and SPAD.neXt.                                                                                     |
| [02-namespaces](02-namespaces.md) | `A:` `L:` `K:` `H:` `B:` — four different discovery mechanics, not one. Which are enumerable, which are only observable, and the measured per-vendor coverage that makes the difference matter. |
| [03-link](03-link.md)             | Our own WASM module. Why not piggyback on FS Copilot's, the one form of piggybacking that is still fine, the rule against patching core sim files, and what the module is responsible for.      |
| [04-connection](04-connection.md) | Onboarding: the footer nudge, the install dialog, finding the Community folder, the four connection states, versioning and uninstall.                                                           |
| [05-data-model](05-data-model.md) | SQLite, the evidence-per-source schema, what identifies a variable, what identifies an aircraft, and what an "entry candidate" has to carry.                                                    |

## Live features

| Part                                        | What is in it                                                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [06-variables-panel](06-variables-panel.md) | The Variables panel — a standalone right-hand view over the database. The search specification, including why literal matching is the thing being fixed, and the ranking signal nobody else has. |
| [07-activity](07-activity.md)               | Activity — the bottom panel. Anchors, the findings feed, direct vs downstream changes, automatic repeat collapse, ambient noise, empty states.                                                   |
| [08-marks](08-marks.md)                     | The hotkey. What Electron can and cannot do with global shortcuts, why a mark beats a start/stop toggle, window defaults, and the persist-wide/display-narrow rule.                              |
| [09-live-values](09-live-values.md)         | Inlay hints showing each `get:` line's current value, and unknown-on-this-aircraft as a diagnostic. The cheapest thing that proves the transport works.                                          |
| [10-probe](10-probe.md)                     | **Superseded** by [build/run-setter-plan.md](build/run-setter-plan.md). Kept for the cause-vs-symptom reasoning, which survives, and the `A:` inversion, which has no successor yet.               |

## Offline analysis

| Part                                        | What is in it                                                                                                                                                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [11-static-analysis](11-static-analysis.md) | Reading addon files without the sim. What parses cleanly, what has to be mined, the read/write direction trick, tooltip labels, binaries, and the oracle principle that makes low-precision mining safe. |
| [12-rules](12-rules.md)                     | Extraction rules as data rather than code. How they get derived and scored, and the skill that lets anyone derive rules from their own addons.                                                           |
| [13-report](13-report.md)                   | The per-addon report as structured data. Cold-starting a profile for a newly bought addon, and what a candidate needs to become an entry.                                                                |

## Later

| Part                                            | What is in it                                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| [14-sweep-and-testing](14-sweep-and-testing.md) | Automated sweep of input events, profile regression against aircraft updates, and the two-machine end-to-end test the relay already makes possible. |

## Delivery

| Part                                      | What is in it                                                                                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| [15-ui-surfaces](15-ui-surfaces.md)       | Where everything sits. The rail buttons, the Variables panel, the Activity panel's span, the footer chip, and what is deliberately absent from v1. |
| [16-phasing](16-phasing.md)               | The feature-phase view. **Superseded for build order** by [build/v1-plan.md](build/v1-plan.md).                                                    |
| [17-open-questions](17-open-questions.md) | Everything that needs verifying before it is depended on, and the decisions already settled.                                                       |
| [18-language-core](18-language-core.md)   | The profile dialect's front-end: tokens, IR, stack simulation, rule engine. Foundation for the highlighting/completion/diagnostics pass.          |

## Names

Settled, because several obvious words are already taken by this codebase
(`profile`, `workspace`, `entry`, `section`, `manifest`, `dictionary`, `event`,
and `bridge` — which is FS Copilot's own package name):

| Name           | What it refers to                                                                           |
| -------------- | ------------------------------------------------------------------------------------------- |
| **Variables**  | The right-hand panel you open to find a variable.                                           |
| **Activity**   | The live feed of findings, in the bottom panel.                                             |
| **Log**        | The raw feed of everything the system is doing, sharing that panel. Internally `debug-log`. |
| **Finding**    | One row of Activity: an anchor plus what changed after it.                                  |
| **Mark**       | The hotkey action, and the anchor it creates.                                               |
| **Probe**      | Writing to a candidate to see what it does.                                                 |
| **Link**       | Our Community package, installed as `fsc-editor-link`.                                      |
| **Analysis**   | The offline scan of addon files.                                                            |
| **Report**     | What Analysis produces per addon.                                                           |
| **Dictionary** | Unchanged — the existing corpus scan behind `scanVars()`.                                   |
