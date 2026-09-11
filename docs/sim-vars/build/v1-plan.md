# v1 build plan

    Status:     every stage BUILT. 0, 1, 1b, 2, 2a, 2b, 2c and 3 are verified
                against a live simulator. 4 and 5 have been run in a cockpit
                once, on 2026-08-24; that run found the ranking wanting, and
                the fixes it produced — `promiscuity`, `MIN_QUIET_MS`,
                `snapshotsIn` — are verified against the captures it left
                behind rather than re-run live.
                **`L:` works end to end.** Our own WASM module enumerates the
                table, streams deltas, and a profile's `L:` lines show live
                values in the editor that follow a control being moved by hand.
                The install flow — discovery, install, auto-update, uninstall,
                four chip states — has been used to install the module it is
                now running.
                What is left below is mostly checks rather than work, and none
                of those block anything. **One item is work**: the sim
                announces an aircraft twice, in two spellings, and the app
                keys off the raw one — so for a moment the running aircraft
                matches no profile. See "Deferred, and waiting on a simulator".
    Supersedes: 16-phasing, for build order
    Log:        v1-log.md

> **Renamed 2026-09-20.** Our own environment variables moved from `FSC_` to
> `FSCE_`, so `FSCE_SIM_REPLAY` below reads as it does in the code. Bare
> `FSC_` is FS Copilot's own — profile `L:` variables, the client data on the
> wire — and keeps its name.

**Start here.** Read this before any design doc. The design record in
`docs/sim-vars/01-17` describes the whole feature set including things v1
deliberately does not build; this file says what is actually being built, in
what order, and where it currently stands. Anything the build discovered that
contradicts a design doc is in [v1-log.md](v1-log.md).

## Resuming

Read this file, then the top of [v1-log.md](v1-log.md). That is enough to
continue without any of the conversation that produced them.

**Everything is committed.** The history was squashed to `65f0a58` and the
working tree matches it. The old chain — `a3a856e` and the `progress` commits
after it — survives only as unreferenced objects, so a resuming session should
read the tree rather than go looking for a diff that no longer exists.

At the time of writing: **853 tests** pass, `npm run typecheck` is clean, and
`npx eslint src/` reports one error and one warning. The error is
`variables/index.tsx`'s `useVirtualizer()`, which `react-hooks` cannot prove
memoizable; `editor-pane.tsx`, which used to hold the only one, is clean.

**Prettier is not clean and has not been for some time** — most committed files
differ from it once CRLF is normalized away, so `npm run format` would produce a
repo-wide diff unrelated to whatever is being worked on. Match the surrounding
code rather than the formatter, or fix it deliberately in its own commit.

### Where things are

| | |
| --- | --- |
| `src/shared/sim.ts` | the event contract — raw `SimEvent` vs derived `SimState` |
| `src/shared/link.ts` | the module wire format and its parsers |
| `src/shared/link-install.ts` | the install contract, and the `UserCfg.opt` parser |
| `src/main/sim/session.ts` | the SimConnect client — `A:`, `B:`, aircraft |
| `src/main/sim/link.ts` | the app's half of the module protocol |
| `src/main/sim/install.ts` | Community discovery, install, uninstall. No electron, no SimConnect |
| `src/main/sim/live-values.ts` | the current value of everything, fed by both transports |
| `src/shared/activity.ts`, `src/main/activity.ts` | anchors, baselines, findings — stage 4's ranking |
| `src/main/activity-debug.ts` | the ranking's working, written to a file. The Bug button in the Activity header |
| `src/main/activity-history.ts` | what one session teaches the next. Owns the moment an anchor is *finished* |
| `src/main/activity-buffer.ts` | the packed ring the ranking runs over |
| `src/main/marks.ts` | the global hotkey, and what registration cannot promise |
| `src/renderer/.../components/activity/` | the Activity panel |
| `src/renderer/.../components/var-chip.tsx` | a variable and its live value, in the editor's own colours. Used wherever a name is shown |
| `src/renderer/.../lib/var-watch.ts` | ref-counted retain/release, so panels join the editor's watch set rather than replacing it |
| `scripts/slice-capture.ts` | cuts a committable window out of a 90 MB capture |
| `src/renderer/.../lib/live-decorations.ts` | live values drawn on `get:` lines. **Not inlay hints — see the log** |
| `src/renderer/.../components/sim/` | the footer chip's four states, and the install dialog |
| `link/Packages/` | **committed** — the built package the installer copies. See its `.gitignore` |
| `src/main/sim/store.ts` | writes `sim_variable` / `sim_observation` / `sim_aircraft` / `sim_coincidence`, and reads the last two back as history |
| `src/main/sim/capture.ts`, `replay.ts` | NDJSON captures, and playing them back |
| `src/main/sim/fixtures/` | two real captures, two synthetic. Its README says which is which and why |
| `src/main/log.ts`, `renderer/.../components/log/` | the Log panel |
| `link/` | the WASM module sub-project. **Read `link/README.md` first** |
| `link/transcripts/` | what the module said, one file per `link:read`. Gitignored |

