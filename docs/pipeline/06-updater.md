# Updater — how an installed editor updates itself

    Purpose:    The update mechanism, the one control the user sees, and what
                happens when any of it fails.
    Depends on: 05-release
    Decides:    electron-updater, silent staging, the header slot, the two
                gates, the failure responses

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

- **`autoDownload` on**, because the design below shows a control only once
  restarting is genuinely instant.
- **`autoInstallOnAppQuit` on**, so somebody who never presses the button still
  gets the update the next time they close the app normally. The button is the
  *now* path, not the only path.

**Cadence:** a check ten seconds after launch, then every four hours, plus a
manual one in Settings. Checking is cheap and harmless; only the restart is
disruptive.

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

One slot in the title bar, immediately after the app name, in the header strip
in [App.tsx](../../src/renderer/src/App.tsx). It has exactly two appearances and
they occupy the same box.

### Downloading — a progress ring

A determinate circular indicator in a bare `size-7` box, drawn in a 24×24
viewBox at stroke width 2 so it matches Lucide's glyph weight by construction
rather than by eye. Arc `--tone`, track `--tone-border`.

**It is not a `<button>`.** No hover, no focus ring, not focusable. That is not
only cosmetic: it makes a click during the download structurally impossible
rather than something that has to be guarded.

**It appears only after 400ms.** A blockmap diff can be three megabytes, which
on a decent connection is under a second — a ring that appears and vanishes
reads as a glitch. The threshold only ever *suppresses*; it never holds the ring
on screen after the work is done. A fast update simply produces the button.

The timer lives in **main**, not in the component. What
[main/updates.ts](../../src/main/updates.ts) publishes is already "what there is
to say", and a second opinion about that in the renderer would be two places to
look when the answer is wrong. A download that finishes inside 400ms therefore
never produces a `downloading` state at all.

**Fallback:** if `download-progress` does not fire on the differential path, or
the total is unknown, use `LoaderCircle` with `animate-spin` at `size-3.5` in the
same box — already the app's idiom in eight places. Whether the event fires
reliably there is a thing to verify, not assume.

### Ready — the button

A `size-7` icon button. First click reveals a label to its right; second click
quits and relaunches. No dialog.

> **Click again to update and restart**

**This narrates the UI on purpose**, against the rule in
[docs/copy.md](../copy.md). The rule is about prose describing controls the
reader can already see; this is a confirm affordance, where the instruction *is*
the semantics — a button that does not fire on first click has to say so or it
reads as broken. Registered as a deliberate exception in
[docs/help/copy-review.md](../help/copy-review.md).

Nothing about the reveal animates its width, and the button never takes focus
when it appears. The launch island beside it is absolutely centred, so nothing
else in the header moves. The button keeps `size="icon"`'s 28px height and only
its width is overridden — a `sm` control would be 24px and the whole strip would
jump by four.

**The confirmation lives in its own component, keyed on the version.** That is
not tidiness: returning `null` from a component does not unmount it, so a
half-made confirmation held in `UpdateButton` itself **survived the control
being hidden**. Arm it, start a Remote Connect session, end the session, and the
button came back already armed — one click from a restart nobody asked for. Seen
in the app on 2026-09-20; see the log.

`ReadyButton` is mounted only while there is something to confirm, so React owns
every way of disarming it. Leaving `ready` unmounts it, a session starting
unmounts it, and a different version replaces it through the key. There is no
reset to write and none to forget.

### The colour

A new `tone-update` in [index.css](../../src/renderer/src/index.css), beside
`tone-warning` and `tone-destructive` — the file already calls those "not a
feature either", and this belongs in the same category. There is no Update panel
and there never will be; this dresses one control that is on screen for as long
as it takes somebody to press it twice.

**Teal at hue 195.** Radar is at 163 and `--sim` at 242, so it is 32 degrees off
one and 47 off the other — wider than the 18 between `--radar` and
`--remote-added`, which that block already argues reads as chosen rather than as
a near-miss. Radar's proportions exactly, since the two sit at the same chroma
and anything else would make one of them look like a mistake. They never share a
surface regardless: Radar is a rail button, this is the header strip.

`update` was added to `Button`'s `tone` variant, which is how the control gets
it without any colour being written at the call site.

### The gates

The slot is hidden entirely when:

- **a Remote Connect session is live.** `session.resume` never leaves the
  process ([session.ts](../../src/main/remote-connect/session.ts)), so a restart
  ends the session for the other pilot permanently. Worse, updating mid-session
  can leave the two sides on different builds, and the other pilot cannot see
  that a download is what happened. Hiding the whole slot — not just the button —
  matters: a ring that runs to completion and then produces nothing is worse
  than never having appeared.
- **the build is portable.**

Unsaved work is **not** a gate. [src/main/drafts.ts](../../src/main/drafts.ts)
restores drafts against the file they were taken from, so a restart loses
nothing and must not prompt.

### One rule this amends

[docs/ui.md](../ui.md) forbids `transition-*` outright, with `animate-spin` on a
genuine spinner as the single exception. The progress ring's fill may transition.
The amendment is narrow and belongs beside that exception:

> A value that moves continuously — a progress indicator's own fill — may
> transition. The rule is about state changes, where a transition puts time
> between the act and the answer; a download's progress is neither a state
> change nor something the user just did.

The swap from ring to button at completion is still instant. Whether the motion
rules are too strict more generally is a separate question, parked in
[09-open-questions](09-open-questions.md).

## Settings — the About section

The title bar handles the case that matters. Settings' last section
([groups/about.tsx](../../src/renderer/src/components/settings/groups/about.tsx))
covers the two it does not: somebody who wants to know **now** rather than
within four hours, and somebody on a build that **cannot update at all**, who
would otherwise wait forever for an offer that is never coming.

Two rows — the version, and one line saying whether updates are possible and
why — plus a *Check now* button, which is absent where a check has no answer to
give.

**A manual check answers its caller.** `checkForUpdates()` returns a
`ManualCheck` rather than publishing anything, so asking here changes nothing
about what the title bar shows. That is the whole reason the ambient state can
stay as quiet as it is: a scheduled check has nobody waiting on it, and one
somebody pressed a button for is a question.

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
