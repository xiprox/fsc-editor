# v1 build plan

    Status:  Stages 0 and 8 are done. The corpus is committed — 69 profiles,
             the assertions extracted into `scripts/checks/`, all four sweeps
             rewired through them, golden output beside it — and the suite is
             1135 tests in 10 s.
             Stage 5 is done: the ring, the two-click button, both gates and
             the Settings About section have all been seen rendering, driven
             through every state in a running build.
             Stages 1, 2, 3, 7 and 9 are **written and unproven**. The
             workflows have never been executed by GitHub, and the updater
             itself cannot run in a development build — so the check, the
             download and the staging have never happened.
             Stages 4 and 6 are verification and cannot be done from a
             keyboard: they need a real release, a real install and a running
             simulator.
             The next thing that moves this forward is a pull request, and then
             a first release. Until then none of the exit criteria below have
             been met by anything.
    Scope:   A release pipeline for the editor and the relay, an updater the
             user drives from one control, and the guards that keep the
             committed WASM module honest.
    Log:     v1-log.md — newest first

**Start here.** The design docs describe the whole thing including parts that
are not being built yet; this file says what is actually being built, in what
order, and where each stage stands. Read [02-deployables](../02-deployables.md)
next — it is the doc the rest hangs off.

## The stages

Each exit criterion is a thing you can watch happen, not a box to tick.

| | Stage | Exit criterion | Status |
| --- | --- | --- | --- |
| 0 | **Version and the one-way door** | `package.json` at `0.1.0`, tag shapes settled, `relay/package.json` created, release-please config and manifest committed | **done** |
| 1 | **Build on a runner** | A `setup.exe` built by CI installs and launches, with the module present at `resources/link/fsc-editor-link/` | written, never run |
| 2 | **Publish** | `latest.yml`, the `.blockmap` and the installer on a public GitHub Release, all three fetchable anonymously | written, never run |
| 3 | **Updater, headless** | A `0.1.0` install detects `0.1.1`, stages it, and relaunches as `0.1.1`. No user interface at all. | written, never run |
| 4 | **Differential, proven** | `0.1.1 → 0.1.2` transfers materially less than the full installer, measured rather than assumed | not started |
| 5 | **The header slot** | Ring, two-click button, `tone-update`, both gates, strings registered in the copy review | **done** — every state seen |
| 6 | **Module over the air, proven** | A rebuilt wasm shipped in `0.1.3` replaces the one in a real Community folder on the next launch | not started |
| 7 | **The PR job** | the module guards, test, `relay:check`, bundle, `check:cascade` — not lint or `format:check`, see 03-checks | written, never run |
| 8 | **The corpus** | `corpus/` committed with `.gitattributes`, assertions extracted into `checks.ts` modules, golden files, the four sweeps still working against a real folder | **done** |
| 9 | **Relay deploy** | Merging the relay release PR deploys the Worker and nothing else does | written, never run |

Stages 7 and 8 are independent of 0–6 and can be built in either order relative
to them. 8 is the largest single piece of work here and the one with the least
risk attached.

**"Written, never run" is not most of the way to done.** None of 1, 2, 3, 7 or
9 has been executed by anything. A workflow that has never run is a guess about
runner behaviour, token scopes, action outputs and artifact naming — four things
this repository has no evidence about yet, and the updater has never performed a
check. Each of those stages keeps its exit criterion, and the criterion is a
thing that happened, not a file that exists.

### What each of them still needs

| | Still open |
| --- | --- |
| 1 | `npm ci` on a clean Windows runner; `electron-builder` finding `link/Packages/`; the installer actually running |
| 2 | That `--publish always` uploads to a release somebody else created; `RELEASE_PLEASE_TOKEN` existing as a repository secret. *(The output keys are settled — the root component is unprefixed, see v1-log.)* |
| 3 | That bundled `electron-updater` works in a *packaged* app — it bundles and typechecks, which is not the same claim |
| 5 | Only that the control appears *by itself*. Every state has been seen by publishing it into a running build; what a development build cannot do is produce one. |
| 7 | Whether the test suite passes on a runner rather than on the machine it was written on |
| 9 | `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` existing as repository secrets, the token with Workers deploy scope. The account id is passed as a secret rather than committed to `wrangler.toml`, which is public. |

## Where the discovery is

Most of this is assembly. Three stages are claims that could turn out to be
false, and they are the ones expected to produce log entries.

**Stage 4 — differential download.** The claim is that a point release transfers
a few megabytes rather than a hundred. It depends on the blockmap being uploaded
and fetched correctly for both the old and the new build, and it falls back to a
full download silently when anything about that fails. A silent fallback that
nobody measures is indistinguishable from a feature that does not exist.

**Stages 3 and 5 — progress on the differential path.** `download-progress` is emitted
by the differential downloader through its own transform, and that is the flakier
of electron-updater's two paths. If the event does not fire, or reports a total
it cannot know, the ring needs its indeterminate fallback. Verify rather than
assume.

**Stage 6 — the module chain end to end.** Every individual link is understood
([08-module](../08-module.md)) and none of it has been run in sequence. The
interesting part is the ordering: the module is replaced on the launch *after*
the restart, and a simulator already running will not rescan.

## Two things that will be proposed and are wrong

Recorded here because both are what a reasonable person reaches for.

**Adding the corpus sweeps to CI.** `check:format`, `check:grammar`,
`check:setters`, `check:highlight` and `check:claims` need folders that do not
exist on a runner. [03-checks](../03-checks.md) explains what happens instead.

**A PR comment previewing the release.** Considered and rejected —
[04-versioning](../04-versioning.md) has the reasoning. release-please's own
release PR is already that preview, one merge later.

## Stage 0 deserved a sentence of its own

`package.json` said `0.0.1`, which was a placeholder rather than a version, and
now says `0.1.0`. Once a build exists in somebody's hands the version line can
only move forward: electron-updater will not offer an older version, and a
number cannot be withdrawn from a machine that already has it.

The manifest deliberately starts *below* that, at `0.0.0`, so the first release
has somewhere to bump from — and the first one is pinned with a `Release-As:
0.1.0` footer rather than left to depend on which commit types happen to have
landed. See [04-versioning](../04-versioning.md).
