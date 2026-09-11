# The debug report

One action in the footer collects everything the app knows about itself into a
folder and a zip beside it, for a tester to send by hand. There is no upload, no
endpoint, and no identifier that outlives the file.

This is the **debug** report — the app reporting on itself. It has nothing to do
with [the addon report](sim-vars/13-report.md), which is a saved query over the
variable database.

Written down here as a format rather than as an implementation, because the
package outlives the code that writes it: a report from an alpha build will be
read months later, by tooling that does not exist yet, against thresholds that
have since moved.

## Shape

```
Downloads/
  fsc-editor-report-2026-08-26T14-02-11/
    manifest.json
    environment.json
    sim-state.json
    log.ndjson
    activity.json
    activity-ring.ndjson
    findings.json
    variables.json
    workspace.json
    settings.json
    captures/
      2026-08-26T13-44-02-pa24-250.ndjson.gz
      2026-08-26T13-44-02-pa24-250.p2.ndjson.gz
    errors.txt
    fsc-editor-report-2026-08-26T14-02-11.zip
```

One folder, containing the loose files and a zip of the same folder minus
itself. Loose because the first thing anyone does with a report is read one file
out of it; zipped because the second thing is attach it to a message. Revealing
the folder with the zip selected gives both without asking which is wanted.

**The zip repeats the folder's name in full.** It is the half that leaves the
machine, and it arrives in a chat window beside a dozen other attachments with
the folder it came out of nowhere in sight — so the filename has to say what it
is, which app it is from, and when it was taken. It also means extracting it
reproduces the folder it was made from, since Explorer names the destination
after the archive.

The stamp is `YYYY-MM-DDTHH-MM-SS`, sortable and legal on Windows — the same
form `captures/` uses.

## Rules that hold for every file

**UTF-8, LF, no BOM.** JSON is pretty-printed with two spaces. NDJSON is one
object per line with no header record, so a truncated file is still a valid
prefix — the same property a capture has.

**Every timestamp is `Date.now()` milliseconds**, in a field named `t`. Formatted
wall-clock strings appear only in `manifest.atLocal`, and only for a human
skimming.

**Only `manifest.json` is required.** Any other file may be absent, and its
absence means its collector failed and `errors.txt` says why. A file that is
present but empty means there was genuinely nothing — an empty ring, a session
with no marks. The distinction matters: a report silently missing exactly the
subsystem that broke is the failure mode this rule exists to prevent.

**Redaction is applied once, to serialized output, last.** See below. Nothing
upstream is responsible for it, so there is one place to audit.

## manifest.json

What the package is, and what is in it.

```json
{
  "version": 1,
  "at": 1756216931000,
  "atLocal": "2026-08-26T14:02:11+03:00",
  "app": "0.0.1",
  "packaged": true,
  "files": [
    { "name": "log.ndjson", "bytes": 481230, "records": 5000 },
    { "name": "captures/2026-08-26T13-44-02-pa24-250.ndjson.gz", "bytes": 4118002 }
  ],
  "captures": {
    "files": ["captures/2026-08-26T13-44-02-pa24-250.ndjson.gz"],
    "live": "captures/2026-08-26T13-44-02-pa24-250.ndjson.gz"
  },
  "errors": 0
}
```

`version` is the format's, not the app's. An integer, bumped only when a reader
that understood the previous version would now be wrong. Readers ignore unknown
fields.

`files` lists what was actually written, so a reader can tell a collector that
produced nothing from one that never ran without parsing every file. `records`
is present for the line-oriented ones.

`captures.live` names the part that was still being written when the report was
taken, and is null when the simulator was not connected. Not inferable from the
list: a session that has just rolled a part leaves two files a second apart, and
only one of them is still growing.

## environment.json

The machine and the build, and nothing about the person at it.

