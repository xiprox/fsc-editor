# Module — the Link package's custody

    Purpose:    How a WASM module that CI cannot build stays honest, and how it
                reaches a simulator.
    Depends on: 02-deployables, 05-release
    Decides:    the three guards, where the source hash is written, the
                over-the-air path

## Why it is committed

`fspackagetool` drives the game executable, and the MSFS SDK has no unattended
install. What a maintainer built on a machine with MSFS and Visual Studio is the
only package there will ever be, so `link/Packages/fsc-editor-link` is checked
in. That is what lets a hosted runner produce a complete editor build.

The cost is that the repository now carries a binary whose relationship to the
source beside it is a matter of trust. The three guards below are what replace
trust with a check.

## The three guards

All of them are greps and a hash, all read only this repository, and all run in
the ordinary PR job rather than a workflow of their own —
[03-checks](03-checks.md).

| Guard | App side | Module side | Currently |
| --- | --- | --- | --- |
| Protocol | `LINK_PROTOCOL` in [src/shared/link.ts](../../src/shared/link.ts) | `k_protocol` in [link/src/module.cpp](../../link/src/module.cpp) | 6 = 6 |
| Version | `package_version` in the committed `manifest.json` | `k_version` in `module.cpp` | 0.7.0 = 0.7.0 |
| Freshness | — | hash of `module.cpp`, the vcxproj and `link.xml` against a hash recorded beside the wasm | to build |

### The protocol guard is the one that bites

The app already negotiates. It records the module's protocol number at
[link.ts](../../src/main/sim/link.ts), reports `outdated` when it is below
`LINK_PROTOCOL`, and gates individual features on their own thresholds —
`RESOLUTION_PROTOCOL` today.

So bumping `LINK_PROTOCOL` in TypeScript while the committed wasm still announces
the old number is a change that **typechecks, passes every test, and degrades
silently in the simulator**. That is precisely the failure mode
[link/build.sh](../../link/build.sh) was written to eliminate on the other side of
the boundary: *"every way of getting them wrong succeeded at build time and
failed only in the simulator — a sim restart per mistake."*

### Where the hash is written

`build.sh` writes it, as part of the build, rather than a separate tool a human
remembers to run. The script already owns this category of invariant, and a hash
the build records itself cannot be forgotten, whereas one a person updates is one
more thing to forget.

### What it feels like to hit

A pull request that touches `link/src/module.cpp` **fails until somebody with
MSFS and the SDK rebuilds and commits the wasm**. For an outside contributor
that is a wall — but an honest one, since they could not have built it anyway,
and a clear failure message naming `npm run link:build` beats a merge that ships
a binary which does not match the source beside it.

### No scheduled job

An earlier version of this plan had a scheduled job that opened an issue when
`main` went stale. With non-PR pushes to `main` disabled and the guards required,
`main` cannot go stale. The job was insurance against a hole that no longer
exists.

## Over the air

The module rides inside the editor release, and the existing install code does
the rest.

1. `link/Packages/fsc-editor-link` is in `extraResources`, so it lands at
   `resources/link/fsc-editor-link/` — a real folder outside the asar, because
   installing means copying it into somebody's Community folder and MSFS reads
   the result.
2. electron-updater replaces the whole installation, so a rebuilt module arrives
   with the app. The blockmap means only its changed chunks are actually
   transferred.
3. On the next launch, `updateStaleLinks()`
   ([src/main/ipc.ts](../../src/main/ipc.ts)) overwrites the copy in every
   Community folder that already has one.

So the full chain is: rebuild the module, commit `link/Packages/`, bump, tag, CI
builds and publishes, the user's editor stages it, they press the button, and the
module is replaced on startup.

### Three things about step 3

- **Staleness is decided by hashing the wasm**, not by comparing manifest
  versions ([install.ts](../../src/main/sim/install.ts)). A rebuilt module is
  detected whether or not anybody remembered to bump a number. The corollary:
  editing `package_version` *without* rebuilding ships a version that will never
  propagate, because the bytes are unchanged. The version guard above is what
  catches that.
- **`unknown` is a no-op.** A build carrying no package of its own never touches
  anyone's Community folder. "I cannot tell" must not become "so I overwrote it".
- **MSFS only scans packages at its own startup.** The module is replaced when
  the editor restarts, but a simulator already running will not see it. This is
  the one link in the chain that is not self-healing, and it is the existing
  mechanism the app's copy already explains elsewhere.

`updateStaleLinks` also never installs where nothing is installed — writing into
somebody's game directory for the first time stays a decision they make. Nothing
in this pipeline changes that.
