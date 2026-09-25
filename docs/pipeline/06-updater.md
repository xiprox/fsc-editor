# Updater — how an installed editor updates itself

    Purpose:    The update mechanism, where the user meets it, and what
                happens when any of it fails.
    Depends on: 05-release
    Decides:    electron-updater, silent staging, the app menu's update row
                and mark, What's new, the gates, the failure responses

## The mechanism

`electron-updater`, in four steps.

1. **`checkForUpdates()`** fetches `latest.yml` from the feed, compares its
   version against `app.getVersion()`, and emits `update-available`,
   `update-not-available` or `error`.
2. **`downloadUpdate()`** — automatic, and left that way — pulls the installer
   into `%LOCALAPPDATA%\fsc-editor-updater\pending`. If it can also fetch the
   installed build's blockmap it diffs the two and issues ranged requests for
   only the changed chunks, splicing the rest from what is already on disk. It
   falls back to a full download if any part of that fails, and verifies the
   SHA-512 either way. Emits `download-progress`, then `update-downloaded`.
3. **`quitAndInstall()`** spawns the staged installer with `--updated /S`, quits,
   and the installer replaces the installation and relaunches it.
4. Nothing runs unless `app.isPackaged`, so development is unaffected.

Two defaults are kept deliberately:

- **`autoDownload` on**, because the design below offers a restart only once
  restarting is genuinely instant.
- **`autoInstallOnAppQuit` on**, so somebody who never restarts from the menu
  still gets the update the next time they close the app normally. The menu is
  the *now* path, not the only path.

**Cadence:** a check ten seconds after launch, then every four hours, plus a
manual one from the app menu. Checking is cheap and harmless; only the restart
is disruptive.

**Portable builds are excluded entirely.** `electron-updater` cannot update
them, and `process.env.PORTABLE_EXECUTABLE_DIR` is set when the app is running
as one — so the whole feature is suppressed there. A development run
(`!app.isPackaged`) is suppressed for the same reason: there is no installed
copy to replace, and asking anyway would only fill the log with errors that look
like something is broken.

### It is bundled, not externalized

`externalizeDepsPlugin` makes everything in `dependencies` external by default,
and an external module has to be named in `electron-builder.yml`'s `files`
allowlist to exist in a packaged build — a step that fails *silently* in a
checkout, where Node resolution walks up out of `out/` and finds the repo's own
`node_modules`.

electron-updater's transitive closure is a dozen packages, so that allowlist
would be a dozen entries to keep right forever. It is pure JavaScript and reads
`app-update.yml` by path at runtime rather than importing it, so bundling takes
nothing away. It joins `yazl` in the `exclude` list in
[electron.vite.config.ts](../../electron.vite.config.ts); `node-simconnect`
stays external for the reason that file gives.

### Its failures go to the app's log

`autoUpdater.logger` is set to `null`, because electron-updater's own logger
writes to a file this app does not own. Every failure is logged through
`main/log.ts` instead, which means the debug report already collects them with
no new plumbing.

## What the user sees

The app menu — the **FSC Editor** trigger at the leading edge of the title bar,
the first menu in the menu bar
([menu-bar.tsx](../../src/renderer/src/components/menu-bar.tsx)). Updating has
no control of its own in the title bar. It had one until 0.2.0, and it had
nowhere to go once the menu bar arrived: whatever sat after the app name would
sit between the app menu and File.

### The mark

An icon in `text-update` beside the name, in the trigger's own row:

- **Download** — an update is ready: downloaded, and restarting into it would
  take two seconds.
- **Check** — an update arrived when the app last closed and What's new
  has not been opened since.

When both are true, Download wins: it is the one that asks for something. The
row it points at wears the same icon in the same teal, so the eye can follow it
from the title bar into the menu. Nothing is shown while a download runs: the
user hears about an update when there is something to do about it.

The trigger grows by the icon while it is there. Once File and View sit after
the app menu, they move by as much when it comes and goes — accepted, in
exchange for the mark reading as part of the name rather than as a badge.

### The menu

*Version X.Y.Z* at the top, as an inert label, then What's new and the update
row, then Settings. After an update nobody has read, What's new becomes
*Updated — see what's new*, teal, with the check icon. The version is not
repeated there; it is the row above.

### The update row

One row that always says where updating stands. The menu is `w-72` rather than
sized to its content, because this row's words change while the menu is open
and a menu that resized under the pointer would move the row being read.

| State | Row |
| --- | --- |
| Nothing going on | *Check for updates* |
| Checked from the row | *Checking for updates…*, then the answer in place |
| Downloading | *Downloading update…*, with `ProgressRing` as its icon |
| Ready | **Restart to update to X.Y.Z**, in `tone="update"` |
| Ready, Remote Connect live | *Restart to update after Remote Connect*, disabled |
| Portable or development | *Updates are off in a … build*, disabled |

**Two clicks, and no confirmation.** Opening the menu is the first and the row
is the second, and the row's own words say what it will do. The old button's
armed state — and the bug where it survived being hidden and came back one
click from a restart — went with it.