| field | example |
| --- | --- |
| `app` | `"0.0.1"` |
| `electron`, `chrome`, `node`, `v8` | `"43.4.0"` |
| `os` | `"Windows 11 Pro"`, `"10.0.26200"`, `"x64"` |
| `locale` | `"en-GB"` |
| `memory` | total and free bytes |
| `display` | size and `scaleFactor` per display |
| `uptime` | process and system, in ms |
| `dev` | which development gates were open |

`dev` is the one that matters when reading a strange report: it records
`packaged`, whether capture was forced on or off, and whether `FSCE_SIM_REPLAY`
or `FSCE_RELAY_URL` were set. A report produced against a replayed capture rather
than a simulator looks entirely normal otherwise.

## sim-state.json

The `SimState` the footer chip was showing, plus the two facts the chip
summarizes away: the Link module's version and protocol number, and whether the
package is installed in a Community folder at all.

Never the path to that folder — see redaction.

## log.ndjson

The main-process log ring, oldest first, one `LogEntry` per line with its detail
object inlined as `detail`.

The ring is 5,000 entries and is not a complete record of the session; it is
whatever survived. Sources are `sim`, `remote`, `files`, `app`, `ui`. The `sim`
rows are already summaries — the stream is coalesced into one row per 250 ms
window carrying at most 50 samples, because the raw rate is ~1,000 events a
second. The raw stream is under `captures/`, not here.

Rows with `kind: "console"` are the main process's own `console.warn` and
`console.error`, and also uncaught exceptions and unhandled rejections from both
processes. In a packaged build this is the only place a stack trace exists.

`detail` is redacted, and for Remote Connect events it is redacted heavily — see
below.

## activity.json

Everything Activity knew at the moment of collection: every anchor, every
candidate, every **rejected** candidate with its measured rate, the marks, the
per-variable and per-control history the ranking consulted, the buffer's account
of its own span and occupancy, and the tuning constants in force.

This is what the `activity-debug/` dump held, unchanged in content. It is the
derived half that a capture cannot hold: baselines are computed over a window of
history that has already rolled out of the ring by the time anyone looks, so
recomputing them later from the capture gives different numbers than the ones
the panel actually used.

The constants are recorded rather than assumed, so a report read six months from
now is interpretable against the thresholds that produced it rather than against
whatever they were later tuned to.

## activity-ring.ndjson

The change ring — the last 120 seconds of the simulator as `CapturedEvent`s,
oldest first.

This is the floor of the report and is present whenever the sim is connected,
regardless of what `captures/` contains. It is what `activity.json`'s
findings were computed *from*, so the two can be checked against each other.

## findings.json

The kept captures — findings whose window has closed and which the panel is
still showing — and every mark, with a flag for whether each mark produced an
anchor of its own.

A mark that produced no anchor is not noise. It is the single most confusing
outcome the feature has: the key was pressed, the panel shows something else,
and nothing on screen says the two are related.

## variables.json

Aggregates from the variable database. **Never the database file.**

- schema version, and row counts per table
- for the loaded aircraft only: its `sim_observation` and `sim_coincidence`
  rows, which is what makes a ranking complaint readable
- corpus totals as counts alone

The corpus is derived from the user's own profile files. Shipping `vars.db`
would ship that content; shipping counts says everything a reader needs about
whether the corpus was populated.

## workspace.json

The shape of the workspace with none of its location: how it was detected, how
many profiles are on disk, the aircraft folder names, the open tab count.

Aircraft folder names and profile-relative paths stay. They are addon names, not
identity, and they are most of the point.

## settings.json

`settings.json` as stored, with `workspaceRoot` reduced to its token. It holds
one field today; it is included whole so that it keeps being included whole.

## captures/

The raw simulator stream, gzipped, one file per capture part. NDJSON of
`CapturedEvent`, readable by `readCapture` and replayable through
`FSCE_SIM_REPLAY` without modification.

