# Release — building and publishing the editor

    Purpose:    What an editor release is built from, on what, and what it
                contains.
    Depends on: 04-versioning
    Decides:    the targets, per-user install, unsigned publishing, GitHub
                Releases, what a hosted runner can and cannot build

## What a release contains

| File | What it is |
| --- | --- |
| `FSC-Editor-X.Y.Z-setup.exe` | The NSIS installer |
| `FSC-Editor-X.Y.Z-setup.exe.blockmap` | A chunk-hash index of the installer, which is what makes differential updates possible |
| `latest.yml` | The update manifest: version, SHA-512, size, path, release date |
| `FSC-Editor-X.Y.Z-portable.exe` | The portable build |

The first three are what an installed editor consumes. The portable build is
there for quick local testing and **is not updatable** — see
[06-updater](06-updater.md).

## The install

`nsis`, `perMachine: false`, `oneClick: false`. A per-user install under
`%LOCALAPPDATA%\Programs`, with the directory changeable at install time.

The per-user part is the load-bearing choice: it is what lets an update replace
the installation **without a UAC prompt**. A per-machine install would need
elevation on every update, and the whole design in
[06-updater](06-updater.md) — two clicks, no dialog — falls apart.

## Unsigned

No code signing certificate. Consequences, in full:

- **SmartScreen warns on first download and first run.** Accepted; see
  [01-goals](01-goals.md) for who this reaches. A sentence in the README is the
  whole mitigation.
- **electron-updater skips Authenticode verification.** It only runs that check
  when `publisherName` is configured, which it is not, so nothing needs to be
  turned off to make this work.
- **Integrity still holds for updates.** The SHA-512 in `latest.yml` is verified
  unconditionally, and the manifest arrives over HTTPS from GitHub. That is the
  update path's guarantee, and it is independent of signing.

Signing is parked, with options, in [09-open-questions](09-open-questions.md).

## The runner

`windows-latest`. The build is `npm run build:win`, which is typecheck plus
`electron-vite build` plus `electron-builder --win`.

**What makes this possible at all is that the WASM module is committed.**
`fspackagetool` drives the game executable and the MSFS SDK has no unattended
install, so a runner cannot build it. `link/Packages/fsc-editor-link` is checked
in, `extraResources` copies it into `resources/link/`, and CI never needs to know
that a simulator was involved. See [08-module](08-module.md).

`node-simconnect` is pure JavaScript and `npmRebuild` is off, so there is no
native toolchain to arrange either.

### What the release workflow must not do

Run `check:format`, `check:grammar`, `check:setters`, `check:highlight` or
`check:claims`. They need folders that do not exist on a runner, and they will be
proposed as "the checks CI is missing". [03-checks](03-checks.md) explains why
they are not.

## Publishing

`publish:` in `electron-builder.yml`, provider `github`, owner `xiprox`, repo
`fsc-editor`. That does two things: it uploads the artifacts to the release, and
it bakes `app-update.yml` into `resources/` so the installed app knows where to
look for `latest.yml`.

The repository is public, which is what keeps this simple — a private repo would
need a token on every client and the feed would have to move somewhere else.
That alternative, and what it would cost, is in
[09-open-questions](09-open-questions.md).

The release is created by merging the release PR
([04-versioning](04-versioning.md)); the tag push is what triggers the build.
