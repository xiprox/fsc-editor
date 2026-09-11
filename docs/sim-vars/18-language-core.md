# Language core

    Purpose:    One front-end for the profile dialect — tokens, IR, stack
                simulation, and a rule engine every editor feature sits on.
    Depends on: 02-namespaces, 05-data-model, the shared parser (src/shared/vars/)
    Decides:    four layers, three rule families, confidence tiers, fix channel

> **Status, 2026-08-30.** Layers 1–4 are **built** in
> `src/shared/lang/` with **twenty-six rules shipping**, across all three
> levels and all three families:
>
> - **ten over one expression** — k-arity, k-operand-order, b-write-op,
>   b-preset-unknown, rpn-unterminated, rpn-braces, invisible-chars,
>   ns-access, unit-meaningless, stack-balance
> - **ten over the entry** (`analyzeEntry`) — dead-set, master-set-shape,
>   no-write, toggle-guard, get-unit-meaningless, get-preset-unknown,
>   ref-unresolved, and the setter-shape family: not-settable,
>   prepended-unused, value-word
> - **seven over the profile** (`analyzeProfileView`) — duplicate-get,
>   block-conflict, include-missing, header-updated, block-unknown,
>   key-unknown, ignore-duplicate
>
> **The evidence tier is open**: `b-preset-unknown` and `get-preset-unknown`
> read the loaded aircraft's own input events, so their verdicts appear and
> disappear as the simulator connects and as aeroplanes change. Calibrated in
> the sim on the Black Square Baron and found two lines of real dead code in
> a shipped payware profile. `ref-unresolved` joined them on 2026-08-30, on
> protocol 5's resolution flag — the tier's second source and its first
> channel of its own, `sim:watch-resolution`, because unlike the aircraft's
> input events it moves when a tab opens rather than when an aeroplane does.
> Calibrating it is `npm run lang:calibrate`, which measures rather than
> describes — and its first run cost protocol 5 a bump to 6, because the
> `watched` field had two states for three facts. See the tier's list below.
>
> `npm run lang:sweep` is effectively a corpus lint. After the YAML
> unquoting fix (`scanEntries` → `scalarValue`), **99.8% of 9,345 RPN texts
> tokenize clean**, and the residue is a readable list of real corpus
> mistakes: the Albatross missing parens, the P180 stray quotes, the PC-12's
> missing `(` — plus the bare-event-name setters (`set: K:THROTTLE1_SET`),
> since answered from FS Copilot's own source: dead text forgiven by a
> silent fallback, not a form (see *The two execution paths*).
> **The probes ran 2026-08-29** (v1-log: "The arity probes"): k-arity's
> warning is vindicated — bare `(>K:E)` pops exactly one operand and the
> missing index broadcasts, so two-operands-plus-bare is the *strongest*
> finding, not an idiom to forgive. b-write-op's bare-write branch can
> never be static — "op" is a naming convention over presets (Fenix names
> `..._Push` as full Preset IDs), so it stays muted until it returns as an
> evidence rule. Steps 1–3 of the variable model beneath all this are done
> and sim-verified — see the 2026-08-27 v1-log entries. *Resuming this
> work* below is kept current.

## Why this exists

The editor's language features each hold a private, partial model of RPN
today: [profile-tokens](../../src/renderer/src/lib/profile-tokens.ts)
regex-matches `(>K:EVENT)` for colouring,
[completions](../../src/renderer/src/lib/completions.ts) has its own notions,
[setter.ts](../../src/shared/setter.ts) classifies `set:` lines without
parsing them. That is the disease the shared parser just cured for names,
alive one level up. A fresh pass over highlighting, formatting, completion
and diagnostics is planned; this core is its foundation, built once, in
`src/shared/`, consumed by main and renderer alike.

The corpus is the test suite: ~8,600 real `set:` lines across 66 profiles
must tokenize clean and stack-balance before any rule ships.

## The four layers

1. **Tokens.** Spans on every token, error-tolerant (half-typed code must
   tokenize, never throw), `${…}` holes carried as opaque single-value
   tokens. Invisible characters (NBSP, smart quotes — real hazards in files
   people paste from forums) are tokens too, so a rule can see them.
2. **IR.** Each `( … )` group parsed to `{ kind: read | write | call,
   ref: VarRef, unit?, span }` using the shared parser; every bare RPN
   operator tagged with its known stack arity (push/pop counts).
3. **Stack simulation.** Symbolic depth at every point of the expression; a
   `${…}` hole counts one value. This is what makes arity rules *general*:
   "call needs N operands, M available" catches a missing `:2`, a missing
   value, and malformed RPN with one mechanism.
4. **Rule engine.** Rules are registered functions over `(IR, context)`.
   Context: the SDK catalogue, the descriptor table, corpus evidence, live
   sim evidence when connected, and **the profile entry** (setter kind,
   `get:` ref, units) — the setter family needs it. A diagnostic carries
   span, severity, message, and an optional **fix** (code action). The fix
   channel exists from day one; half the intended rules are corrections.

## Three rule families

Every rule declares its family, because the same token means different
things per layer — `K:` in a `get:` line is FS Copilot's event-sync form
(7,177 corpus lines), while `(K:FOO)` in read position inside RPN is an
error. A rule that does not know its layer false-positives on a third of
the corpus.

**Sim-RPN rules** (about what the simulator will do):

| id sketch | rule | evidence | fix |
| --- | --- | --- | --- |
| k-arity-missing | `(>K:E)` where the catalogue documents a `[1]` param | catalogue `parameters` | insert `:2`, snippet operands |
| k-arity-extra | `(>K:2:E)` where only `[0]` is documented | catalogue | drop `:2` |
| k-operand-labels | inlay `[0] value · [1] index`, reversed-stack order made visible | catalogue | — |
| k-operand-order | the `${…}` value pushed into a documented index slot — wrong with or without `:2` | catalogue + hole position | swap operands |
| b-write-no-op | bare `B:` preset in write position | parser | append `_Set` / offer suffixes |
| b-read-with-op | suffixed `B:` name in read position | parser | strip suffix |
| a-not-settable | write to an `A:` whose catalogue row says not settable | catalogue | suggest the K: event |
| a-unknown / k-unknown | name not in catalogue | catalogue | nearest-match suggestion |
| unit-category | unit from the wrong category; `percent` vs `percent over 100` | catalogue | ×100 hint |
| unit-on-unitless | units on `K:`/`H:`/`B:` refs | descriptor table | remove |
| h-read / e-write | `H:` read; `E:` write (only SIMULATION RATE is writable) | descriptor table | — |
| stack-balance | expression under/overflows for its context | stack sim | — |
| rpn-syntax | unbalanced `if{`/quotes/parens; unknown operator; register out of 0–49 | tokens/IR | — |
| invisible-chars | NBSP, smart quotes, zero-width | tokens | replace |

**FS Copilot dialect rules** (about what FS Copilot does with the line):

- `K:` in `get:` position is legal (the event-sync form) — a *suppression*
  the engine encodes, not a rule.
- unit on an `L:` line that FS Copilot will not convert — info-tier.
- duplicate `get:` names across entries; units disagreeing with corpus
  consensus (this var is `Bool` in 12 profiles, you wrote `Number`).