### Commands

```
npm run sim:sandbox                       list captures
npm run sim:sandbox -- <file|n>           replay one into the app
npm run sim:sandbox -- <file> --print     print one

npm run link:build                        build + verify + install the module
npm run link:read                         watch the module's stream
npm run link:read -- enumerate            make it re-walk the table
```

`link:build` takes ~18s and **refuses to run while MSFS is open** —
fspackagetool drives the sim executable and hangs rather than failing.

The module accepts `start`, `stop` and `enumerate` and nothing else. The stage
2a probes — `units`, `snap`, `delta`, `unitof` — are gone with the spike; their
answers are in the log and the module they ran in is at `a3a856e`.

### Conventions worth not rediscovering

- **UI is shadcn, always.** Add missing components with
  `npx shadcn@latest add <name> --yes` rather than approximating them with a
  native control. Panel header actions are ghost icon buttons, not text.
- **Verify a script through its documented `npm run` command.** PowerShell to
  npm to bash has a different environment than bash directly — `$APPDATA` is
  absent and `$HOME` can be `/home/<user>`. **Three** scripts have shipped
  broken this way. The last one was worse than a missing variable: from
  PowerShell, `bash` is the WSL shim rather than Git Bash, so a script written
  for MSYS ran in an environment where none of its assumptions held. Shell
  scripts go through `link/tools/bash.mjs` now, which picks the right one.
- **Write escapes with a real editor tool, not a shell heredoc.** `'\0'` has
  collapsed to a literal NUL three times, in two source files and in the log
  entry about it happening.
- **The sim is a slow, manual dependency.** Batch everything that needs it into
  one session. `link/transcripts/` and `src/main/sim/fixtures/` exist so a
  question only has to be asked of it once.

### Deferred, and waiting on a simulator

**Run 2026-08-24.** Most of these are answered; two produced findings, and the
findings are the work now. See the two entries at the top of
[v1-log.md](v1-log.md).

- ~~**`npm run link:read` since the second-client fix.**~~ **Passed.** Names
  arrive before any values with two clients attached. Transcripts in
  `link/transcripts/2026-08-24T16-57-09-start.txt`.
- ~~**Whether `Ctrl+Alt+M` collides with MSFS.**~~ **No collision observed** in
  a PA-24 cockpit. Not a proof for every aircraft or every binding set, but it
  is the only test there is, and it passed.
- ~~**Re-enumeration against a cold-and-dark A2A load.**~~ **Failed, and worse
  than expected.** Enumeration ended holding 3,963 of 5,343 names — the missing
  tail being the aircraft's own controls. The ladder never reached its third
  step. **This is now work, not a check**: see the log entry.
- ~~**The exit criterion itself**, and **a mark on a control the sim does not
  report.**~~ **Run, and the answers are poor.** The loop works — hotkey, flip,
  ranked list — but the list is topped by click sounds, eyelid blinks and a
  camera accumulator, and the right variable places below them or not at all.
  Diagnosed: the ranking has no measure for a variable that moves for *every*
  interaction. See the log entry, and `activity-debug.ts` for the instrument
  built to settle it against the next session rather than against one capture.

**Since fixed, from the first dump:** the ambient filter was rejecting the whole
aircraft on a young buffer — 5,551 of 5,554 variables, the cabin vent lever
among them. `MIN_QUIET_MS`, and `pa24-mark-cabin-vent.ndjson.gz` is the session
kept as a regression. A mark now answers with the control that was pulled.

**Also fixed:** a mark taken in the first half-minute ranked the enumeration
snapshot — 5,397 candidates, all "moved once, next to an anchor". `snapshotsIn`,
and the ranking now leads with `promiscuity`: how many *different* controls a
variable answers to. Every correct answer in a 12-control session scored 1;
every click sound, blink offset and camera accumulator scored 8 to 11.

Still only answerable in a cockpit:

- **A mark on a control that moves no `L:` at all.** Distinct from the above:
  the sessions so far cannot separate "the ranking buried it" from "there was
  nothing to find". Only 12 `A:` variables are watched, all of them from the
  profile, so a control the aircraft implements as a SimVar is invisible to the
  ranking whatever it does.
- **The tagged `A:` read has not recurred, which is not the same as proven.** It
  crashed once on a positional read walking off the end of a message. `A:` is
  requested tagged now and read in `sim/tagged.ts` (8 tests), and many live
  sessions since — at `SIM_FRAME`, so far more messages than before — have not
  reproduced it. Nothing has deliberately re-created the condition, which is a
  variable the aircraft does not have sitting mid-watch-set.

### Open decisions

- ~~**Captures are unbounded, and large.**~~ **Resolved: bounded in the capture
  layer, not by capturing less.** `CAPTURE_LIMITS` in `sim/capture.ts` caps a
  part at 25 MB and the directory at 100 MB; `prune` evicts oldest-first before
  a session opens, never touching the part being written. The always-on premise
  survives — what changed is that history has a ceiling. Observed working: the
  folder sits at exactly its 100 MB cap, and a long session rolls to `.p2`.
  The debug report gzips captures into its zip, which is a consumer of this
  decision rather than the place it was made.
