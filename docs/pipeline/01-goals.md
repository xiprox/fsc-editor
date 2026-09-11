# Goals — what shipping means here

    Purpose:    What a release is, who it reaches, and what is deliberately
                not automated.
    Depends on: nothing
    Decides:    unsigned distribution, per-user install, Windows only, the
                five non-goals

## Who this reaches

People who fly MSFS and write FS Copilot profiles. They already found an
application that ships as an archive with no installer, put it somewhere, and
pointed this editor at it. That is the baseline of technical comfort, and it is
what makes an unsigned build acceptable where it would not be for a general
audience.

There is no account, no licence, no telemetry and no crash reporter. The app
knows nothing about who is running it, and nothing in this pipeline changes
that.

## What a release is

One Windows installer, published to a GitHub Release, which an already-installed
copy can find and apply to itself without being told to look. Everything else
here exists to make that sentence true and keep it true.

## The shape of the problem

Three things come out of this repository, and they do not resemble each other:

- an **Electron application**, distributed as an installer, living on machines
  that may never be updated again;
- a **Cloudflare Worker**, which is a URL — deploy it and every client is on the
  new one within seconds, whether they wanted to be or not;
- a **WASM module for the simulator**, which no hosted runner can build, because
  the packaging tool drives the game executable and the SDK has no unattended
  install.

Three update mechanics, three failure modes, one repository. [02-deployables](02-deployables.md)
is where that is worked out; the rest of this record follows from it.

## Non-goals

Each of these is a decision rather than an omission. Several are revisited in
[09-open-questions](09-open-questions.md).

**Code signing.** A certificate costs money the project does not have, and
SmartScreen warns on an unsigned installer the first time it is run. The
audience above can be told that in a sentence in the README. Integrity for the
*update* path is covered without it — see [06-updater](06-updater.md).

**Telemetry and crash reporting.** Nothing is collected. The debug report
([src/main/report](../../src/main/report)) is written on request, by hand, by
somebody who then chooses to send it. That is the whole mechanism and it is
enough.

**macOS and Linux.** The app reads the Windows registry to find FS Copilot, it
drives `FsCopilot.exe`, and it installs a package into an MSFS Community folder.
There is no partial port worth having.

**Staged rollout, channels, rollback.** One release, everyone at once. With no
telemetry there is nothing to stage *on* — a canary you cannot observe is just a
delay.

**Automatic module builds.** Not a choice so much as a fact, but it is recorded
here because everything in [08-module](08-module.md) is a consequence of it.
