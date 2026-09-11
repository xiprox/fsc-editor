# The pipeline

What is built, what is released, what is deployed, and what is checked on the
way. Three deployables come out of this repository and only one of them is an
application — the other two are a Cloudflare Worker and a WASM module that no
hosted runner can build.

## How this record works

Two halves with different lifetimes, the same convention as
[sim-vars](../sim-vars/index.md).

**The design record** — `01-09` — is what the pipeline _is_, including parts
deliberately not built yet. It is stable. It is amended only by a pointer line
at the top of a file naming the log entry that overturned something, **never by
silent rewriting**.

**The build record** — `build/` — is what is _actually being built_, in what
order, and what the building has discovered. It is live and it moves.

> **Picking this up fresh?** Nothing here is built yet. Read
> [build/v1-plan.md](build/v1-plan.md) for the stages and where each one
> stands, then [02-deployables](02-deployables.md), which is the doc the rest
> hangs off. Treat any design doc as amended by
> [build/v1-log.md](build/v1-log.md) where the two disagree.

Each design part is self-contained and opens with three lines — `Purpose`,
`Depends on`, `Decides` — so a file can be judged before it is read in full.

## Build

| File | What is in it |
| --- | --- |
| [build/v1-plan.md](build/v1-plan.md) | **Start here.** The stages, each with an exit criterion that is a thing you can watch happen, and where each one currently stands. |
| [build/v1-log.md](build/v1-log.md) | What the building discovered and what changed as a result, newest first — including approaches tried and abandoned, which is the part git history cannot tell anyone. |

## Design

| Part | What is in it |
| --- | --- |
| [01-goals](01-goals.md) | What shipping means here, who it is for, and the five things deliberately not automated. |
| [02-deployables](02-deployables.md) | The editor, the relay and the Link module: their lifetimes, who can build each, the contracts between them, and why the editor and the relay release separately. |
| [03-checks](03-checks.md) | What runs on a pull request. The committed corpus, the extraction that makes the sweeps' assertions testable, and the five scripts that will never run in CI. |
| [04-versioning](04-versioning.md) | release-please in manifest mode, conventional commits, the 0.x bump rules, and two mechanisms considered and rejected. |
| [05-release](05-release.md) | The editor release: what is built, on what runner, and what a release contains. |
| [06-updater](06-updater.md) | How an installed editor updates itself, and the one control the user ever sees. |
| [07-relay](07-relay.md) | How the relay is versioned and deployed, and the rule that keeps editors in the wild working. |
| [08-module](08-module.md) | The Link module's custody — built by hand, committed, carried inside the editor — and the three guards that keep the committed bytes honest. |
| [09-open-questions](09-open-questions.md) | Signing, channels, rollback, relay conformance testing, and the motion rules. Each with the reason it is parked, because what makes several of these dangerous is that they stay fine right up until they do not. |