**A check answers in the row.** The row sets `closeOnClick={false}`, so the
menu stays open and the row's label becomes the answer. That is the rule the
manual check is built on — a check somebody asked for is a question, and the
answer goes to the caller rather than into the ambient state — with the row as
the caller. The answer is component state, and the popup unmounts on close, so
reopening the menu starts from the standing state with nothing reset by hand.

**Checking lasts at least a second.** The feed often answers in a few hundred
milliseconds, and a label that flashes and reverts reads as a click that did
nothing. The floor only holds the checking state: a download that starts
meanwhile shows at once, since the row reads the ambient state before its own
answer.

The 400ms threshold in [main/updates.ts](../../src/main/updates.ts) still
applies to the downloading row: a download that finishes inside it goes
straight to the restart row.

### What's new

A dialog built from `CHANGELOG.md`, bundled with `?raw` and read by
[shared/changelog.ts](../../src/shared/changelog.ts). Bundled rather than
fetched: the release commit carries the changelog, so a tagged build always
holds its own entry and What's new works offline. The parser is deliberately
dumb — every scope is valid and every heading is kept. The dialog only dresses
them, as a document rather than a table: the version, then *Features* and
*Fixes*, then each scope as a heading with its entries as a bulleted list under
it. Scopes are written as names (*Remote Connect*, *SimConnect*), and each
entry gets back the capital a commit title leaves off. Nothing indents the list
but its bullets, so every line starts at the same edge.

**After an update, it is offered once.** Main keeps `version.json` in
`userData` — the version last *seen*, which moves only when What's new is
opened. On launch, a version newer than that one is an update:

- **Restarted into from the menu** — `installUpdate` writes the version it is
  restarting into on the way out, and the next launch opens What's new by
  itself. The user just asked for the update; what changed is the answer.
- **Installed when the app closed** — no dialog. The check icon, and the teal
  row, until it is opened. The user is here to work.

The releases that arrived with the update are listed first and the rest follow
under *Earlier*, so an update that skipped a release — and brought two — reads
as exactly that. An update nobody opened keeps being offered, and one that
arrives on top of it is offered together with it. A copy that ran before
`version.json` existed counts only the release it updated into, since that is
the one thing known to be new.

A development run never records anything. `FSCE_UPDATED_FROM=<version>`
pretends one was just updated from that version, and
`FSCE_UPDATED_RESTARTED=1` pretends it was restarted into from the menu.

### The colour

`tone-update` in [index.css](../../src/renderer/src/index.css), beside
`tone-warning` and `tone-destructive` — the file already calls those "not a
feature either", and this belongs in the same category. There is no Update
panel and there never will be; this dresses the mark beside the app's name and
the rows it points at.

**Teal at hue 195.** Radar is at 163 and `--sim` at 242, so it is 32 degrees off
one and 47 off the other — wider than the 18 between `--radar` and
`--remote-added`, which that block already argues reads as chosen rather than as
a near-miss. Radar's proportions exactly, since the two sit at the same chroma
and anything else would make one of them look like a mistake.

A menu row takes it through `DropdownMenuItem`'s `tone` prop, so no colour is
written at the call site. Its label is the saturated `--tone` rather than
`--tone-foreground`: it has to match the mark that points at it, and the paler
value read dimmer than the white rows around it.

### The gates

The restart row is disabled, and the download mark hidden, when:

- **a Remote Connect session is live.** `session.resume` never leaves the
  process ([session.ts](../../src/main/remote-connect/session.ts)), so a restart
  ends the session for the other pilot permanently. Worse, updating mid-session
  can leave the two sides on different builds, and the other pilot cannot see
  that a download is what happened. Disabled rather than hidden, so the menu's
  rows stay where they were.
- **the build is portable**, where the row says so instead.

Unsaved work is **not** a gate. [src/main/drafts.ts](../../src/main/drafts.ts)
restores drafts against the file they were taken from, so a restart loses
nothing and must not prompt.

### One rule this amends

[docs/ui.md](../ui.md) forbids `transition-*` outright, with `animate-spin` on a
genuine spinner as the single exception. The progress ring's fill may
transition — the amendment sits beside that exception in `ui.md`. The swap from
the download row to the restart row is still instant.

## Failure handling

Almost all of it is *do nothing visible*. A failed check is not news.

| Failure | Response |
| --- | --- |
| No network, feed unreachable, 404 | Nothing shown. One log line. Retry on the next cycle. |
| SHA-512 mismatch, truncated download | Discard the staging directory, log, retry next cycle. Never show a half-download. |
| Disk full, staging directory locked | Same. Silent, logged. |
| Install fails after `quitAndInstall` | The app is already gone and NSIS shows its own error. Nothing can be done from here — which is an argument against ever offering a silent install-on-quit as the *only* path. |
| An older version in the feed | Never offered. electron-updater compares semver and will not go backwards. |

Everything logged goes to the existing log ring, so it reaches the debug report
without any new plumbing. The report already carries `app.getVersion()`
([src/main/report/sources.ts](../../src/main/report/sources.ts)), so a bug report
says which build produced it without anything being added.