### The two execution paths — read from FS Copilot's source, 2026-08-27

> The full behavior reference, with source anchors and the commit pin, is
> [docs/fscopilot-behavior.md](../fscopilot-behavior.md) — check its pin
> before trusting either of us.

`Definition.ApplyTo` in `fscopilot/src/FsCopilot/Simulation/Definitions.cs`
splits by block, and the split changes what a `set:` even *is*:

- **`shared:` entries** build the expression (`Set()` — the four kinds,
  branch-identical to our `setKind`) and run it through the calculator
  (`sim.Execute`). Real RPN.
- **`master:` entries** never run RPN. `ParseSet` matches the *whole*
  expression against `^args (>NAME[, units])$`, splits args on spaces,
  parses each as a number — **anything non-numeric becomes 0** — reverses
  them (the authoritative confirmation of [0]-pushed-last), strips a
  `K:2:` arity, and transmits through SimConnect: `L:` by data definition
  (FLOAT32), `A:` by data definition, `K:` as a real event, everything
  else wrapped back into calculator code. **No regex match ⇒ silent
  fallback: the value is written to the `get:` target and the `set:` text
  never runs.**

Rules this unlocks (all dialect-family, all needing the entry's block) —
**the first three shipped 2026-08-29** in `src/shared/lang/rules/`, over the
`analyzeEntry` entry point below:

| rule | the fact | corpus proof |
| --- | --- | --- |
| master-set-shape ✓ | a `master:` setter containing RPN operators or reads produces zero-args, not computation | none today: every one of the 126 matching non-js master setters has *zero* args, so the rule ships calibrated to zero |
| dead-set ✓ | `master:` setter that cannot match ParseSet — "this never runs; the value goes to the get: variable instead" | JF_RJ_100's `set: K:THROTTLE1_SET` ×6 — the entries work only via the fallback write to their `get:` A: var. Fixable: the bare name wants to be `(>K:THROTTLE1_SET)` |
| toggle-guard ✗ *(shipped, then retired 2026-09-19 — the skip only happens when the two sides already agree, so the accidental case costs nothing worth a diagnostic; zero corpus hits. The mechanism stays in `facts.ts` for the setter templates and the entry trace.)* | a shared `>K:`/`>B:` expression containing "TOGGLE" is *skipped when value == current* | 911 corpus expressions are guarded and every one of them means to be, so the shipped rule fires only on the accident: the word outside every write target |
| k-numeric-id | `(>K:#84132)` fires a custom event by numeric id — legal, must not trip unknown-name rules | 3+ corpus uses, and the `">K:#"` branch in `ApplyTo`. A *suppression*, so it lands with the first unknown-name rule, not before |

Also learned there, for other parts of the model: the implicit setter
writes with the entry's units (`value (>Get, Units)`); `L:`/`A:` writes use
only the **last** arg; FS Copilot writes `L:` as FLOAT32 over the same
SimConnect data-definition path this project researched from the SDK docs
on day one — it was never module-only.

**Setter-shape rules** (about the four kinds in `setter.ts` — FS Copilot
picks the kind by *shape*, so the mistake class is "what the author meant ≠
what the shape means"):

| rule | fix |
| --- | --- |
| ~~`${value}` inside a `literal` setter~~ — **struck, void by construction**: `Set`'s trigger is `IndexOfAny([''', '`', '?', '{', '}'])`, so any text containing `${…}` has a `{` and *is* a javascript setter. There is no literal setter with a hole in it | — |
| value-word ✓ — `value`/`current` in a non-JS kind. **0 corpus hits**, shipped as insurance: probe-backed, since the calculator silently ignores the bare word | names the template form |
| prepended-unused ✓ — a prepended setter whose expression supplies every operand it needs, so the incoming value is left on the stack. **0 corpus hits**, and precisely so: strictly walked, **1,940 of 1,940** corpus prepended setters consume their value. Walks the stack itself, because the shared simulator *softens* a bare `(>K:E)`'s pop — the model that keeps stack-balance quiet calls 1,888 of those 1,940 unconsumed | — |
| not-settable ✓ — an implicit setter whose `get:` is an `A:` the SDK marks unsettable. **119 across 32 names**, so **info** and phrased as the docs' claim: a premise with that many counterexamples in flown payware does not get to warn, and the settable column is not even the path FS Copilot writes through (a SimConnect data definition, not the calculator). Belongs to the evidence tier in the end | — |
| bare `B:` as an implicit target | — | 
| JS setter not template-shaped — analyze each template literal, mark the rest honestly unanalyzed | — |
| ~~`set:` writes X, `get:` reads Y~~ — **struck, measured**: 9,673 corpus setters write something other than their `get:` name and only 701 write it. Reading a variable that exposes a state and writing the event that changes it *is* the format's normal shape, not a desync smell | — |

**Evidence-backed rules** (need the sim or history). **The tier is open as
of 2026-08-29**: `RuleContext.hasInputEvent` is the first method whose answer
changes while the file does not, and verdicts appear and disappear as the
simulator connects and as aeroplanes change — accepted deliberately, as the
point of the tier.

The wire, which the next evidence rule reuses: `session.inputEventNames()`
beside `simState`, carried on `VarIndex.inputEvents` rather than through a
channel of its own, because the index is *already* rebuilt per aircraft and
`onVarsChanged` *already* re-runs diagnostics for every open file. Per-aircraft
evidence has exactly the index's lifetime, so it travels with it.

- b-preset-unknown ✓ — a `B:` name the loaded aircraft has not registered.
  **Warning, never error**: the sim's table fills as add-ons wake up (the same
  reason the `L:` walk runs twice), so absence is weak evidence where presence
  is strong. **Corrected 2026-09-03**, from an A220 reported firing on correct
  lines: a name counts as found if the aircraft knows the whole name *or* the
  name with **one trailing `_Word` removed** — whichever word it is, unless
  it is all digits, which is an index rather than a preset (`_1` and `_2` are
  different controls). See `src/shared/vars/input-events.ts`.
  `EnumerateInputEvents` returns `<InputEvent ID>` values and nothing else —
  the A220 lists `AIRLINER_FCU_CHRONO_2` and never the `..._Push` its own
  Behaviors tool shows, and exactly 1 of its 464 names ends in a generated
  operation — so a miss on the *written* name is the normal state of every
  correct `ID_Preset` reference, and only the base can be asked about. The
  `AIRLINER_FCU_SPD_PUSH` / `..._PUSH_PUSH` pair the earlier op-stripping
  design was inferred from is two IDs, not a preset plus an op; the A220 names
  `ALT` the same way. **Calibrated in the sim 2026-08-29** on the Black Square
  Baron, against its own profile: 127 enumerated events, 72 `B:` references,
  **2 hits, both real** — a pass that counted hits and could not see the
  misses, on an aeroplane whose installed profile has zero `B:` refs. Note
  what the rule does *not* claim: that an enumerated preset is a working
  write target. It is not — the bare-write question is b-write-op's, and
  still muted. Nor that a trailing word is the *wrong* operation: `_ARM`
  (dead on the Baron) and `_Push` (working on the A220) are one shape, only
  per-preset set-code separates them, and running the setter is what asks.
- b-write-bare ✓ (2026-09-03) — a `set:` expression writing a name the sim
  lists **verbatim**. The table holds IDs, so a written name that is in it is an
  ID with its action missing: `b-write-op`'s bare-write branch, decidable at
  last, and keyed on *presence* rather than the absence that made
  `b-preset-unknown` misfire. **Write position only** — 411 of the corpus's
  643 `B:` `get:` lines carry no action, because a bare ID is exactly what a
  read subscribes to. Uncalibratable by sweep: of the 599 distinct names the
  corpus writes through `>B:`, **zero** are among the A220's 464, so it speaks
  only while somebody authors against a loaded aeroplane. The message hedges to
  match its evidence — one probe, on one event, on the Baron.
- get-preset-unknown ✓ — the same question on a `get:` line. A `B:` `get:` is
  legal dialect (it mirrors the event firing, as a `K:` `get:` does), but only
  for an event the aeroplane has — and **643 corpus entries name a `B:` preset
  in `get:` position**, where no rule had ever looked, because the expression
  rules only see `set:` values. Not the entry-level twin the b-write-op note
  warns against: that warning is about a *positional* question, and existence
  is not positional. Baron: 11 such lines, 0 missing.
- ref-unresolved ✓ — a `get:` whose name the module watched and the aircraft
  never resolved: "does not exist here; FS Copilot will create it and sync a
  constant 0". The dead-line detection proven 2026-08-27 (see the v1-log
  entry "Protocol 4 verified in the sim"), unblocked by protocol 5 on
  2026-08-29 and built on 2026-08-30. What made it sayable is an asymmetry:
  the *calculator* read touch-creates a `Z:`, which is why FS Copilot's own
  read hides the problem, and the typed Get the module watches with does not
  — so an unresolved ref is real absence rather than silence.

  Two things narrowed it while building. **It is a `get:` rule**, because
  only `get:` lines enter the watch set — `store.ts` builds it from the open
  tabs — so a `Z:` inside a `set:` expression has no evidence and gets no
  verdict. And **"unresolved `Z:`/`L:`" is two rules, not one**: `readOf`
  sends `Z:`, `E:` and indexed `L:` to the module's typed-id watch, but plain
  `L:` is *streamed* (the module forwards every variable that moves) and is
  never watched at all, so resolution can never speak for it. Its existence
  question belongs to a second rule over the module's enumeration, which is
  already recorded per aircraft in the sim-evidence table.

  Corpus population: **13 lines**, all `Z:` — twelve `Z:AUDIO_Knob_Selector_1`
  across the Black Square fleet, the PC-12 and the WB-Sim C172, plus one
  `Z:SWS_MISC_SunshadePlaced` in the PC-12. No `E:` or indexed-`L:` `get:`
  line exists in the corpus at all.

  Calibration is `npm run lang:calibrate` rather than a description of a
  squiggle. It watches all 13 lines at once with no app in the way, prints
  the settle timeline and each name's verdict beside its profile:line sites,
  and finishes by running the rule itself through `analyzeProfile`. The first
  attempt at calibrating by eye is what hid the protocol-5 defect below for a
  day; the script asserts exactly that defect and exits non-zero on it.

  **The first attempt found one, and it was the wire's.** Protocol 5 had two
  states for three facts: `watch-add` is answered *before* the tick resolves
  anything, so every fresh ref was reported unresolved and corrected a frame
  later — a ~66–100 ms warning on every `Z:`/`E:` line, on correct code, each
  time a tab opened. Protocol 6 makes the field three-valued (`2` = not tried)
  and `RESOLUTION_PROTOCOL` withholds verdicts from any module older than
  that. See the v1-log entry of 2026-08-30.

  Its wire is the tier's first **channel of its own**, `sim:watch-resolution`,
  rather than a facet of `VarIndex`. The input-event enumeration rides the
  index because per-aircraft evidence has exactly the index's lifetime; this
  does not — the watch set is these tabs' `get:` lines, so it moves when
  somebody opens a file, and rebuilding 25,000 rows to answer that is the
  wrong trade. Main only wakes the renderer when the *unresolved set* differs,
  because the mapping itself is re-sent after every `watch-add`.
- `not-settable`, properly — asking a running sim instead of reading the SDK's
  settable column, which is not even the path FS Copilot writes through.
- "reverted when written in N of M runs" — the desync warning at edit time,
  from run history.

## Beyond setters — the whole profile

The RPN core is the *innermost* of three analysis levels. The outer two are
audit category (c): additive entry points beside `analyze()`, sharing the
same Rule/Diagnostic/fix shapes. `scanLines` already carries 1-based line
numbers and indent on every line, so positions exist; the one prerequisite
is `RawEntry` gaining references to its lines (an additive field).

~~prerequisite~~ **Both done, 2026-08-29.** `RawEntry.at` carries `{ get,
set?, skp? }` — line numbers, not `Line` objects, because an entry crosses
IPC — and `entriesFromLines(lines, relPath)` lets a caller that already has
a scan fold entries out of it rather than scanning the same text twice.
`analyzeEntry(rules, entry, context)` mirrors `analyze` down to the
registry being a parameter; an `EntryRule` sees an `EntryView` (a subset of
`RawEntry`, redeclared so `lang/` goes on depending only on `vars/`) and
returns diagnostics whose offsets are measured in the text named by
`target: "get" | "set"`. **Both targets are now mapped**, and building the
second one corrected the first: level 2 originally ran *inside* the
expression walk, at the setter — which meant it never saw an entry without
one, and **15,933 of the corpus's 25,855 entries are implicit**. A
`get:`-line rule would have been blind to the majority of every profile.
So `analysis.ts` runs two passes: the walk gathers each setter's text and
its mapper, keyed by the `set:` line an entry records, and a second pass
judges every entry — `set:` verdicts reusing the walk's mapper, `get:`
verdicts placed by finding the `scalarValue` back in its raw line, which
absorbs quoting for free. The refactor was verified verdict-neutral: the
corpus sweep did not move by one diagnostic.

**Level 2 — the entry** (`analyzeEntry(rules, entry, context)`): the `get:`
name and units, the setter's relationship to them, `skp:`.

| rule | evidence | corpus today |
| --- | --- | --- |
| no-write ✓ — a `shared:` setter containing no `(>NAME)` at all, so an incoming value is never applied. **Error**: unlike master's `dead-set` there is no fallback | sim probe (bare words are ignored) | 5 — four WBSIM `H:KAP140_*_PRESS`, one inibuilds `NAV SWAP:2 = 1`, all fixable to `(>NAME)` |
| get-unit-meaningless ✓ — a units field on a `get:` whose namespace has none. **Info**: redundant, not harmful | descriptor + sim probe | 60 — every one an `H:` line with `Bool`, and every one an *implicit* setter, so FS Copilot really does build `1 (>H:NAME, Bool)`. `1 16272 (>K:2:KOHLSMAN_SET, Bool)` moved the altimeter exactly as the unit-free form does, so the calculator ignores it |
| ~~unit-category vs the catalogue unit~~ — **struck 2026-08-29, measured**: 549 of the 2,464 `A:` `get:` lines that carry both a written unit and a documented one disagree, and the disagreements are legitimate — `Position 16k` for a percent quantity, `Hz` for `MHz`. The premise was wrong twice over: any convertible unit resolves, and *both peers run the same profile*, so a non-documented scale round-trips. What could still earn a rule is an **incompatible category** (`Feet` on a `Bool`), which needs a unit→category table units.ts does not have | catalogue + a category table | 0 shippable |
| `Z:`/`L:` that resolves to nothing on this aircraft — dead line | live sim | 13+ lines |
| implicit setter whose `get:` target is unwritable | catalogue + descriptor | uncounted |
| `set:` writes X, `get:` reads Y, nothing connects them | RPN IR + entry | uncounted |
| ~~unknown `A:`/`K:` name in `get:`, nearest match~~ — **deferred 2026-08-29, measured**: see *Why the catalogue cannot carry this yet* below | catalogue | 94 raw, ~42 real |
| ~~`skp:` not a number~~ — **wrong, struck 2026-08-29**: `skp:` holds the *name of another variable*, so "is it a number" is exactly backwards. The rule that belongs here is `skp:` naming a variable no entry in the profile declares | grammar + entries | uncounted |

#### Why the catalogue cannot carry the unknown-name rule yet

Measured 2026-08-29, and every number argues against shipping it:

- **The catalogue is a whitelist of the documented, not a census of what
  exists.** 94 `A:` `get:` lines name something it does not hold, and real
  variables are among them — `A:FUEL TANK CENTER2 LEVEL`, the MSFS 2024
  `… DIRT PCT` family. Absence is weak evidence in a way presence is not.
- **52 of those 94 are not unknown at all.** They are the string-index form,
  `A:LINE BREAKER PULLED:'BUS_1_To_FuelPump'_n`, and every base name in that
  group *is* catalogued. `parseVar` splits only a numeric index (`A:NAV
  OBS:1`), by design, so the lookup key still carries the index. **This is
  the rule's real prerequisite**: string-index parsing in
  `src/shared/vars/parse.ts` — a shared-parser change, so a design event
  rather than a patch, and not one to make in passing.
- **The nearest-match fix makes it worse, not better.** 18 of the 94 have a
  near neighbour and 16 of those suggestions are wrong, because unknown
  names cluster in numbered families: `A:COM2 STORED FREQUENCY` gets
  "did you mean COM1", when the answer is `A:COM STORED FREQUENCY:2`.
  Edit distance is confidently wrong exactly where the corpus needs help.

Two narrower shapes were tried against the same data and also failed: an
`A:` name that is really a known `K:` event scores **0**, and "an `A:` name
with an underscore" (the SDK has 0 such names in 1,585) cannot be told from
the legitimate string-index form until the parser splits it.

What survives is a smaller, honestly-tiered rule for later: the ~42 genuine
unknowns, at **info**, with no suggestion — and better, the live-sim version
already in the evidence tier, which asks the aircraft instead of the docs.

**And one negative rule, learned from the corpus before it could ship
wrong:** `get: B:X_Toggle` — a suffixed B: name in get: position — appears
**232 times** and is legal dialect: a B: `get:` subscribes to the event and
mirrors its firing, the same way a `K:` `get:` is the event-sync form. The
RPN-position rule `b-write-op` (reading an operation *inside an
expression*) must not grow an entry-level twin. Position decides meaning;
the families exist so this stays explicit.

**Level 3 — the profile** (`analyzeProfileView(rules, profile, context)`,
built 2026-08-29): blocks and the file. A `ProfileRule` is handed the whole
file's view — entries, `include:` items, `ignore:` items, block keys and the
`# Updated:` line — and anchors each
verdict to a **line**, whose value text its offsets are measured in.

> Level 2 names its target `"get" | "set"` because an entry has exactly two
> texts. Level 3 cannot: an `include:` item is not an entry. The first cut
> of this took `EntryView[]` and anchored by index into it, which could not
> have expressed a single one of the `include:`, `ignore:` or block-key
> rules listed below — the same under-building the audit records for
> `simulate()`. Widened the same day, before a second rule could depend on
> the narrow shape.
>
> **Both list blocks are optional.** Most profiles declare neither, and
> nothing here may read an absent `include:` or `ignore:` as a finding.

> **The premise about duplicates was wrong, and the source says so.**
> `Definitions.Load` builds a flat array (`master.Concat(shared)`) with no
> dictionary and no dedup, and `Coordinator.Load` does
> `foreach (var def in definitions) AddLink(def)`. A repeated name is **not**
> last-wins and not a lookup conflict: it gets two independent
> subscriptions, sends two `Update` packets per change, and applies both
> setters to every incoming value. Which is why the rule below fires on
> *identical* copies only — 161 corpus groups repeat a name with a
> **different** setter, and that is a deliberate fan-out (one variable
> driving the captain's button and the first officer's), working exactly as
> written.

| rule | evidence | notes |
| --- | --- | --- |
| duplicate-get ✓ | entries + source | 197 corpus hits, all identical copies: two subscriptions doing one job. Wasted work for a plain write, a **double press** for a `_Push`/`_Toggle`. Compares names *exactly*, because `Coordinator` does (`update.Name == getVar`) |
| block-conflict ✓ | entries + source | 28. Not "the block decides authority" — both subscriptions live, with *opposite* rules: a `master:` entry sends only while this machine is master and applies only while it is not, a `shared:` one always does both |
| block-unknown ✓ | grammar's `known` | **error, and the widest blast radius in the set.** `.IgnoreUnmatchedProperties()` is *commented out* in FS Copilot's `DeserializerBuilder`, so YamlDotNet throws on an unmatched key; `TryLoadTree` catches it and `Load` returns an empty definition set. `sharde:` does not disable a block, it disables the profile — every entry, plus everything it includes, with one information-level log line as the only symptom. 0 corpus hits. The four keys are a closed vocabulary, so `nearest` may suggest one |
| key-unknown ✓ | grammar's line kinds | **error**, block-unknown's sibling one level in, and the same blast radius for the same reason: `Definitions.cs` builds **one** deserializer for the document, so an unmatched property on a `Config.Link` throws exactly as one on `Config` does. `sett:` does not disable a setter, it disables the profile. 0 corpus hits. Two closed vocabularies — `get:`/`set:`/`skp:` inside an entry, the five blocks at the top level — so `nearest` may suggest one, at **one** edit inside an entry rather than two: on a three-letter key two edits reaches `get` from `sett` as well as `set`, and the tie rule then refuses both. Written 2026-09-19 to replace monaco-yaml's `additionalProperties: false`, which had never run |
| include-missing ✓ | `RuleContext.workspaceFiles()` | 2 of 125 includes, and one is the gift the calibration promised: `bksq-aircraft-tbm850.yaml` includes `modules/paload.yaml` while `payload.yaml` sits beside it, so the fix writes the right name. Nearest match is safe here — a filename against a directory listing, not a variable name in a numbered family — and is offered only when *exactly one* candidate in the same directory is within two edits. Paths resolve from the Definitions root (`LoadModule`'s `Path.Combine`), matched case-insensitively |
| include cycle; self-include | the file's own path, and other files' includes | **not built**: neither is decidable from a listing. A cycle needs the includes *of other files* and self-include needs `analyzeProfile` to know which file it is analysing — two additions to the context surface, for 0 known corpus instances |
| ignore-duplicate ✓ | entries + source | **info**, 0 corpus hits. `Coordinator._ignore` is a `HashSet<string>`, so a repeat is a no-op — the rule says so rather than implying a cost it does not have |
| ~~`# Last Updated:`~~ — folded into header-updated above: the regex is anchored `^\s*#\s*Updated:`, so `# Last Updated:` simply is not a date line and the profile has none. **No near-miss is suggested**: not one of the four undated corpus profiles wrote `# Last Updated:` or anything else date-shaped, so there is nothing to correct *to*. Two further facts the mirror encodes: the regex is `Multiline` over the **whole file**, so the line need not sit in the comment header, and it is case-sensitive, so `# updated:` is not one | grammar | 0 |
| unparseable `# Updated:` date | the real parser | **not built.** Identical consequence — `TryReadUpdatedUtc` returns null and the date is `MinValue` just the same — but deciding it means mirroring .NET's `DateTime.TryParse(raw, CultureInfo.InvariantCulture, …)` in JS, whose accepted set differs. All 52 corpus dates are `yyyy-MM-dd[ HH:mm:ss]` and parse, so the branch is emulation risk with nothing to catch |
| header-updated ✓ | the mirrored `UpdatedRx` | **error**, and 4 of 56 profiles. Not the nag it reads as: the date feeds `defs.UpdatedAt`, and `MainViewModel` sets `NewProfileAvailable` from `updatedAt > defs.UpdatedAt`. With no header the date is `DateTime.MinValue`, so **any** published version compares as newer and FS Copilot offers to replace the profile every time it checks, however current the file is. Gated on the profile having entries — a file with none is one somebody has started, and the absence rule holds |

**Deliberately no rules about absence.** `shared:`, `master:`, `include:`
and `ignore:` are all optional, and any combination of them — including none
— is a profile somebody is partway through writing. Nothing may read an
absent block as a finding. Seven such shapes are pinned in
`profile-diagnostics.test.ts`, because it is one line of carelessness away in
any future block-key rule. The single rule that fires on something *not*
being there is `header-updated`, and it earns that twice over: it names a
consequence rather than a convention, and it stays silent until the file has
entries — a profile somebody has only started is never told off for a date it
has not needed yet.

**Deliberately no rules:** headings, padding, casing, blank-line discipline
— the canonical-form section of docs/profile-format.md is the formatter's
domain, applied on save with no options. A diagnostic nagging about what
the formatter silently fixes would be noise about nothing.

## The core-change audit

A standing check, run whenever a rule is added: **a rule that requires
editing an existing core signature is a design event, not a patch.** The
audit as of the twenty-five shipped rules — every remaining catalogue rule lands
via (a) a new file under `rules/`, (b) a new *optional* `RuleContext`
method, or (c) the entry- and profile-level entry points mapped in *Beyond
setters* above — additive functions beside `analyze()`, designed here and
built when the first such rule lands, with one additive prerequisite
(`RawEntry` gaining line references). Nothing left in the catalogue needs
(d) none-of-the-above.

**Category (b) came due too**, and cost one line: `include-missing` needed
the workspace listing, which landed as the optional `RuleContext.workspaceFiles()`
— supplied by the renderer from the store's `files`, by the sweep from a
`readdir`, and by nobody in a test, where its absence correctly mutes the
rule.

**Category (c) came due 2026-08-29 and held.** The three ParseSet rules
needed the entry, and landed as `analyzeEntry` plus the `RawEntry.at`
prerequisite, both spelled out above before they were built — three new
files under `rules/`, one new entry point, and not one existing signature
edited. The one core-adjacent question it raised, whether entry rules
should read the setter kind off the entry or the context, went to the
context: `RuleContext.setterKind` already carried it, and a second copy is
a second answer waiting to disagree.

The second breach, recorded the same way: level 3 shipped taking
`EntryView[]` and anchoring by index into it, which its own catalogue —
`include:`, `ignore:`, block keys — could not use. Caught within the hour by
writing the next rule on the list, and widened to a `ProfileView` with a
line anchor before anything depended on the narrow shape. The lesson is the
one below, twice: the spec was here first.

The first breach, recorded as the cautionary example: `simulate()`
shipped without the initial-depth parameter that this doc's own
prepended-consumption rule plainly required, and grew it a day later along
with `underflow` and `end`. The spec was here first; the implementation
under-built it.

## Confidence tiers

Only 662 of 1,524 `K:` events carry parameter documentation. A rule
declares its evidence source and **mutes itself when the data is absent** —
missing-arity must not fire on the undocumented 862. Absence of evidence is
silence, never a guess. Severities: catalogue-backed → error; dialect and
shape → warning; corpus-consensus and live-evidence → info. Suppression via
a YAML comment opt-out is part of the diagnostic shape from the start.

## What completion takes from the core

Completion inserts the **correct calling shape**, not just a name:
`${1:value} ${2:index} (>K:2:KOHLSMAN_SET)` as a snippet generated from the
catalogue's parameter strings; `B:` offers only suffixed forms after `(>`
and the bare preset in read position; the unit slot completes from the
variable's own unit category. Hover and inlays read the same IR.

## Deliberately deferred, and until when

- **`I:`/`O:` component paths** — blocked on data: paths live in model
  behaviour XML, which only the unbuilt Analysis stage will parse. Gated on
  demand (2 corpus lines, one aircraft). Possibly never; the descriptor
  `why` covers it honestly.
- **Per-ref resolution state in the `watched` mapping** — a wire change
  whose only consumer is panel value-cell copy that does not exist yet.
  Lands with the panel pass that renders descriptor `why` strings.
- **`B:` op folding in the panel** (three generated events listed as one
  control) — parser already carries `preset` + `op`; folding is one line in
  `varIdentity` once the panel decides to render ops.

## Highlighting v2 — the setter taxonomy and the design (2026-09-11)

> **Built the same day.** The highlighter now lives in
> `src/shared/highlight/` — `scopes.ts` (the vocabulary, 33 scopes),
> `paint.ts` (the two mutually recursive painters and the frame stack),
> `line.ts` (dispatch over `classifyLine`, and the state Monaco carries).
> `profile-tokens.ts` is a twenty-line adapter; `monaco-theme.ts` is a
> `Record<Scope, …>`; `index.css` gained `--syntax-rpn-operator` and
> `--syntax-register`. 38 headless cases in `highlight.test.ts`, one per
> row below plus the corpus mistakes; the adapter's nine kept. `npm run
> check:highlight` sweeps the 65 profiles (45,292 lines): no throws, every
> scope in the vocabulary, and 22 `rpn.word` spans — all of them the known
> corpus mistakes, plus three `- set:` lines that meant `- get:`. The set
> templates moved to `set-templates.ts` with the six corpus-ranked shapes
> added and a test that each template is the kind its label claims. Live
> check: a CDP drive of the dev build reading computed colours off the
> rendered spans — flow words keyword-bold, operators indigo, `value`
> injected-bold inside a double-quoted template, refs by anatomy inside a
> single-quoted string. One thing seen there and left alone: Monaco's
> bracket-pair colorization paints every paren and brace by nesting depth,
> over the scope colour, as it did before.

The first editor pass (2026-08-28, step 3 below) put the core under the
token provider but left its shape alone: a JavaScript lexer paints every
`set:` value whatever its kind, with refs popped out by `tokenizeRpn`. A
sweep of the 65-profile corpus (`Documents/Definitions`, 25,607 entries,
checked against `Set()` in FS Copilot's `Definitions.cs`) shows that shape
mispaints the *dominant* form. This section is the spec for the redo: the
taxonomy every setter falls into, the rules the numbers force, and the
design that follows. The vocabulary file, the tests and the completion
templates all cite the tables here rather than restating them.

### The taxonomy

Three layers; every setter is one choice from each.

**Layer 1 — YAML surface.** Five forms, no chomping indicators, no escape
sequences anywhere in the corpus (so unquoting is arithmetic, as
`analysis.ts` already relies on). One block indicator carries a trailing
`#` comment.

| form | javascript | prepended | literal |
| --- | --- | --- | --- |
| plain | 2 (junk: `NAV ACTIVE FREQUENCY:2 = {frequency}`) | 1,990 | 1,749 |
| `"double"` | **5,906** | 17 | 89 |
| `'single'` | 0 | 0 | 22 |
| block `\|` | 331 | 0 | 0 |
| block `>` | 270 | 0 | 0 |

**Layer 2 — the kind**, decided by `Set()` on the *unquoted* text, in this
order: no `set:` → implicit; any of `'`, `` ` ``, `?`, `{`, `}` →
javascript; leading `(` → prepended; else literal. `master:` changes
execution (ParseSet, above), not syntax, and gets no highlighting of its
own.

| kind | shared | master |
| --- | --- | --- |
| implicit | 15,231 | — |
| javascript | 6,372 | 137 |
| prepended | 1,881 | 126 |
| literal | 1,854 | 6 |

**Layer 3 — the program.** Every literal and prepended setter in the
corpus is *numbers, then one write*: `N (>K:E)` 1,361, `(>K:E)` 1,240,
`(>B:E)` 698, `N N (>K:2:E)` 253, `N (>L:V)` 212, `(>L:V)` 51, `N (>B:E)`
20, `(>H:E)` 17. Not one RPN operator appears outside JavaScript — `if{`
and `}` are JavaScript triggers, so every program that computes is a
JavaScript setter whose *strings* are the RPN. The residue is the known
corpus mistakes: 4 unterminated refs, 3 refs without a namespace, 6 bare
event names in `master:`, one `NAV SWAP:2 = 1`, one trailing comma.

| JavaScript shape | count | example |
| --- | --- | --- |
| the whole value is one template literal | 5,487 | `` `${value} (>B:X)` `` |
| ternary of strings | 635 | `value > current ? '(>B:INC)' : '(>B:DEC)'` |
| `switch` / `if`-chain with `return` | 248 | `switch (value) { case 0: return '…' }` |
| IIFE block | 133 | `(() => { if (!!value === !!current) return ''; … })()` |
| broken — backtick closed by a quote, or a missing `(` | 7 | `` `${value} (>K:COVER_0_SET)' `` |

Features by count: arithmetic in a hole 2,435; uses `current` 1,502; an
empty `''` branch 1,246; RPN flow (`if{`) inside a string 236; nested
quoting (a `'…'` inside a `${…}` hole, or a template concatenated to a
string with `+`) 796; `Math.` 57; `const`/`let` 38; `//` comments 6;
`K:#` numeric event ids 8 (plus 36 in RPN setters).

**What the strings hold** decides the central rule. Of the 8,700 string
literals inside JavaScript setters: 5,322 template bodies are pure RPN
(ref only), 1,849 single-quoted bodies are pure RPN, 458 single-quoted
bodies are RPN *with operators*, 8 template bodies are RPN with operators,
490 are empty, 221 template bodies are holes only (`` `${value * 16}` ``).
**Zero** are comparison operands — no `current == 'ON'` exists. Jint's
`AsString()` on the result is why: the value of the expression *is* the
program, so every string is a program fragment.

### The rules the numbers force

1. **Unquote before painting.** 91% of JavaScript setters sit in YAML
   double quotes, and the provider receives the raw value, so today the
   entire expression is painted as a string with only the refs popped out
   — `${value}` never shows as injected. The quote layer is painted as a
   delimiter and the kind is decided on the inside, through the same
   `scalarValue` split `scanEntries` uses.
2. **Every string literal in a JavaScript setter is an RPN program.**
   Its body goes to the RPN painter; a `${…}` hole in a template body goes
   back to the JavaScript painter. The two painters are mutually recursive
   because the corpus nests both ways.
3. **Block scalar bodies are JavaScript.** 601 of 601. A line tokenizer
   cannot know the kind on the first body line (the trigger can be
   anywhere in the value), and it does not need to.
4. **Literal and prepended values go straight to the RPN painter**, where
   an unknown word paints as a word and nothing more — diagnostics own the
   verdict, colour only names the part.
5. **Mode survives the line.** A template or string spanning lines (8
   corpus cases, and every block scalar mid-keystroke) keeps its painter
   mode and hole depth in the token state; this is the one thing
   `ScanState` does not already carry.

### Holes in the current provider, filled by the above

| hole | corpus weight | filled by |
| --- | --- | --- |
| YAML-quoted JavaScript paints as one string | 5,906 | rule 1 |
| RPN inside strings paints as string; numbers, `==`, `if{` vanish | 7,637 strings | rule 2 |
| no scope for RPN operators, registers, flow words, unknown words | every computing setter | the `rpn.*` scopes below |
| string/template mode lost at end of line | 601 block scalars | rule 5 |
| `skp:` values go through the JavaScript lexer | every `skp:` | painted as a `get:` name |
| template backticks paint as string | 5,552 | delimiter scope |
| `#` comment after a block indicator; `K:#84132` paints as a name | 1; 44 | comment scope; acceptable, left |

### The design

- **A typed scope vocabulary**, one file, named for the languages rather
  than the venue: `yaml.block`, `yaml.key`, `yaml.delimiter`, `ref.prefix`,
  `ref.name`, `ref.unit`, `ref.write`, `rpn.number`, `rpn.operator`,
  `rpn.register`, `rpn.flow`, `rpn.word`, `rpn.string`, `js.keyword`,
  `js.injected`, `js.identifier`, `js.operator`, `js.number`, `js.hole`,
  `js.comment`, the comment family (`comment`, `comment.section`,
  `comment.subsection`, `comment.meta`, `comment.code`), `invalid.invisible`.
  The theme in `monaco-theme.ts` becomes a `Record<Scope, …>` so a scope
  without a colour, or a colour without a scope, fails typecheck. New
  `--syntax-*` tokens are expected for operator/register/flow — a system
  addition in `index.css`, named there, never hardcoded.
- **Two painters that call each other.** `paintRpn` over `tokenize` +
  `parseRef` + `stackEffectOf` (registers by the same `s|sp|l N` pattern,
  `if{`/`els{`/`}` as flow). `paintJs`, a small lexer whose string and
  template bodies hand off to `paintRpn` and whose holes come back.
- **Dispatch by kind.** One-line values: unquote, `setKind`, paint.
  Block scalar bodies: JavaScript. `get:`/`skp:` values: a name.
- **The line half stays.** `tokenizeLine` already rides `classifyLine`;
  it changes only where the new scopes touch it.
- **Tests as a floor.** The nine existing provider tests are kept; one
  case per row of the tables above is added; and a corpus sweep in the
  `check:*` family asserts every line of every profile tokenizes without
  throwing and emits only vocabulary scopes. The live check is the
  Playwright drive of the built app used on 2026-08-28.

### Completion rides the same table

`setTemplates` in `completions.ts` offers eight shapes: the four bare
writes, the template expression, the guarded toggle, and two block forms.
The corpus ranks what is missing — literal `N (>K:E)` (1,361), two-operand
`N N (>K:2:E)` (253), the increment pair `value > current ? INC : DEC`
(most of the 1,502 uses of `current`), the empty-branch guard
`value == 1 ? '…' : ''` (1,246), the scaled template
`` `${value * 16} (>K:E)` `` (2,435 with arithmetic), and
`switch (value) { case … }` as a block form (248). Each item is labelled
with its kind name so the menu teaches the vocabulary as it completes.

## Resuming this work

Where everything already lives:

| Piece | Where |
| --- | --- |
| Name parser, identity, descriptor table | `src/shared/vars/` (parse.ts, namespaces.ts, tests) |
| Module (protocol 4, watch set, probe) | `link/src/module.cpp`, v0.5.0, built + installed |
| Wire | `src/shared/link.ts` (LINK_PROTOCOL 4, WATCH_HANDLE_BASE, packWatchAdds) |
| App readers | `src/main/sim/session.ts` (watchSimVars groups by `readOf`), `src/main/sim/link.ts` (watched mapping) |
| Setter classification | `src/shared/setter.ts` (kinds; no parsing yet — that is this doc's job) |
| Corpus for testing | the workspace at `%APPDATA%/fsc-editor/settings.json` → `workspaceRoot` |
| Build log | [build/v1-log.md](build/v1-log.md), entries dated 2026-08-27 |

~~Next concrete step: layers 1–3 plus the engine skeleton and two seed
rules.~~ **Done** — `src/shared/lang/`: tokens.ts, ops.ts, ir.ts, stack.ts,
rules.ts, lang.test.ts, plus scripts/lang-sweep.ts (`npm run lang:sweep`).

**Twenty-five rules ship.** Ten over one expression: k-arity, k-operand-order,
b-write-op, rpn-unterminated, rpn-braces, invisible-chars, ns-access,
unit-meaningless, stack-balance. Five over the entry, through
`analyzeEntry`: dead-set, get-unit-meaningless, master-set-shape, no-write,
toggle-guard. Eight over the entry, through `analyzeEntry`: the five above plus
not-settable, prepended-unused and value-word — the setter-shape family, two
of which ship at zero on purpose. Six over the profile, through
`analyzeProfileView`: duplicate-get, block-conflict, include-missing,
header-updated, block-unknown and ignore-duplicate — the dialect
family that needs the block, all three read out of `ApplyTo`/`ParseSet`
rather than inferred, corpus 6 / 0 / 0. k-operand-order (2026-08-29, the first rule grounded in a
probe) fires on the layout the arity probe proved broken — the `${…}` value
pushed into a documented index slot — 16 corpus hits, zero false positives,
three of them previously uncounted WBSIM bugs on HEADING_BUG_SET /
ALTERNATOR_SET / PITOT_HEAT_SET. In the editor it rides the javascript
composition's top-level pass, where template RPN keeps its operand
adjacency — and since the layout rules need that adjacency, the ref rules
run there too for top-level refs, with the descended doc keeping only the
refs quoting hid (each ref judged once, by span). k-arity is severity-split
on the same probe: **error** when the operands are laid out (plain values
directly before a bare call — the author's intent is on the stack and the
sim provably pops only the top), warning when underspecified (one operand;
index 0 broadcasts, which single-instrument profiles plausibly intend).
Corpus: 17 errors, 56 warnings, total unchanged at 73. The simulator
grew initial depth / underflow / end for stack-balance (see the audit
above); the descriptor table grew its `units` fact for unit-meaningless.
Sweep after the batch: stack-balance fires **zero** times on the corpus's
10,295 setters once B: writes were modelled as soft-consuming their
parameter — quiet on working code, loud only on the synthetic mistakes in
its tests, which is what calibrated means.

Next, in order of value:

1. ~~**YAML unquoting for `set:` values**~~ **Done** — `scanEntries` now
   stores `scalarValue`, sweep at 99.8% clean, and the residue was real
   corpus bugs (see the v1-log entry "Entries store what FS Copilot sees").
2. ~~**Probes, narrowed by reading FS Copilot's source**~~ **Done**
   (2026-08-29, on the Black Square Baron — v1-log: "The arity probes"):
   a bare `(>K:E)` pops exactly ONE operand ([0], top of stack) and the
   missing index defaults to 0, which **broadcasts** (both altimeters
   moved); a second stacked operand is leaked, so the corpus's 16
   two-operand bare `K:KOHLSMAN_SET` lines are all broken or working by
   accident — and the value-first ones are not fixed by inserting `:2`
   alone, their operand order is wrong too. Bare `(>B:PRESET)` writes are
   dead air on a state preset (`1 (>B:ELECTRICAL_Battery_1)` did nothing;
   `_Toggle` worked) — but per-preset, not by grammar: the Fenix's
   Inputs.xml names `..._Push`/`..._Pull`/`..._Toggle` as complete Preset
   IDs, so bare-vs-op cannot be segmented statically and the bare-write
   branch belongs to the evidence tier, never to the parser. ~~Still
   open: `set: K:EVENT` bare in `shared:`~~ **Closed 2026-08-29** on
   synaptic_a220 (v1-log: "Bare words are ignored"): a bare `X:NAME` word
   is *silently ignored* by the calculator — it reads nothing, writes
   nothing, fires nothing, and does not abort the program around it.
   `K:KOHLSMAN_SET` bare left the altimeter where it was while
   `1 16272 (>K:2:KOHLSMAN_SET)` moved it in the same session, and a
   sentinel written after a bare `K:`/`H:` word still landed. The question
   was filed as low-stakes and was not: it is what licenses `no-write`,
   which fires on 5 real corpus lines the corpus had never been able to
   name.
3. **The editor pass, adapter by adapter** — ~~highlighting first~~
   **highlighting done** (2026-08-28): profile-tokens.ts consumes the core's
   tokenizer + `parseRef`; the `WRITE_TARGET` regex is deleted; reads are
   coloured for the first time (as the `var.*` scopes they echo), `L:1:`/
   `K:2:` prefixes measure correctly, invisible characters render in
   destructive bold-underline, and the provider gained its first tests (9)
   plus a live screenshot check via a Playwright drive of the built app.
   **Completion done** (2026-08-28): write-target corpus extraction rides
   `collectRefs` (the regex died; refs found inside JS strings and holes,
   reads never counted); index candidates filter through `writeOffer` — a
   non-settable A: or a plain E: is withheld, a bare B: preset offers its
   `_Set`; and multi-parameter K: events complete as their whole calling
   shape — `${1:Altimeter index} ${2:Value to set} (>K:2:KOHLSMAN_SET` as
   a snippet replacing from the `(`, operands reversed, [0] tabbed last.
   The founding lesson from the first live drive: corpus items and
   catalogue snippets must JOIN, not compete — the corpus knows what is
   popular, the catalogue knows the operands, and dedupe silently dropped
   whichever came second until the corpus row itself was upgraded.
   Decisions live monaco-free in set-completions.ts (11 tests); verified
   live by a Playwright drive, snippet tab-stops on screen. Next: hover,
   diagnostics-in-editor, format.

   **Diagnostics delivery, pinned ahead of building it** (product call,
   2026-08-28): a real diagnostics engine with an Issues panel — but scoped
   to **open files only**, and the panel shows **the current file only**.
   The corpus is written by many hands; as an fsc-editor user you care
   about the profile you are working on, and everything else is noise. The
   whole-corpus view stays where it already lives, `npm run lang:sweep`.
   Shape: one diagnostics store as the authority (the live-values pattern),
   fed by analysis of open buffers, consumed by squiggles, the panel,
   gutter and quick-fixes alike — never markers-only, and never a
   background workspace lint.

   **Hover done** (2026-08-28): `tokenAt` in the core (the positions-
   carrying descent through strings and holes), `positionIn` as
   `offsetIn`'s tested inverse, a shared var-index store folding written
   names to identities, and a monaco-free card builder — namespace natures
   with scope where it bites, direction-of-use notes that mirror the rules
   at hover's gentler volume, K: arity verdicts against the catalogue
   (⚠ live on the a400m's bare KOHLSMAN_SET), unit judgements per the
   descriptor's units fact, `skp:` explained as the suppression
   cross-reference FS Copilot's source shows it to be, and stack
   arithmetic for RPN words and registers. Dialect-aware per position: the
   same `K:` that warns in an expression reads as "the sync itself" on a
   `get:`. Stacked above the entry documentation completion already shows
   — one truth, two venues. 16 new tests (969 total); verified live.

   **Diagnostics-in-editor done** (2026-08-28), per the pin: the analyzer
   lives in `src/shared/analysis.ts` so the sweep and the editor run the
   SAME judge — squiggle counts and sweep counts cannot drift. The store
   (`diagnostics-store.ts`) is the single authority over open models:
   markers, the code-action provider, and the future Issues panel all read
   it. Two compositions inside the analyzer: literal/prepended setters get
   the full rule set with kind-aware stack simulation; javascript setters
   get ref-rules over `collectRefSpans`' descent plus unterminated-only at
   top level — raw JS must never meet the brace rule. Quoted values
   analyze unquoted with a +1 offset shift; escaped values are skipped
   (a missing squiggle is a gap, a wrong-position one is a lie).

   Calibration event, the biggest yet: reaching refs inside JS strings
   took b-write-op from 89 to **529** — Aerosoft names whole presets as
   actions (`_KEY_Push`/`_Release`) and writes them bare throughout
   shipping payware. The bare-write branch is MUTED behind a constant
   pending the in-sim probe; the premise does not get to warn against 529
   counterexamples. k-arity rose 71→73 (two real finds in single-quoted
   strings). Verified live on the Albatross: squiggle at line 172,
   lightbulb, "Close with )", applied, squiggle gone. Corpus totals under
   the editor's judge: k-arity 73 · stack-balance 9 · rpn-unterminated 10.
   **The Issues panel done** (2026-08-28), to the aligned design: third
   occupant of the bottom slot, rail button above Radar (both drive the
   bottom slot; Issues is about the file, Radar about the sim — the nearer
   concern sits nearer the editor), a new `issues` feature palette (red,
   hue 12 — deliberate kinship with destructive's 27, far enough that a
   lit rail button never reads as an error glyph), count on the rail
   button only when >0, coloured by the file's worst severity.
   Errors-first rows, document order within severity; row click reveals;
   the wrench applies the same fix the lightbulb offers, through the same
   undo stack. Current file only, per the pin. First live run found a
   THIRD issue in the Albatross nobody had catalogued (a second
   unterminated at 547, plus a K:COVER_SET arity warning at 586) — the
   panel doing discovery on its first open.

   **Format: closed as verified-no-op** (2026-08-28), which completes the
   editor pass. The formatter was inspected for the disease the pass
   cures and does not have it: line-level rendering plus exactly one
   value touch (get:-line unit re-casing, safe because SimConnect matches
   units case-insensitively), no RPN regexes anywhere. `check:format`
   passes 68 profiles under every shared-code change this work made
   beneath it. The one defensible extension — the same case-only rule
   inside one-line setter refs — was measured instead of assumed: 33 such
   refs in the corpus, zero non-canonical. A canonical-form addition with
   no instances is risk without value; the contract ("a save must never
   alter what FS Copilot loads") stays untouched.

   **Highlighting redone** (2026-09-11) — see *Highlighting v2* above for
   the corpus-measured taxonomy, the design, and what shipped.

   **The editor pass is complete**: highlighting, completion, hover,
   diagnostics + Issues panel, format — every feature either rides the
   language core or was verified to need nothing from it.
4. **More rules** from the catalogue in this doc — each one file under
   `rules/` with tests, registered in `defaultRules` or `defaultEntryRules`.

   **The entry level is open (2026-08-29)**: `RawEntry.at`,
   `entriesFromLines`, `analyzeEntry`, and the three dialect rules the
   ParseSet reading unlocked. Corpus after the batch: dead-set **6** — the
   JF_RJ_100 throttles and brakes, each now carrying the fix that turns the
   bare event name into the write it meant — master-set-shape **0** and
   toggle-guard **0**, both deliberately (their corpus populations are
   correct code, and a rule that fires on correct code is worse than none).
   1650 tests.

   Next from the catalogue, in the order their evidence is already in hand:

   - **the `get:`-line rules** — explicit unit on a `K:`/`H:` `get:` (60
     corpus lines, descriptor-backed, fix removes), unit-category against
     the catalogue, unknown `A:`/`K:` name with a nearest match. The first
     of these ships the `target: "get"` mapper. Watch the `b-write-op`
     lesson while doing it: `get: B:X_Toggle` is legal 232 times over, and
     position decides meaning.
   - **level 3, the profile** — duplicate `get:` within a block and the
     same name in both blocks, unknown block key (`BlockKeyLine.known` is
     already there), `include:` missing or cyclic. Needs
     `analyzeProfileEntries` beside `analyzeProfile`, and for `include:` a
     `RuleContext` method over the file list main already holds.
   - **the evidence tier** — b-write-op's bare-write branch returns here,
     as "this preset is not in the aircraft's enumerated input events",
     with the unresolved `Z:`/`L:` and the revert history beside it.

     ~~unresolved `Z:`~~ **built 2026-08-30** as `ref-unresolved`, and it
     split in two on the way: plain `L:` is streamed rather than watched, so
     resolution never speaks for it and its existence question is a second
     rule over the module's enumeration — **the next one to build**, and the
     evidence for it is already recorded per aircraft in the sim-evidence
     table. `ref-unresolved` itself owes an in-sim calibration; its 13 corpus
     lines are named in the tier's list above.
