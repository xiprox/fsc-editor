# Static analysis

    Purpose:    Reading addon files to find variables without the sim running.
    Depends on: 05-data-model
    Decides:    the two tiers, direction detection, label resolution, the oracle principle

> **Amended by the build.** MSFS 2024 aircraft use a preset/variant layout: the
> loaded `aircraft.cfg` is a thin overlay and the substance lives in a sibling
> `common/`, with no declared pointer between them. Analysis needs a layout
> resolver before any of the parsing below applies. The findings themselves —
> including the `systems.cfg` circuit naming, which was read from `common/` —
> stand. See the log entry "Stage 0 complete. Aircraft key confirmed; two
> findings about layout." in [build/v1-log.md](build/v1-log.md).

Reliable extraction here is not parsing-for-meaning. It is **mining with
confidence levels, using the sim and the corpus as oracles.**

Everything below was checked against the installed A2A PA-24.

## Package classification comes first

Of 42 packages on this machine containing `SimObjects/Airplanes`, most are FSLTL
AI traffic models with no cockpit at all. A package with no panel, no interior
model and no interactive definitions is not a candidate, and counting it wrecks
any recall metric computed later.

Roughly 30 flyable aircraft remain, across Fenix, PMDG, A2A, Black Square,
iniBuilds and the defaults — five or six genuinely different architectures.

## Tier 1: structured, parse it properly

**`.cfg` files** are INI-shaped with `;` and `//` comments. `systems.cfg` is the
prize, because it *names* the circuit indices:

    circuit.3 = Name:Fuel_Pump#Type:CIRCUIT_FUEL_PUMP:1#Connections:bus.1  ; Fuel pump 24V DC @ 2A

So `A:CIRCUIT CONNECTION ON:3` renders as "Fuel_Pump — bus 1", with the author's
own trailing comment as documentation. The same applies to `[LIGHTS]`,
`[FUEL]`, `[ANTIICE]`. Nothing else does this.

`aircraft.cfg` gives identity and the `[FLTSIM.N]` variants; `panel.cfg` says
which gauges exist and where their code lives.

**Model behavior XML** parses as XML. Run one RPN tokenizer over every text node
that can hold code, and **the RPN gives direction**:

- `(L:FOO)` — a read
- `(>L:FOO)` — a write

That is a control-versus-indication classifier for free, and it is how the junk
gets filtered: many of the PA-24's variables are `*_Anim` animation outputs —
real, but never things to bind.

**Labels resolve.** `<TOOLTIPID>TT:COCKPIT.TOOLTIPS.CONTROLSLOCK` joins against
the package's `en-US.locPak` to give "Controls lock". Human names for
interactive elements, written by the addon author, available offline. The
`doc` field currently comes only from profile comments; this doubles its
sources.

**Input event definitions** — `model/Inputs/*.xml` — give the `B:` list and its
gestures statically, which is what lets [13-report](13-report.md) predict
discoverability before connecting.

## Tier 2: mining, lower confidence, high recall

**Where Tier 1 runs out.** The PA-24's model XML contains **399 distinct `(L:`
reads and zero `(>L:` writes.** The XML only consumes. The producers are five
WASM modules A2A ships — `Accusim.wasm`, `ModelCode1.wasm`, `PA24_Avionics.wasm`
and friends. For any payware aircraft worth the trouble, Tier 1 finds names but
not wiring.

**JS in `html_ui`** — do not parse JavaScript. Match the variable-reference
grammar and `SimVar.GetSimVarValue` / `SetSimVarValue` call sites, raising
confidence when the string is an argument to a known API.

**Binaries** — walk the buffer for printable runs and apply the same patterns.
Recall varies enormously and this is the important finding:

- `ModelCode1.wasm` — 57 embedded calculator strings, writes included:
  `(>A:FLAPS HANDLE INDEX`, `(>A:LIGHT BEACON`, camera commands. Directly
  usable.
- `Accusim.wasm` — **zero** parenthesized references, because it registers its
  variables by bare name through `register_named_variable`, so the prefix is
  never in the binary. A naive `L:` pattern finds nothing and concludes the file
  is opaque.

## The oracle principle

What rescues `Accusim.wasm`: extract the 3,009 bare identifier-shaped strings,
then intersect with variable names already in the corpus. **222 exact matches
against `pa24-250.yaml` alone.** No parsing, no format knowledge.

Generalized, and this is the rule the whole design follows:

> **Static analysis needs recall, not precision, because there are two
> independent oracles.** Every mined string is a candidate. The corpus promotes
> the ones other authors already use; a live sim connection promotes the ones
> `L:` enumeration actually contains. A candidate confirmed by either is a fact.

This is exactly why evidence is stored per source
([05-data-model](05-data-model.md)) — it is not bookkeeping, it is the
mechanism.

## Limits, to be stated rather than hidden

- **Encrypted packages.** Report "read 12 of 340 files" rather than silently
  finding nothing. A scan that admits what it could not read is trustworthy.
- **WASM-driven aircraft.** Names may be present with no wiring; the sweep and
  the recorder cover what files cannot.
- **Streamed content.** This install has a `StreamedPackages` folder, and
  content living in the cloud is not on disk to scan. How much of the default
  fleet that affects bounds the feature — see
  [17-open-questions](17-open-questions.md).

## Incremental

Key each package's analysis to its version and the hash of `layout.json`.
Re-analyse only what changed, which also produces the update diff described in
[13-report](13-report.md).