- ~~**`k_version` and `package_version` disagree**~~ **Resolved 2026-08-27, by
  removing the second number rather than by correcting it.** They had drifted
  to `0.3.0` on the wire against `0.0.1` in the manifest, because only one of
  them had a reason to be maintained: `k_version` is in the handshake, so a
  protocol change forces somebody to look at it, while `<AssetPackage Version>`
  is read by fspackagetool and nobody else. `link/build.sh` now derives the XML
  from `k_version` before packaging and asserts the manifest afterwards — see
  `link/tools/version.mjs`. **Not yet verified through a real build**, which
  needs the SDK and a closed sim; the definition is synced and the committed
  `link/Packages/` artifact still says `0.0.1` until the next rebuild.
- ~~**Replace `fixtures/link-session.ndjson` with a real capture.**~~
  **Resolved 2026-08-27, by addition rather than replacement.** Every capture
  on disk was measured against the two properties the L: tests assert, and
  exactly one satisfies both — a parked A350 whose only moving variable is a
  camera accumulator. The reason is structural: a real session re-walks the
  table while values flow, so names land after values, and it enumerates
  thousands of names of which a few hundred move. Those properties are the
  module's contract, and a generated fixture is the right place to assert one.
  So `bonanza-l-values.ndjson.gz` was added beside it — fifteen real seconds,
  and the only fixture that can ask whether a variable registering *late* still
  reaches the editor. The fixtures README carries the reasoning.
- ~~**08-marks' ±60 s persistence on mark**~~ **Not built, and not planned.** It
  exists so a *window adjustment* survives the ring rolling over. Nothing
  adjusts a window, and after the 2026-08-24 run nothing wants to — the mark
  answers with the control that was pulled, and a window nobody moves needs no
  protection from the ring. It becomes work again if window adjustment does.
- ~~**`link/.gitignore` excludes `Packages/`.**~~ **Resolved:** committed and
  shipped through `extraResources`.
- ~~**`A:` updates at 1 Hz.**~~ **Resolved:** read at `SIM_FRAME`, recorded to
  the capture once a second.
- ~~**The Log panel needs burst grouping.**~~ **Resolved:** it calls stage 4's
  rule through `inBurstAt`.

**Next action: normalise the aircraft key.** The sim announces a load twice —
once as `SimObjects\Airplanes\A350\…` and once as an absolute lowercase path —
and `folderFromPath` returns the segment as written, so the app sees `A350` and
then `a350`. `profileKey` lowercases, and compares exactly, so the first of
those matches no profile: for that moment the running aircraft has none, which
is what gates the run-setter buttons and every aircraft-scoped facet. One line,
no simulator needed. See the 2026-08-27 log entry.

**Still suspect, but no longer the next action: the settle rule.** It stops on
a pause rather than on a finished table, which cost 74% of a table on
2026-08-24 — but a Bonanza on 2026-08-27 ran the full ladder and lost nothing.
One observation, not a reproducible trigger. The same log entry has the two
ways a capture misleads on this, which is worth reading before measuring it
again.

[run-setter-plan.md](run-setter-plan.md) — a play button in front of every
`set:` line, running the setter against the live simulator — is **built and has
been run live**. It **supersedes 10-probe entirely**, which is the one row of
the scope table below that has changed answer rather than merely waited.

## Scope

v1 answers one question: **which variable does this switch move**, and shows
live values while a profile is being written. It is complete when that workflow
works end to end.

### In

- A SimConnect client in the main process, for `A:` and `B:`
- SQLite as the system of record, with the existing profile corpus as its first
  source
- Completions served from the database rather than an in-memory scan
- The Variables panel — search over the dictionary (pulled forward, see 1b)
- **The Link module**, for `L:` enumeration and reads, plus the install flow
  it brings with it
- Live values as inlay hints on `get:` lines
- Activity: input-event and mark anchors, findings with direct and downstream
  tiers, repeat collapse
- The global hotkey
- Rail buttons and the horizontal splitter

### Out, and why

| Deferred | Reason |
| --- | --- |
| Probe | **Not being built at all.** Running the profile's own `set:` line answers a better question for less machinery — see [run-setter-plan.md](run-setter-plan.md). |
| Analysis, rules, report | Wants the enumeration answer key to score against — see [12](../12-rules.md). |
| Sweep, regression testing | Rearrangements of primitives none of which exist yet. |

### The one thing that changed this scope — resolved

The question asked here was whether `B:` input events could be reached without
the module. They can, and stage 0 proved it. The module came onto the critical
path anyway, for a question nobody had asked: `L:` variables cannot be **read**
from a SimConnect client either, and they are 84% of the corpus. Enumeration was
never the binding constraint.

The decision taken in response was to build the module now rather than narrow
v1 around the gap — it is also what unblocks probe, the Variables panel's live
half, and the `H:` CommBus route, so the toolchain gets paid for once. Full
reasoning in the log.

