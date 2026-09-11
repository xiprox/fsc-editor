# Deployables — three things, three lifetimes

    Purpose:    What this repository ships, who can build each, and the
                contracts between them.
    Depends on: 01-goals
    Decides:    separate release lines for the editor and the relay; the relay
                is always the old half of the pair; the module's custody

This is the doc the rest of the record hangs off. Read it before
[04-versioning](04-versioning.md) or [07-relay](07-relay.md), both of which are
consequences of it.

## The three

| | Built by | Released as | Reaches the user |
| --- | --- | --- | --- |
| **Editor** | CI, `windows-latest` | A GitHub Release, tagged `vX.Y.Z` | When they accept an update, or never |
| **Relay** | CI, `wrangler deploy` | A tag, `relay-vX.Y.Z`, whose release PR *is* the deploy | Within seconds, unconditionally |
| **Link module** | **A maintainer's machine, by hand** | Committed to `link/Packages/`, carried inside the editor | With the editor release that contains it |

The third column is the whole story. The editor's install base is something you
persuade; the relay's is something you replace; the module's rides along with
whichever editor release happens to carry it.

## The editor

An Electron app, `nsis` target, `perMachine: false` — a per-user install under
`%LOCALAPPDATA%\Programs`, which is what makes an update possible without a UAC
prompt. Details in [05-release](05-release.md) and [06-updater](06-updater.md).

The thing to hold on to here: **an installed editor may never be updated.** It
is unsigned freeware for a hobby; somebody installs `0.1.0`, it works, and they
have no reason to look again. Every compatibility question in this record is
downstream of that.

## The relay

A Cloudflare Worker, one Durable Object per invite code, backing Remote Connect.
Small and stable — but it is a URL, so deploying it moves every client at once,
including clients from an editor released a year ago.

**It is a router, not a participant.** [relay/src/index.ts](../../relay/src/index.ts)
states this as a design commitment: it reads the envelope to decide where a
frame goes, never looks inside `message`, never stores one, and never needs to
understand a manifest or a profile. That is what lets the app protocol change
without redeploying the relay — and what makes "the relay has your files" untrue
rather than merely unlikely.

## The Link module

A WASM module installed into an MSFS Community folder, which enumerates the
`L:` table and streams deltas back to the app.

It cannot be built by CI. `fspackagetool` drives the game executable and the
MSFS SDK has no unattended install, so what a maintainer built on a machine with
MSFS and Visual Studio is the only package there will ever be. `link/Packages/`
is committed for exactly this reason, and that is load-bearing rather than
untidy: it is what makes a hosted runner able to produce a complete editor build
at all. See [08-module](08-module.md) and [link/README.md](../../link/README.md).

## The contracts

### Editor ↔ relay

The entire shared surface is one file,
[src/shared/remote-connect.ts](../../src/shared/remote-connect.ts): `RelayFrame`,
the `CLOSE_*` codes, `CODE_ALPHABET` / `CODE_LENGTH` / `parseCode`, `MAX_GUESTS`
and `HOST_GRACE_MS`.

The relay **imports it directly out of the app's source tree**
(`../../src/shared/remote-connect.ts`). So parity inside the repository is not
something anyone has to maintain — it is structural. Two compilers, one file,
and `npm run relay:check` fails if they disagree.

What that does *not* protect against is **deploy-time skew**, and that is the
real risk. Compile-time parity is a property of this tree; the install base is
not in this tree. The invariant that actually matters is therefore not parity at
all:

> **The relay must stay compatible with every editor that has ever been
> released. It is always the old half of the pair.**

No mechanism enforces that today. [09-open-questions](09-open-questions.md)
carries the design for one, and the reason it is safe to defer: there are zero
released editor versions, so the set of editors that could break is currently
empty.

### Editor ↔ module

This one *is* versioned, properly, and was from the start.

The module announces itself with `version protocol variables`
([link/src/module.cpp](../../link/src/module.cpp) `k_version`, `k_protocol`). The
app parses that at [src/main/sim/link.ts](../../src/main/sim/link.ts), records
the protocol number, reports `outdated` when it is below `LINK_PROTOCOL`, and
gates individual features on their own thresholds — `RESOLUTION_PROTOCOL` is the
one that exists today. Both sides are at **6**.

So an old module against a new editor degrades in a way the app can describe,
rather than failing. That is a better position than the relay's, and it is worth
noticing that it got there because the constraint was obvious: the module was
always going to be installed separately from the app that talks to it.

## Why the editor and the relay release separately

**Their lifetimes have nothing in common.** One is an install base you persuade,
the other is a URL you replace.

**Coupling produces churn in the wrong direction.** A one-line relay fix would
cut an editor release that every user is then asked to install, for a change
none of them can observe.

**And it would be misleading.** Releasing them together creates the impression
that shipping them as a pair makes them compatible. It does not. The only editor
whose compatibility matters is the one somebody installed eight months ago, and
no amount of synchronised tagging reaches it.

The cost of separating them is one more version number and one more changelog,
which is cheap. The gate that comes with it — [07-relay](07-relay.md) — turns out
to be worth more than the number.
