# Connection

    Purpose:    How a user goes from no sim connection to a live one.
    Depends on: 03-link
    Decides:    onboarding flow, Community folder discovery, connection states, versioning

> **Amended by the build.** The four states below are two independent facts —
> is a module installed, and are we connected — not four points on one axis, and
> the third of them needs a fact this doc does not mention: a grace window,
> because "sim running, module silent" is also true for the first moment of
> every connection. See "The install flow. Four chip states are two independent
> facts, not four phases." in [build/v1-log.md](build/v1-log.md).
>
> The junction warning under *Finding the Community folder* turned out to be
> load-bearing in both directions — uninstall must not recurse through one, and
> install must not write through one. See "Uninstall would have deleted somebody
> else's scenery" in the same file.
>
> **The chip's labels and tone have moved on from the table below.** Nothing in
> the footer draws attention any more except a fault: the invitation is muted
> inline text reading `Install sim module`, because this is not the only place
> the feature is pitched and a permanent poster in the status bar assumes it is.
> `Restart sim` is now `Sim module not responding` — a state, not an
> instruction, with the instruction in its tooltip. Current labels live in the
> table in `src/shared/sim.ts`.
>
> **There is no `connecting` state.** It existed, it was permanent, and it was
> derived from whether the retry loop was alive rather than from anything it had
> achieved. The client is always trying, so the phase was true almost always and
> informative never — not connected now reads `Sim offline`. See "`Connecting…`
> was permanent" in the same file.
>
> Two things below are overturned outright, both from looking at the built
> screen. **The fifth state does not offer an update, it applies one** — nobody
> can evaluate a WASM module diff, so the prompt has one right answer and should
> not exist. And **the Community folder is proposed, not listed**: `UserCfg.opt`
> is authoritative, so a picker makes the user answer a question we already
> know. See "The update prompt should not exist" and "The folder picker was
> asking a question we already knew the answer to".

## Nothing at startup

Launch is unchanged. Folder selection stays exactly as it is, the app never
waits on the simulator, and a user who never connects sees no degradation of
anything that works today.

The invitation lives in the footer instead: a single attention-drawing chip
reading **Connect to sim**. It is the only thing on screen asking for
attention, and it stays until connected or dismissed.

## The install dialog

Clicking the chip opens a dialog that does four things, in order:

1. **Explains what connecting buys.** Live values in the editor, the Activity
   feed, real variable enumeration for the loaded aircraft. Concrete, not
   abstract.
2. **Asks for the Community folder.** See below.
3. **Installs the Link package** and reports what it wrote.
4. **Tries to connect.** If the module does not answer, says plainly that MSFS
   scans packages at boot and the sim needs restarting — not "try restarting."

## Finding the Community folder

Do not guess. `UserCfg.opt` holds `InstalledPackagesPath` and is authoritative
across MS Store, Steam, 2020, 2024 and relocated installs. On this machine:

    C:\Users\<user>\AppData\Roaming\Microsoft Flight Simulator 2024\UserCfg.opt
    InstalledPackagesPath "…\Microsoft Flight Simulator 2024\Packages"

with `Community`, `Community2024`, `Official2020`, `Official2024` and
`StreamedPackages` beneath it. Both `Community` folders are candidates and the
user may have either or both.

Fall back to the same shape of UX the workspace picker already uses in
`src/main/detect.ts` — offer what was found, let the user override, accept
anything that looks right. AddonLinker and junction farms are common; follow
junctions when checking whether Link is already installed, and do not assume
the folder is a plain directory of real subfolders.

## Four states, not two

The footer chip is a status indicator once connected, and the distinction
between these matters — one is a nag, one is an instruction, two are neither:

| State | Chip | Meaning |
| --- | --- | --- |
| Not installed | `Connect to sim` (attention) | The invitation. |
| Installed, sim not running | `Sim offline` (muted) | Not the user's problem. Say nothing louder. |
| Sim running, module silent | `Restart sim` (attention) | Actionable and specific: the package is there, the sim has not loaded it. |
| Live | `Sim · pa24-250` | Aircraft name doubles as confirmation the right profile applies. |

A fifth state exists once versioning matters: **module older than the editor
expects**, which offers an update rather than failing silently.

## Versioning, updating, uninstalling

- The handshake carries a protocol version from the first release. An editor
  that expects newer says so and offers to reinstall.
- Reinstall overwrites in place and needs a restart, same as install.
- **Offer uninstall.** We are writing into somebody's game install and should
  be able to leave it as we found it.

## What activates on connect

- [09-live-values](09-live-values.md) — silently, no prompt.
- [07-activity](07-activity.md) — starts filling.
- [06-variables-panel](06-variables-panel.md) — gains live values and the
  in-sim filter.
- [10-probe](10-probe.md) — becomes available.

Disconnection is not an error state anywhere. Everything above degrades to the
corpus-only behaviour that exists today.