## Stages

### Stage 0 — Spike

**Throwaway.** One scratch script, timeboxed, deleted afterwards. No product
code, no commits to `src/`.

Questions, in order of consequence:

1. Does a pure-JS SimConnect client connect from Electron main? Does it need the
   SDK present? (`node-simconnect` is the candidate.)
2. Does the aircraft-loaded event yield `pa24-250` — matching FS Copilot's log
   and the profile filename ([05](../05-data-model.md))?
3. Does `A:` subscription deliver values?
4. **Does `EnumerateInputEvents` return the PA-24's 127?**
5. Does `SubscribeInputEvent` fire on a cockpit click?
6. Does `node:sqlite` load under Electron 43?

**Exit:** a script printing input event names as switches are flipped, and a log
entry recording all six answers.

**Status: COMPLETE.** All six questions PASS against MSFS 2024 (SunRise 12.2)
and the A2A PA-24. Input events are reachable from a plain client, so **the
module stays off the critical path** and is justified by `L:` enumeration alone.

Four findings changed things downstream — input events fire twice, the runtime
list is a superset of the aircraft's own, the loaded path is package-relative,
and 2024 uses a preset/common layout. All in [v1-log.md](v1-log.md), with
pointers added to the five design docs they amend.

`node-simconnect` is a real dependency as of stage 2, and the spike is deleted.

### Stage 1 — Database, backed by the corpus

No sim involvement. The schema from [05](../05-data-model.md), with the corpus
as its only source.

- Evidence-per-source tables
- Migrate `scanVars()` output into them; `VarEntry` becomes a projection
- Completions read from the database
- Rescan becomes incremental — a diff against stored mtimes rather than
  re-reading all 55 profiles on every launch

**Why first:** it is the backbone, it has a real consumer on day one, and
migrating 12,000 existing rows is the honest test of whether the evidence model
holds. If it cannot cleanly represent what `VarEntry` already carries, that is
worth knowing in week one.

**Exit:** completions behave exactly as they do today, sourced from SQLite, and
a second launch does not re-read unchanged profiles.

**Status: COMPLETE.** Both criteria verified against the real corpus — 64
profiles, 12,578 variables, output identical field by field to the previous
implementation, cold 338ms against warm 88ms. `Api.scanVars()` is unchanged, so
nothing in the renderer moved.

Landed as `src/main/db.ts` (schema and migrations), a rewritten
`src/main/vars.ts` (incremental scan, storage, projection) and
`src/main/vars.test.ts` (16 tests, no filesystem). One trap found and recorded:
SQLite's `ORDER BY` does not agree with `localeCompare`.

### Stage 1b — Variables panel

Out of the original order, added because it turned out to need no
main-process code at all: the store already holds the whole index, and
[06](../06-variables-panel.md) puts the search index in memory anyway.

**Exit:** the dictionary is searchable in a way the tools this replaces are not.

**Status: COMPLETE.** Built:

- `src/renderer/src/lib/var-search.ts` — normalization, unordered word AND,
  containment, subsequence fallback, namespace prefix as a filter, ranking tiers
  tie-broken on how many profiles use a variable. 15 tests.
- `src/renderer/src/components/variables/index.tsx` — the panel.
- `src/renderer/src/components/rail.tsx` — the rail, generalized to hold both
  panels as vertical buttons. Needed by stage 5 anyway.
- `store.ts` — `remoteOpen` became `panel: "remote" | "variables" | null`, with
  the old key migrated on read.

**Not built, and 06 still describes them:** the `in sim` and `new` filters, live
values in rows, probe, insert-at-cursor, reveal-in-Activity. All of them need
evidence that does not exist until the sim is connected.

### Stage 2 — Transport and the capture harness

The connection lives in main, for the same reason the relay socket does: the
packaged app's CSP puts the renderer out of reach of anything on the network.

- Sim client in main, exposed through `Api` in `src/shared/types.ts` and the
  preload bridge
- Footer chip, the two states reachable without a module — `Sim offline` and
  `Sim · <aircraft>`. The install states arrive with 2b ([04](../04-connection.md))
- **Every event captured to disk**, timestamped and appendable, each one
  carrying its `source`. There are two producers coming, not one, and adding
  the field after captures exist is a fixture migration
- `scripts/sim-sandbox.ts` replays a capture into the running app

**Why the harness matters:** Activity's value is ranking and correlation, which
is pure logic over an event stream. Captured once, all of it can be developed
and tuned with the sim closed, and the captures become vitest fixtures — which
is what this repo already does with `diff-hunks.test.ts` and
`scripts/remote-sandbox.ts`.

**Exit:** the chip reads `Sim · pa24-250`, and a captured session exists on disk.

**Status: COMPLETE**, verified against MSFS 2024 and the A2A PA-24. Built:

- `src/shared/sim.ts` — the contract. Two layers kept apart: `SimEvent`, the
  raw record that goes to disk and becomes stage 4's fixtures, and `SimState`,
  the derived summary the chip renders. Every event carries `t` and `source`.