**All of them, not a window.** Nothing is trimmed and there is no size budget: a
capture directory is already bounded at 100 MB by the rules below, which makes
"everything there is" a bounded answer, and the session worth reading is not
always the live one. Somebody who flew, landed, quit the simulator and only then
noticed something wrong is describing the previous file.

**Standing alone.** A capture is only readable with its announcements — which
aircraft, what the input events are called, what the `L:` names are — and those
arrive in the first seconds of a session and are never repeated. So a part after
the first carries the last announcement of each in front of its own events,
**re-timed to a second before the part opens**, one millisecond apart so their
order survives a reader that sorts on `t`. Timing of everything after them is
untouched, which is the whole point: proximity ranking is a claim about
milliseconds.

The first handful of timestamps in a `.p2` or later are therefore synthetic.
This is the rule `scripts/slice-capture.ts` already applies, so that there is one
meaning in the repo of a capture that stands alone.

### What is on disk behind them

Captures are written for every session in packaged builds, not only in
development, because the reports worth having are the ones for issues nobody can
reproduce on demand. The report reaches for a file that is already there; it
never asks the user to go and reproduce anything first.

- One file per session part, `<stamp>-<aircraft>.ndjson`, part 2 onward suffixed
  `.p2`, `.p3`. Every part of a session shares the session's stamp, so parts sort
  and group together.
- A part rolls at **25 MB**, about seven minutes at the measured rate. The new
  part re-emits the announcements, so every part stands alone by the rule above.
- The `captures/` directory is held at **100 MB**, evicting oldest part first.
  The part being written is never evicted.
- Eviction happens when a part's handle actually closes, not when the roll
  decides on it. Windows will not delete a file that is still open, so a cap
  enforced at the moment of rolling is a cap that silently never applies.

That gives a bounded rolling window of the most recent sessions rather than an
unbounded archive. The measured rate is ~957 events a second — roughly 200 MB an
hour, so a long-haul flight is not a corner case — and a 15-minute session is
about 50 MB raw and 5 MB gzipped. 100 MB is a couple of sessions: enough to still
hold the one somebody is about to report, and small enough to never be
noticed.

## errors.txt

One line per collector that threw, naming the collector and the reason. Absent
when nothing failed, and `manifest.errors` is then 0.

A collector's failure never stops the report. The disk being read-only, the
database being locked, the sim disconnecting mid-collection — each of those
removes one file and is recorded, and the rest of the package is still worth
sending.

## Redaction

Applied to every file's serialized bytes, once, immediately before writing.

**Paths become tokens.** Known roots are replaced by longest-prefix match,
followed by a regex backstop for anything that slipped through:

| token | what it stood for |
| --- | --- |
| `<home>` | the user profile directory |
| `<userData>` | the app's own data directory |
| `<workspace>` | the selected `Definitions` folder |
| `<community>` | the Community folder the Link package lives in |

The Windows username is the only personal datum the app handles, and it is
inside almost every absolute path it touches.

**Remote Connect is stripped, not tokenized.** A `file` event carries the full
text of a peer's profile; the content is dropped and replaced by its length. A
session code is replaced by its shape, `XXX-XXX`. Peer display names are
dropped.

**What is deliberately kept.** Variable names and their values, aircraft folder
keys, profile-relative paths, input event names, addon and package names. None
of it identifies a person, and a report without it says nothing.

## Never in the report

Named explicitly, because the reason each is absent is easier to lose than to
re-derive:

- `vars.db` — carries the corpus, which is derived from the user's own files
- unsaved drafts, and the content of any profile file
- Remote Connect file contents, session codes and peer names
- the Windows username, in any form
- `link/transcripts/` — a maintainer tool that never runs in a build
- anything from the relay, which stores no message even in principle

## Reading one

Anything under `captures/` goes straight into replay. `activity-ring.ndjson` is
the same format and can be replayed alone. `scripts/slice-capture.ts` cuts a
window out of either, and a slice of a report capture is a legitimate test
fixture — which is the point of keeping the report's captures in exactly the
format the fixtures already use.
