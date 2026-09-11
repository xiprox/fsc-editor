# Link — the WASM module

`fsc-editor-link`, a Community package containing one WASM module. It is the
only code of ours that runs inside the simulator, and it exists for one
capability nothing else provides: **`L:` variables**.

They are 84% of the profile corpus, there is no client-side way to read them,
and enumerating them needs `fsVarsGetLVarName`, which only exists inside a
module. Everything else the app needs — `A:` values, `B:` input events, the
loaded aircraft — comes from SimConnect without any of this.

A sibling sub-project like `relay/`: sources here, commands in the root
`package.json`.

## Commands

```
npm run link:build              build, verify, package, install to Community
npm run link:read               watch the stream, without launching the app
npm run link:read -- enumerate  ask the module to walk the table again
npm run link:read -- probe      smoke-test the typed variable API (see below)
```

`link:build` takes about 18 seconds. **It refuses to run while MSFS is open** —
`fspackagetool` drives the sim executable and hangs rather than failing, so the
script checks first and says so. A package change needs a sim restart anyway.

`link:read` writes every session to `transcripts/`, gitignored. Terminal
scrollback lost one of these once; a dump is hundreds of lines with the
interesting part in the middle.

## Requirements

The MSFS SDK, MSFS itself, and Visual Studio with the MSFS platform toolset.

All maintainer tools. **Users never build this** — the module ships as a built
artifact and the app's installer copies the finished folder into Community. It
also means the module cannot be built on a hosted CI runner: the SDK has no
unattended install and `fspackagetool` needs the game.

## How it is built, and why not by hand

MSBuild, through the MSFS2024 platform toolset. `fsc-editor-link.vcxproj` names
its source file and an output path and inherits every flag; `fspackagetool`
writes `manifest.json`.

That is a reversal. Three earlier attempts drove the SDK's clang and wasm-ld
directly and all three produced a package the simulator rejected — a quoted
`date` in `layout.json`, two missing manifest fields, then eight missing
exports. **None of them failed at build time.** MSFS drives a module's memory by
calling into it, so `malloc`, `free`, `get_pages_state` and
`mark_decommit_pages` must appear in the export table; a module without them
registers and is then simply never scheduled.

So `tools/check.mjs` asserts those exports before install, where being wrong
costs a second rather than a sim restart. `tools/layout.mjs` fills in the one
file fspackagetool does not write. `tools/version.mjs` keeps the package's
version equal to the module's — they are two numbers for one artifact and drifted
three releases apart before anyone looked, so the build now derives one from the
other and then checks what the tool actually wrote.

## What the module does

Enumerate `L:` once, cache the ids — they are stable, measured across an
aircraft change — read every one by id at 15 Hz, and send what moved past a
1e-6 deadband. Since protocol 4 it also holds a **watch set**: names the app
asks about that are not in the `L:` table — `Z:` (either spelling) and `E:` —
resolved to typed ids through `MSFS_Vars.h`, read on the same tick with the
same deadband, values on the same wire under handle ids starting at 1,000,000.
The sim's vars-status handler un-resolves cached `Z:` ids on an aircraft
change and triggers a `rescan` on an `L:` reset; a read that errors
un-resolves itself, so the handler is speed, not correctness.

Nothing else: no interpretation, no ranking, no correlation. Those are the
app's, computed over the stream.

Values are read unconverted (`FS_INVALID_UNIT`). The module has no idea what
unit a given profile asked for and would be guessing; conversion happens
app-side where the entry is known.

## The probe

`npm run link:read -- probe` asks the module to smoke-test the typed variable
API in `MSFS_Vars.h` — the API the variable model (docs/sim-vars) plans to
generalise the read loop over. One message of human-readable answers: do
`Z:`/`E:`/`A:` ids resolve and read, do units convert, what does a missing
name return in each id-space, does a `Z:` write round-trip, and does the
vars-status handler register. The handler's *firing* arrives as its own probe
message later — switch aircraft while the reader runs to see it.

`I:`/`O:` are probed with an empty component path only; reading one for real
needs a path from the loaded aircraft's model XML, which is a follow-up by
hand through `exec`. Answers land in the transcript, and belong summarized in
docs/sim-vars/build/v1-log.md once run.

## The wire

Defined in `src/shared/link.ts` and **duplicated in `src/module.cpp`**. A wasm
translation unit and a vite bundle cannot share a header, so the format is
written twice and nothing but `src/main/sim/link.test.ts` notices when the two
drift. Change one, change the other.

Names are ours throughout — `FSCEDITOR_*`, never `FSC_*` — because
`fscopilot-bridge` lives in the same Community folder and speaks on the same
buses. We also patch no file the sim or another package owns, which is what
makes coexistence a property rather than a hope.