- `src/main/sim/session.ts` — the client. Connect with retry, aircraft
  tracking and re-enumeration on aircraft change, input-event enumeration and
  subscription, and an `A:` watch set for stage 3 to fill.
- `src/main/sim/capture.ts` — NDJSON, append-only, renamed on close to name its
  aircraft. No header record: the `open` event is always first and carries what
  a header would, so a capture has one shape and a truncated file is still a
  valid prefix.
- `src/main/sim/replay.ts` and `scripts/sim-sandbox.ts` — `FSCE_SIM_REPLAY`
  swaps the event source and changes nothing else, so replay exercises the real
  path. The script lists, prints and plays captures.
- The footer chip, three states — the two install states need a module.
- 23 tests over the capture format, the round trip and replay.

**Verified live:** one 437-second session — connected, `pa24-250` derived from
the loaded path, 318 input events enumerated (matching stage 0 exactly), events
firing by name, 771 of them captured and the file renamed to name its aircraft.
The session changed aircraft twice, which exercised re-enumeration:
`microsoft-pilatus-pc6` at 260, and the PA-24's 318 on return.

Four things recorded: the packaged app had been unshippable in two separate
ways; the double-fire collapse moved to read time; **an aircraft change
snapshots every input event 4-8 seconds before announcing itself**, which needs
a burst filter in stage 4; and the echo window is now measured at 40 ms against
a nearest genuine repeat of 261 ms.

### Stage 2a — Link spike

**Throwaway**, exactly like stage 0: a scratch package, timeboxed, deleted once
its answers are in the log. No product code.

Questions, in order of consequence:

1. ~~Can we build a `.wasm` gauge module at all, and with what toolchain?~~
   **ANSWERED.** `C:\MSFS 2024 SDK` alone — `WASM/llvm/bin/clang-cl.exe` and
   `wasm-ld.exe`, target `wasm32-unknown-wasi`. No Visual Studio, no MSBuild.
   A minimal module built first try. See the log entry "A `.wasm` module builds
   from the SDK alone".
2. Does a minimal module load from `Community` and announce itself — one byte
   to the app over a ClientData area of our own naming?
3. **Does walking ids through `get_name_of_named_variable` terminate cleanly on
   MSFS 2024?** Open since [17](../17-open-questions.md); the whole of `L:`
   rests on it.
4. ~~Does `get_named_variable_value` by id read what enumeration found?~~
   **Answered at link time**: both it and `get_name_of_named_variable` are
   declared in the 2024 SDK's `MSFS/Legacy/gauges.h` and resolve against the
   host import table. Whether the values are *right* still wants a look.
5. Does any of this collide with `fscopilot-bridge` when both are installed and
   FS Copilot is running? [03](../03-link.md) predicts not, having given us our
   own prefixes, but contention is the failure mode that would be worst
   discovered late.

**Exit:** a script printing `L:` names and values enumerated from the PA-24 by
our own module, and a log entry answering all five.

**Status: COMPLETE.** All five questions PASS against MSFS 2024 and the A2A
PA-24.

**5,364 `L:` variables enumerated, and the walk terminates.** Both APIs stop at
exactly id 5364 — the legacy call with a null name, the modern one with error
`INVALID_ARGS` — with the same count and the same names at the same ids. Two
independent walks agreeing is what makes that an answer.

`fsVarsRegisterVarsStatusUpdateHandler` works too; it had fired twice by the
time the dump ran. No collision with `fscopilot-bridge`, which is installed
alongside.

Three findings came out of it, all in the log, and two change what 2b builds:

- **The `L:` table is a superset** — the aircraft's own share is ~5%. The rest
  is every other installed add-on and the sim's globals.
- **`fsVarsLVarGet` converts units** and disagrees with the legacy read by a
  factor of 264 on at least one variable. Which read to use is **open** — it
  turns on which one agrees with FS Copilot, whose watcher also converts.
- The module took four attempts, none failing at build time. See "The module
  must export MSFS's allocator".

It took three tries to get a module the simulator would run, and none of the
failures were in the C++. That is why `link/` is built by MSBuild through the
MSFS2024 toolset, packaged by `fspackagetool`, and gated by
`link/tools/check.mjs` before install.

### Stage 2c — Log panel

Out of order, before 2b, because 2b is the stage that most needs it: a WASM
module's only voice is a transport being written at the same time.

- Ring buffer in **main**, batched to the renderer — a renderer reload must not
  lose the history, and a 318-event burst must not become 318 IPC messages
- Bottom panel sharing its slot with Activity, a second bottom-aligned rail
  button, and the **horizontal splitter** stage 5 needs anyway
- Filters: source, level, text, and collapse-adjacent-repeats
- Main's `console.warn`/`error` mirrored in, since a packaged build has no
  terminal to print them to

**Exit:** replay a capture and watch it arrive.

**Status: COMPLETE**, and looked at.

Built as `src/shared/log.ts` (contract), `src/main/log.ts` (ring, batching,
console capture), `src/renderer/src/lib/log-filter.ts` (+31 tests across both),
`src/renderer/src/components/log/index.tsx`, and the layout changes: `Rail`
gained a bottom group, `Splitter` gained a horizontal orientation, and
`usePanelWidth` gained a `bottom` side.

