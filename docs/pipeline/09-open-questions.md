# Open questions

    Purpose:    What is deliberately not decided, and the reason each one is
                safe to defer.
    Depends on: everything
    Decides:    nothing — that is the point

Each entry says what would be built and why it is not being built now. Several
of these are safe *because of a fact that will stop being true*, and those say
which fact.

## Relay compatibility, and why it must not be left vague

**The fact that makes it safe today: there are zero released editor versions.**
The set of editors a relay deploy could break is currently empty. It stays
trivial for a while after `0.1.0`, and then quietly stops being trivial.

A table that declares "compatible" or "incompatible" cannot be computed. A check
can detect *change*, not *breakage*, and the gap between them is where the
interesting cases are:

- `MAX_GUESTS` 4 → 8 — the relay enforces it, old editors do not care. Fine.
- `CODE_LENGTH` 6 → 8 — old editors generate and parse six characters. Breaks,
  silently, for everyone on an old build.
- A new `CLOSE_*` code — depends entirely on whether the old client has a
  default branch.
- A new optional field on `RelayFrame` — fine. A required one — breaks.

Some of that is mechanically classifiable (a constant's value changed; a
non-optional field was added), but the verdict needs judgement, and a check that
prints "incompatible" with false confidence is worse than one that prints "you
changed the contract".

**The cheap version, to build first.** On the relay release PR: for every
released editor tag, compare `src/shared/remote-connect.ts` at that tag against
the one being deployed, and report the set that differs.

> Contract unchanged since `fsc-editor-v0.3.0`.
> Editors **v0.1.0 – v0.2.1** were built against a different contract.
> Changed: `CODE_LENGTH` 6 → 8. Acknowledge on this PR to deploy.

Mechanical, honest about what it knows, and it forces the thought at the only
moment it matters.

**The real version, later.** A conformance test: for each released editor tag,
run *that tag's* client against the new relay under `wrangler dev`, and assert
host, join, frame round-trip and close all work. That decides rather than
guesses, because it runs the code that is actually in the wild.
[scripts/remote-sandbox.ts](../../scripts/remote-sandbox.ts) already proves the
local-relay wiring; what is missing is a headless client driver rather than two
Electron windows.

## The tree does not pass its own linters

123 eslint errors, and 484 files prettier disagrees with — see
[03-checks](03-checks.md), which is why neither is a step in the PR job.

This is not a hard problem, it is a *large* one, and the order matters: clean
the tree in a change whose entire purpose is cleaning the tree, then add both
steps **in the same commit**, so that the repository never spends a day in a
state where the check exists and cannot pass.

The prettier half needs a decision first. Prettier would unwrap signatures that
were deliberately broken across lines, so accepting it means accepting a house
style somebody did not choose. The alternative is to bring the config to the
tree rather than the tree to the config, which is a smaller diff and a longer
conversation.

## Acknowledging an intended cascade change

`check:cascade` runs on every pull request and cannot block one, because it has
no way to tell a deliberate reordering from a regression — see
[03-checks](03-checks.md). Both look like "these two declarations swapped".

What would make it a gate is somewhere to record that a change was intended:
a committed baseline it diffs against, which a PR updates the way a golden file
is updated, so that an intentional change is a reviewable line in the diff
rather than a red check somebody waves through. That is the same shape as the
relay contract check above and the golden files in
[03-checks](03-checks.md) — a tripwire is only useful if there is an approved
way to step over it.

## Code signing

Parked in [01-goals](01-goals.md) as a non-goal, with options if it is
revisited:

- **Azure Trusted Signing**, around ten dollars a month, no hardware token, works
  from a hosted runner, inherits Microsoft's reputation immediately. The current
  answer for a project this size.
- **An OV certificate**, a few hundred a year, still warns until it accrues
  reputation.
- **EV**, more again, no warning, but awkward to use from CI.

Nothing in the pipeline needs to change to accommodate it later: signing adds a
`publisherName`, at which point electron-updater starts verifying Authenticode
as well as the SHA-512 it already verifies.

## Release channels

A `-beta.N` prerelease tag plus `allowPrerelease` would give a channel. Not built
because there is no second audience to serve yet, and with no telemetry
([01-goals](01-goals.md)) there is nothing to learn from a staged group that a
report would not tell you anyway.

## Rollback

There is none. A bad release is fixed by publishing a higher version, because
electron-updater will not offer an older one and a version number cannot be
withdrawn from a machine that already has it. Whether a "pinned known-good"
mechanism is worth having is untested; a fast follow-up release is the working
assumption.

## A private repository

The feed is GitHub Releases, which works anonymously because the repository is
public. Going private would require a token on every client — so the feed would
move to R2 behind the existing relay Worker instead: `/update/latest.yml` and
`/update/*.exe`, perhaps thirty lines, which would also buy staged rollout and a
kill switch. Recorded because the decision to stay public is load-bearing for
[05-release](05-release.md), not because a change is expected.

## Aggregate snapshots for the corpus

Deferred in [03-checks](03-checks.md). If the refusal list and scope histogram
return, they return as counts per category — three readable lines — not a line
per entry. A snapshot that churns is a snapshot nobody reads.

## Property-based generation

The grammar properties — idempotence, placement, containment — are textbook
targets for a generator, which would find variation no corpus contains. The
committed corpus is the cheap version and comes first; this is the version that
finds things nobody thought of.

## The motion rules

[06-updater](06-updater.md) amends [docs/ui.md](../ui.md) narrowly: a progress
indicator's own fill may transition, because it is continuous data rather than a
state change.

The broader question — whether the no-transition rule is too strict in general —
is deliberately **not** settled by that amendment. Widening a system rule by
inference from one control is how a system erodes. It wants its own pass over
`ui.md`, with examples, when somebody has the appetite for it.
