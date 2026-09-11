# Link — our WASM module

    Purpose:    What we install into the sim, and why it is ours rather than borrowed.
    Depends on: 02-namespaces
    Decides:    own module vs piggyback, no-core-patching rule, module responsibilities

> **Amended by the build.** Protocol 4 widens the module's job beyond `L:`: it
> holds a watch set of `Z:` and `E:` names read by typed id on the same tick
> and wire as the stream, invalidated by the sim's own vars-status push. See
> "Protocol 4: the module watches Z: and E: by typed id" in
> [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** Enumeration is not a one-off. An aircraft's `L:`
> variables come into existence when the aircraft loads, so a table walked at
> connect — which happens at the main menu — contains none of them. The app
> re-enumerates on aircraft change and on connect, backing off until two walks
> agree. See "An aircraft's `L:` variables do not exist before the aircraft
> does" in [build/v1-log.md](build/v1-log.md).

> **Open question from the build.** The two `L:` read APIs can return different
> numbers for the same id — 29.09 against 0.110129, a factor of 264 — because
> `fsVarsLVarGet` applies unit conversion. Which one this module should use is
> **unsettled**: it depends on which read agrees with FS Copilot, whose watcher
> also converts. See "`fsVarsLVarGet` converts units" in
> [build/v1-log.md](build/v1-log.md) for the four-read test that decides it.

`fsc-editor-link` is a Community package containing a WASM module. It is the
only code of ours that runs inside the simulator.

## Why not piggyback on FS Copilot's module

FS Copilot ships `fscopilot-bridge`, whose `modules/FsCopilot.wasm` already
does much of what we need. Its symbols show a `var_watcher` class with
`watch_entry`, `poll`, `set_epsilon(double)`, `read_calc_double` and
`wrap_expression(name, units)`, driven by CommBus commands `FSC_WATCH` and
`FSC_UNWATCH` emitting `FSC_VARIABLE`, plus SimConnect input-event enumeration.

We should not build on it, for three reasons:

1. **It is a watcher, not an enumerator.** There is no
   `get_name_of_named_variable` anywhere in the binary. It watches expressions
   you name; it cannot tell you what exists. Enumeration is exactly the
   capability we need and the one it lacks.
2. **The transport is contested.** Module-to-application traffic runs over
   SimConnect ClientData, and the real `FsCopilot.exe` is running and using it.
   A second client on the same named areas interferes. Their own `hook.js`
   arbitrates duplicate hooks through `L:FSC_HOOK`, so contention here is a
   demonstrated problem rather than a hypothetical one.
3. **It is private and undocumented.** `FSC_WATCH` could be renamed in a patch
   release without anybody being wrong to do it.

Also on the merits: its watcher wraps expressions and evaluates them through
`execute_calculator_code`, which is right for the dozens of variables FS
Copilot watches and hopeless for the thousands we want to diff at once. See
"Module responsibilities" below.

## The one form of piggybacking that is fine

CommBus is a broadcast bus keyed by name. A listener registering on
`FSC_GAUGE_EVENT` can *observe* FS Copilot's interaction stream — H: events and
DOM interactions from its `hook.js` — without patching anything, writing
anything, or competing for a channel.

Passively reading a broadcast is a different act from impersonating a client on
a private protocol, and it is the cheapest possible route to the DOM layer.

Treat it as opportunistic: mark anything sourced this way as such in the
evidence model, and never let correctness depend on it. It relies on their
message shape, and on the user having their bridge installed — likely, since
they are editing its profiles, but not guaranteed.

Verify first that multiple CommBus listeners on one name all receive. See
[17-open-questions](17-open-questions.md).

## Hard rule: patch no core sim file

`fscopilot-bridge` patches `html_ui/Pages/VCockpit/Core/VCockpit.js` — a core
file — under a `PANEL_PATCH` package order hint. If our package patched the
same file, whichever loads last would win and the other's hook would vanish
silently, with no error anywhere.

**Our package ships a module and its own entry point, and replaces no file the
sim or another package owns.** That constraint is what makes the CommBus
observation above worth having: it gets the DOM layer without a patch.

## Namespacing

Everything we name must be distinct from FS Copilot's, because both packages
live in the same Community folder and speak on the same buses:

- package: `fsc-editor-link`
- CommBus channels: our own prefix, never `FSC_*`
- ClientData areas: our own prefix
- any arbitration variable: our own, not `L:FSC_HOOK`

## Module responsibilities

- **Enumerate `L:` variables** by walking ids through
  `get_name_of_named_variable` until null. This is the capability that
  justifies the module existing.
- **Read `L:` variables by id**, via `get_named_variable_value` — a direct
  read, not calculator code. This is what makes diffing thousands of variables
  per tick affordable, and where our module beats an expression-based watcher.
- **Diff in-module** at roughly 10–20 Hz with a float deadband, and send only
  changes. The wire carries deltas, never snapshots.
- **Watch the `A:` list** — the static SDK names plus configured indices — the
  same way. Cost question in [17-open-questions](17-open-questions.md).
- **Enumerate and subscribe input events** (`B:`). This is SimConnect work and
  could live application-side; keeping it in the module keeps one time base for
  every anchor and every change.
- **Execute calculator code on demand**, for [10-probe](10-probe.md).
- **Report a protocol version** in its handshake, from the first release.

## Time base

Every change and every anchor is stamped by the module, from one clock. That is
what makes proximity ranking meaningful — see [08-marks](08-marks.md) on why
sim-stamped anchors beat human-stamped ones.