One bug found by its own tests and worth remembering: `clearLog` emptied the
pending queue without cancelling the scheduled flush, and since `log` only
schedules when no flush is pending, that silently stopped every future batch.

### Stage 2b — Link, for real

The module as [03](../03-link.md) describes it, minus what it does not yet need.

- Enumerate `L:`, read by id, diff in-module at 10–20 Hz with a float deadband,
  send deltas only
- Protocol version in the handshake, from the first release
- Feeds the stage 2 harness as `via: "link"` — one source, two transports; the
  app degrades to `A:`/`B:` when the module is absent, which is what made 2a's
  failure survivable
- The install flow from [04](../04-connection.md), back in scope with the
  module: `UserCfg.opt` discovery, the dialog, the remaining two chip states,
  reinstall and uninstall

Deliberately not in 2b: calculator execution for probe, the `A:` watch list
(the client already has `A:`), and the CommBus observation of `H:`. Each is a
later addition to a module that exists, which is the whole argument for
building it.

**Exit:** `L:DmeOnOffKnob` appears in a capture, with values, after a cockpit
click.

**Status: COMPLETE**, and verified live. A profile's `L:` lines show values that
track a control being moved by hand in the simulator, in both start orders —
editor first then MSFS, and MSFS first then editor. The module, the protocol,
the app's half, the database writing and the install flow are all built and in
use.

That same session found a bug, now fixed but **not yet confirmed against the
sim**: a second client got no enumeration, because `start` only enumerated when
the table was empty. Confirming it is one line of `npm run link:read` output —
`names:` chunks should appear *before* any values.

Done: `src/shared/link.ts` (format + parsers, 19 tests), `link/src/module.cpp`
rewritten to enumerate once and stream 15 Hz deltas, `src/main/sim/link.ts` (the
app's half), wired into `session.ts` so link events land in the same capture and
Log panel as everything else, and shown on the footer chip.

Also done: `src/main/sim/store.ts` writes `sim_variable` (every enumerated name,
so completions finally know what the sim *has*) and `sim_observation` (what moved,
per aircraft). Batched at 5 s, flushed on aircraft change so one aircraft's
changes never follow the next, and never throwing.

Also done: **the install flow** from [04](../04-connection.md).
`src/shared/link-install.ts` holds the contract and the `UserCfg.opt` parser;
`src/main/sim/install.ts` does discovery, install, reinstall and uninstall with
no electron and no SimConnect in it, which is what makes 19 tests over a temp
directory possible. The dialog and the chip's four states are in
`components/sim/`. `link/Packages/` is now committed and shipped through
`extraResources`, verified in an unpacked build at
`resources/link/fsc-editor-link/`.

Six things it decided that the design did not say:

- **The four chip states are two facts, not four phases** — installed, and
  connected — plus a three-second grace, because "module silent" is otherwise
  true for the first moment of every connection.
- **Junctions cut both ways.** Community folders are full of them, this machine
  included, and uninstall must not recurse through one nor install write through
  one.
- **Compare bytes, not versions.** The manifest and the module report different
  version numbers for the same artifact, so `current` is a sha256 of the wasm —
  and it is `same | different | unknown`, because a build with nothing to
  compare against must not report a good install as stale.
- **Updates apply themselves.** 04's fifth state offers an update; the offer has
  one right answer and should not be a question. `updateStaleLinks` runs at
  startup, never installs where nothing is installed, and never acts on
  `unknown`.
- **The folder is proposed, not listed.** `UserCfg.opt` is authoritative, so a
  picker of two near-identical absolute paths asks the user a question we
  already know the answer to.
- **The chip reports state only.** Aircraft and variable count are data with
  surfaces of their own coming.

Two things it took a live session to find, both written up in the log and worth
knowing before touching this again:

- **Enumeration is not a one-off.** An aircraft's `L:` variables do not exist
  before the aircraft does, and the app connects at the main menu. Re-walking on
  aircraft change — backing off until two walks agree — is what made a profile
  light up rather than show a handful of lines.
- **`start` must reseed the module's `last`.** It outlives the app, so an editor
  restarted mid-flight finds the table already walked and, without the reseed,
  hears nothing until something moves.

`src/main/sim/fixtures/link-session.ndjson` is still synthetic; replacing it with
a real capture is worth doing now that real ones exist.

2a answered every feasibility question, and three sim sessions answered the
design ones. Nothing here is open; it is a build.

**What was settled, so none of it is re-litigated:**

| Question | Answer |
| --- | --- |
| Does id-walking terminate? | Yes — 5,364, both APIs agree exactly |
| Are ids stable? | Yes — 6,149 of 6,149 unchanged across an aircraft swap |
| Which read? | `fsVarsLVarGet` with the entry's unit — matches FS Copilot's calculator |
| Which variables are the aircraft's? | Unknowable from the table. Watch everything, report what moves |
| Do units need deriving? | Barely — 2.8% carry one. Compare against `number` when non-zero, no search |
| Is the change notification usable? | It fires, but only says *something* moved |

What it has to build, in order:

1. **Enumerate once and store all of it.** ~6,150 names into `variable` plus
   `sim_variable` — variables confirmed to exist in the sim, which is what
   completions have wanted since stage 1 and cannot get from a corpus that only
   knows what somebody already wrote. Cache the ids; they are stable.
2. **Read through `fsVarsLVarGet` with the entry's unit.** Not the legacy call,
   and not raw — the corpus is written against FS Copilot's
   `(L:NAME, Units)` and a profile must mean the same thing in both programs.
   Opportunistically compare against `number` when a value is non-zero and
   record `sim_variable.units` / `units_confirmed` where they differ.
3. Diff in-module at 10–20 Hz on `Update_StandAlone`, send deltas only.
4. Protocol version in the handshake.
5. Feed the stage 2 harness as `via: "link"` — the capture format already
   carries the field, and the Log panel already renders it.
6. The install flow from [04](../04-connection.md).

The spike's `link/src/module.cpp` is throwaway scaffolding around the right
calls: it dumps text over one ClientData area on request. The transport shape
2b needs is different, but every call it makes is one 2b makes too.

### Stage 3 — Live values

- Watch the `get:` lines of open models only
- Inlay hints at end of line
- Unknown-on-this-aircraft diagnostic, which 2b's enumeration is the authority
  for. It was deferred only while there was no module

**Exit:** open `pa24-250.yaml` with the sim running and see values update. The
first product commit should be one hint showing one real number.

**Status: COMPLETE**, verified live, and rendered differently than designed.

`L:` and `A:` both reach the editor and update fast enough to follow a control
being dragged in walkaround — roughly 80 ms end to end for `L:`. Two things
changed on the way:

- **They are not inlay hints.** Monaco's `InlayHintsController` drops its
  subscription to a provider's change event after the first update and never
  renews it, so hints froze after exactly two repaints. That was stage 3's
  long-standing "appears once and freezes" symptom. Rendering is injected-text
  decorations now, in `live-decorations.ts`, which also puts the update rate
  under our control.
- **Both namespaces feed one value store.** `A:` arrives as a full set and `L:`
  as deltas, and the renderer replaces its map wholesale — so emitting each
  transport separately meant them erasing each other's values on alternate
  messages.

Built as `src/renderer/src/lib/watch-set.ts` (which `get:` lines want values,
and where their hints go — pure, 9 tests), `src/renderer/src/lib/sim-values.ts`
(the value map the Monaco provider reads, kept separate because it needs a
monaco `Emitter` and therefore a browser), the inlay hints provider in
`monaco-setup.ts`, and a store subscription that keeps the watch set in step
with open tabs.

Two decisions worth keeping:

- **The renderer sends every namespace and main routes.** `watchSimVars` drops
  anything that is not `A:`, so `L:` becoming readable in 2b is a change to one
  function in `session.ts` and nothing in the renderer.
- **No value means no hint**, rather than a dash. `pa24-250.yaml` is 279 `L:`
  against 12 `A:`, so a placeholder on nine lines in ten would read as broken
  rather than as not-connected-yet.

Note what this means for the exit criterion: until 2b, opening `pa24-250.yaml`
lights **12 lines of 291**. The mechanism is what is being tested here; the
coverage arrives with the module.

### Stage 4 — Activity logic

Developed against replay, with the sim closed. Raw events persist; **findings
are a view computed over them** — the shape of a raw event is not in doubt,
the correlation and ranking fields are, and deriving them at read time keeps
the uncertain part out of the schema.

- Ring buffer and persistence of raw events
- Anchors: input events, and marks
- **Burst grouping** — a run of many *distinct* events inside a few
  milliseconds is a machine, never a person. This is the third collapse rule
  and none of them substitutes for another: anchor-side dedup handles one event
  arriving twice, repeat collapse handles one control touched five times, and
  this handles hundreds of controls reporting at once. See the log entry "An
  aircraft change snapshots every input event before it announces itself"
- Findings: direct and downstream tiers, repeat collapse, ambient demotion
- Proximity ranking, anchored on the interaction where one exists

Rendered as a plain unstyled list at this stage.

**Hook the Log panel up to the burst rule when it lands.** Stage 2c ships with
adjacent-identical collapse only, which leaves an aircraft-change snapshot as
318 rows in 2 ms — correct, since they are 318 distinct events, and unreadable.
The panel needs exactly the grouping stage 4 is already building, so it should
call the same function rather than grow a second one that drifts. The seam is
`filterLog` in `src/renderer/src/lib/log-filter.ts`.

**Exit:** a vitest suite over real captured sessions asserting that flipping the
DME switch ranks `L:DmeOnOffKnob` first.

**Status: the ranking works.** `src/shared/activity.ts` (contract and every
threshold, each one measured), `src/main/activity.ts` (anchors, baselines,
findings) and `activity.test.ts` — 11 tests, the exit criterion among them.

Against the real capture, flipping the battery master: **192 variables move
within the window, 25 survive the ambient filter, and `L:Battery1Switch` is
first** with the right value both times it is thrown. `KNOBS_EVENT_NAVINSTR_KNOB`
finds `L:NavInstrLightSwitchPct`, which is also correct and was not tuned for.

`src/main/activity-buffer.ts` holds the working set the ranking runs over: a
fixed 2.4 MB ring of the last two minutes, packed into typed arrays with the
names interned. That is 08-marks' design and the measurement vindicated it —
957 changes a second against its "pessimistic thousand", which as
`CapturedEvent` objects would be tens of megabytes of permanent garbage for a
feature that is idle most of the time. Events are rebuilt only when something
asks. 9 tests, including the wrap, which is the half a ring usually gets wrong.

Still to do in this stage:

- ~~**Hooking `filterLog` up to the burst rule.**~~ **Done.** `inBurstAt` in
  `@shared/activity` takes accessors, so the panel asks it about `LogEntry` rows
  and the ranking asks it about input events without either owning the other's
  shape. A snapshot is one row now, reading "318 events at once" with its span,
  rather than `×318` — which would be true of an identical run and a lie about a
  burst. Two qualifiers the Log panel needs and the ranking does not: a burst
  must be a same-source run of at least `BURST_DISTINCT`, and **warnings and
  errors are never folded**. Being in a burst is a property of the
  neighbourhood, so a warning arriving mid-snapshot is flagged with it, and that
  line is the one thing in those 2 ms anybody wants.
- ~~**Marks as a second anchor kind.**~~ **Done**, with stage 5's hotkey.
- **Persisting a ±60 s slice when a mark fires**, which is 08-marks' "persist
  wide, display narrow". Still open, and the reason it matters is specific: a
  window adjustment works for as long as the ring holds and then silently stops.
  Nothing adjusts a window yet, so nothing is broken by its absence.

Two things measured before it began, both of which changed how it started:

- **Proximity alone cannot rank.** 195 distinct `L:` variables change within
  ±400 ms of a single cockpit interaction, in a real capture. The per-variable
  baseline is the primary signal and proximity is the tie-break; see the log
  entry. This reverses the order the bullets above imply.
- **There is exactly one usable capture, and it is 93.6 MB.**
  `2026-08-23T17-53-04.ndjson` — 1,756 input events and 1,101,839 `L:` deltas
  over 614 s, with genuine interaction in it: bursts of one to four distinct
  names, including the n=2 double-fire. Everything captured before the module
  existed has input events and no `L:`; everything after has `L:` and no
  interaction. So the first task is a slicer that cuts a window out of a capture
  — keeping `open`, `aircraft` and `input-events` so the slice still stands
  alone — because nothing that size can be committed as a fixture.

### Stage 5 — Activity UI and marks

- Bottom panel, two columns, table keeping its space when nothing is selected
- Horizontal splitter (new — existing `usePanelWidth` is width-only)
- Rail buttons with rotated labels, Activity bottom-aligned
- `globalShortcut`, mark window, clash reporting

Independent of the sim, so this is the work to do while waiting to get into it.

**Exit:** press hotkey, flip switch, come back to a ranked answer.

**Status: BUILT, unverified against a sim.** Everything the exit criterion needs
exists and is tested; nobody has pressed the key with MSFS in front of them.

The layout was already there — 2c built the bottom slot, the horizontal splitter
and the rail's bottom group, and the store has had `BottomPanel = "log" |
"activity"` since then. So this stage was marks plus one panel:

- `src/shared/activity.ts` gained `Mark`, the −3 s/+12 s window and the default
  accelerator. `Anchor` now carries its own `before`/`after`, because a mark and
  an interaction are not the same question: one is a person reacting at 200–400
  ms, the other is the simulator's own timestamp of a click.
- `src/main/marks.ts` — `globalShortcut`, bound at launch rather than when the
  panel opens, since the whole point is that it works while MSFS has focus.
- `src/main/activity.ts` — a mark with an interaction in its window produces no
  finding of its own. 08-marks' rule, and it is the difference between four
  candidates and one.
- `src/renderer/.../components/activity/` — two columns, the table keeping its
  space, `direct` and `downstream` separated rather than interleaved.

**What still needs a sim:** that the default accelerator is one MSFS does not
bind. `globalShortcut.register` cannot tell us — the sim reads its keybindings
through raw input — so the only way to find out is to press it in a cockpit and
see whether something else happens too.

**v1 ships here.**

## Working notes

- **The sim is a slow, stateful, manual dependency.** Batch everything that
  needs it into deliberate sessions rather than reaching for it continuously.
  The capture harness exists to make that possible.
- **Record findings as they happen**, in [v1-log.md](v1-log.md), not at the end.
  A finding that changes scope is worth more than the code written that day.
- **Amend design docs by pointer, never silently.** If something here overturns
  a decision in `01-17`, add a line at the top of that doc pointing at the log
  entry. Do not rewrite the design record mid-build.
