# v1 build log

    Purpose:  What the build discovered, and what changed as a result.
    Plan:     v1-plan.md
    Order:    newest first

Findings and changes, recorded as they happen. A session picking this work up
reads [v1-plan.md](v1-plan.md) for scope and status, then the top of this file
for anything the plan does not yet reflect.

## What belongs here

- A verification that resolved an open question, whether it passed or failed
- Anything that contradicts a design doc in `01-17`
- A decision taken during the build that a later session would otherwise have to
  re-derive
- An approach that was tried and abandoned, **including why** — this is the part
  git history cannot tell anyone

Not here: what got implemented and when. That is what commits are for.

## Entry format

```
## YYYY-MM-DD — one-line summary
Stage:     which stage of v1-plan.md
Expected:  what was believed going in
Found:     what turned out to be true
Changed:   what this changes about the plan, or "nothing"
Affects:   design docs this amends, or "none"
```

`Affects:` is what makes "does this override the design?" answerable by grep
rather than by reading everything. When an entry amends a design doc, add a
pointer line at the top of that doc naming this entry — see the working notes in
[v1-plan.md](v1-plan.md).

---

> **Renamed 2026-09-20 — the names below were updated in place.** Our own
> environment variables moved from `FSC_` to `FSCE_`, because FS Copilot runs
> its own relay and its own variables, and one prefix over both read as one
> project: `FSC_BASH` is now `FSCE_BASH`, `FSC_COMMUNITY` is now
> `FSCE_COMMUNITY`.
>
> Only the names changed; the entries record what happened. Bare
> `FSC_` anywhere else is FS Copilot's — the `L:` variables inside profiles,
> the client data on the wire — and is left alone.


## 2026-09-25 — Completion rebuilt; the file, not the corpus, is the evidence

    Stage:     post-v1 (19-completion, all five build stages)
    Expected:  The design's ranking: this entry, then what this variable's
               setters write elsewhere, then this file, then the corpus — and
               for `get:` and reads, the Variables panel's evidence bands.
    Found:     `npm run check:completion` — every name in the committed
               corpus ranked with its own file left out, 160,844 completions,
               Monaco's own scorer — overturned three parts and confirmed the
               rest. Right name first, with only the namespace typed and the
               whole file around it, new against the old order:
                 write   68% (40%)   top five 88% (47%)   12,668 names
                 get:    61% (0.2%)  top five 62% (0.9%)  26,763 names
                 read    92% (none)                         545 names
                 skp:    97% (none)                         235 names
               What overturned:
               - `skp:` names its own entry's `get:` 228 times in 235. The
                 design left the entry's own name out; the sweep scored 0%.
               - The evidence bands scored 0.4% for `get:`. The signal is the
                 file: for 60% of `get:` names the author wrote the name that
                 follows the previous entry in the profile most like theirs
                 (91% of the time that entry is in that profile), 66% are in
                 that profile at all, 90% share a family (`L:A32NX`) with a
                 name above them. Tiers in that order took it to 61%.
               - Reads read their own entry's variable 516 times in 545,
                 spelled as the `get:` spells it.
               And for writes, a tier the design lacked: what the most similar
               profile's setter writes for the same `get:` — 69% on its own —
               ahead of the entry's own variable, from 60% to 68% first.
    Changed:   Built as designed otherwise, with these found in the building:
               - `B:` controls are labelled `ID_…`; the bare ID is offered
                 beside its control in step one, counted in this position,
                 not after the underscore — there it could only match as an
                 exact match, which Monaco puts first whatever the order.
               - A name whose only evidence is the open file's saved copy is
                 never offered: saving a half-typed `get: L:UNIQ` put it back
                 in the list, labelled "known to the sim". Units are offered
                 by canonical name only, for the same reason (`ga`).
               - Shapes live in `src/shared/completion/shapes.ts`; in
                 `src/shared/vars/` they would import the language core that
                 imports `vars`.
               - Profile summaries carry every `get:` in order, and which are
                 `master:`, instead of `sharedGets` — the sequence needs order.
               - The file's context is keyed by its uses without the one
                 under the caret, so typing inside a name reuses it.
               - `W:` is offered in write position: the descriptor table,
                 like `ns-access`, says it is written — that is how a sound
                 event is fired. The old list withheld it.
               - The corpus fold moved to `src/shared/corpus.ts` so the sweep
                 folds the same rows main does; main keeps the SQL.
               Costs: the index fold is ~250ms on the corpus against ~145ms
               before (and now runs after a save as well as at launch); the
               index payload is 5.1MB against 4.4MB. `complete()` is 1–2ms at
               the median; 30–60ms the first time after a new index.
    Affects:   19-completion (amended in place before its first commit, with
               this entry named at its top).


## 2026-09-25 — A `B:` read through the calculator is in the control's unit, not the input event's

    Stage:     post-v1 (completion rebuild, 19-completion)
    Expected:  `(B:ID, Number)` — how FS Copilot reads a `get: B:` — returns
               the value `getInputEvent` returns for the same ID.
    Found:     On the CJ4, not for percent controls. `npm run sim:probe-reads
               -- snapshot` over its 38 input events away from zero: 24 agree
               exactly; 14 — volumes, trims, flaps, cabin air and heat, FMC
               brightness — read 1/100 of the input event's value. Asking
               for `Percent` gives it back: COM1 volume reads 1 as `Number`,
               100 as `Percent`, 100 from `getInputEvent`. Panel lights, not
               a percent control, read 50 as `Number` and 5000 as `Percent`.
               The calculator converts from each control's own unit to the
               one asked for. Also found: `(B:ID_Set)` reads what `(B:ID)`
               does on all 38, and a suffix the control does not define reads
               0 with no error.
    Changed:   Nothing in the completion design beyond the reason unseen
               operations rank last (19-completion, stage two). For live
               values it is a mismatch to settle: the value beside a `B:`
               line comes from `getInputEvent` (100), while FS Copilot reads
               and syncs `Number` (1). Also unchecked: whether FS Copilot's
               unit-less `B:` write — the `master:` fallback — puts that 1
               back as 100% or 1%.
    Affects:   none. b-values-plan.md and 09-live-values should cite this
               entry when the gutter value is next touched.


## 2026-09-19 — Radar left the bottom slot for the side column

    Stage:     post-v1 (UI)
    Expected:  15-ui-surfaces puts Activity in the bottom slot, bottom-aligned
               on the rail, spanning the editor and the right panel. The
               argument was spatial: the rail points at where the panel appears.
    Found:     The grouping is about to mean something else. Issues is gaining a
               second diagnostics panel beside it, which makes the bottom slot
               the diagnostics-and-debug area — and Radar is not diagnostics, it
               is variable discovery, the same subject as Variables and Remote
               Connect. Radar and Variables are also read against each other: a
               candidate found in Radar is checked in Variables, and a variable
               in Variables is confirmed by working the control and watching
               Radar. Two panels used in one motion were at opposite ends of the
               window.
    Changed:   Radar is a side panel, stacked *under* whichever of Remote
               Connect or Variables is open rather than replacing it, with a
               dragged divider between them. Its rail button moved to the top
               group. `BottomPanel` lost `activity` and is now Log and Issues;
               an install with the old value open reopens Radar in its new home
               rather than losing it. Radar's own two halves flipped from a row
               to a column, since a side-panel column cannot hold two columns —
               the detail table is the half that carries the remembered size.

               Two things only showed up once it was on screen. Radar's header
               was laid out for the editor's width and measured about 372px
               against a 336px column, so Capture was clipped by the rail — it
               is two rows now, title and housekeeping above, Auto-capture and
               Capture below, rather than shedding the label that 07-activity
               argues Auto-capture needs. And the first heights tried gave the
               captures list 42px, which is one 44px row; the defaults are now
               measured against that row height instead of guessed.
               With two panels in the column, the bottom slot shortening it
               left all three too small, so which of the two gets the corner
               between them is now conditional: one panel in the column and the
               slot spans full width as before, two and the column runs full
               height while the slot spans the editor only. The workbench is a
               CSS grid for this — nesting expressed one arrangement per tree
               shape, and switching shapes would have remounted the side column,
               clearing the Variables search that opening Radar is meant to
               help check. Same items, different `grid-template-areas`.

               Narrow-column fallout, both invisible while Radar was wide: a
               candidate's `VarChip` needed `min-w-0` before its own truncation
               could fire — long `A:` names ran 48px out under the rail — and
               Radar's header needed the second row above.
    Affects:   15-ui-surfaces — "The rail" and "Panel spans" both change

---

## 2026-09-04 — The `B:` subscription is a change feed; the entry below was wrong

    Stage:     variable model — checking b-values-plan.md before building it
    Expected:  to confirm the entry below, and with it the plan's choice of
               polling `getInputEvent` as the read.
    Found:     **The 2026-09-03 conclusion does not survive the experiment it
               never ran.** That probe watched a cold-and-dark A220 for five
               seconds with nobody touching it, saw 443 of 464 events say
               nothing, and concluded the subscription "cannot be the read"
               because those 443 "would never produce a value". Silence from
               an untouched aeroplane is what a change feed does. The run could
               not distinguish "never reports" from "nothing changed", and
               nobody moved a control.

               Re-run on a powered A220 on the runway with somebody working
               the overhead, using `npm run sim:probe`:

               - **The subscription reports changes.** Eleven latching
                 switches sent real transitions with correct values, in the
                 order the panel was worked: `OVH_LTS_NAV` 1->0->1 at 2.4s,
                 `BEACON` at 4.2s, `STROBE` at 5.7s, and so on down the row.
                 Three-position switches reported every detent —
                 `OVH_LTS_TAXI` went 2->1->0->1->2.
               - **The 433 silent events were never touched, not dead.** Ten
                 that said nothing during a hands-off baseline spoke the
                 instant they were pressed, `AIRLINER_FCU_ALT_PUSH` among them.
               - **There are two kinds of event.** *Latching* controls carry a
                 state that changes and is worth showing. *Momentary* ones —
                 every one of the ten above — fire with the value `0` every
                 time; the arrival is the news, the value is not.
               - Unchanged from the entry below and re-confirmed: all 464
                 answer `getInputEvent`, all declare `DOUBLE`, no strings, no
                 exceptions, and the same 21 events tick at 4 Hz regardless.

               **Nothing tells you which kind an event is.**
               `InputEventDescriptor.type` is `DOUBLE` for all 464;
               `enumerateInputEventParams` returns `";FLOAT64"` for all 464;
               FS Copilot's own source does not use the input-event API at all.
               The distinction is authored in the aircraft's model behaviors,
               the same wall `b-preset.ts` already documents for writes.
    Changed:   **b-values-plan.md, substantially.** Step 6 — the poll cadence,
               called "the only real cost" and the plan's one open decision —
               is deleted: no poll is needed for updates. Step 3 shrinks to a
               one-shot `getInputEvent` when a name enters the watch set, which
               covers the one real gap (subscribing delivers no initial value,
               which the entry below established correctly). The subscription
               is already running for all 464 on every aircraft load, so
               updates cost nothing that is not already being paid.

               A new open question replaces the old one, and it is larger: a
               momentary event's value is always `0`, so a gutter hint for one
               is a constant rather than a live value. Which events deserve a
               hint is now the decision the plan turns on.

               **The preset strip stops eating indices.** Building the above
               moved `absent()`'s `_Word` stripping into
               `src/shared/vars/input-events.ts`, shared with the resolver that
               turns a written name into a hash. That promoted a harmless
               inaccuracy into a wrong number: `/^(.*)_[A-Za-z0-9]+$/` also
               strips `_2`, so `ELECTRICAL_Alternator_2` resolved to
               `ELECTRICAL_Alternator` — **71 of the corpus's 919 distinct `B:`
               names end in a bare index**, and they come in families. While
               this list only suppressed a missing-control warning that cost
               nothing; deciding which value a `get:` line shows, it is one
               alternator reporting the other's state. An all-digit suffix is
               now kept. No preset is a bare number, so nothing legitimate was
               relying on it — but `b-preset-unknown` will now warn on a
               numbered control the aircraft lacks where it previously found
               the sibling and stayed quiet, which is the correct answer and a
               change in behaviour all the same.
    Affects:   supersedes the 2026-09-03 entry immediately below on the
               subscription's nature. That entry's other findings stand.

               **Method note.** The first attempt at this ran its interactive
               phases unattended and produced forty confident-looking seconds
               of "nothing changed" from an empty chair — the same failure as
               the entry it was checking, one day later. `probe-input-events.ts`
               now refuses to open a watch window without a TTY, and scores the
               subscription against arrivals rather than against a read either
               side: a switch flipped and flipped back reads identically at
               both ends, which is exactly what toggling a light looks like.

---

## 2026-09-03 — `B:` values are readable two ways, and the subscription is not a change feed

> **Superseded on 2026-09-04** on the subscription question — see the entry
> above. The subscription *is* a change feed; this entry's "443 events would
> never produce a value" was inferred from an aeroplane nobody was touching.
> Everything else here stands.

    Stage:     variable model — answering "can we read B: at all", after the
               enumeration fold above
    Expected:  values by subscription only, per the descriptor table's
               `why: "input-event values arrive by subscription, not yet as
               live values"`.
    Found:     Two working reads, neither needing the module. Probed on the
               cold-and-dark A220 with a read-only client beside the running
               app:

               - **`getInputEvent(requestId, hash)` answers on demand.** All
                 five events asked replied on the `getInputEvent` channel with
                 a number. Nothing in the app calls it. This is the one that
                 fits the gutter: a value when a line is opened, rather than a
                 value whenever the aeroplane feels like it.
               - **`subscribeInputEvent` is per-event and not on subscribe.**
                 Of five subscribed, four sent nothing in four seconds and
                 `AIRLINER_ALT_FLAP_TOGGLE` sent **16** — a steady 4 Hz, value
                 0 every time, nobody touching anything. So subscription gives
                 neither a current value on demand nor a guarantee that an
                 arrival means a change.

               Surveyed across the whole table afterwards, which settles the
               transport question: **`getInputEvent` answered all 464**, every
               value a `number` and **not one string** — while over five
               seconds only **21 of 464** subscribed events sent anything at
               all, 420 arrivals between them, a flat 4 Hz each. Subscription
               therefore cannot be the read: 443 events would never produce a
               value. Polling `getInputEvent` for the watch set is the route,
               with the subscription kept for Activity and as an accelerator.

               Values came back `number`; the API types them `number | string`
               (`setInputEvent` takes either), which `recordValue`'s numeric
               signature does not yet allow for.
    Changed:   **A defect in the observation recording added an hour earlier,
               found by this probe.** `observe()` counted every `input`
               arrival as a movement, so a ticking event would have become the
               most-moved control on every aircraft — exactly the failure
               06-variables-panel already records for `L:`, where two
               clock-like variables were 88% of all change records. It now
               keeps the last value per name, counts only a difference, and
               treats the first arrival as a baseline: existence, not
               movement. Cleared on an aircraft change, because hashes are
               reassigned on a swap. Two tests, 778 passing.

               Not changed, and the next thing to build: the descriptor's
               `read: null` for `B:`. It is honest — nothing is wired — but it
               is now a wiring gap rather than a limitation, and `absorbValues`
               ignoring `kind: "input"` is the whole of it.
    Affects:   none — the descriptor's `why` string is still accurate about
               what the app does today. The work it implies is planned in
               [b-values-plan.md](b-values-plan.md), which carries these
               measurements so they are not retaken.

---

## 2026-09-03 — The panel never saw the enumeration, and neither did the index

    Stage:     variable model — closing the B: gaps the rule fix exposed
    Expected:  the B: tab to be thin because the aeroplane is unusual.
    Found:     It is thin because the enumeration is not a source. `VarIndex`
               carries two independent things — `entries`, built by
               `projectIndex` from corpus + `sim_variable` + catalogue +
               observations, and `inputEvents`, the 464 names. `projectIndex`
               took no `inputEvents` argument, and the field's only reader in
               the whole renderer was `aircraftHasInputEvent`. So the panel
               listed the SDK catalogue's generic `templates` names —
               `B:HANDLING_Spoilers`, `B:AS1000_MID_ADF` — **none of which are
               among the A220's 464** — plus whatever the open profile happened
               to name, while the aeroplane's own were unlistable and
               uncompletable.

               **A second gap, found auditing for others.** `observe()` — the
               only writer of `sim_variable` / `sim_observation` — handles
               `aircraft`, `vars` and `var`, and ignores the rest by design. It
               was ignoring `input`: an input event **firing**, which Activity
               has always consumed. So `B:`, the one namespace whose names a
               person can read, was also the only one with no per-aircraft
               movement evidence. Unbiased too, unlike SimConnect's `simvar`:
               `enumerated()` subscribes to every name the enumeration
               returned, where `A:` values arrive only for what is watched —
               which is why this kind is now recorded and that one still is
               not.

               The audit's negative results, so nobody re-runs it: `A:`/`K:`
               names ship as a fixed list and the sim cannot teach us one;
               `H:` is not a live source at all (there is no `hevent` kind in
               `SimEvent`); `Z:`/`E:`/`I:`/`O:` are read by typed id with no
               enumeration to fold. Both real gaps were `B:`.
    Changed:   `foldInputEvents` in projectIndex, marking `AircraftFacet` with
               a new `inputEvent` key — in memory, not banked, because these
               are what one aeroplane says about itself now and storing them
               would build an index of every aircraft ever loaded. `observe()`
               records an `input` firing as an observation, prefixed `B:` on
               the way in. `isThisAircraft` counts an enumerated event, which
               is the state a switch is in while somebody is hunting it: not
               moved yet, not bound yet.

               **One invariant deliberately broken.** `aircraftStrength`
               (`inProfile || inputEvent`) now leads `byCorpusThenName`, so the
               base's "no aircraft fold can disturb this order" no longer
               holds, and `projectIndex` re-sorts whenever an aeroplane is
               loaded rather than only when a name was appended. `changes` was
               left *out* of the leading term on purpose: 97,907 observation
               rows would bury the corpus-heavy names under everything the
               aeroplane has ever twitched. It sits below the corpus count as a
               tiebreak.

               The panel says what the list is in one line above it
               (`InputEventsNote`), not as a case in `VariablesEmpty` — the
               catalogue always supplies some `B:` names, so that list is never
               empty and the explanation would never be reached. Silent while
               the sim is offline, per 04-connection's "say nothing louder".

               And `b-write-bare`, the rule the ID display makes necessary: see
               the entry below for why it is decidable now and the catalogue in
               18-language-core for what it may not claim.

               776 tests. Verified against the running A220: a correct
               `..._Push` read and write are silent, a bare-ID read is silent,
               a bare-ID write warns, an unknown base warns.
    Affects:   docs/sim-vars/06-variables-panel.md (the "no runtime signal for
               this aircraft's" note is an `L:` fact and now says so),
               docs/sim-vars/18-language-core.md (b-write-bare added to the
               evidence tier)

---

## 2026-09-03 — The input-event table lists IDs; the preset rules were reading it as names

    Stage:     language core — evidence tier, correcting 2026-08-29
    Expected:  `b-preset-unknown` / `get-preset-unknown` to hold up on the
               aeroplane they were calibrated for.
    Found:     They fire on correct lines. Reported from a cold-and-dark A220
               with the Behaviors tool open: `AIRLINER_FCU_CHRONO_2_Push`
               shows in the tool, its setter runs from the editor, and the
               rule said the aircraft "has AIRLINER_FCU_CHRONO_2 but no
               AIRLINER_FCU_CHRONO_2_Push".

               Re-enumerated live (read-only node-simconnect spike, no module,
               alongside the running app): **464 events, 463 distinct** — the
               same numbers as the 2026-08-29 calibration, so the same
               aeroplane and the same table. What is in it is the correction:

               - `AIRLINER_FCU_CHRONO_1`, `_CHRONO_2`,
                 `_MASTER_CAUTION_1`, `_MASTER_CAUTION_2` — all present.
               - Not one of the `_Push` spellings the tool shows. None.
               - **One** name of 464 ends in a generated operation
                 (`AIRLINER_ALT_FLAP_TOGGLE`). Eight end in `_PUSH`, all
                 uppercase, all part of the control's own name.

               The table holds `<InputEvent ID=...>` values. The name the
               Behaviors tool shows and FS Copilot writes is `ID_Preset`. So
               **a miss on the written name carries no information** — it is
               the normal state of every correct preset reference — and the
               rule was treating it as the interesting case.

               `AIRLINER_FCU_SPD_PUSH` beside `AIRLINER_FCU_SPD_PUSH_PUSH`,
               the pair the whole op-stripping design was inferred from, is
               two IDs. The A220 names `ALT` the same way
               (`..._ALT_PUSH`, `..._ALT_PUSH_PUSH`). It was a vendor naming
               habit read as a sim mechanism.

               Two reasons this survived calibration: the installed
               `synaptic_a220.yaml` contains **zero** `B:` refs, so the
               aeroplane the rule was measured against never exercised it;
               and the Baron pass counted hits, not misses on lines that were
               right. Corpus scale of the exposed class: of **643** `B:` refs,
               232 end in a generated op and **411 end in some other word** —
               every one a candidate for the wrong verdict whenever its base
               happens to be enumerated.
    Changed:   `absent()` in rules/b-preset.ts strips one trailing `_Word`,
               whatever the word is, and asks only about the base. The
               "wrong operation" branch is gone: it generalised the Baron's
               `SAFETY_ELT_1_ARM` into a claim about `_Push`, and the
               2026-08-28 entry below already established that only
               per-preset set-code decides whether a write lands.

               **What the rule gives up**: `_ARM` now passes silently. It has
               to — `SAFETY_ELT_1_ARM` and the A220's working
               `..._CHRONO_2_Push` are the same shape, and no static rule can
               separate them. Running the setter is what answers that, and
               that feature already exists. What survives is the smaller
               honest question — is the control there at all — which still
               catches a mistyped ID.

               Tests: the both-spellings case keeps its assertion with the
               correct reason attached; two added (an authored preset the
               enumeration never lists; a base the aircraft lacks); the
               vendor-word test inverted to assert silence. 759 passing.
    Affects:   docs/sim-vars/18-language-core.md (b-preset-unknown bullet
               amended in place), and this supersedes the "Both spellings
               count as found" reasoning in the 2026-08-29 entry below.

---

## 2026-08-30 — Protocol 5 called every fresh ref absent, and nobody could have seen it

    Stage:     language core / link — the first calibration of ref-unresolved
    Expected:  load the Baron, open the profile, see one squiggle.
    Found:     What was actually observed was "no line for the longest time,
               then somehow it appeared", which reads as a slow rule. Reading
               module.cpp to explain the delay turned up a different defect,
               and a worse one.

               **`watch-add` answers with the mapping before the tick has
               resolved anything.** `handle_command` calls `send_watched()`
               inline; resolution happens in the tick that follows. Every
               `Watched` is constructed `resolved = false`, so under protocol
               5 the first mapping after every watch-add reported **every new
               ref as unresolved** — including refs that exist — and a frame
               later (~66 ms at 15 Hz) sent a corrected one.

               So the app's honest reading of a true wire was a warning on
               correct code: a ~66–100 ms flash on every `Z:`/`E:` `get:` line,
               every time the watch set changed, which is every tab opened and
               every keystroke in a `get:` line. `Z:SWS_MISC_SunshadePlaced`
               resolves fine on the PC-12 and would have flickered anyway.
               That is the exact failure the project's own bar rejects — a
               rule that fires on correct code is worse than none — and it
               shipped because the wire had two states for three facts.

               The observed *delay*, separately, was almost certainly the
               module handshake: with no mapping at all `watchResolution()` is
               null, which is the tier's silent case and indistinguishable
               from a healthy file. That part was working as designed.
    Changed:   **Protocol 6, module 0.7.0.** The `watched` state field is now
               three-valued — `0` absent, `1` present, `2` not tried — derived
               from a new `attempted` flag rather than stored twice. It is
               cleared wherever a verdict stops being current: on the ZVAR
               flag at an aircraft change, and on a read that errors, because
               a stale id means "ask again", not "it is gone".

               App side, `WatchedRef.resolved` is `boolean | null` and the
               renderer's store drops the nulls, so "not tried" and "nobody is
               watching this" reach the rules as the same silence. A new
               `RESOLUTION_PROTOCOL` constant, separate from `LINK_PROTOCOL`
               because they move for different reasons, withholds resolution
               entirely from a module older than 6 — an outdated module now
               shows no verdicts rather than wrong ones. 734 tests.

               **`npm run lang:calibrate`**, which is the real answer to how
               this hid. It connects without the app, watches every watchable
               `get:` name in the corpus at once (2 names, 13 lines), records
               every mapping with the time it arrived, and prints the settle
               timeline, the per-name verdicts with their profile:line sites,
               and the output of the actual rule through `analyzeProfile`.
               Its one hard assertion is this bug: a ref reported absent and
               *then* present was never absent, and that exits non-zero.
               Calibration stops being a description of what a squiggle looked
               like.
    Affects:   src/shared/link.ts (LINK_PROTOCOL 6, RESOLUTION_PROTOCOL, and
               the table), link/src/module.cpp, docs/sim-vars/18-language-core

---

## 2026-08-30 — ref-unresolved, and "unresolved Z:/L:" turning out to be two rules

    Stage:     language core — the evidence rule protocol 5 was built for
    Expected:  the rule the 2026-08-29 entry left owing, then a sim
               calibration.
    Found:     The rule is built and the calibration is still owed — but two
               things about its shape were wrong in the catalogue, and both
               were only visible from inside the code.

               **It is two rules, not one.** 18-language-core has said
               "unresolved `Z:`/`L:`" since it was written. `readOf` does not
               agree: `Z:`, `E:` and *indexed* `L:` go to the module's
               typed-id watch, which is what protocol 5 reports resolution
               for, but plain `L:` is `"stream"` — the module forwards every
               variable that moves and nothing subscribes — so plain `L:` is
               never in the watch mapping and resolution can never speak for
               it. Its existence question has a different and already-present
               answer: the module's enumeration, recorded per aircraft in the
               sim-evidence table. That is a second rule, and now the next one
               on the list.

               **It is a `get:` rule.** The watch set is assembled in
               `store.ts` from the `get:` lines of the open tabs, so a `Z:`
               written inside a `set:` expression is never watched and there
               is no evidence about it. An entry rule, not an expression one —
               which is also why the corpus population is small and knowable.

               **13 lines, all `Z:`.** Twelve `Z:AUDIO_Knob_Selector_1` — the
               Black Square fleet, the SWS PC-12, the WB-Sim C172 — plus one
               `Z:SWS_MISC_SunshadePlaced` in the PC-12. No `E:` and no
               indexed-`L:` `get:` line exists in the corpus at all. Worth a
               correction to the 2026-08-27 entry, which called all thirteen
               `AUDIO_Knob_Selector_1`: it is twelve of those and one other.

               The wire is the tier's **first channel of its own**,
               `sim:watch-resolution`. The 2026-08-29 entry put input events
               on `VarIndex` and gave the reason — per-aircraft evidence has
               exactly the index's lifetime. This evidence does not: the watch
               set is the open tabs' `get:` lines, so it moves when somebody
               opens a file, and rebuilding a 25,000-row index to answer that
               is the wrong trade. Main wakes the renderer only when the
               *unresolved set* differs, because the mapping itself is re-sent
               after every `watch-add` — i.e. on every tab open — and waking
               for those would re-run every open file's diagnostics to reach
               the answer it already had. A disconnect withdraws the verdict
               rather than freezing it: `watchResolution()` returns null, not
               `[]`, because "nothing is watched" and "nobody is answering"
               are the same array and opposite facts.
    Changed:   Twenty-six rules. `ref-unresolved` in `rules/ref-unresolved.ts`,
               `RuleContext.refResolved`, `onWatchResolution`/
               `watchResolution` in main's link.ts, the `sim:watch-resolution`
               channel, and `watch-resolution.ts` holding the verdicts in the
               renderer. `WatchedRef` moved to `@shared/link` — the renderer
               reads it now. 732 tests.

               **Not yet done**: the in-sim calibration. Load the Baron, open
               `bksq-aircraft-baronpro.yaml`, and line 181 should light up
               while the rest of the file stays quiet — the b-preset-unknown
               bar, which is silence on correct code.
    Affects:   docs/sim-vars/18-language-core.md (the evidence-tier entry, now
               split in two and no longer blocked)

---

## 2026-08-29 — Protocol 5: the watch mapping says whether a ref resolved

    Stage:     language core / link — the module change the unresolved-Z:
               rule has been blocked on since 2026-08-27
    Expected:  a small module edit and a protocol bump.
    Found:     Small, and worth stating exactly what it buys. Before this the
               only signal for "this variable is not on this aircraft" was
               *silence* — an unresolved ref reports no values by definition,
               which is precisely what an untouched switch looks like. The
               module already knew (`ref.resolved`, with the per-tick retry);
               it had no way to say so.

               Module 0.6.0, protocol 5. Each `watched` line is now
               `<handle> <resolved> <name>`, and the mapping is re-sent from
               the tick whenever any ref's resolution differs from what was
               last *reported*. Comparing against the reported value rather
               than against the previous tick is deliberate: a ref that
               resolves and then fails its read inside one tick ends the tick
               unresolved, so a permanently-broken ref sends one message, not
               one per frame.

               App side: `parseWatchedLine` rather than a widened
               `parseNameLine` — the two messages are no longer the same
               shape, and a name may contain spaces (`E:ZULU TIME`), so only
               the first two fields are split. A line whose state field is
               neither `0` nor `1` is dropped, which is what a protocol-4
               module talking to a protocol-5 app looks like. `watchedRefs()`
               is exported from main because resolution is evidence now
               rather than plumbing.

               **`npm run link:build` could not find Git Bash on this
               machine**, and the reason is the class of bug CLAUDE.md warns
               about: the launcher assumed `git.exe` sits in `<root>/cmd`,
               which is true of a Git-for-Windows install and false of a
               scoop one, where `where git` answers
               `<version>/mingw64/bin/git.exe`. The two-level guess landed on
               `<version>/mingw64` and searched for a bash one directory
               further up than it looked. Now it walks up to four ancestors
               from `git.exe`, trying `bin/bash.exe` and `usr/bin/bash.exe`
               at each — and was verified through the plain
               `npm run link:build`, with `FSCE_BASH` unset.
    Changed:   Module 0.6.0 / protocol 5 built and installed to the Community
               folder. 720 tests, two of them new: resolution carried through
               a re-send, and a protocol-4 line refused rather than parsed
               with the name as its state.

               **Not yet built**: the rule itself. It needs the sim restarted
               on the new module, and a corpus calibration the way
               b-preset-unknown got one — the 13 known `Z:AUDIO_Knob_Selector_1`
               lines are the obvious subject.
    Affects:   src/shared/link.ts (LINK_PROTOCOL 5 and the table),
               link/tools/bash.mjs

---

## 2026-08-29 — 643 get: lines nobody had ever looked at

    Stage:     language core — the second evidence rule, chosen for what it
               could reach without a module rebuild
    Expected:  the next rule on the list was unresolved `Z:`/`L:`.
    Found:     That one is **blocked on a module change**, and the block is
               worth naming precisely. The signal today is *silence*: an
               unresolved ref never reports, which is the same thing a switch
               nobody touched looks like. The module already knows —
               `ref.resolved`, with the retry loop that re-resolves after an
               aircraft change — it simply does not say, exactly as the
               2026-08-27 entry deferred. Carrying the flag in the `watched`
               mapping is a protocol bump and a rebuild, and `link/build.sh`
               drives MSFS through `fspackagetool`, so verifying it costs a
               sim restart. Not something to start inside a session with an
               aircraft loaded, and not something to fold into another
               errand.

               So the reach-first question was asked instead: what evidence
               does the tier already have that nothing consumes? **643 corpus
               entries name a `B:` preset in `get:` position** and no rule
               had ever looked at one, because `analyzeProfile` only ever
               runs the ref rules over `set:` values. The aircraft's
               enumeration answers that question exactly as well as it
               answers the setter one.

               Calibrated on the loaded Baron: 11 `get: B:` lines, **0 that
               the aircraft does not have** — silent on correct code, which
               is the bar.
    Changed:   Twenty-five rules. `get-preset-unknown`, an entry rule sharing
               one `absent()` verdict with `b-preset-unknown` — the question
               is about the name, not about where it was written, so the two
               cannot drift. Worth recording why this is *not* the
               entry-level twin 18-language-core warns against: that warning
               is about `b-write-op`, whose question is positional (a
               suffixed name means something different in `get:` than inside
               an expression). Existence is not positional. 718 tests.
    Affects:   docs/sim-vars/18-language-core.md (the evidence-tier list, and
               the Z:/L: entry now stating its price)

---

## 2026-08-29 — b-preset-unknown calibrated in the sim, and it finds real dead code

    Stage:     language core — the corpus calibration the evidence tier's
               first rule was shipped owing
    Expected:  the test that matters is whether the rule stays silent on a
               correct profile for the loaded aeroplane. A handful of hits
               would be acceptable; dozens would mean the matching is wrong.
    Found:     On bksq-aircraft-baronpropress — loaded, and its own profile —
               **127 enumerated input events, 72 B: references, 38 distinct
               names, and the rule fires twice.**

               Both hits are real, and proving it corrected my reading of the
               mechanism. The two are `(>B:SAFETY_ELT_1_ARM)` and
               `(>B:SAFETY_ELT_1_TEST)`, from a `switch` over
               `L:XMLVAR_ELT_STATE`. The aircraft enumerates exactly one ELT
               event, `SAFETY_ELT_1`. Driven through `link:read -- exec`:

                 (>B:SAFETY_ELT_1_ON)     state 1 -> 2   works
                 1 (>B:SAFETY_ELT_1_Set)  state 2 -> 1   works
                 (>B:SAFETY_ELT_1_ARM)    unchanged      dead
                 (>B:SAFETY_ELT_1_TEST)   unchanged      dead

               Neither `_ON` nor `_Set` is enumerated and both work; neither
               `_ARM` nor `_TEST` is enumerated and neither does. So **the
               enumeration lists presets**, the generated operations work on
               top of them without appearing in it, and a vendor word that
               merely looks like an operation does nothing. Two lines of a
               shipped payware profile are dead, and the third case of the
               same switch works — which is why nobody noticed.

               That also **validates `parseVar`'s INPUT_OP list** from the
               other end: `set|inc|dec|toggle|on|off` is exactly the family
               that works, measured rather than assumed.

               One near-miss worth recording. Midway through this I thought
               the premise was dead, because this morning on this same
               aircraft the *enumerated* `ELECTRICAL_BATTERY_1` written bare
               did nothing while the *un-enumerated* `..._Toggle` worked.
               That is a true observation about a different question —
               whether a bare preset is a write target, which is b-write-op's
               still-muted branch. This rule never claims enumeration implies
               a working write; it claims the preset must exist. The two
               facts are consistent and it is worth not conflating them.
    Changed:   The rule keeps its logic and gains a sharper message: when the
               written name minus a trailing word *is* a known preset, it
               says "the aircraft has SAFETY_ELT_1 but no SAFETY_ELT_1_ARM,
               and `_ARM` is not one of the generated operations" rather than
               "unknown name" — which is the actual mistake. 717 tests.
               The ELT switch was left as it was found, in state 1.
    Affects:   docs/sim-vars/18-language-core.md (the evidence-tier entry, no
               longer owing a calibration)

---

## 2026-08-29 — The evidence tier opens, on a wire that already existed

    Stage:     language core — the first rule whose answer comes from the
               running simulator rather than from a document
    Expected:  a new IPC channel, a new store, and a design problem about
               diagnostics that appear and disappear.
    Found:     Two of the three were already solved. The aircraft's
               input-event names are enumerated per aircraft in
               `session.ts` and held in `live.names`, cleared on every swap —
               the data existed, it simply never left main. And the renderer
               already calls `refreshAllDiagnostics()` inside its
               `onVarsChanged` handler, so anything riding the variable index
               re-runs every open file when the aeroplane changes.

               So the evidence travels on `VarIndex.inputEvents` rather than
               through a channel of its own. Per-aircraft evidence has exactly
               the index's lifetime; giving it a second path would have meant
               two things to keep in step. `session.inputEventNames()` sits
               beside `simState`, which carries the *count* for the status bar
               and should not grow a list.

               Enumerated live for calibration (synaptic_a220, via a
               node-simconnect spike): **464 input events, 463 distinct**. The
               receive event is `inputEventsList`, not the method name — worth
               recording, it cost a timed-out run. Nine names end in an
               op-like word, and the shape that matters is there:
               `AIRLINER_FCU_SPD_PUSH` **and** `AIRLINER_FCU_SPD_PUSH_PUSH`
               are both real events. That is the 2026-08-29 probe's finding
               seen from the other side — "op" is a naming convention over
               presets — so a written name counts as found if the aircraft
               knows the whole name *or* the name with its parsed operation
               removed, and only a miss on both is an absence.

               **Severity is capped at warning by an asymmetry**, not by
               timidity: presence is strong evidence, absence is weak. The
               sim's table fills as add-ons register — the documented reason
               the `L:` walk runs twice after a swap — so a name missing
               seconds after loading may only be late.
    Changed:   Twenty-four rules; `b-preset-unknown` is the first in the
               evidence tier, and it is where `b-write-op`'s muted bare-write
               branch finally lands. `RuleContext.hasInputEvent` supplied by
               the renderer from the index; absent everywhere else, where the
               rule correctly says nothing. 716 tests.

               **Owed: a corpus calibration.** Every rule this session was
               measured against the corpus before shipping; this one cannot
               be, because it needs an aircraft loaded whose own profile uses
               `B:` — and synaptic_a220's profile has none. The unit tests
               pin the logic, including both A220 spellings, but "does it stay
               silent on a correct profile for the loaded aeroplane" is
               unanswered. The Aerosoft CRJ profiles are the obvious subject.
    Affects:   docs/sim-vars/18-language-core.md (the evidence-tier section,
               now describing an open tier and its wire)

---

## 2026-08-29 — The insurance rules, and the setter family measured down to three

    Stage:     language core — the level-3 leftovers written on purpose at
               zero, then the setter-shape family, the last of the three
               with nothing built
    Expected:  two cheap "free insurance" rules, and five setter-shape rules
               whose evidence was already in hand.
    Found:     The cheap one was not cheap. **An unknown top-level block key
               does not disable a block — it disables the profile.**
               `.IgnoreUnmatchedProperties()` is commented out in FS
               Copilot's `DeserializerBuilder`, so YamlDotNet throws on an
               unmatched key, `TryLoadTree` catches the exception, and `Load`
               hands back a definitions set with no entries at all. `sharde:`
               costs every entry in the file plus everything it includes, and
               the only symptom is one information-level log line. Shipped at
               **error** — the widest blast radius of any rule here — with a
               nearest-match fix, which is safe over a closed four-word
               vocabulary. Its sibling went the other way: `_ignore` is a
               `HashSet<string>`, so a duplicate `ignore:` name is a no-op,
               and the rule says so at info rather than implying a cost.

               The setter family came out at three of six, and the two
               removals were removals of *design*, not of scope:

               - `${value}` inside a `literal` setter is **void by
                 construction**. `Set`'s trigger is
                 `IndexOfAny([''', '`', '?', '{', '}'])`, so text containing
                 `${…}` has a `{` and is a javascript setter. No such entry
                 can exist.
               - "`set:` writes X, `get:` reads Y" is **struck on the
                 numbers**, as the author predicted before the measurement:
                 9,673 corpus setters write something other than their `get:`
                 name against 701 that write it. Reading the variable that
                 exposes a state and writing the event that changes it is the
                 format's normal shape.

               `prepended-unused` took two measurements to get right, and the
               first one was instructive. Asked through the shared simulator,
               1,888 of 1,940 prepended setters "never consume" their value —
               because `stack.ts` *softens* a bare `(>K:E)` to pop at most
               what is available, which is exactly what keeps stack-balance
               calibrated to zero. Walked strictly, **1,940 of 1,940** consume
               it. So the rule owns its own walk, on the precedent
               stack-balance set for the same reason, and ships at zero with
               proof it cannot fire on correct code.

               `not-settable` is the one judgement call: 119 implicit entries
               across 32 names write to an `A:` the SDK marks unsettable.
               Info, phrased as the docs' claim rather than as fact — a
               premise with 119 counterexamples in flown payware does not get
               to warn (the b-write-op lesson), and the settable column is not
               even the path FS Copilot writes through, which is a SimConnect
               data definition rather than the calculator. Its honest home is
               the evidence tier.
    Changed:   Twenty-three rules. New: block-unknown, ignore-duplicate,
               value-word, prepended-unused, not-settable. `nearest` promoted
               out of include.ts to `lang/nearest.ts` on its second caller,
               carrying the *policy* — exactly one candidate within budget, or
               no suggestion — which is the half that keeps it honest.
               `RuleContext.simVarSettable` added, supplied by the renderer
               from the variable index and by the sweep from the catalogue.
               Corpus: not-settable 119, everything else new at 0. 711 tests.
    Affects:   docs/sim-vars/18-language-core.md (the setter-shape table, two
               strikes; the level-3 table; the counts)

---

## 2026-08-29 — The one rule that fires on an absence, and it is an error

    Stage:     language core — `header-updated`, plus excluding worktrees
               from the test run
    Expected:  the catalogue files this info-tier: "missing `# Updated:`
               header entirely". It reads like a style nag, and the standing
               principle is that an absent optional thing is never a finding.
    Found:     It is not a style rule. `TryReadUpdatedUtc` falls back to
               `DateTime.MinValue`, and `MainViewModel` sets
               `NewProfileAvailable` from `updatedAt > defs.UpdatedAt` — so a
               profile with no date compares as older than **every** published
               version, and FS Copilot offers to replace it every time it
               checks, however current the file actually is. Named
               consequence, not convention: shipped at **error** on the
               author's call.

               Calibration removed two planned branches rather than adding
               them. Of the 4 undated corpus profiles, **none** wrote
               `# Last Updated:` or anything else date-shaped, so there is
               nothing to suggest and no near-miss fix. And all 52 written
               dates are `yyyy-MM-dd` or `yyyy-MM-dd HH:mm:ss`, both of which
               parse — so the unparseable-date branch, which has the
               identical consequence, would be a JS emulation of .NET's
               `DateTime.TryParse(InvariantCulture)` with nothing to catch.
               Left out and recorded.

               Three facts about the regex the mirror had to encode: it is
               `Multiline` over the **whole file**, so the date line need not
               be in the comment header; it is case-sensitive, so
               `# updated:` is not a date line; and `^\s*#\s*Updated:` is
               anchored, so `# Last Updated:` never was one. Derived once in
               `analysis.ts` and handed to the view as a fact, rather than
               left for each rule to re-derive.

               The absence principle survives intact and got sharper: the
               rule stays silent until the file has entries. A blank file, or
               a header somebody has started, is not a profile and is not
               told off for a date it has not needed yet.
    Changed:   Eighteen rules. `ProfileView` gained `blocks` and `updated`;
               the missing-date verdict anchors at the first block key, the
               top of the profile proper, which always exists once entries
               do. Corpus: header-updated 4. Three existing fixtures needed a
               `# Updated:` line added — a fixture without one was testing
               this rule whether it meant to or not — via a shared `DATED`
               constant that says so.

               Also: vitest now excludes `**/.claude/worktrees/**`. A
               worktree is a whole second copy of the tree, so the suite was
               running 117 files instead of 46 with two open, every test
               three times, and reporting failures against paths nobody is
               editing. **Not fixed by it**, and stated in the config:
               `capture.test.ts` fails intermittently in a full run — a
               different test each time — and passes 19/19 in isolation. That
               race predates this session and is nobody's diagnosis yet.
    Affects:   docs/sim-vars/18-language-core.md (level-3 table, the absence
               principle, the counts), vitest.config.ts

---

## 2026-08-29 — include-missing lands, after the level-3 entry point failed its own catalogue

    Stage:     language core — the `include:` rules, and the widening that
               writing them forced
    Expected:  one rule and one optional `RuleContext` method, per the plan.
    Found:     The context method was the easy half. `analyzeProfileEntries`
               — shipped an hour earlier — took `EntryView[]` and anchored
               each verdict by index into it. An `include:` item is not an
               entry and has no `get:`, so that signature could not express
               a single one of the `include:`, `ignore:` or block-key rules
               its own catalogue lists. The audit's cautionary example,
               `simulate()` shipping without initial depth, repeated
               exactly: the spec was here first and the implementation
               under-built it.

               Widened rather than worked around, while only two rules
               depended on it: `analyzeProfileView(rules, profile, context)`
               over a `ProfileView { entries, includes, ignores }`, with
               diagnostics anchored to a **line** whose value text carries
               the offsets. Entries fit unchanged — `EntryView.line` already
               existed and its `get` is that line's value — so duplicate-get
               and block-conflict moved over by deleting fields.

               A grammar detail the calibration had hidden: two corpus
               includes carry a trailing `# ADDED BY DKGOLFNUT` note, and
               the sequence item's value keeps it. YAML strips a comment
               from a plain scalar, so FS Copilot never sees one — the view
               is built through `plainValue`, and the two lines that a
               naive read called missing resolve fine.

               Both list blocks are optional, and that is now a test rather
               than an assumption: a profile with no `include:` is the
               normal case and gets nothing.
    Changed:   Seventeen rules. `include-missing` fires on 2 of the corpus's
               125 includes, and one carries an exact fix —
               `bksq-aircraft-tbm850.yaml` includes `modules/paload.yaml`
               with `payload.yaml` beside it. Nearest match is allowed here
               precisely where it was struck for variable names: a filename
               against a directory listing has a small closed candidate set,
               and the suggestion is offered only when exactly one candidate
               in the same directory is within two edits, so the other hit
               (`modules/AS_G1000_NXi_ALT_MOD.yaml`) gets a diagnostic and
               no guess. `RuleContext.workspaceFiles()` is supplied by the
               renderer from the store's `files`, by the sweep from a
               `readdir`, and by nobody in tests — where its absence
               correctly mutes the rule instead of calling every include
               missing. Cycles and self-include are **not** built: neither is
               decidable from a listing, and both need a context surface
               nothing else wants yet, for 0 known instances. 1672 tests.
    Affects:   docs/sim-vars/18-language-core.md (level 3's entry point and
               table, the core-change audit's second breach, the counts)

---

## 2026-08-29 — Level 3 opens, and a duplicate get: turns out to be two subscriptions

    Stage:     language core — step 4's level-3 pass: the profile rules that
               need every entry at once
    Expected:  18-language-core's framing, that duplicates are a lookup
               conflict — "the block is what decides authority, so a name in
               both is a real conflict" — with an implied last-wins.
    Found:     Read from the source before writing anything, and it is not a
               lookup at all. `Definitions.Load` builds a flat array,
               `master.Concat(shared)`, with no dictionary and no dedup;
               `Coordinator.Load` then does `foreach (var def in
               definitions) AddLink(def)`. Every duplicate gets its **own
               subscription**: two `Update` packets sent per change, and on
               receive both setters applied, since the incoming filter is
               `.Where(update => update.Name == getVar)` per definition.

               That inverts the rule. A repeated name is not a conflict to
               resolve; it is work done twice. And it is only a defect when
               the copies are the *same* — the corpus has **161 groups that
               repeat a name with a different setter**, which is a
               deliberate fan-out (the Aerosoft CRJ driving the captain's
               master-warning button and the first officer's from one
               variable). Those must stay silent. **197** entries are exact
               copies — units, set and skp identical — and those are two
               subscriptions doing one job: wasted for a plain write, a
               *double press* for a `_Push` or `_Toggle`.

               Cross-block is the same mechanism with a sharper edge: 28
               names live in both blocks, and the two subscriptions have
               opposite authority — a `master:` entry sends only while this
               machine is master and applies only while it is not, a
               `shared:` one always does both.

               Names are compared exactly, mirroring `update.Name == getVar`.
               That leaves 3 P180 pairs differing only in case
               (`L:P180_Upper_front_door` / `L:P180_upper_front_door`) as two
               names to FS Copilot whatever the simulator makes of them —
               noted, not judged, because what the *sim* does with `L:`
               casing is a probe nobody has run.

               The rest of the level-3 catalogue was calibrated in the same
               pass: unknown block key **0**, `ignore:` duplicates **0**,
               profiles with no `# Updated:` header **4 of 56**, and
               `include:` targets missing **2 of 125** — one of which is a
               gift, `bksq-aircraft-tbm850.yaml` including
               `modules/paload.yaml` next to the `payload.yaml` it meant.
               A nearest match over a directory listing is safe in the way
               the catalogue-name one was not; it is blocked only on the
               context method over main's file list.
    Changed:   Sixteen rules. New entry point `analyzeProfileEntries(rules,
               entries, context)` in `lang/profile.ts`; a `ProfileRule` sees
               every entry and names its subject by index, reusing
               `EntryDiagnostic`'s target and offsets unchanged. `EntryView`
               gained `line`, which level-3 messages need to say "also
               declared at line 43". `analysis.ts` builds the views and their
               mappers once and runs levels 2 and 3 off the same arrays.
               Corpus: duplicate-get 197, block-conflict 28. 1665 tests;
               lint, typecheck and all three maintainer sweeps unchanged.
    Affects:   docs/sim-vars/18-language-core.md (status, the level-3 table
               and its premise, the audit count)

---

## 2026-08-29 — The rest of the get: batch is measured, and none of it ships

    Stage:     language core — step 4's remaining `get:`-line rules:
               unit-category, and unknown `A:`/`K:` name with a nearest
               match. Both were expected to need one new optional
               `RuleContext` method over the catalogue, and to be one piece
               of work.
    Expected:  two rules and a catalogue accessor.
    Found:     Neither earns its place, and the accessor was never the hard
               part. Calibrated first, as 12-rules requires; every number
               below is over the installed 56-profile workspace.

               **unit-category: 549 hits, nearly all correct code.** Of the
               2,464 `A:` `get:` lines carrying both a written unit and a
               documented one, 549 disagree — `Position 16k` where the docs
               say `Percent Over 100`, `Hz` where they say `MHz`. Those are
               convertible units, and the premise fails a second time
               independently: both peers run the *same profile*, so a
               non-documented scale round-trips and decides nothing. Only an
               *incompatible category* would be a bug, and units.ts has no
               category table to test that with.

               **unknown-name: 94 raw hits, and 52 of them are a parser
               artefact.** The 52 are the string-index form,
               `A:LINE BREAKER PULLED:'BUS_1_To_FuelPump'_n`, whose base
               names are all catalogued; `parseVar` splits only a numeric
               index, so the lookup key still carries the string one. The
               rule's real prerequisite is string-index parsing in the
               shared parser — a design event, not a patch.

               **And nearest-match is actively harmful here**: 18 of the 94
               have a near neighbour, 16 of those suggestions are wrong.
               Unknown names cluster in numbered families, so
               `A:COM2 STORED FREQUENCY` draws "did you mean COM1" when the
               answer is `A:COM STORED FREQUENCY:2`. Edit distance is
               confidently wrong exactly where help is needed.

               Two narrower shapes were tried on the same data: an `A:` name
               that is really a known `K:` event scores **0**, and "an `A:`
               name with an underscore" (0 of the SDK's 1,585 have one)
               cannot be separated from the legitimate string-index form
               until the parser splits it.

               **A units rule was looked for and does not exist either.** Of
               8,519 written units, **zero** are unresolvable; 8 are
               non-canonical spellings (`Millibar`, `FT`, `ft`, `ft/min`),
               and units.ts warned that rewriting an alias "changes the
               string SimConnect receives". Checked in the sim rather than
               assumed: `(A:KOHLSMAN SETTING MB:1, Millibar)` and
               `…, Millibars` both returned 1005; `(A:PLANE ALTITUDE, ft)`
               and `…, Feet` both returned 113.232674. SimConnect resolves
               the aliases itself, so those 8 lines are correct and there is
               nothing to flag.
    Changed:   Nothing ships — the batch's whole output is three corrected
               rows and a prerequisite. 18-language-core's level-2 table has
               unit-category struck with its numbers, unknown-name deferred
               behind a new *Why the catalogue cannot carry this yet*
               section naming the parser prerequisite, and units.ts's alias
               comment now records what the sim actually answered. The
               unknown-name rule's honest future is the evidence tier, which
               asks the aircraft rather than the docs.
    Affects:   docs/sim-vars/18-language-core.md (level-2 table, new
               subsection), src/shared/units.ts (alias comment)

---

## 2026-08-29 — The get: line gets its mapper, and level 2 could only see 38% of the corpus

    Stage:     language core — step 4's `get:`-line batch, starting with the
               rule 18-language-core files as "explicit unit on a K:/H:
               get: — decides nothing, fix removes"
    Expected:  60 corpus lines, descriptor-backed, an info-tier tidy-up
               whose only real job was to justify building the
               `target: "get"` position mapper.
    Found:     Two things the design had wrong, both caught by calibrating
               before writing.

               **The rule is not about K: at all.** All 60 instances are
               `H:` lines, all with the unit `Bool`, and — the part that
               mattered — **all 60 are implicit setters**. So FS Copilot
               builds `1 (>H:NAME, Bool)` and the unit really does reach a
               write. "Decides nothing" was an assumption about the
               calculator with 60 counterexamples in payware behind it,
               which is the b-write-op situation exactly. Probed instead:
               `1 16272 (>K:2:KOHLSMAN_SET, Bool)` moved the altimeter
               1015 → 1017, identical to the unit-free control. The unit is
               accepted and ignored — redundant, not harmful, so the rule
               ships at **info**. Had it gone the other way the finding
               would have been sixty dead entries across the Black Square
               fleet.

               **Level 2 was structurally blind to most of the corpus.**
               The entry rules ran inside the expression walk, at the
               setter — so an entry with no `set:` was never judged, and
               15,933 of the corpus's 25,855 entries are implicit. Every
               one of this rule's 60 hits is in that 15,933: the rule as
               designed could not have fired once. The three rules shipped
               earlier today hid it, because all three read `entry.set` and
               mute without one.
    Changed:   `analysis.ts` now runs two passes: the walk collects each
               setter's text, kind and mapper keyed by its `set:` line, and
               a second pass judges every entry. `set:` verdicts reuse the
               walk's mapper; `get:` verdicts are placed by finding the
               `scalarValue` back in its raw line, which absorbs quoting
               for free. An entry whose setter the walk could not map gets
               no `setterKind` rather than a defaulted one — unknown, so
               dependent rules mute, instead of being told "implicit".
               `EntryView` gained `get` (the raw value the offsets are
               measured in). The refactor is verdict-neutral: the sweep did
               not move by one diagnostic before the new rule was added.
               Fourteen rules; corpus get-unit-meaningless 60; 1659 tests.
    Affects:   docs/sim-vars/18-language-core.md (status, *Beyond setters*
               — where the `"get"` mapper was recorded as deliberately
               unbuilt — the level-2 table, and the audit count)

---

## 2026-08-29 — Bare words are ignored, and five dead corpus lines get their rule

    Stage:     language core — the last open probe question from
               18-language-core's step 2, closed in the sim
    Expected:  filed as low-stakes: "bare `set: K:EVENT` in shared:, what
               the calculator does with a bare word", with the note that
               the master:-side dead-set rule already covered the corpus
               instances. Both halves of that note were wrong.
    Found:     First, the corpus was measured rather than assumed, and the
               question as filed had **zero instances**. The real shared:
               population of bare-word setters is five lines, none of them
               `K:`: four WBSIM_C172SP_Classic `H:KAP140_*_PRESS` and one
               inibuilds_f406 `NAV SWAP:2 = 1`.

               Then, on synaptic_a220 via `npm run link:read -- exec`:

                 (A:KOHLSMAN SETTING MB:1, millibars)   -> 1015
                 K:KOHLSMAN_SET                          -> ok, 0
                 (A:KOHLSMAN SETTING MB:1, millibars)   -> 1015   (unmoved)
                 1 16272 (>K:2:KOHLSMAN_SET)             -> ok
                 (A:KOHLSMAN SETTING MB:1, millibars)   -> 1017   (control)
                 1 16240 (>K:2:KOHLSMAN_SET)             -> restored to 1015

               and the tolerance pair, which is what makes it general:

                 0 (>L:P) K:KOHLSMAN_SET   7 (>L:P) (L:P)  -> 7
                 0 (>L:P) H:KAP140_NAV_PRESS 7 (>L:P) (L:P) -> 7

               So a bare `X:NAME` word is **silently ignored**: it reads
               nothing, writes nothing, fires nothing, and does not abort
               the program around it. `ok` from the calculator means the
               text was accepted, not that anything happened — the control
               in the same session is what separates the two, and any
               future probe of this kind needs one.

               Note the sim was in the pause menu for the first attempt and
               every reading was taken again afterwards, in a flight. The
               numbers above are all from the second run.
    Changed:   Ships `no-write` (rules/no-write.ts), the shared:-side
               sibling of dead-set: a literal/prepended `shared:` setter
               containing no `(>NAME)` writes nothing, so the entry never
               applies an incoming value. **Severity error, where dead-set
               is a warning** — the master: fallback makes its entries work
               by accident and there is no such fallback here; the entry
               still sends its local value, so the broken direction is the
               one nobody watches. Fires on exactly the 5 corpus lines,
               four of them carrying the same lone-name fix dead-set offers
               (`H:KAP140_NAV_PRESS` → `(>H:KAP140_NAV_PRESS)`). It reads
               writes through `collectRefs`, so an *unterminated* write
               still counts as one and the Albatross lines stay
               rpn-unterminated's alone — one mistake, one squiggle.
               Thirteen rules; 1655 tests; sweep unchanged elsewhere.
    Affects:   docs/sim-vars/18-language-core.md (status, step 2's open
               question closed, the level-2 table, the audit count)

---

## 2026-08-29 — The entry level opens; the corpus's dead setters get their fix

    Stage:     language core — step 4's entry-level pass, the prerequisite
               18-language-core named plus the three dialect rules the
               ParseSet reading unlocked
    Expected:  master-set-shape and dead-set as the two rules, with a rough
               guess that a master: setter carrying RPN would be the common
               disease.
    Found:     Calibrated against the corpus before writing a line of rule,
               which changed what got built. Of 988 master: entries, 228
               carry a set:, 96 of those are javascript (their expression is
               Jint's output, so outside any static rule by construction).
               Of the 132 that remain, **126 match ParseSet with exactly
               zero args** and 6 do not match at all — the JF_RJ_100
               throttles and brakes. So the non-numeric-args disease
               master-set-shape exists for has *no corpus instance*, and
               dead-set has all six.

               dead-set's population turned out to be fixable, which the
               design had not noticed: all six are a lone event name where a
               write was meant, and `K:THROTTLE1_SET` → `(>K:THROTTLE1_SET)`
               is exact. The fix is gated to a lone namespaced name —
               wrapping real RPN in `(>` … `)` would invent a different
               program. And the message deliberately does NOT say "move it
               to shared:", the advice master-set-shape gives: a bare name
               is not an expression, so the calculator would do nothing with
               it there either. Two rules, two different corrections, from
               one source reading.

               toggle-guard was reshaped by the same method. Written as the
               doc describes it — shared, writes `>K:`/`>B:`, contains
               TOGGLE — it fires **911** times, every one of them correct
               code doing what the guard is for. Narrowed to the accident
               the behaviour doc warns about (the word outside every write
               target, e.g. a `(L:ToggleGuard)` read arming the guard for an
               expression that is not a toggle), it fires **zero** times and
               still catches a bug with no symptom to search for.

               One doc error found while reading `skp:` in the source:
               18-language-core's level-2 table lists "`skp:` not a number".
               `skp:` holds the *name of another variable* — the rule was
               exactly backwards. Struck in place.
    Changed:   Twelve rules ship. `RawEntry` gained `at: { get, set?, skp? }`
               (line numbers, not `Line` objects — an entry crosses IPC) and
               `entriesFromLines(lines, relPath)` so `analysis.ts` folds
               entries out of the scan it already has instead of scanning the
               same text twice. `analyzeEntry(rules, entry, context)` mirrors
               `analyze`, registry parameter included; entry rules read the
               setter kind from `RuleContext.setterKind` rather than a second
               copy on the view. Diagnostics name their text through
               `target: "get" | "set"`; the `"get"` mapper is deliberately
               unbuilt until the first rule produces one. Corpus: dead-set 6,
               master-set-shape 0, toggle-guard 0. 1650 tests; check:format,
               check:grammar and check:setters unchanged.
    Affects:   docs/sim-vars/18-language-core.md (status, the ParseSet rule
               table, *Beyond setters*, the core-change audit and step 4,
               all updated in place)

---

## 2026-08-29 — Operand order re-verified on a second aircraft; k-arity earns its error tier

    Stage:     language core — a challenge to k-operand-order's direction,
               answered in the sim, and the severity split the probe entry
               promised
    Expected:  a reasonable doubt that the swap rule had the order
               backwards — the corpus writes value-first 13 times, which
               reads like consensus.
    Found:     re-verified live on a second airframe (synaptic_a220), in
               the exact disputed shape: `16160 1 (>K:2:KOHLSMAN_SET)`
               (value first) moved NOTHING — the event took 1 as its
               value; `1 16160 (>K:2:KOHLSMAN_SET)` (index first) set
               altimeter 1 to 1010 and touched nothing else. The pushed
               order is the documentation order reversed, `[1] [0]`,
               because [0] pops from the top — two aircraft, no
               counterexample.

               Making k-arity's laid-out escalation actually fire took a
               composition fix: javascript setters ran REF_RULES over a
               refs-only doc, where adjacency does not exist, so the
               escalation was invisible exactly where the corpus keeps
               its 17 broken lines. The ref rules now run on the
               top-level parse (which has the adjacency) for top-level
               refs, and the descended doc keeps only quoting-hidden refs
               — judged once each, by span; corpus totals unchanged,
               so the split introduced no duplicates and no new findings.

               One conservative miss, stated: fsw_l35a/f406's index-first
               lines glue their leading backtick to the first operand
               (`` `0 `` is one word), so the layout gate does not see two
               plain values and they stay warnings rather than errors.
    Changed:   k-arity: error when `documented` plain values sit directly
               before an under-aritied call, warning otherwise; messages
               now state the probe facts (top popped, missing params
               default to 0). Corpus: k-arity 17 error / 56 warning
               (total 73, unchanged). 983 tests.
    Affects:   docs/sim-vars/18-language-core.md (kept current in place)

---

## 2026-08-29 — k-operand-order ships; the calibration sweep finds three more WBSIM bugs

    Stage:     language core — the first rule grounded in a probe, split
               out of k-arity per the order-is-not-arity finding below
    Expected:  the 13 known value-first `K:KOHLSMAN_SET` lines, and a
               question over whether the hole-position heuristic could
               fire on anything else.
    Found:     16 hits, zero false positives. The three extras are the
               same disease on other events, all WBSIM_C172SP_Classic:
               `${value} 1 (>K:HEADING_BUG_SET)` (bug set to 1 degree),
               and the twins on ALTERNATOR_SET and PITOT_HEAT_SET —
               uncounted until the rule existed. Two design facts earned
               their gates: `[0]` is NOT always the value (the catalogue
               documents "[0]: The pump index" families), so slots are
               classified from their own descriptions and the rule is
               silent unless exactly one is index-like; and the corpus
               lines are javascript setters, whose operands are invisible
               to the ref-descent — the rule runs in the top-level pass,
               where a backtick tokenizes as a lone word and template RPN
               keeps its adjacency, and its plain-values-before-a-K:-write
               gate cannot trip on actual JavaScript. Known gap, stated:
               RPN inside single-quoted JS strings goes unjudged; the
               corpus has no swapped line there today.
    Changed:   nine rules; 45 lang tests (982 total). The audit holds:
               one new file under rules/, one line in the javascript
               composition, no core signature touched.
    Affects:   docs/sim-vars/18-language-core.md (rule table and status,
               updated in place)

---

## 2026-08-29 — The arity probes: bare K: pops one and broadcasts; bare B: writes are per-preset dead air

    Stage:     language core — step 2 of 18-language-core's "Resuming this
               work", the two probes holding severities at warning
    Expected:  open both ways. The optimistic reading: a bare `(>K:E)` with
               two operands stacked behaves like `K:2:` — the corpus writes
               that shape 16 times, so "it must work" was a live hypothesis
               — which would silence k-arity whenever the stack shows the
               operands present. And for B:, 529 muted counterexamples
               suggested bare writes work.
    Found:     On the Black Square Baron (bksq-aircraft-baronpropress),
               via `npm run link:read -- exec`:

               **Bare K: pops exactly one.** `77 16208 (>K:KOHLSMAN_SET)
               1 +` → 78: the 77 survives the event. `2 16240
               (>K:KOHLSMAN_SET)` → result 2 (first operand leaked on the
               stack) and BOTH altimeters read 1015 afterwards: the top of
               stack went to the sim as [0], and the missing [1] index
               defaulted to 0, which *broadcasts to every altimeter*. The
               control `2 16272 (>K:2:KOHLSMAN_SET)` moved only altimeter
               2, to 1017 — index pushed first, [0] value last, exactly as
               fscopilot-behavior.md pinned from ParseSet's reversal.

               So two-operands-plus-bare is not a working idiom — it is
               the *strongest* k-arity case: the stack proves the author
               meant to pass both, and the sim provably uses the wrong
               one. The corpus's 16 lines split into two broken shapes.
               Value-first (`${value * 16} 1 (>K:KOHLSMAN_SET)` — Aerosoft
               CRJ ×9, a400m ×2, WBSIM ×2): the INDEX is sent as the
               millibar×16 value and broadcast — every altimeter driven to
               the clamp. Index-first (fsw_l35a ×3, inibuilds_f406 ×1):
               the value lands, but on ALL altimeters, the index dead.
               And the value-first shape is NOT fixed by inserting `:2` —
               its operands are also in the wrong order ([0] is pushed
               last); a fix that only adds the arity converts one bug into
               another. The diagnostic must say the order.

               **Bare B: writes are dead air — but per-preset, not by
               grammar.** Battery off: `1 (>B:ELECTRICAL_Battery_1)` →
               unchanged (the 1 consumed, matching the soft-consume stack
               model); `(>B:ELECTRICAL_Battery_1_Toggle)` flipped it 0→1.
               Then the premise behind the 529 dissolved on inspection:
               parse.ts's INPUT_OP is `(set|inc|dec|toggle|on|off)` — no
               push/release — while the Fenix's own Inputs.xml declares
               `..._Push` / `..._Pull` / `..._Toggle` as *complete Preset
               IDs*. "Op" is a naming convention over presets, not a sim
               mechanism; whether a write lands is decided by set-code
               authored per preset, invisible to any static rule.
    Changed:   k-arity keeps its warning, unmuted and vindicated; operands-
               present is a confidence upgrade, never an excuse. The
               bare-write branch of b-write-op can never ship as a static
               rule: it graduates to the evidence tier — "this preset is
               not in the aircraft's enumerated input events" — already in
               the rule catalogue. The read-with-op branch inherits the
               same caveat at lower stakes (a preset legitimately *named*
               `..._Toggle` would false-positive its read).
    Affects:   docs/sim-vars/18-language-core.md (status and step 2
               updated in place)

---

## 2026-08-28 — Format closes as a verified no-op; the editor pass is complete

    Stage:     language core — the last step of the editor pass
    Expected:  the formatter, like the other features, holding private RPN
               opinions to replace with the core.
    Found:     it holds none. Inspection: line-level rendering plus exactly
               one value touch — get:-line unit re-casing, already guarded
               by the case-insensitivity argument — and no expression
               regexes anywhere. The pass's premise simply does not apply
               to it, and its contract (a save must never alter what FS
               Copilot loads; block scalar contents and quoting are never
               touched) is a reason to keep expression-aware rewriting OUT
               of it, not in.

               Two measurements before closing rather than asserting:
               `check:format` passes 68 profiles / 0 failures under every
               shared change this work made beneath it (the oracle rides
               scanEntries, which gained scalarValue unquoting mid-pass);
               and the one defensible extension — canonical unit case
               inside one-line setter refs — has 33 candidate refs in the
               corpus and ZERO non-canonical. A canonical-form addition
               with no instances is risk without value.
    Changed:   nothing — that is the finding. The editor pass is complete:
               highlighting, completion, hover, diagnostics + Issues
               panel, format. Every feature either rides the language core
               or was verified to need nothing from it.
    Affects:   docs/sim-vars/18-language-core.md (kept current in place)

---

## 2026-08-28 — The Issues panel, and it finds a third Albatross bug on first open

    Stage:     language core — the Issues panel, built to the aligned design
    Expected:  bottom-slot occupant, rail button above Radar, a red feature
               palette, errors-first rows, count only when >0, current file
               only, fixes applicable from the panel.
    Found:     all of it, on the existing kit: the bottom slot took its
               third occupant exactly as its comment promised; the rail
               button is BottomRailButton with the new tone and the count
               riding the existing `dot` slot (which is why zero issues
               shows nothing — the slot's own semantics); the panel is
               PanelHeader + rows of severity icon / message / rule ·
               line:col / wrench. The wrench applies the same edits the
               lightbulb offers, through executeEdits on the shared model —
               one fix channel, undoable, so panel and editor cannot
               disagree. The `issues` palette is hue 12 in remote's
               proportions, registered in both themes, @theme, and
               tone-issues; deliberately near destructive's 27 but not it.

               The store grew its subscription (onDiagnosticsChange), with
               the useSyncExternalStore stability lesson written where it
               was learned: diagnosticsFor returns a shared EMPTY, because
               a fresh [] per snapshot re-renders forever.

               First live open, on the Albatross: count 3 — the known
               unterminated at 172, a SECOND unterminated at 547 nobody
               had catalogued, and a K:COVER_SET arity warning at 586.
               Row click revealed 172; the wrench fixed it; the panel and
               the rail count updated to 2 from the store's re-analysis.
               The panel did discovery on its first open.
    Changed:   976 tests. BottomPanel union gains "issues"; App wires the
               render branch and the rail stack.
    Affects:   docs/sim-vars/18-language-core.md (kept current in place);
               docs/ui.md's palette inventory grows by one, values in
               index.css as the system requires

---

## 2026-08-28 — The Albatross gets its squiggle; the sweep and the editor share one judge

    Stage:     language core — diagnostics-in-editor, per the pinned scope
               (open files only; the sweep keeps the corpus view)
    Expected:  a store as the single authority over open models, markers
               and quick fixes reading it, the pure analyzer testable
               headless.
    Found:     built — with the analyzer pushed all the way down to
               src/shared/analysis.ts once it became clear the sweep and
               the editor were about to analyze differently: the same
               private-opinion split this whole project hunts, forming in
               real time. Now `lang:sweep` counts exactly what authors see
               as squiggles, by construction.

               The composition that made it correct: literal/prepended
               setters are RPN programs and get the full rule set with
               kind-aware stack simulation; javascript setters get the
               ref-judging rules over collectRefSpans' descent (new in the
               core, spans exact through strings and holes) plus the
               unterminated check at top level only — raw JS must never
               meet the brace rule, which the first draft got wrong and a
               test caught. Quoted values analyze unquoted with a +1
               shift; escaped ones are skipped outright.

               The calibration event: reaching refs inside single-quoted
               JS strings took b-write-op from 89 to 529 — the CRJ names
               whole presets as actions and writes them bare, everywhere.
               The bare-write branch is muted behind a constant pending
               the in-sim probe. k-arity rose 71→73 with two real finds
               the old extraction missed. Corpus under the editor's judge:
               k-arity 73 · stack-balance 9 · rpn-unterminated 10.

               Verified live: the Albatross's line 172 — the bug the first
               sweep found — shows the squiggle, the lightbulb offers
               "Close with )", Enter applies it, the squiggle clears on
               the store's re-analysis. One keystroke, the whole stack.
    Changed:   974 tests. profile-diagnostics.ts remains as a re-export
               shim; store wired into monaco-setup and index refreshes.
    Affects:   docs/sim-vars/18-language-core.md (kept current in place)

---

## 2026-08-28 — Hover knows what a reference is, wherever the cursor finds it

    Stage:     language core — the third editor adapter
    Expected:  a hover provider over refs and RPN words in every venue a
               name appears: set: expressions (both shapes, through JS
               strings and holes), get: values, skp: values.
    Found:     built on three additive pieces — `tokenAt` (the language
               core's positions-carrying descent; interiors are verbatim
               slices so offsets survive as arithmetic), `positionIn`
               (offsetIn's inverse, roundtrip-tested against it), and a
               shared var-index store that folds written names to the
               identities the index keys by, so `A:NAV OBS:1` and
               `K:2:KOHLSMAN_SET` find their entries. The card stacks a
               monaco-free ref header over the entry documentation
               completion already renders — one truth, two venues.

               The header's judgements, all descriptor/catalogue-backed:
               namespace natures with scope where it bites (`Z:` names its
               L:1: synonym), direction-of-use notes mirroring ns-access
               and b-write-op at a gentler volume, K: arity verdicts (the
               a400m's bare KOHLSMAN_SET shows "⚠ … missing K:2:?" live,
               with the corpus count and SDK parameters beneath), unit
               judgements from the descriptor's units fact, skp: explained
               from FS Copilot's own semantics, stack arithmetic for words
               and registers. Position-aware dialect: the same K: that
               warns inside an expression reads "the sync itself" on a
               get:, and an H: get: carries no warning at all.

               Product decision recorded mid-build: diagnostics will scope
               to open files with the Issues panel showing the current
               file only — the corpus is other people's work; the sweep
               keeps the all-files view. Pinned in 18-language-core.
    Changed:   completion's `documentation` and `linesOf` exported for
               reuse; setVarIndex feeds the shared store. 969 tests.
    Affects:   none

---

## 2026-08-28 — Completion inserts the calling shape; corpus and catalogue join

    Stage:     language core — the second editor adapter
    Expected:  write-target completion upgraded three ways: corpus
               extraction through the core instead of a regex, writability
               filtering through the descriptor table, and multi-parameter
               K: events completing as full snippets with the arity.
    Found:     all three landed, plus the design lesson of the day, caught
               by the first live drive rather than by review: the corpus
               row `K:2:KOHLSMAN_SET` (evidence-ranked, plain insert) and
               the catalogue's snippet for the same event DEDUPED each
               other — whichever source came second silently vanished, and
               it was the snippet. The fix is a join, not a contest: the
               corpus row itself is upgraded with the catalogue's operand
               docs, so the top-ranked item both carries the usage count
               and inserts `${1:Altimeter index} ${2:Value to set}
               (>K:2:KOHLSMAN_SET` — operands reversed, [0] tabbed last,
               range reaching back over the typed `(>`. Verified on
               screen: type `(>K:KOHL`, Enter, and the whole calling shape
               lands with live tab-stops.

               Also in this adapter: `collectRefs` in the core (descends
               into string and hole interiors — where JS setters keep
               their refs and where the tokenizer's honest islands hide
               them; seed of the planned effects analyzer); `writeOffer`
               withholding non-settable A: vars, non-writable namespaces
               and plain E:, and turning bare B: presets into `_Set`;
               `filterText` spanning the widened range so Monaco's filter
               still matches. Decisions are monaco-free in
               set-completions.ts. 953 tests.
    Changed:   nothing beyond the above; the drive script grew the
               completion flow.
    Affects:   none

---

## 2026-08-28 — Highlighting rides the language core; the regex dies

    Stage:     language core — the first editor adapter
    Expected:  profile-tokens.ts swaps its private WRITE_TARGET regex for
               the core's tokenizer and parseRef, behaviour-compatible.
    Found:     landed, with three visible upgrades beyond parity: reads are
               coloured for the first time — an (A:X, Bool) inside a setter
               takes the same var.* scopes as the get: line it mirrors;
               L:1:/K:2: prefixes measure at their real width; invisible
               characters render destructive bold-underline. One guard
               matters: a paren becomes a ref only when parseRef finds a
               namespace or the `>`, so Math.round(value) stays JavaScript.
               A YAML-quoted setter's whole value sits inside one more
               string layer and its refs still pop — the raw buffer is what
               gets coloured, honestly.

               The provider gained its first tests (9 — the file always
               claimed to run headless; now it is held to it) and a live
               check: playwright-core driving the built app, screenshots
               confirming refs popped from JS strings, block-scalar switch
               bodies, and hole interiors. 939 tests pass.
    Changed:   playwright-core added as a devDependency; the drive script
               stays in the session scratchpad — promote it to a project
               run skill when the editor pass needs it routinely.
    Affects:   none — renderer-only, scopes unchanged except the new
               invalid.invisible

---

## 2026-08-27 — FS Copilot's source answers the dialect questions

    Stage:     language core — calibration by reading the authority
    Expected:  the bare-event-setter question (`set: K:THROTTLE1_SET`,
               shipping and "working") would need an in-sim probe or FS
               Copilot behavioral testing.
    Found:     FS Copilot's source sits in the fscopilot checkout's src/,
               and Definitions.cs answers nearly everything at once:

               - `Definition.Set()` is branch-identical to our setKind —
                 the four kinds confirmed against the authority.
               - **master: and shared: entries execute differently.**
                 Shared runs the built expression through the calculator —
                 real RPN. Master runs `ParseSet`: the whole expression
                 must match `^args (>NAME[, units])$`; args split on
                 spaces, parsed as numbers (non-numeric → 0), REVERSED
                 (authoritative [0]-pushed-last confirmation), `K:2:`
                 arity stripped; then SimConnect transmits — `L:`/`A:` by
                 data definition (L: as FLOAT32 — FS Copilot itself uses
                 the client-side L: write path researched from the SDK
                 docs at this session's start), `K:` as a real event,
                 the rest as calculator code. **A non-matching master
                 setter silently falls back to writing the value at the
                 get: target.**
               - So JF_RJ_100's `set: K:THROTTLE1_SET` (master block) is
                 dead text — the entry works only through the fallback.
                 Not an undocumented form: an author error the fallback
                 forgives. Two dialect rules planned: master-set-shape and
                 dead-set.
               - WBSIM's `set: H:KAP140_NAV_PRESS` is a *shared* entry —
                 the calculator receives the bare word. What the
                 calculator does with one is the last open sliver:
                 answerable with one exec against the module.
               - `(>K:#84132)` fires a custom event by NUMERIC id — a
                 legal form (SimConnect's "#" convention), special-cased
                 in ApplyTo; unknown-name rules must never flag it.
               - Sync semantics: a shared >K:/>B: expression containing
                 "TOGGLE" is skipped when value == current; the implicit
                 setter writes with the entry's units; L:/A: writes use
                 only the last arg.
    Changed:   18-language-core gains "The two execution paths" with four
               newly-unlocked dialect rules; the bare-event open question
               narrowed to one exec test. No code changed tonight — these
               rules need the entry-level pass, which needs the
               line-references prerequisite.
    Affects:   docs/sim-vars/18-language-core.md (kept current in place);
               eventually 05-data-model (master/shared is an execution
               distinction, not only an authority one)

---

## 2026-08-27 — Entries store what FS Copilot sees; the sweep becomes a lint

    Stage:     language core — the YAML unquoting fix
    Expected:  scanEntries stored `plainValue` — quotes on — while the run
               path unquoted through `scalarValue`; one value, two stories.
               Switching entries to `scalarValue` should erase the sweep's
               `"`-word residue.
    Found:     it did, and the floor under it was corpus bugs. 99.8% of
               9,345 RPN texts tokenize clean; the unknown-word list fell
               from 208 JS keywords to 15 singletons, each readable by eye:

               - SWS_Pilatus_PC12_5B.yaml:521 — `5 ${value}
                 >K:2:CABIN_LIGHTS_SET)` — missing the opening paren. Typo.
               - P180.yaml ×7 — `` `${value} (>K:COVER_N_SET)' `` — a stray
                 quote where the closing backtick belongs. Typos.
               - JF_RJ_100 / WBSIM C172 / others — `set: K:THROTTLE1_SET`
                 and `set: H:KAP140_NAV_PRESS`, bare event names with no
                 parens. NOT called bugs: the WBSIM profile works in the
                 wild, so this may be an undocumented FS Copilot form
                 ("literal that names an event fires it"). Open question,
                 answerable by reading FS Copilot's Set handling or by
                 test; a dialect rule waits on the answer.

               Diagnostic counts settle at k-arity 71, b-write-op 89,
               rpn-unterminated 10, stack-balance 9 — the last now largely
               co-located with the real typos above. The sweep is at this
               point a working lint of the whole corpus with near-zero
               noise.
    Changed:   `scanEntries` uses `scalarValue` for set:/skp:/get: values —
               the dictionary, the db and the sweep now hold what FS
               Copilot's YAML parser hands FS Copilot. 930 tests pass.
    Affects:   docs/sim-vars/05-data-model.md implicitly (corpus_entry.set
               now stores unquoted values; old rows refresh on next scan
               since mtimes gate re-reads, not values)

---

## 2026-08-27 — Six more rules; the sweep calibrates stack-balance to zero

    Stage:     language core, the rule batch
    Expected:  the remaining parser/descriptor/stack-backed rules from
               18-language-core, landing as one file each with no changes
               to existing core surfaces.
    Found:     mostly true, with one honest exception that proves the
               user's point about designing exhaustively up front:
               `simulate()` had shipped without the initial-depth parameter
               that the doc's own prepended-consumption rule required, and
               grew it (plus `underflow` and `end`) in this batch. The
               core-change audit is now a standing section in the doc —
               every remaining catalogue rule lands additively.

               Shipped: rpn-unterminated (the Albatross fix as a code
               action), rpn-braces (corrected to the real grammar — els{
               opens its own block with its own }), invisible-chars (with
               substituting fixes), ns-access, unit-meaningless (descriptor
               table grew a `units` fact), stack-balance (kind-aware:
               prepended setters start at depth 1; JS fragments exempt).

               Calibration: stack-balance's first run fired 704 times —
               because B: writes were modelled as consuming nothing, when
               they softly consume their parameter (`fsVarsBVarCall` takes
               it; `(>B:X_Inc)` with none is also legal). Corrected, it
               fires ZERO times across all 10,295 corpus setters while
               catching every synthetic mistake in its tests. 930 tests
               pass; k-arity 71 and b-write-op 81 stand, awaiting the
               in-sim probe that sets their final severity.
    Changed:   18-language-core status and audit section.
    Affects:   docs/sim-vars/18-language-core.md (kept current in place)

---

## 2026-08-27 — Language core built; first sweep finds a real corpus bug

    Stage:     language core (18-language-core), layers 1–4 + seeds
    Expected:  tokens with spans, IR over the shared parser, linear stack
               simulation, a rule engine with injected evidence and a fix
               channel; the corpus sweep as acceptance.
    Found:     built in src/shared/lang/ — 21 tests, 918 total passing.
               The first sweep (55 profiles, 10,295 setters, 9,323 RPN
               texts) taught four things in one run:

               - Feeding setters to the RPN tokenizer without the *real*
                 kind classifier put every JS keyword in the unknown-word
                 list. With setKind routing (JS setters contribute only
                 their template literals), 98.7% tokenize clean and the
                 operator table already covers corpus RPN.
               - A real bug: microsoft_grumman_albatross(.g111).yaml write
                 `set: (>B:INSTRUMENT_IE_HU16_CB_NAV_2_Toggle` — no closing
                 paren (WINDSHIELD_DEICE likewise). The tokenizer's
                 unterminated flag found it on first contact.
               - Severity calibration is corpus-driven: k-arity fired 71
                 times and b-write-op 81 times on shipping payware (the
                 CRJ's `_KEY_PUSH`/`_SHOW_HIDE` presets are named as
                 actions and written bare). Either those lines are quietly
                 broken or the sim tolerates the forms — both rules were
                 downgraded to warning until an in-sim probe decides.
               - The residue (~1.3%) is YAML double-quote escapes leaking
                 through scanEntries' raw values — the next fix belongs in
                 the profile grammar, not the tokenizer.
    Changed:   18-language-core's status and next-steps rewritten to match;
               `npm run lang:sweep` added.
    Affects:   docs/sim-vars/18-language-core.md (kept current in place)

---

## 2026-08-27 — Protocol 4 verified in the sim; Z: resolve-does-not-create is signal

    Stage:     variable model, step 3 — in-sim verification of the build below
    Expected:  hello 0.5.0/4, the watched mapping answering the commands, E:
               ticking, Z:AUDIO_Knob_Selector_1 reporting on an aircraft
               whose profile reads it.
    Found:     transcripts 20-27-01-watch (Black Square Baron) and
               20-30-42-probe / 20-31-18-exec (stock C172 G1000):

               - The command → mapping round trip works: `watched: 0 mapped`
                 on reset, `2 mapped` after add.
               - `E:ZULU TIME` reported 1,076 ticks at a steady 15 Hz, the
                 value matching the wall clock. The raw FS_INVALID_UNIT read
                 works for E:; the number-unit fallback never engaged.
               - `Z:AUDIO_Knob_Selector_1` reported nothing on either
                 aircraft — and the exec test told the whole story in two
                 lines. `exec "(Z:AUDIO_Knob_Selector_1)"` answered ok/0,
                 and on the next tick `1000000=0` appeared in the stream:
                 the CALCULATOR read created the var (legacy touch-creates
                 applies to Z: in RPN), the typed Get does not create, and
                 the moment the var existed the watch's unresolved-ref retry
                 resolved and reported it with no command. Proxy object id 0
                 is fine.
               - `B:LANDING_GEAR_PARKINGBRAKE` read 100 through the typed
                 API on the C172 (id 983105) — the client-side path stays
                 primary, but the fallback is real.
               - Product finding: the 2024 NavCom template uses
                 AUDIO_Knob_Selector only as an animation name — zero `Z:`
                 references in the file. The thirteen profile lines reading
                 `Z:AUDIO_Knob_Selector_1` are 2020-era; under FS Copilot
                 the RPN read creates the var and syncs a constant 0.
    Changed:   the Get-not-Register choice is now deliberate policy:
               watching must not create variables in the aircraft, because
               "this variable does not exist here" is exactly the diagnostic
               an author needs — FS Copilot's own touch-creates read is the
               behaviour that *hides* it. A dead profile line is now
               detectable. Future wire nicety, deferred: carry per-ref
               resolution state in the `watched` mapping so the panel can
               say "not present on this aircraft" instead of showing quiet.
    Affects:   none beyond the entry below

---

## 2026-08-27 — Protocol 4: the module watches Z: and E: by typed id

    Stage:     variable model, step 3
    Expected:  generalising the module's enumerate → cache id → read → diff
               loop over the namespaces the probe verified, with the wire
               decisions named in the plan: a watch command flowing app →
               module, and a handle scheme keeping watch ids off the L: id
               space.
    Found:     built as planned, with the shapes the probe dictated:

               - `watch-reset` / `watch-add` carry the set, names one per
                 line — the first multi-line command, because names contain
                 spaces. The app resends the whole set on change;
                 `packWatchAdds` chunks it, one chunk in any realistic set.
               - The module answers every watch command with its **complete**
                 handle mapping (`watched` messages, handles from 1,000,000).
                 Full-map-replace rather than deltas kills the reset/add
                 ordering races outright; a chunked map accumulates app-side
                 and swaps in whole.
               - Watched values ride the existing `values` stream — same
                 tick, same deadband — so hints, capture, picks and revert
                 detection work for `Z:` with zero downstream changes.
               - A read that errors un-resolves its ref (stale Z: id after an
                 aircraft change), making the vars-status handler an
                 accelerator, not a correctness requirement. The handler —
                 registered at init now — also runs `rescan()` on the LVAR
                 reset push, answering the settle loop's question before it
                 asks; the loop stays as fallback.
               - `E:` reads try FS_INVALID_UNIT and fall back to the `number`
                 unit once per ref — the probe read E: through an explicit
                 unit and never asked whether raw works.
               - `B:` deliberately not routed through the module: session.ts
                 already enumerates, subscribes and resolves input events
                 client-side.
    Changed:   descriptor rows for Z: and E: read: "watch" — the panel's
               readable() and the watch pipeline pick both up with no further
               edits, which was the point of the table. LINK_PROTOCOL 4,
               module 0.5.0; an older module now shows as outdated with a
               reinstall offer. 897 tests pass.
               NOT yet verified in the sim: the module needs a build (MSFS
               was open) and one `link:read` session watching a Z: on an
               aircraft that has one.
    Affects:   docs/sim-vars/03-link.md (the module's job description gains
               the watch set), 02-namespaces.md (`Z:`/`E:` now readable)

---

## 2026-08-27 — One parser, one descriptor table; eight private opinions deleted

    Stage:     variable model, step 2
    Expected:  a behaviour-preserving consolidation: every site that guessed
               at a name's structure or capability starts asking
               `src/shared/vars/` instead, seeded with exactly what the sites
               believed.
    Found:     the eight sites are gone — vars.ts's regexes, session.ts's
               namespaceOf and A:-filter, the panel's readable(), the
               activity buffer's via-inference, entries.ts's letter test,
               store.ts's watch-units ternary, var-search's facet regex — and
               888 tests pass, the old parseVarName cases unchanged through
               the delegation.

               Behaviour-preserving with four deliberate corrections, each a
               case the old regexes got wrong and the corpus contains:

               - `L:A32NX_AUTOTHRUST_TLA:1` and `:2` are two complete names
                 in the sim's table. The old parse stripped the ":1" as an
                 index, folding two variables into one row whose merged name
                 exists nowhere — its live value was blank forever. Indices
                 are an A:-only concept now.
               - `L:1:X` is `Z:X` — parsed as such, so it stops passing
                 readable() while being unmatchable against the L: stream.
               - `K:2:EVENT` folds to `K:EVENT` — the arity is how it was
                 called, not what it is.
               - An unknown prefix letter (`Q:FOO`) is part of the name, as
                 it is to the sim.

               Also settled: entries.ts's unit default tested the first
               *letter*, so a bare name like `Kollsman_Knob` would have been
               an event with no units; the corpus has no such name today,
               which is why this could be fixed silently. And 62 of the
               corpus's B: suffixes are spelled _SET/_set/_INC/_Off — the
               parser reads the operation case-insensitively.
    Changed:   migration 5 re-derives the variable table's cached
               namespace/name/idx columns from full_name via the shared
               parser, so rows cached under the old regexes fold identically
               to new ones. B: operation folding (_Set/_Inc/_Dec → preset) is
               parsed but deliberately NOT applied to identity — that changes
               what the panel lists, a product decision deferred to the panel.
    Affects:   docs/sim-vars/05-data-model.md (identity is now
               varIdentity(parseVar(name)); indices A:-only),
               docs/sim-vars/06-variables-panel.md (readable() is now the
               descriptor table's readOf)

---

## 2026-08-27 — The typed variable API works, and the sim announces invalidation

    Stage:     variable model, step 1 (the smoke test the plan gates on)
    Expected:  `MSFS_Vars.h` covers Z:/O:/I:/E:/B: with the same id-based
               shape as the proven `L:` third, but nothing beyond `L:` had
               ever been called here. Header shipping ahead of implementation
               was the named risk.
    Found:     module 0.4.0's `probe`, run on the CGS Hawk AII in MSFS 2024.
               Every assumption held, and one answer is better than assumed:

               - Units resolve and convert: `PLANE ALTITUDE` read as 132.689
                 feet and 40.444 meters through two `fsVarsGetUnitId` ids —
                 ratio 3.28084, exact. Unit id 0 is a *valid* id (meters), so
                 the sentinel is FS_INVALID_UNIT/-1, never 0.
               - `E:` reads: ZULU TIME id=2, 71396s, a real clock.
               - Missing names fail clean, with per-family sentinels:
                 `fsVarsGetLVarId` and `fsVarsGetZVarId` return -1 — resolve
                 does NOT create, unlike the legacy touch-creates lore —
                 while a missing A: returns 0 (FS_VAR_AVAR_NONE). "Not in
                 this aircraft" is therefore a detectable state, which is
                 what the variables panel's empty states wanted to hear.
               - `Z:` round-trips: register → set → read back 42, and set
                 accepts both FS_INVALID_UNIT and a unit id. Write mechanics
                 proven end to end.
               - `Z:AUDIO_Knob_Selector_1` resolved -1 *on this aircraft* —
                 an ultralight with no audio panel. Consistent with per-
                 aircraft scope, but a positive read of a pre-existing Z:
                 still wants one run on an aircraft that has it (C172 or any
                 Black Square). Same for B:LANDING_GEAR_PARKINGBRAKE (-1
                 here; B: is served client-side anyway, nothing rests on it).
               - I:/O: with an empty componentPath fail cleanly (-1, even
                 register). A real-path read is still open, by hand through
                 `exec`, path from the loaded aircraft's model XML.
               - The status handler registers AND fires, decodably. On an
                 aircraft change: a burst of flags=33571072 = ZVAR|OVAR|IVAR
                 with op=REMOVE, one per destroyed object id — then
                 flags=2048 = LVAR with op=RESET, object=0xFFFFFFFF.
    Changed:   the plan's gate is passed; parser/descriptors and the module
               generalisation can be designed against these exact behaviors.
               Beyond the gate: the LVAR/RESET firing is a *push* signal for
               the very thing the app's settle loop polls `rescan` for —
               worth folding into the module generalisation rather than
               keeping the backoff heuristic.
    Affects:   docs/sim-vars/02-namespaces.md (missing-name detectability),
               10-probe.md's per-namespace table (Z:/O:/I: now typed reads,
               not calculator code)

---

## 2026-08-27 — Two version numbers, one of which nobody had a reason to touch

    Stage:     housekeeping — an open decision from v1-plan
    Expected:  a typo to correct on the next rebuild
    Found:     a structural reason it drifted, and a wider gap than recorded.
               The plan said `0.1.0` against `0.0.1`; it is `0.3.0` against
               `0.0.1` now, so the module's number moved twice more while the
               package's stood still.

               Nothing was neglected here. `k_version` is in the handshake, so
               a protocol change puts it in front of somebody; `<AssetPackage
               Version>` is read by fspackagetool and by nothing else, so
               nothing has ever asked about it. **A number with no reader does
               not get maintained**, and correcting it by hand would have set
               up the identical drift from a different starting value.

               Worth naming: nothing depends on either — install compares the
               module's bytes, which is the only comparison that cannot be
               lied to. That is exactly why this went three releases without a
               symptom.
    Changed:   `link/build.sh` derives the XML version from `k_version` before
               packaging, and asserts `manifest.json` after it. Both live in
               `link/tools/version.mjs`. The check is not redundant with the
               sync: one proves what was asked for, the other what
               fspackagetool did, and this build has been surprised once
               already by that tool silently not writing a file.

               **Unverified through a real build.** The sync and the check were
               run directly and behave correctly — including failing, as it
               should, against the package built before the sync — but
               `npm run link:build` needs the SDK and a closed sim.
    Affects:   none

---

## 2026-08-27 — The settle rule did not fail here, and one aircraft was two

    Stage:     deferred verification — carried over from the 2026-08-24 entry
               "Re-enumeration stops on a pause, not on a finished table"
    Expected:  that the 2026-08-24 failure was quietly reproducing in every
               session since. A first pass over
               `2026-08-27T18-02-01-bksq-aircraft-bonanzaproturbine` appeared
               to confirm it: walks at 0/3/9 s reaching 4,161 names, a table
               that eventually held 7,617, and therefore a ladder that stopped
               holding 55% of what was there
    Found:     **that reading was wrong, and the way it was wrong is the part
               worth keeping.** Two traps in reading a capture this way:

               - The name count is a **union across every aircraft in the
                 session**, not one aircraft's table. This session held an
                 A350, then a PA-24, then the Bonanza; 7,617 is all three plus
                 every add-on that woke up, and no single aircraft ever had a
                 table that size.
               - **`rescan` emits nothing when it finds nothing.** A walk that
                 discovers no new names leaves no `vars` event, so the absence
                 of a walk in the capture is not the absence of an ask. The
                 ladder was running through gaps that looked like silence.

               Tracked properly — by first appearance of names matching the
               aircraft — the Bonanza is a **pass**. It loaded at 583.8 s, and
               its own 88 variables arrived across the full ladder: 71 in the
               load walk, 3 at +3 s, 4 at +14 s, 6 at +17 s, and the last 3 at
               +35 s. All four steps ran. Nothing was left behind.

               **What is real is the duplicate `aircraft` event**, and it is
               not the sim being strange. Every load produced two, and the
               first pair are 1 ms apart with *different paths*:

               ```
               SimObjects\Airplanes\A350\presets\...\aircraft.CFG
               c:\users\...\community\inibuilds-aircraft-a350\simobjects\airplanes\a350\presets\...\aircraft.cfg
               ```

               Relative and mixed-case, then absolute and lowercase — the same
               aeroplane announced twice, and `folderFromPath` keys off the raw
               path segment, so the app saw `A350` and then `a350`. **Those are
               two different aircraft to everything downstream**, because
               `profileKey` lowercases the profile's filename and compares
               exactly: `A350` matches no profile at all. It self-corrects a
               millisecond later, which is why nobody has seen it, and it is
               one sim behaving differently from another away from being the
               permanent state.

               The later duplicates are a different thing and are **by design**
               — `aircraftChanged` says it records a repeat deliberately, since
               a reload resets sim state and 07-activity wants the separator.
    Changed:   the settle rule stops being the next action. It remains wrong in
               principle — two equal walks detect a pause, not a finish — and
               the 2026-08-24 A2A measurement stands, but it is now a defect
               with one observation behind it rather than a live problem, and
               the duplicate event it was blamed on turns out to *help* it by
               restarting the ladder.

               **The next action is the key.** Normalising it is a line, it
               needs no simulator, and it removes a window in which the running
               aircraft matches no profile — which gates the run-setter play
               buttons and every aircraft-scoped facet.
    Affects:   none. `04-connection` describes the transport, not this.

---

## 2026-08-27 — Stage 5 ran, and only half of it can ever be read back

    Stage:     run setter — 5
    Expected:  a stage marked "not started"
    Found:     it had been run, and the evidence was sitting in the captures.
               The app issued `exec` against a live A350 on 2026-08-26 —
               fifteen replies between 20:29 and 20:45, every one `ok: true`,
               with app-side tokens incrementing, plus singles in four more
               captures that evening. That is the wire, the resolver, the
               button and the module working together against a real aircraft,
               which is the first half of the exit criterion.

               **The second half cannot be read back at all.** A revert is
               returned from `runSetter` to the renderer over IPC and written
               nowhere, so whether the revert line has ever appeared is a
               memory rather than a record. Three days later there is no way to
               settle it from disk — which is a peculiar shape for the one
               outcome the whole detector exists to report.
    Changed:   run-setter-plan's status, from "stage 5 is what is left" to
               "first half met, second half unconfirmed". Worth more than
               closing the criterion by watching for it: **record a run's
               outcome into the capture.** The revert is the one thing the
               editor cannot show, which is the argument for keeping it, and it
               would make this question self-answering next time.
    Affects:   none

---

## 2026-08-25 — The live value was already the result line

    Stage:     run setter — 3 and 4
    Expected:  a run reports three outcomes — held, reverted, no effect — into
               a result line inside the popover, and a fourth thing besides:
               everything else that moved in the window, via a new `AnchorKind`
               feeding the existing ranking
    Found:     two of the three outcomes were being reported to somebody who
               could already see them.

               Inline live values shipped before this did, and a `get:` line
               shows its variable continuously. Put the popover under the entry
               and that number is directly above it, so "it moved and stayed"
               and "nothing moved" are both on screen while the panel is being
               read. Saying them again in a result line is a second, worse copy
               of a fact with a one-second delay on it.

               **The third outcome is different, and the rates say why.** The
               module diffs at 15 Hz and main flushes to the renderer at 60, so
               what can be seen is bounded by the module's 66 ms tick:

               | revert takes | reported | visible |
               | --- | --- | --- |
               | under ~66 ms | nothing | nothing |
               | ~66-400 ms | one or two ticks | a flicker, if you are looking |
               | over ~400 ms | several ticks | readable |

               Measured median is 83 ms and p90 is 464 ms, so most reverts sit
               in the middle band — where a revert and "nothing happened" end
               with the same number on screen and are indistinguishable to a
               person. That is the case worth a sentence, and it is the only
               one.

               The top row is the honest limit: below one tick nothing reaches
               anybody, this detector included, because it reads the same
               stream. Fixing that means the module watching the target at
               frame rate, which is a protocol change and is not being made on
               spec.
    Changed:   stage 3 is a revert detector rather than a classifier —
               `revertIn`, silent on the two visible outcomes. Stage 4's
               popover **stays open** after Run: the value being watched is on
               the line above, failures have somewhere to land, and re-running
               is a new number and Enter, which is also how you undo. The
               finding-list anchor work is dropped rather than deferred; the
               mark hotkey answers "what else moved" and answers it better.

               Two things fell out of the placement rule. The widget is pinned
               to `BELOW` alone so Monaco cannot flip it over the `get:` line —
               and `scrollBeyondLastLine`, which had been turned off in
               `editor-pane.tsx` with no reason recorded, is back on, because
               without it the last entry in a file has nothing underneath it and
               no scrolling can make room. It also means the last line can be
               read somewhere comfortable, which is why Monaco and VS Code
               default it on.

               One thing the plan expected to be awkward was not: Monaco does
               not report injected text in a mouse target's `detail`, but
               `IBaseMouseTarget.element` is the element under the pointer and
               carries our class, so the button is hit-tested exactly rather
               than inferred from a column.
    Affects:   `10-probe` is already superseded; nothing else describes this.

---

## 2026-08-25 — The wire runs calculator code, and `gauges.h` came back clean

    Stage:     run setter — 1
    Expected:  the stage most likely to surprise. 2b dropped
               `MSFS/Legacy/gauges.h` and took `DWORD`/`HANDLE` with it, and
               "re-adding it should be clean" was doing real work in that
               sentence
    Found:     clean. It compiled, packaged and installed first time with
               `MSFS_WindowsTypes.h` already in place, and
               `execute_calculator_code` needed nothing else.

               `npm run link:read -- exec "1 (>L:Battery1Switch)"` in a
               pa24-250 answered `exec: #1 ok -> 0`, twice. The `0` is the
               calculator's return, not a failure — a write leaves nothing on
               the stack — and `ok` is its verdict that the code parsed and ran.

               Two things the transcripts confirm beyond the exit criterion:
               the token came back as sent, which is what a caller waits on;
               and values kept streaming to the reader throughout, so an `exec`
               from a second client does not disturb a session the app already
               started.
    Changed:   nothing. The one stage that was expected to move the plan did
               not.
    Affects:   none

---

## 2026-08-25 — A setter is a script, and most entries do not have one

    Stage:     run setter — 2
    Expected:  a `set:` value is a template literal, evaluated as an expression
               with `value` and `current` bound. Jint and V8 agree on
               arithmetic and interpolation, so the difference between them is
               a caveat rather than a problem
    Found:     three things, in the order a sweep of the real corpus found
               them. Each would have shipped as a silently wrong preview.

               **Most entries have no `set:` at all.** `Definition.Set` opens
               with `if (_set == null)` and writes the value straight to the
               `get:` variable — `<value> (>NAME, Units)`, units-less for `K:`
               and `H:`, whose units resolve to empty. That branch is **15,933
               of 26,533 entries, 60%**, against 6,720 javascript, 2,017
               prepended and 1,863 literal. A feature scoped to `set:` lines
               would have missed the majority of what can be run, and the
               majority it missed would be the plain switches.

               **`Engine.Evaluate` runs a script, not an expression**, and
               hands back the script's completion value. Two consequences, both
               live in the corpus:

               | | |
               | --- | --- |
               | top-level `return` | legal in Jint, `Illegal return statement` in V8 — **296 entries** across the CRJ family, the Albatross, the TBM 850 and the iFly 737 are `switch (value) { case 0: return <code> }` |
               | a leading `{` | a block in a script, an object literal if the source is parenthesised — so parenthesising changes what those entries resolve to |

               So the source runs unparenthesised, as a script; when V8 rejects
               it for a top-level `return`, it runs again wrapped in a function,
               where `return` means what its author meant. 296 refusals became
               0.

               **`instanceof` does not work on an error from a `vm` context.**
               The retry above is guarded by "was this a syntax error", written
               as `error instanceof SyntaxError`, and it was false every time:
               a `vm` context builds its errors from its own constructors, so
               the host realm's `SyntaxError` is a different class. The guard
               silently disabled the retry it existed to trigger, and the fix
               was to ask for `name` instead. Worth remembering the next time
               anything crosses that boundary.
    Changed:   the plan's stage 2 rewrote itself around the four branches, and
               its stage 4 button moved from the `set:` line to the entry —
               `set:` when there is one, `get:` when there is not. The sweep is
               `npm run check:setters`, a maintainer script beside
               `check:format` for the same reason: the corpus is not in the
               repository.
    Affects:   none — 11-static-analysis and 12-rules describe reading files
               rather than running them.

    **What the sweep still refuses, and why none of it is the resolver's.**

    Eight entries, tried with `value` of 0, 1, 5 and 20 and reported only when
    all four fail.

    - **Four CRJ guards** carry a `###############` banner *inside* the `set:`
      block, because our own scanner ends a block scalar at the parent key's
      indentation rather than at the block's. Real YAML ends the block and
      treats the banner as a comment. That is a grammar bug, filed separately;
      the CRJ files are independently invalid YAML — duplicate keys at line
      674, which is why `check:format` already counts them among its five.
    - **Two FlyByWire baro entries** answer only between 745 and 1100, or 22 and
      32.48. Nothing is wrong with them; the sweep's four values simply fall
      outside, which is why the script reports an entry only when every value
      fails and says so in its output.
    - **Two inibuilds F406 lines** are `NAV ACTIVE FREQUENCY:2 = {frequency}`,
      which is somebody's placeholder. These do nothing in FS Copilot today —
      it logs the parse failure and returns an empty string.

---

## 2026-08-25 — The migrations were never stuck; the database had never been opened

    Stage:     variable index — verification
    Expected:  migrations 3 and 4 were failing to run in a live app, most
               likely because the process was serving a stale `out/`
    Found:     the runner is not broken and never was. Three readings, in
               order:

               | | |
               | --- | --- |
               | the file, app closed | `schema_version` 2, `journal_mode` **delete**, `integrity_check` ok |
               | `openDatabase()` on a *copy* of that exact file | migrated 2 → 4, `sim_aircraft` and `sim_coincidence` created |
               | the real app, launched | same, on the real file, in the second it took to start |

               The database had simply never been through `openDatabase()`
               since the rebuild that followed the corruption on 08-24. A
               rebuild dumps the intact tables into a **new file**; that file
               carries whatever `meta` said and nothing else, and it had not
               been opened by the app between then and the readings that
               produced the open item.

               **The fingerprint, which is the part worth keeping.**
               `openDatabase` runs `PRAGMA journal_mode = WAL`, and SQLite
               persists that in the file header. So a `vars.db` reading
               `delete` **has never been opened by this app** — one query
               separates "the app ran and the migration failed" from "the app
               never ran against this file", and it was always the second.
               Reach for that before theorising.

               The stale-`out/` theory was wrong on the evidence available at
               the time: `out/main/index.js` contained both migrations.

               The launch also rescanned the corpus clean — 25,916 entries
               across 65 profile files — and quit checkpointing its WAL away,
               so nothing about the path is sick.
    Changed:   two of the three open items in var-index-plan.md close. The
               third, `B:` names, is untouched. `observedRates()` has its table
               and the history path is live, on empty tables: the rebuild took
               `sim_observation` with it, so aircraft evidence — observations,
               observed time, coincidences — accumulates from the next
               connected session rather than from history.
    Affects:   none

---

## 2026-08-24 — The capture window turns around: do the thing, then press

    Stage:     post-v1 — UI and ranking
    Expected:  a mark's window is forward-biased, −3 s / +12 s, per 08-marks
    Found:     08-marks argues for the opposite in three places and for the
               forward window in one, and the implementation followed the one.

               | | |
               | --- | --- |
               | "Press it whenever something happens" | act-then-press |
               | "**You cannot press start too late.** The interesting thing sometimes announces itself afterwards … takes the window *before* it" | argues for a backward window outright |
               | "The hotkey carries human reaction latency — 200–400 ms" | reaction latency only exists when the event comes first |
               | "Forward-biased, because press-then-act is the common gesture" | unsupported, and what was built |

               The forward window also made the feature feel broken. Press the
               key and nothing could be said for twelve seconds, with no
               indication why — the window had to close before there was
               anything to close over.
    Changed:   **−12 s / +0.5 s.** The evidence is already in the ring when the
               key goes down, so the row arrives with its candidates rather than
               as a placeholder. The tail is half a second because that is what
               the gesture needs — effects arrive in bands measured at 46, 123
               and 200 ms, and the press lands 200–400 ms after the act — and
               because every millisecond of it is a millisecond before the
               answer holds still. Anyone who needs more presses a moment later,
               which is learned in one try; waiting on the panel is endured
               every time.
    Affects:   `08-marks`, whose one forward-biased line is now wrong and whose
               other three are what got built.

    **Three things underneath it had to turn around too, and one was a real
    bug.**

    The sort demoted anything more than a sample before the anchor — "a cause
    does not follow its effect". True of an input event, and the exact inverse of
    a capture, whose answer is *always* before the press by however long it took
    to reach the keyboard. Left alone it would have put every real answer in the
    demoted bucket and ranked the half-second of tail above all of it. The arrow
    of time is an input event's property now, not the ranking's.

    `windowFor` kept the **first** occurrence of a variable in the window, which
    was the same as the nearest one while every window ran forwards. Backwards
    it is the *oldest*: a variable that moved ten seconds ago and again just
    before the press was being ranked, and labelled, by the ten-second figure.
    Nearest wins now, which is what "first" always meant.

    And absorption — a mark next to an input event yields to it, because the
    input carries the simulator's own timestamp — was judged against the whole
    window. At twelve seconds backwards that stops being true: flip a reported
    switch, work an unreported control eight seconds later, press the key, and
    the capture would quietly answer about the switch. `MARK_ABSORB_MS` is
    reaction latency plus slack, which is the width over which the two are
    plausibly one gesture.

    **What it cost.** `pa24-mark-cabin-vent.ndjson.gz` was recorded
    press-then-act, so it now holds a gesture the feature does not expect — the
    first capture reaches nothing and the second finds the lever 4.7 s behind
    it. Its tests were rewritten rather than its assertions weakened: what it
    caught was the denominator collapse, and that is asserted against the
    measured rate directly, where no window can move it.

---

## 2026-08-24 — Arming is a capture policy, not a view filter

    Stage:     post-v1 — UI, and then main
    Expected:  gating what the panel *follows* was enough, because the ranking
               and the coincidence history had to keep running whatever the
               panel did
    Found:     that reasoning was true and irrelevant, and it produced the worst
               bug in the feature.

               The learning was never in the renderer. It happens in main, in
               `noteInteraction`, and has nothing to do with what anybody is
               looking at — so nothing about it required the *list* to keep
               growing. But `activity:findings` ranked the whole ring on every
               ask, which is a row for every interaction in the last two
               minutes, and arming was a filter the panel applied afterwards.

               Three symptoms, each patched separately before the cause was
               seen. Switching off did not stop entries arriving. A `+N held`
               counter was added to explain why the list looked stuck. The hold
               released itself when its contents aged out, so rows somebody was
               watching values on vanished. And then the one that gave it away:
               **flip a switch two dozen times to watch values, re-arm, and two
               dozen rows appear at once.**

               A filter cannot fix that, because everything it hides is still
               there waiting to be revealed. **Hiding can be undone; not
               creating cannot.**
    Changed:   arming moved to main. A *capture* now exists only because
               somebody asked for one — armed auto-capture, the button, or the
               hotkey — and `activity:findings` returns the captures rather than
               ranking the ring. The renderer holds a row selection and nothing
               else.

               `activity-history.ts` owns both halves and the boundary between
               them: **every** interaction teaches `sim_coincidence`, and only a
               requested one becomes a row. Background flipping is not merely
               tolerated, it is useful — promiscuity is computed across every
               anchor in the ring, so the flips made while watching values are
               ranked into the next capture.
    Affects:   `07-activity`, `15-ui-surfaces`.

    **Three things that fell out of it, all improvements.** A capture is
    computed once when its window closes and then kept, so the two-minute ring
    can no longer take the panel's contents away — which was the disappearing
    rows, fixed properly instead of by a self-releasing filter. The panel stopped
    re-ranking 180,000 records on every update. And a capture that matches no
    anchor gives the arm back rather than spending it: an aircraft change dumps
    hundreds of input events, `anchorsIn` drops them as a machine burst, and the
    arm that fired on the first of them was being spent on nothing.

    The cost, stated because it is a real one: a kept capture is a snapshot of
    what was known when it closed, so it does not improve when later flips teach
    the ranking more. Live values on its rows keep working regardless, which is
    what the row is for.

---

## 2026-08-24 — The Activity panel stops answering and starts helping you check

    Stage:     post-v1 — UI
    Expected:  the ranking would keep getting better until the list was right
    Found:     a better shape for the panel than "be right". A ranked shortlist
                plus **live values on every row** turns it from an answer to be
                trusted into a shortlist to be confirmed: get five candidates,
                then work the control and watch which one moves. A person
                watching a value flip is a far better detector than any ranking
                that can be written, and it degrades honestly — when the
                ranking is wrong, that is visible instead of misleading.
    Changed:   three things, and the third only exists because of the second.

               **One list.** The `direct` / `downstream` headings are gone. The
               argument for them was sound — the variable a control *is* and
               the things it caused are different answers — but the boundary is
               not: at 15 Hz a control and its effects routinely arrive in one
               sample, and the tier has been caught mislabelling twice in a day.
               It is a dim marker on a row now. Same information, without a
               layout that presents a hint as a finding.

               **Groups flatten.** An alias sits under its candidate, dimmed and
               indented, instead of behind a `+N`. This came from a real miss:
               `L:BeaconLightSwitch` was reported as undetected when it was in
               all three beacon anchors — folded into `L:BeaconON`'s row, the
               two separated by a 0.001/s baseline difference, and the one
               somebody wanted was behind a hover.

               **Auto-capture.** Live values are useless if the list keeps being
               replaced by the very interactions being performed to test it. So
               the panel follows the newest capture until one finds something,
               then holds. It gates **display only** — every interaction is
               still ranked and still recorded into the coincidence history,
               because disarming that would mean the app quietly stopped
               learning exactly while somebody was teaching it.
    Affects:   `07-activity` and `15-ui-surfaces`, which describe the two-group
               candidate list.

    **It is a full button, not a ghost icon**, against the header convention and
    deliberately. The other controls are icons because pressing one does a thing
    and it is over; this changes what the panel does next. A mode nobody notices
    is a mode that makes the panel look broken — the list stops moving and there
    is no visible reason why.

## 2026-08-24 — A variable is a component, not a formatted string

    Stage:     post-v1 — UI
    Expected:  the Activity list would format names and values itself
    Found:     the same three questions are asked wherever a variable name
                appears — what is it called, what is it reading, can I get it
                into the file — and every panel was answering the first only.
                `VarChip` answers all three once.
    Changed:   `var-chip.tsx`, and `var-watch.ts` under it.

               **The colours are not matched, they are shared.**
               `monaco-theme.ts` holds no palette: it reads the resolved
               `--syntax-*` properties off the document and builds the editor
               theme from them. A chip using the same properties cannot drift
               from the editor, because there is only one palette to drift from.

               **Retain and release, not subscribe per component.** The obvious
               shape breaks twice — thirty chips is thirty round trips, and two
               chips showing one variable unsubscribe each other on unmount,
               silently, leaving the survivor frozen. Names are ref-counted and
               the store sends one union.
    Affects:   none.

    **The watch set is a replace, not an add**, and that was nearly a bug rather
    than a design note. `store.ts` sends a set built from the `get:` lines in
    the open tabs; a second caller would have wiped it, and the editor's live
    values would have gone dark the moment any panel showed a chip. The set is
    the union of both now.

    Two smaller things found on the way. A chip must render **no value box at
    all** rather than a placeholder, because in a candidate list a `0` is a
    completely plausible reading and a dash is not distinguishable from one at a
    glance. And a UI-held `A:` name is watched as `Number` rather than with no
    unit: SimConnect rejects a datum without one, which would have left the chip
    blank forever rather than failing visibly.

---

## 2026-08-24 — The right answer was being sorted last for arriving 2 ms early

    Stage:     post-v1 — ranking
    Expected:  a live session would confirm the day's improvements
    Found:     it reported them as **worse**, and it was right. From the dump —
               eleven pitot-heat flips and two battery master flips, both with
               known answers:

               | | |
               | --- | --- |
               | right answer ranked first | **4 of 13** |
               | `L:Battery1Switch`, the variable this ranking was built on | **15th of 16**, twice |

               Six of the thirteen had the answer sorted **last**, all for the
               same reason: an offset of −1 to −19 milliseconds.

               `L:` values arrive through our WASM module and input events
               through SimConnect. Two transports, two latencies, so the offset
               between a control and its own variable carries tens of
               milliseconds of noise in either direction. The window has always
               opened 50 ms early to absorb exactly that — and the *sort* did
               not, treating any negative offset as proof a change preceded its
               cause. **A tolerance that exists in the window and not in the
               ordering is not a tolerance.**

               The rule was added for a real reason, recorded at the time: a
               noise variable at −3 ms outranking a real one at +30 ms. It
               fixed that and created this, and this is the worse of the two
               because it fires on the control itself.

               **Then a second one underneath it.** With jitter handled, the
               battery master still placed eighth and tenth, because
               `L:Battery1Charge` at −1 ms beat `L:Battery1Switch` at −2 ms. The
               app stamps each value with `Date.now()` as it *parses*, so the
               ~192 values in one 8 KB message land 0–3 ms apart — ordering on
               that is ordering by parse order, which is variable-id order,
               which is nothing. The module sends at 15 Hz, so anything finer
               than a sample was never information.
    Changed:   `JITTER_MS` — within 50 ms before an anchor, a change is *at* it,
               for the ordering and for the tier. `SAMPLE_MS` — offsets are
               compared in whole samples, and below that the tie-break falls to
               `baseline`, which is the right next question: among things that
               arrived together, the one that moves least often is the likelier
               control.

               | ordering | first | in top three | mean position |
               | --- | --- | --- | --- |
               | negatives last, raw offset | 4 of 13 | 6 of 13 | 5.1 |
               | jitter absorbed | 12 of 18 | — | 2.22 |
               | **and quantised to a sample** | **14 of 18** | **18 of 18** | **1.22** |

               The six-control fixture is unchanged at 31 of 31, so neither
               change was bought at its expense. 50 ms and 100 ms score
               identically for the jitter band, so it sits in the flat part.

               `pa24-early-report.ndjson.gz` is the session, committed.
    Affects:   `07-activity`, whose "forwards in time first" no longer holds
               within a sample of the anchor.

    **The tier label was wrong in the same way.** A switch reporting 2 ms early
    was filed `downstream`, which tells somebody the control is a consequence of
    itself. It reads `direct` from `-JITTER_MS` now.

    **What is still not separable, and probably is not by anything here.** The
    battery master's own variable and `L:Battery1Volts` arrive in the *same
    sample*, because the switch and the voltage it causes genuinely do. Second
    place is the honest ceiling for that anchor rather than a defect to chase.

---

## 2026-08-24 — Marks do not need identities. Switch-flipping already teaches the ranking.

    Stage:     post-v1 — ranking, history
    Expected:  every mark sharing the name `Mark` is a defect, fixable either by
               making them unique or by letting somebody label them
    Found:     both are wrong, and the second was unnecessary.

               **Unique names would demote the answer.** Measured on the cabin
               vent session: the two marks' candidate lists overlap by **76 of
               76 names — 100%** — because they were two marks on the same
               control, which is how anybody confirms a thing moved. Named
               uniquely, every one of those scores 2 of 2, the vent cluster
               included, and the only names left at 1 are the two stragglers
               that happened to appear in the second window alone. The right
               answer sinks and noise rises. It is the same failure the
               "count controls, not anchors" rule exists to prevent.

               So the shared name is a guess — *every mark is the same control*
               — and uniqueness is the opposite guess. The app cannot tell which
               is true, because only the person pressing the key knows.

               **Labelling was the obvious answer and is the wrong one.** Asking
               somebody to name a thing is close to the highest-friction request
               a UI can make, and this one would arrive while they are trying to
               find a switch.

               **It is already solved.** Promiscuity is per *variable*, not per
               anchor, so coincidences learned from ordinary switch-flipping
               apply to a mark's candidates without the mark needing an identity
               at all. Simulating a second session — history from the
               six-control fixture, then the vent marks with no input events:

               | history available | the vent lever's position |
               | --- | --- |
               | none | 4th and 7th, under eyelids and blink offsets |
               | rates only | 3rd and 6th, list halved from 56 rows to 32 |
               | **rates and coincidences** | **1st, on both marks** |
    Changed:   nothing. The finding is that no change was needed.
    Affects:   `08-marks`, which can stop treating the mark's anonymity as a
               limitation. It is what keeps a repeated gesture from being
               counted as variety.

## 2026-08-24 — `mark` in the code, "Capture" in the UI

    Stage:     post-v1 — naming
    Expected:  a rename either happens or does not
    Found:     it should happen in exactly one layer. "Mark" names the thing
               after what it is to the program — a point on a timeline — which
               is nothing to somebody who has not read the program. "Capture"
               says what pressing the key is for.

               It must not reach the data. `capture` already means the NDJSON
               recording of a session throughout main — `capture.ts`,
               `CAPTURE_DIR`, `captureFile()`, `npm run sim:sandbox` — so
               renaming the concept would make "the capture" ambiguous in the
               two places it most needs to be exact. And an anchor's `name` is
               the key promiscuity counts by: it is a value the ranking depends
               on, not a caption.

               Checked before doing it: the renderer had no user-facing use of
               the word "capture" at all, only comments and a DOM API call. So
               the two meanings never meet on screen.
    Changed:   a `label()` in the Activity panel, and four strings. `Anchor.name`
               stays `"Mark"`.
    Affects:   none.

---

## 2026-08-24 — `sim_coincidence`, and the moment an anchor is finished

    Stage:     post-v1 — ranking, history
    Expected:  a nice-to-have, deferred once already on the grounds that
               persisting a signal a few hours old means persisting whatever is
               wrong with it
    Found:     the argument for deferring was answered by the signal's own
               weakness. **Promiscuity is inert on a marking session.** Every
               mark carries the name `Mark`, so a session made of marks has one
               control in it and scores every candidate 1 — the strongest signal
               the ranking has does nothing at all in the case the feature
               exists for. Only history reaches it, so "wait until it has proven
               itself" could never have been satisfied by marking.
    Changed:   migration 4 adds `sim_coincidence (variable_id, aircraft,
               control, anchors, …)`.

               **Named for what it records.** A row says a variable moved near a
               control, not that the control caused it — a high count is
               evidence a variable is *not* the answer, so `sim_response` would
               have asserted the opposite of what the data means. It sits with
               `sim_variable` ("this exists") and `sim_observation` ("this
               moved") as another neutral evidence word.

               **Read as controls, not counts.** They have to be *unioned* with
               the current session, and two counts cannot be unioned: a variable
               that answered to the beacon last week and the beacon again today
               has coincided with one control, not two. Counting instead of
               unioning would demote every answer a little further every
               session until nothing was specific to anything.

               **Marks are never recorded.** They share a name, so persisting
               them would build one control called `Mark` that everything had
               coincided with, and every answer a mark ever found would be
               demoted by every other mark.
    Affects:   none.

    **The write moment was the design, not the table.** Findings are a view —
    computed on demand, thrown away, recomputed whenever the panel asks — so
    recording from there would write the same interaction once per refresh, and
    never write at all with the panel closed. `activity-history.ts` owns the one
    moment that is neither: a timer per *control*, reset by each new event for
    that control, firing `WINDOW_AFTER_MS + 250` after the last one. Per control
    rather than per event because the sim reports every interaction twice and a
    knob a hundred times; a hundred recordings of one gesture would teach the
    ranking that the knob's own variable is promiscuous.

    It ranks the whole buffer rather than a slice around the anchor, which is
    not laziness: baselines are rates measured against quiet time, and a slice
    cut to one window has almost none, so everything in it would measure as
    ambient. Ranking the whole buffer is also what makes the recorded
    conclusions the ones a person would have seen on screen.

    Aliases are recorded alongside their representative. An alias moved in
    lockstep with the candidate that happened to rank first, so it coincided
    with the control just as much — recording only the representative would
    leave the other four names of one lever looking specific forever.

---

## 2026-08-24 — `sim_observation` counts had no denominator, and nobody had noticed

    Stage:     post-v1 — ranking, history
    Expected:  seed baselines from `sim_observation` with no schema change: it
               holds `changes`, `first_seen` and `last_seen`, which reads like a
               rate
    Found:     it is not a rate and never was. `first_seen` is stamped once when
               the row is inserted and `last_seen` at every flush, both from
               `Date.now()`, so their difference is **calendar time — including
               every hour the app was closed**. A variable that moved a thousand
               times across a week reads as 0.0017 changes a second.

               The table has a numerator and no denominator, and the comment at
               the top of `store.ts` saying nothing reads it within a session is
               why it went unnoticed: nothing had ever divided by it.
    Changed:   migration 3 adds `sim_aircraft`, one row per aircraft holding
               `observed_ms`. Per aircraft rather than per variable because the
               module reports the whole table at once — observation time is a
               property of the session, and storing it six thousand times would
               be the same number six thousand times.

               Advanced at each flush by the time since the last, **capped at
               twice the flush interval and floored at zero**. The cap is what
               keeps a suspended laptop or a session that ended without a
               disconnect from being counted as watching; the floor is because
               an `aircraft` event flushes before it records and can land on the
               same millisecond the clock started.

               `observedRates` returns nothing below 30 seconds of observation,
               for the same reason `MIN_QUIET_MS` exists: an integer over a
               small number is not a measurement.

               Baselines take **the higher** of the live rate and the historical
               one. The two disagree in one direction only — a two-minute buffer
               can fail to show that a variable churns, and cannot invent churn
               that never happened — so the higher reading is the better
               informed, and being wrong that way costs a candidate rather than
               the answer.
    Affects:   none. `sim_observation`'s own doc comment said it was per
               aircraft evidence of movement, which is true; it never claimed
               to be a rate.

    **Two bugs the tests caught before the simulator could.**

    The query read `variable.name`, which is the bare half with the namespace
    split off, where everything in the ranking keys on `full_name` — `L:Foo`.
    Keyed on the wrong column the history map matches nothing, silently, and
    the feature would have looked like it simply did not help.

    And observation time was banked inside `flushSimEvidence` *after* its early
    return for "nothing to write", so a quiet aircraft banked nothing. Cold and
    dark is the case with the fewest changes and the most switch-hunting, so the
    denominator would have stayed at zero exactly where it was needed. The claim
    is computed before the early return now, and the return accounts for it.

---

## 2026-08-24 — A mark's answer was being labelled a consequence of itself

    Stage:     post-v1 — ranking
    Expected:  the tier split — "Moved with it" against "Followed" — was a
               presentation detail already settled by `DIRECT_MS`
    Found:     it is settled for an input event and wrong for a mark. Measured
               on the cabin vent fixture: **0 direct, 76 downstream** on one
               mark and 2 of 78 on the other, with the vent lever itself filed
               as `downstream`.

               `DIRECT_MS` is 100 ms because an input event carries the
               simulator's own timestamp of the click. **A mark carries a
               person.** The press comes first and the hand arrives afterwards,
               so the control's own variables land at +797 ms through +1363 ms
               — seven to thirteen times outside the band. Every mark therefore
               reported that the variable somebody was hunting for was a side
               effect of something else.
    Changed:   `direct` moves onto `Anchor`, beside `before` and `after`, which
               already vary by kind for the same reason. `MARK_DIRECT_MS` is
               2,000: covers a press-then-reach with margin, still separates it
               from the physics and camera values arriving at +4.5 s.
    Affects:   `07-activity`, which describes one tier boundary.

## 2026-08-24 — An aircraft keeps five names for one lever

    Stage:     post-v1 — ranking
    Expected:  a modest tidy-up
    Found:     worth more than expected, because the duplicates crowd out real
               answers rather than merely repeating themselves. Pulling the
               cabin vent moves `L:CabinVentLeftLever`, `L:CabinVentLever1`,
               `L:CabinVents`, `L:CabinFrontVents` and `L:CabinPushPullLevers`
               on the same sample every time; switches carry an `X` and an
               `XPAST`; sounds carry `_p` and `_v` siblings. Six rows saying one
               thing push five other things out of view.

               **Grouped on identical history, not on a shared sample.** Two
               variables that landed in the same 66 ms tick may have nothing to
               do with each other — the wire delivers ~192 values per message,
               so a tick is a delivery, not a fact. Two variables that moved
               together on *every* sample in the buffer are one fact. Signatures
               are an FNV hash folded over each variable's timestamps: a busy
               variable has twelve thousand of them and there are five thousand
               variables, so keeping the lists would be tens of megabytes for a
               question asked once a second.

               21% fewer rows on the six-control fixture, 26% on the mark one.
               Nothing is discarded — an alias rides on its group's row, and a
               test asserts every name appears exactly once across the two.
    Changed:   `Candidate.aliases`, `grouped`, and a `+N` on the panel row with
               the names in its tooltip.
    Affects:   none.

    **Value-matching was measured and dropped.** A candidate whose value equals
    the input event's value looked strong — flipping the beacon to 1 matched
    `L:LightBeaconSwitchSave = 1`, to 0 matched `L:BeaconLightSwitch = 0`. But
    on the off-flip four candidates matched and two of them were click sounds
    sitting at 0 for unrelated reasons. On a two-state control most of the
    window is 0 or 1, so it ties far more often than it separates, and it can
    say nothing at all about a mark. Not worth a sort term.

---

## 2026-08-24 — A table re-report is a photograph, not movement

    Stage:     post-v1 — ranking
    Expected:  detect the enumeration snapshot as "a burst covering more than
               half the variables in the buffer", which is how it was described
               when the fix was proposed
    Found:     **that formulation is wrong**, and the measurement said so before
               a line of it was written.

               `pa24-many-controls` holds 294 distinct variables, because it is
               sliced to start *after* a snapshot and therefore only ever sees
               what actually moves. A one-second window in it routinely holds
               224 of them — **76% of everything that buffer knows about**. As a
               fraction, normal running is indistinguishable from a snapshot.
               The denominator only exists once a snapshot has happened.

               What separates them is the absolute count, and two unrelated
               aircraft sessions agree on the ceiling:

               | | distinct variables, 1 s window |
               | --- | --- |
               | `pa24-mark-cabin-vent`, away from the snapshot | max 213 |
               | `pa24-many-controls`, throughout | max 224 |
               | the snapshot | **5,554 — the whole table, inside one second** |

               A 23× gap — but a *fixed* count is the wrong shape for it, and
               that came out of the review rather than the measurement. A light
               single enumerates a few hundred `L:` variables and a study-level
               airliner tens of thousands, so any constant is at once too high
               to catch the small aircraft's snapshot and too low to survive
               the big one's ordinary traffic.

               **The enumeration already knows.** The module walks the table
               and reports its size, and the ring keeps that number even though
               it discards the walk itself. So the threshold is
               `SNAPSHOT_FRACTION` — half the table — which is 2,777 for this
               aircraft: twelve times its busiest second, half its snapshot.
               `SNAPSHOT_DISTINCT` survives only as the fallback for a stream
               with no walk in it, which live never is.

               The two tidier rules stay rejected for the reasons recorded
               below: watching for `vars` events is exact live and wrong against
               every sliced fixture, and a per-sample cap cannot work because
               the wire chunks at ~192 values per message, so a snapshot sample
               and a busy sample are the same size.
    Changed:   `snapshotsIn`, filtering inside `changesIn` so baselines and
               candidates can never disagree about what happened.

               Mark 1 of the cabin vent session goes from **5,397 candidates to
               76**, and now answers with `L:CabinVentLeftLever_Click` at
               +797 ms and the vent cluster at +1.2 s. Both marks answer with
               the vent now; before this, one was empty and the other was the
               entire aircraft.

               Everything inside a flagged span is dropped, not just each
               variable's first report in it. During a re-report the aircraft is
               being enumerated or has just changed and nothing in that second is
               attributable to a person — dropping a real change that coincides
               costs one second of a two-minute buffer, where keeping the
               snapshot costs the whole answer.
    Affects:   none.

    **This removes the "wait 30 seconds after connecting before marking"
    workaround**, which should never have been the plan. A mark taken two
    seconds after connect now works.

    Two tests pin the fraction where a constant would have failed: a 600-variable
    table's snapshot is caught even though 600 is below the fallback, and 1,500
    variables moving inside one second on a 20,000-variable aircraft is kept even
    though 1,500 is above it.

## 2026-08-24 — Promiscuity: how many controls a variable answers to, and why it beats proximity

    Stage:     post-v1 — ranking, after the companion finding below
    Expected:  that demoting variables which appear near many anchors would
                help, and that it might also fix the mark case
    Found:     it helps more than expected, and does nothing for marks.

               Measured over the 13-minute session — 67 anchors across 12
               distinct controls. The separation is not a judgement call:

               | | |
               | --- | --- |
               | `L:InGameTime`, `L:Count2…900`, `L:Eyelids4` | 11 of 12 |
               | `L:p42_cp_interactive_render`, `L:p42_cp_motion_pause` | 10 of 12 |
               | `L:scalarLiftStabL/R`, `L:FM_Dragfin` | 8 of 12 |
               | **every** variable a control actually moved | **1 of 12** |

               Anything between 2 and 6 gives the same answer, so there is no
               threshold to tune — it is used as a sort key rather than a
               filter, and nothing is discarded on its say-so.

               **Different controls, not different anchors**, and that is the
               whole trick. The beacon was flipped four times, which is four
               anchors with `L:BeaconLightSwitch` in every window; counting
               anchors would have demoted the answer as promiscuous. Anchors
               are counted by name, which also collapses every mark into one.

               It is complementary to `baseline` rather than a better version
               of it. `L:Count900` ticks too rarely to be ambient but sits next
               to everything; a heartbeat is the reverse. Neither signal sees
               what the other catches.

               **Why it outranks proximity.** The module samples at 15 Hz, so
               everything inside one 66 ms tick carries an identical offset and
               proximity cannot order it at all — it fell through to baseline
               and then to `localeCompare`, which is alphabetical. Proximity
               still does real work *between* ticks, which is why it stays as
               the tie-break under promiscuity rather than being removed.
    Changed:   `Candidate.promiscuity`, and `byRank` puts it second after
               direction. Ranking is two passes now — `rankAll` — because the
               count is a property of a candidate across every *other* anchor
               in the buffer and cannot be known while the first window is
               being built. `findingsFor` and `explainAll` both come through
               it, so a dump can never explain an ordering nobody computed.

               `pa24-many-controls.ndjson.gz` — six controls over 115 seconds —
               is the regression, with a test that re-sorts by the old rules and
               asserts the new ordering leads with a specific variable more
               often. 26 of 31 anchors now lead with something that answers to
               one or two controls, and every one of the six controls has its
               own variable first in at least one window.
    Affects:   `07-activity`. Proximity is no longer the ranking's second term.

    **It does not help a mark**, and the naive version actively hurts. Every
    mark is named `Mark`, so counting marks individually would have scored the
    cabin vent lever 2 — it is in both marks' windows, which overlap — while the
    enumeration snapshot beside it stayed at 1 and outranked it. Promiscuity
    needs a *variety* of anchors and a marking session has none by
    construction. It reaches marks only indirectly: the count is built from the
    whole buffer, so a mark taken in a session that also contains real input
    events gets the counters and blink offsets demoted for free.

## 2026-08-24 — The ambient filter rejected the entire aircraft. The denominator was 2.1 seconds.

    Stage:     post-v1 — the first debug dump, taken 24 seconds after a restart
               with two marks on the cabin vent lever
    Expected:  after the companion finding above, that the vent lever would be
               present and ranked below click sounds and blink offsets
    Found:     it was present, and **discarded**. So were 5,551 of 5,554
               variables. The panel showed nothing, and nothing is what the
               ranking computed.

               `baselinesIn` measures a rate over *quiet* time — the span minus
               the anchor windows — which is right, and had never been asked to
               do it on a young buffer. The dump:

               | | |
               | --- | --- |
               | buffer span | 23.878 s |
               | covered by the two mark windows | 21.756 s |
               | quiet time left | **2.122 s** |

               A mark's window is 15 seconds wide. Two marks are 30 seconds of
               window, and a buffer that has just started is 24. The
               denominator collapses, and at 2.1 seconds **one** out-of-window
               change measures 0.47/s and **two** measure 0.94/s — over the
               0.5/s threshold.

               Every variable has two. Enumeration seeds `last` with NaN so
               every variable reports once per walk, and there are two walks on
               connect. So every variable in the aircraft measured 0.94/s and
               every one was rejected. The three survivors had exactly one.

               The distribution in the dump is the tell, and is what a rate
               distribution should never look like: min = p25 = p50 = p75 =
               0.9425, which is not a distribution at all. It is one integer
               divided by one tiny denominator.

               **The filter was not misjudging the vent lever. It was rejecting
               the aircraft, and the vent lever was in the aircraft.**
    Changed:   `MIN_QUIET_MS` — a rate is computed as if there were at least 30
               seconds of quiet time, however little there really was. Wrong in
               the safe direction: an under-measured rate keeps a candidate
               that might be noise, an over-measured one discards the answer.
               The separation is not close — the real heartbeats in that same
               dump measured 42/s, and stay rejected at any floor.

               `pa24-mark-cabin-vent.ndjson.gz` is the session, committed, and
               `activity-mark.test.ts` is the regression. With the floor, mark 2
               offers `L:CabinVentLeftLever`, `L:CabinVentLeftLever_Click`,
               `L:CabinVentLever1`, `L:CabinFrontVents`, `L:CabinVents` and
               `L:CabinPushPullLevers` in its top twelve, which is the answer.
    Affects:   none. `baselinesIn`'s reasoning about *why* windows are excluded
               is still correct; it had no floor under the result.

    Still open, and visible in the same fixture: **mark 1 offers 5,397
    candidates**, because the startup enumeration snapshot landed 2.1 seconds
    inside its window and a variable that reported once next to an anchor is,
    by the current rule, the strongest possible candidate. A snapshot is not a
    set of changes and should not be ranked as one.

    The obvious fix — drop the first report of each variable after a `vars`
    event — is precise about the protocol and **wrong against the fixtures**:
    `slice-capture.ts` re-times the header, including its `vars` events, to a
    second before the window, so it would drop the first real change of every
    variable in every sliced fixture. A per-sample distinct-count rule does not
    work either: the 8 KB wire chunks values at ~192 per message, so a snapshot
    sample and a busy interaction sample are the same size. Measured — p99 is
    164 and the maximum across both fixtures is 192, snapshot included.

## 2026-08-24 — Re-enumeration stops on a pause, not on a finished table

    Stage:     deferred verification — "re-enumeration against a cold-and-dark
               A2A load", the one item most likely to fail
    Expected:  the backoff walks at 3, 6, 12 and 24 seconds and stops when two
               consecutive walks agree, which is right in principle and might
               be outrun by the slowest-registering aircraft
    Found:     it was outrun, and not by being too short. **It never reached
               step 2 of 4.**

               The walks, from the capture — `2026-08-24T16-55-07`:

               | walk | at | names |
               | --- | --- | --- |
               | 1 | 18:55:07.234 | 2,284 |
               | 2 | 18:55:10.224 | 3,617 |
               | 3 | 18:55:16.184 | 3,963 |
               | 4 | 18:55:16.827 | 3,963 |
               | 5 | 18:55:19.833 | 3,963 |

               A forced walk two minutes later found **5,343**. So enumeration
               ended at 18:55:25 holding 74% of the table, and stayed there for
               the rest of the session.

               The mechanism is walks 3 and 4, 643 ms apart. Two `aircraft`
               events arrived — the capture holds both — and each one calls
               `reenumerate`, so the second walk ran before anything could have
               registered between them and was equal by construction. `settle`
               then compared walk 5 against that number, found them equal, and
               returned. The [3, 6, 12, 24] ladder was never the budget: the
               real budget was ~9 seconds.

               **"Two consecutive equal walks" detects a pause, not a
               finish**, and an aircraft loading cold registers its variables in
               bursts with pauses between them. The A2A's own variables are the
               tail of the table, so the pause it stopped on was the pause
               before the part that mattered: the 1,380 missing names are
               `L:Com1InnerKnobPul`, `L:ElevatorTrimInitialized`,
               `L:Eng4_TurbineCorrN1`, `L:Eng1_MixtureManualLever_Click` and
               their neighbours — the cockpit, in other words.

               Two things that are *not* wrong, checked because they looked
               wrong first. Ids are stable: every chunk boundary matches
               between the two walks, name for name, so nothing is being
               renumbered underneath. And the app absorbs a later walk fine —
               `state.names` is a sparse array indexed by id and is never
               cleared, so the manual `enumerate` at 18:58 reached the app and
               the session after it started with all 5,352.
    Changed:   the settle rule needs to stop early on evidence rather than on
               absence of evidence. Not fixed yet — it wants its own sitting,
               and the marking work below was the reason to be in the sim.
    Affects:   none. `session.ts` documents the rule it implements accurately;
               the rule is what is wrong.

## 2026-08-24 — The ranking's problem is companions, not ambient rate

    Stage:     deferred verification — the exit criterion, and a mark on a
               control the sim does not report
    Expected:  a mark surfaces the variable a control moved. Where it failed,
               the suspect was `AMBIENT_PER_SECOND`: an axis like mixture emits
               hundreds of values when exercised, which looks exactly like the
               heartbeats the threshold exists to discard
    Found:     the threshold is barely engaging, and the axis theory is wrong
               for the case it was proposed for.

               Over the 13-minute PA-24 session — 1.35M events, 306 input
               events, 5,364 variables — the baseline distribution is p10
               through p90 all at **0.002/s**, and **5,152 of 5,364 variables
               are under the 0.5/s threshold**. On a cold and dark aircraft
               almost nothing is moving, so almost nothing is being rejected.
               An exercised axis would indeed be demoted, but that is not what
               emptied these answers.

               What crowds the answer out is a small set of variables that move
               for *every* interaction:

                   L:CockpitSwitchSnd          L:SmallToggleSwitchSnd(PAST)
                   L:Eyelids4, L:Blinking4Offset   L:SteamAmount
                   L:p42_cp_motion_pause       L:p42_cp_interactive_render
                   L:LightsElectricalDraw      L:scalarLiftStabL / R

               Click sounds, an eyelid blink, a camera-motion accumulator, a
               total electrical draw. They are **not ambient by rate** — they
               genuinely only move when you touch something — so no rate
               threshold will ever reject them, and they take the top of the
               list. Flipping the beacon, the correct `L:BeaconLightSwitch`
               ranks first once and is off the top-five entirely the other
               time, beaten by `L:LightBeaconSwitchSave` and three sounds.

               Making it worse: the module sends at 15 Hz, so everything inside
               one 66 ms sample carries an **identical** offset. Proximity, the
               documented tie-break, cannot separate them at all — the order
               within a tick falls through to baseline and then to
               `localeCompare`, which is to say alphabetical.

               So the discriminator the ranking is missing is not "how often
               does this variable move" but **"does this variable move for
               every anchor, or for this one"**. A variable answering to all of
               them is answering to none.
    Changed:   nothing yet, deliberately. `explainAll` now measures exactly this
               — an anchor count per variable — and the next dump from a real
               session is what a change should be based on rather than this
               reading of one capture.
    Affects:   `07-activity` and `08-marks` describe proximity as the tie-break
               that does real work. At 15 Hz it frequently cannot, because the
               offsets tie exactly.

## 2026-08-23 — Probe is replaced by running the setter

    Stage:     post-v1, scoping
    Expected:  build probe as 10-probe describes it — write a value to a
               candidate variable, watch, restore, classify cause versus symptom
    Found:     a better question was available for less machinery, and the
               design doc had been reasoning about the wrong object.

               **Probe tests a variable. Running the setter tests the line.** A
               `set:` is a JavaScript template literal producing calculator code
               — `` "`${value * 100} (>L:Com1FreqInnerKnob)`" `` — so running it
               exercises the expression, the multiplier, the target name and the
               units at once. Those are the bugs an author produces, and probe
               structurally cannot find any of them because it never runs the
               author's code.

               It also needs no teaching. Probe required a mental model: cause
               versus symptom, restore discipline, what a probe result *is*. A
               play button in front of `set:` is understood before anything is
               read, which for a feature nobody asked for is most of the battle.

               And probe's actual payoff survives intact. "A variable that
               reverts shortly after being written will desync if bound" is
               *watch the variable after running the line* — it arrives as a
               consequence of pressing play rather than as a feature somebody
               has to know exists.

               One correction worth recording, because it was wrong for an hour:
               `fsVarsLVarSet` exists in the modern API and looked like a way to
               avoid `execute_calculator_code` entirely. That is true for
               probe — write a number to a variable — and false for this. A
               setter emits arbitrary calculator code, so the calculator is
               required. The mistake came from reading the API before reading
               the corpus.
    Changed:   `run-setter-plan.md`, superseding 10-probe entirely. Four
               measurements are in it so they are not re-derived:

               - **1 second catches 97.4%** of the aircraft's own reversions —
                 6,760 A→B→A patterns across 101 variables, median 83 ms. That
                 is the observation window, from evidence rather than a guess.
               - Quick picks are only viable sometimes: the median variable has
                 **73 distinct values** in 75 seconds, but 30% have two or fewer.
               - Picks must come from the **`get:` variable**, not the write
                 target. `value` is the expression's input; `${value * 100}`
                 writes a hundred times it, and offering 4500 where 45 was meant
                 would be worse than offering nothing.
               - Decorations inject **text, not DOM**, so the button is a
                 `mask-image` on a CSS class and cannot take keyboard focus. A
                 command plus keybinding is the accessible path, not an extra.

               What is lost: probe's `A:` inversion, the seed of 14-sweep.
               Nothing here forecloses it.
    Affects:   10-probe

## 2026-08-23 — v1 is built. Three verifications deferred on purpose.

    Stage:     all of them
    Expected:  finish stage 5, then book a sim session to close the exit
               criterion before calling v1 done
    Found:     the session is worth deferring, and saying so is worth more than
               quietly leaving a gap.

               What is unverified is a **loop with a person in it** — press the
               hotkey, flip a switch, read the answer — plus two things no
               capture can contain: whether `Ctrl+Alt+M` collides with a
               keybinding MSFS reads through raw input, and a mark on a control
               the simulator does not report at all. That last one is the case
               the whole feature exists for, which makes it tempting to treat as
               blocking.

               It is not, and the reason is what the harness bought. The ranking
               is proven against a real captured session with real cockpit
               interaction in it; what a sim session adds is confidence in the
               *ergonomics*, not in the logic. Those are different questions and
               only one of them is expensive to answer.
    Changed:   The plan's "Outstanding" list, which had grown into a mix of
               checks, decisions and things already fixed, is now two lists that
               answer different questions: **Deferred** (needs a cockpit,
               batch it) and **Open decisions** (needs a choice, not a
               simulator). Resolved items stay struck through rather than
               deleted, because "why is this not a problem any more" is a
               question a later session asks.

               One stale claim removed while restructuring: the tagged-`A:` note
               still said hints "lag up to a second, which matches
               `SimConnectPeriod.SECOND` plus Monaco's debounce". Both halves of
               that stopped being true — `A:` reads at `SIM_FRAME` now, and the
               hints are decorations rather than inlay hints. A note that
               explains a symptom nobody can reproduce any more sends the next
               person looking for a bug that was fixed two entries ago.
    Affects:   none

## 2026-08-23 — Stage 5, and a single-sink listener that would have silently killed the Log panel

    Stage:     5
    Expected:  the stage the plan describes — bottom panel, horizontal
               splitter, rail buttons, hotkey
    Found:     most of it already existed. 2c built the bottom slot, the
               horizontal splitter and the rail's bottom group *because Log
               needed them*, and left `BottomPanel = "log" | "activity"` in the
               store with a note saying Activity had no component yet. So a
               stage listed as four bullets was marks plus one panel.

               Worth noticing as a pattern rather than as luck: 2c was pulled
               forward out of order on the grounds that "a WASM module's only
               voice is a transport being written at the same time", and it paid
               for the layout of a stage three ahead of it.

               One real bug, and it is the kind that leaves no trace.
               `sim.onSimEvent` keeps a **single sink** — `emitEvent = sink` —
               so registering a second listener for Activity silently replaced
               the Log panel's. Nothing throws, nothing warns, and the symptom
               is that the simulator stops appearing in a panel nobody was
               looking at. Caught by reading the file rather than by running it;
               both consumers go through one call now, with a comment saying
               why.
    Changed:   `Anchor` carries its own `before`/`after` rather than sharing one
               pair of constants. A mark and an interaction are not the same
               question — 08-marks measures human reaction latency at 200–400 ms
               and gives a mark −3 s/+12 s, where an interaction is the
               simulator's own timestamp of a click and needs 600 ms — and
               folding both into one window would have meant a compromise that
               is wrong for both.

               A mark with an interaction inside its window produces no finding
               of its own, which is 08-marks' rule and reads as counter-intuitive
               until the reason lands: the mark has not been ignored, it has been
               *used*. It said which of the things you touched you meant, and the
               finding it points at is sharper than anything it could have
               anchored itself.
    Affects:   none

## 2026-08-23 — One burst rule, two callers, and two qualifiers only one of them needs

    Stage:     4
    Expected:  the Log panel to call stage 4's `inBurst` and be done — the plan
               says so, and warns that a second copy would drift
    Found:     the rule shares cleanly and the *application* does not.

               Sharing was easy once the predicate stopped taking an array.
               `inBurstAt(count, timeAt, keyAt, index)` is accessors, so
               Activity asks about input events and the panel asks about
               `LogEntry` rows, and neither owns the other's shape. What they
               share is a sentence — many *distinct* things at once is a machine
               — and a sentence is about two accessors wide.

               Then the panel needed two things the ranking does not, both found
               by a failing test rather than by thinking:

               **Being in a burst is a property of the neighbourhood, not of the
               entry.** A file-watcher line arriving during a 318-event snapshot
               is inside a window full of distinct things, so it is flagged too
               — and folding on the flag alone put it *inside* the snapshot row,
               where nobody would ever find it. For anchoring that is correct
               behaviour: an input event inside a snapshot is part of the
               snapshot. For a panel it hides the only readable thing in the
               2 ms. So a burst row is now a same-source run, and **warnings and
               errors are never folded at all**.

               **A run has to be long to be a burst.** Without a minimum the
               same neighbourhood effect turns one ordinary entry into a row
               reading "1 events at once".
    Changed:   The `TODO` in `log-filter.ts` is gone. A snapshot renders as one
               row saying how many events and how long they took, rather than
               `×318` — which is true of an identical run and a lie about a
               burst, since those 318 messages are all different and showing one
               of them names an arbitrary member as if it were the group.

               One existing test asserted the opposite — "leaves a 318-event
               burst as 318 rows" — and was right about the identical-collapse
               rule while being wrong about the panel. It documented the
               limitation; now it documents the fix.

               Incidental, and the **fourth** occurrence of a convention this
               repo already has written down: a `\\u0000` separator written
               through a shell heredoc collapsed into a literal NUL byte, which
               turned the source file binary. Fixed by removing the escape
               rather than re-escaping it — the separator is ` :: ` now, the
               same one `store.ts` uses for its watch key, and there is nothing
               left to collapse.
    Affects:   07-activity

## 2026-08-23 — Ranking works. The baseline has to mean "while nothing is happening".

    Stage:     4
    Expected:  filter out variables that change often, rank the rest by how
               close they are to the interaction
    Found:     it works — `L:Battery1Switch` first, both times the master is
               thrown, from 192 variables moving inside the window. But two
               things about it were not obvious until they were built.

               **The baseline is meaningless without the qualifier.** Measured
               over the whole stream, a knob turned 118 times in two seconds
               reads as 1.5 changes a second — ambient by any threshold that
               catches a heartbeat. The feature would have confidently discarded
               the single variable the user was asking about, and it would have
               done it most reliably for the controls people interact with most.
               So the anchor windows are cut out of both the numerator and the
               denominator: the rate is what the variable does when nothing is
               happening, which is the only thing "unusual" can be measured
               against.

               **Sorting on the raw offset made jitter tolerance into a
               preference.** The window opens 50 ms before the anchor to absorb
               the gap between two transports. Sorting ascending then ranked a
               variable that moved 3 ms *before* the control was touched above
               one that moved 30 ms after it — noise beating signal, by
               construction.

               That one is worth recording for how it was found: **not by a
               failing test.** The case with a known right answer is the battery
               master, whose effects land at +30 and +42 ms, and it happened to
               have nothing in its pre-window — so every test passed. It turned
               up in the printed shortlist for `ELECTRICAL_CIRCUIT_36`, which has
               no ground truth to check against and simply looked wrong. A suite
               that only exercises the case you understand will confirm whatever
               you already believe.
    Changed:   Built `src/shared/activity.ts` (contract, and every threshold
               with the measurement that set it) and `src/main/activity.ts`
               (anchors, baselines, findings). Anything before the anchor now
               sorts last and is never `direct`.

               Also `scripts/slice-capture.ts`, because none of this was
               testable otherwise: the only capture holding both real
               interaction and the `L:` stream is 93.6 MB. A 75-second window is
               1 MB gzipped and `readCapture` reads `.gz` transparently.

               Unplanned confirmation worth noting: `KNOBS_EVENT_NAVINSTR_KNOB`
               ranks `L:NavInstrLightSwitchPct` first. Nothing was tuned for it
               and it is correct.
    Affects:   07-activity

## 2026-08-23 — 195 variables change within 400 ms of an interaction. Proximity alone cannot rank.

    Stage:     4, before starting it
    Expected:  the first capture holding both input events and `L:` deltas to
               make stage 4's exit criterion straightforward — flip a switch,
               look at what moved next to it
    Found:     **195 distinct `L:` variables changed within ±400 ms of one
               cockpit interaction**, across 1,503 records. One anchor, 195
               candidates.

               The interaction was four input events at t=502.471 —
               `AS430_NAV1_VOLUME`, `AS430_COM1_VOLUME` and their AS530 twins,
               one knob reported four ways. What surrounds it is the whole
               simulator breathing: `p42_cp_motion_pause`, `FSDT_GSX_HEARTBEAT`,
               `InGameTime`, `Count2/3/4/10`, `C_WingFlapLeft`,
               `Battery1ChargeMax`. None of them has anything to do with a
               volume knob and all of them are equally "near" it.

               This is the earlier ranking finding arriving with a number
               attached. That entry said a variable moving constantly "is by
               definition never near anything in particular" and treated ambient
               demotion as a refinement of proximity. It is the other way round:
               **proximity is nearly worthless on its own, and the baseline rate
               is the primary signal.** A window that catches 195 candidates has
               not narrowed anything.

               What separates the answer from the noise is not when a variable
               moved but whether moving is unusual for it. The candidates above
               are the ones that change every tick regardless; the switch is the
               one that had been still for minutes.
    Changed:   Stage 4 leads with a per-variable baseline — how often this
               variable changes when nothing is happening — and ranks on
               departure from it. Proximity becomes the tie-break it always
               should have been.

               `sim_observation.changes` is already the right raw material and
               is already being written. The earlier entry demoted it to
               "binary: has this ever moved", which cut ~6,150 names to a few
               hundred; this needs the rate back, as a rate.
    Affects:   07-activity, 12-rules

## 2026-08-23 — Verified live: `L:` values in the editor, end to end

    Stage:     2b and 3, closing both
    Expected:  a list of things to check against a running simulator
    Found:     they pass. A profile's `L:` lines carry live values in the
               editor, in both start orders — editor first then MSFS, and MSFS
               first then editor — and they follow a control being moved by hand
               closely enough to watch.

               What it took, beyond the transport that already worked, was three
               fixes that no amount of replay would have surfaced, because every
               one of them is about *when* something happens rather than what:

               - the module walking the `L:` table before the aircraft that owns
                 most of it exists,
               - the module outliving the app, so a restarted editor found the
                 table already walked and heard nothing,
               - Monaco unsubscribing itself from the event that repaints hints.

               The first two are ordering against the simulator's lifecycle. The
               third is ordering inside a scheduler. None is reachable from a
               capture file, which is worth knowing about the limits of the
               harness: it makes *logic* testable without the sim and leaves
               *timing* exactly as untestable as it was.
    Changed:   Stages 2b and 3 are complete. Stage 4 is next and needs no
               simulator — it is logic over the captured stream, which is the
               half the harness does cover.
    Affects:   none

## 2026-08-23 — An aircraft's `L:` variables do not exist before the aircraft does

    Stage:     2b/3, from live values working for a handful of lines and no more
    Expected:  reseeding the module's `last` on `start` to be the whole of the
               "no values until something moves" problem
    Found:     it was half. The other half is that **the table is walked once**,
               and the walk happens at the wrong moment.

               `sendLinkCommand` was called exactly once in the entire app, with
               `start`, at connect — and the app connects the instant SimConnect
               answers, which is at the main menu with no aircraft loaded. Every
               `L:` a profile is actually about is registered when the aircraft
               loads, minutes later. The module never looked again, so those
               names had no ids, and `receiveValues` drops a value whose id it
               cannot resolve. Silently, and correctly, forever.

               Which is why it failed the same way in both directions of the
               "which did you start first" question. It was never about ordering:
               there is no order in which an aircraft's variables exist before
               its aircraft.

               The earlier measurement was sitting right there and had been read
               as a curiosity — 2,282 names on a freshly started sim against
               5,364 and 6,152 in longer-running ones, "the table fills in as
               add-ons wake up". That is not only add-ons. That is the aircraft.
    Changed:   The app re-enumerates on aircraft change, and again on connect.

               Not on a fixed delay. How long an aircraft takes to register its
               variables depends on the aircraft — an A2A with a WASM gauge
               stack against a default Cessna — on the machine, and on what else
               is loading; any constant is either too short for the aircraft
               that needed it or a wait for every aircraft that did not. So it
               walks, waits, walks again, and **stops as soon as two consecutive
               walks find the same number of names**. Backoff of 3/6/12/24
               seconds, capped — `L:` keeps growing for as long as a session
               runs, so "until it stops changing" without a bound is a walk
               every thirty seconds forever.

               Re-walking also fixed something the value store could not reach
               on its own: `enumerate` clears the module's `last`, so an aircraft
               change now replaces the previous aircraft's values instead of
               leaving them on screen looking live. That was a known limitation
               written down two entries ago and it turned out to be free.

               **No module change.** `enumerate` has been a command since 2b;
               nothing had ever sent it.
    Affects:   03-link, 09-live-values

## 2026-08-23 — `npm run link:build` silently ran under WSL. Third of its kind.

    Stage:     2b tooling, reported as "it doesn't do anything"
    Expected:  the script to work, or to say why not
    Found:     it worked from Git Bash and failed from PowerShell, which is
                where the person running it was.

               `"link:build": "bash link/build.sh"` looks portable. On Windows
               `bash` is whatever is first on PATH, and from PowerShell that is
               `WindowsApps\bash.exe` — **the WSL shim**. `build.sh` is a Git
               Bash script: `/c/Program Files/...`, `cygpath`, and the
               `cmd.exe //c` escape that exists only because MSYS rewrites a
               leading single slash.

               Under WSL each of those quietly did something else, and they
               compounded into the worst possible shape:

               1. No Windows environment is inherited, so `APPDATA` *and*
                  `USERPROFILE` were both empty — two fallbacks gone at once.
               2. The third fallback asks `cmd.exe`. `//c` arrived
                  uninterpreted, so cmd started **interactively** and printed
                  its banner.
               3. `roaming()` checked the answer for being non-empty and not
                  literally `%APPDATA%`. A banner passes both. **The banner
                  became the roaming path.**

               The error was `Could not locate the Community folder (tried
               Microsoft Windows [Version 10.0.26200.9168](c) Microsoft
               Corporation...)`. Nothing in it says "wrong shell", which is why
               it read as the command doing nothing.
    Changed:   Three fixes, one per layer, because any one alone leaves the
               trap:

               - `link/tools/bash.mjs` finds **Git Bash** and runs the script
                 under it, so the documented command works from any shell.
                 Located from `git` itself rather than `C:\Program Files\Git` —
                 this machine installs git with scoop, and the standard path
                 does not exist.
               - `build.sh` refuses to run unless `$OSTYPE` is msys or cygwin.
               - `roaming()` now requires its answer to be a directory. That is
                 the bug underneath the other two: a fallback that validates
                 *shape* rather than *plausibility* will accept anything.

               Verified through `npm run link:build` from PowerShell, not from
               bash — which is the standing rule here and is exactly what
               catching this depended on.
    Affects:   none

## 2026-08-23 — Monaco's inlay hints unsubscribe themselves after one update. Stage 3's freeze, found.

    Stage:     3, from `L:` values finally being watchable
    Expected:  the "hint appears once and then freezes" symptom to be ours —
               main going quiet, or the value store not firing
    Found:     it is Monaco's, and it is a bug in `InlayHintsController`.

               The controller subscribes to a provider's `onDidChangeInlayHints`
               from **inside its scheduler callback**, into a store it replaces
               at the top of every run — and `MutableDisposable`'s setter
               disposes what it replaces. Re-subscribing is guarded by a
               `watchedProviders` Set that lives for the whole session and is
               never cleared. So:

                 run 1   subscribes
                 value   arrives, the subscription fires, schedules run 2
                 run 2   disposes the subscription, sees the provider already
                         in the Set, and does not make a new one

               Nothing is listening from there. Hints freeze at whatever run 2
               drew and move again only on a scroll or a keystroke.

               That is exactly two updates, which is why it looked like "shows
               once then freezes" and why it survived stage 3: the `fired` and
               `asked` counters built to find it were measuring the right thing
               and would have shown `asked` flat — nobody had a live `L:` stream
               to watch them with.

               The measured latency budget, separately, was never the problem:
               module tick ≤66 ms, main's flush 250 ms, and Monaco's adaptive
               debounce clamped to [25, 625] ms — settling near 25, because
               `getLinesIn` runs in 0.23 ms on `pa24-250.yaml`. ~340 ms in
               total. The "multiple seconds" a user sees is the freeze, timed
               until they happen to scroll.
    Changed:   **Rendering moved off inlay hints entirely**, to injected-text
               decorations in `src/renderer/src/lib/live-decorations.ts`.

               There are ways to provoke the controller into rebuilding its
               session — the provider *registry*'s `onDidChange` is a different
               event that nothing disposes, so registering and disposing a
               throwaway provider re-arms it. It works, and it was written and
               then thrown away: owning the rendering is fewer moving parts than
               owning a workaround for somebody else's scheduler, and it puts
               the update rate under our control, which is the actual
               requirement. A person moving a control by hand in walkaround
               should see the line follow their hand.

               Two costs, both cheap, and both guarded: the file parse is cached
               against `getVersionId`, so an idle file is parsed once however
               many values arrive; and every model compares what it *would* draw
               against what is drawn, so a tab showing none of the changed
               variables does nothing at all.

               With the freeze gone the flush went 250 ms → **16 ms**. It was a
               readability throttle, which is a real concern for a *number* and
               the wrong concern for a control surface being dragged. Its only
               remaining job is merging the chunks of one 15 Hz module tick into
               one IPC message, and a frame is smaller than the tick it merges,
               so it adds no latency of its own.
    Affects:   09-live-values

## 2026-08-23 — `L:` live values: one value store, or two transports erasing each other

    Stage:     2b/3
    Expected:  routing `L:` to the editor would be the one-line change stage 3
               predicted — `watchSimVars` stops filtering to `A:`
    Found:     the filter was the easy half. `emitValues` sent only the values
               from the message that had just arrived, and the renderer replaces
               its map wholesale on receipt — so a second transport emitting its
               own news would have meant `A:` and `L:` **taking turns erasing
               each other's hints**, once a second.

               Three more things fell out of it, none of them in the design:

               **Every `L:` has to be kept, not only the watched ones.** The
               module sends deltas, so a switch nobody has touched since
               enumeration never reports again — and those are precisely the
               lines somebody writing a profile is looking at. It works because
               the module seeds `last` with NaN, so the first tick after
               enumeration reports all ~6,150; keeping them costs a map of
               numbers and means opening a file shows values immediately.

               **Units are the request, not the wire.** The module reads raw, so
               a value is labelled with whatever unit the `get:` line asked for.
               Measured before deciding rather than assumed: of 19,977 `L:`
               `get:` lines in the corpus, **74% carry no unit at all**, and of
               the 5,345 that do, 99.7% are `Number`, `Bool`, `Percent` or
               `Enum`. The genuinely converting units — `Fahrenheit`, `Mhz`,
               `degrees`, `Position16k`, `ft/min` — total **17 lines**, 0.085%.
               So raw is right almost everywhere, and passing the request
               through is what lets `Bool` render as a boolean. Making those 17
               exact needs the module to read per-unit, which is a protocol
               change and not worth it.

               **A watch set is not a subscription.** `L:` needs nothing asked
               of the module — it streams everything that moves to anyone
               listening — so watching is a question of what to forward. Which
               is why the watch set is recorded *before* the connection check,
               and survives a disconnect.
    Changed:   `src/main/sim/live-values.ts`, 13 tests. `live.watching` stays
               `A:`-only and separate from it, because those indices *are* the
               datum ids `tagged.ts` resolves against and cannot gain entries.
    Affects:   09-live-values

## 2026-08-23 — A fixture that claimed to hold real variable names held one

    Stage:     3, trying to develop `L:` hints against replay
    Expected:  `link-session.ndjson` to light up `pa24-250.yaml`, its README
               saying "the names in it are real `L:` variables from
               pa24-250.yaml"
    Found:     four of its five names do not exist in that profile —
               `AdfOnOffKnob` for the real `AdfOnOffKnobVolume`, and three
               invented outright. The one fixture built to exercise `L:` live
               values could light **one line out of 295**, and its README said
               otherwise.

               A hand-written fixture that asserts its own fidelity in prose is
               a fixture whose fidelity nothing checks.
    Changed:   Generated instead, by `scripts/make-link-fixture.ts`, which reads
               the names out of the profile — 279 real variables, all enumerated
               before any value, chunked the way the wire chunks. Reading them
               from the source makes the mistake impossible rather than merely
               unlikely, which is the same argument as hashing the module
               instead of trusting its version string.

               Also fixed, in passing: `values.test.ts` mirrored `startSim`'s
               replay branch by hand "so that if the real one changes shape,
               this test should be the thing that notices". The branch was
               rewritten and it noticed nothing, because the comment justifying
               the copy — that `session.ts` cannot be imported under vitest —
               had stopped being true. It drives the real `startSim` now.
    Affects:   none

## 2026-08-23 — `Connecting…` was permanent, and the state should not have existed

    Stage:     2b, reported from use
    Expected:  the chip settles to `Sim offline` when MSFS is not running
    Found:     it said `Connecting…` indefinitely, across an app restart, with
                the simulator closed.

               `simState` read `running ? "connecting" : "offline"`, and
               `running` means **the retry loop is alive** — set by `startSim`
               and cleared only by `stopSim`. So it is true from launch until
               quit. `Connecting…` was therefore the state of every session that
               had not reached MSFS, and `offline` — the one 04-connection calls
               the ordinary condition of this app — was reachable only after the
               app had begun shutting down, or when `node-simconnect` failed to
               load at all.

               Pre-existing, and older than the install flow: the same
               expression is in the stage 2 commit. It survived because every
               session that verified the chip had the simulator running, which
               is the one configuration where the bug cannot appear.
    Changed:   **`connecting` is deleted from `SimState`**, not repaired.

               Repairing the condition would have meant finding a truthful
               reading of "an attempt is in flight", and there is not one worth
               rendering. The client is always trying — that is why there is no
               `simConnect()` in the API — so the phase is true almost always
               and interesting never. The single moment it could describe
               honestly is the few milliseconds a local socket takes to refuse a
               connection, which is a flicker, not information. The app also
               cannot distinguish "MSFS is closed" from "MSFS is open and
               SimConnect refused"; both are ECONNREFUSED. Claiming to be
               *connecting* in the second case is a guess.

               Removing it from the union rather than from the branch is what
               keeps it gone: the state cannot come back by accident, because
               nothing can construct it.

               Worth noting for the next one of these: a status state that is
               derived from whether a **background loop is running** rather than
               from what that loop has **achieved** will always read like this.
    Affects:   04-connection

## 2026-08-23 — The update prompt should not exist. And "I cannot tell" is not "stale".

    Stage:     2b, from looking at the built dialog
    Expected:  04-connection's fifth state as written — a module older than the
               editor expects "offers an update rather than failing silently"
    Found:     the offer is the part that does not survive contact with a user.
               Nobody can evaluate what changed inside a WASM module. The only
               answer that ever makes sense is yes. A question with one right
               answer is not a question, it is a chore with a dialog around it.

               The same screen also had a **"Reinstall" button on a package that
               was already correct**, which is a button offering to redo
               finished work — and its only real effect is to make somebody
               wonder whether the work is finished.

               Separately, and worse: a build with no package of its own
               reported the installed one as **"needs updating"**. `current` was
               a boolean, and `shippedHash === null` collapsed into `false`, so
               "there was nothing to compare against" and "these differ" became
               the same answer. Telling somebody their software is stale is a
               claim, and that one was made on no evidence.
    Changed:   `updateStaleLinks` runs at startup and replaces any installed
               package that differs from the one we ship, without asking, and
               writes a log line instead of opening a dialog. Two limits keep it
               from being presumptuous, and both are about restraint: it **never
               installs where nothing is installed** — the first write into
               somebody's game install stays their decision — and it **never
               acts on `unknown`**.

               `InstalledPackage.current` is now `"same" | "different" |
               "unknown"`. The tri-state is the fix for the badge and the
               precondition for auto-update being safe; as a boolean, the
               unknown case would have overwritten a perfectly good install on
               no evidence.

               The decision is a pure `staleFolders(state)` so it can be tested
               without the composed version, which reads the machine's real
               `UserCfg.opt` — a test of that would be a test that rewrites the
               user's actual Community folder. Five tests, four of them about
               what it declines to do.
    Affects:   04-connection

## 2026-08-23 — The folder picker was asking a question we already knew the answer to.

    Stage:     2b, from looking at the built dialog
    Expected:  04-connection's "offer what was found, let the user override"
               meant a list of candidates to choose from
    Found:     on a real machine it renders as two near-identical 90-character
               absolute paths differing four characters from the end, presented
               as the first decision in the flow. The user has no information
               with which to choose. We do: discovery read `UserCfg.opt`, which
               is authoritative, and the sort already knows which folder holds
               the module.

               "Offer" and "list" are not the same thing. `detect.ts` lists
               because its candidates come from guessing — a process list, a
               shortcut, a folder scan — and which guess paid off is genuinely
               worth seeing. This is not guessing.
    Changed:   The folder is **proposed on one line, with `Change`**, and the
               picker opens at what was proposed rather than at the drive root.
               The sort is now deliberate rather than incidental: where the
               module already is, then plain `Community` over `Community2024` —
               MSFS 2024 scans both, and `Community` is the one this module has
               been observed working from, which beats a guess about where a
               2024-SDK module belongs.
    Affects:   04-connection

## 2026-08-23 — The chip was a readout pretending to be a status indicator

    Stage:     2b
    Expected:  `Sim · pa24-250` with an `L:5364` badge is a useful footer
    Found:     it is a panel compressed into a status bar. The aircraft key and
               the variable count are data, they each want a surface with room
               to say what they mean, and neither changes what the user would do
               next — which is the only thing a status indicator is for.
    Changed:   The chip reports one of five states and nothing else. The aircraft
               and the enumeration get dedicated elements later.

               Also introduced `--sim`, a second feature hue taken from the MSFS
               logo (`#11b5f4`, `oklch(0.728 0.148 233)`). It lands almost
               exactly on the dark-mode slot of the existing `--remote` scale, so
               dark mode uses the brand value verbatim and light mode walks the
               same hue down to remote's lightness — the surface and border roles
               keep remote's proportions, so this stays one system with two hues
               rather than two palettes. Everything the simulator owns wears it;
               Remote Connect keeps the violet.
    Affects:   15-ui-surfaces

## 2026-08-23 — The install flow. Four chip states are two independent facts, not four phases.

    Stage:     2b, the install flow
    Expected:  add two more `SimState` phases for 04-connection's two install
               states, next to `offline`, `connecting` and `live`
    Found:     they are not phases. "Is a module installed" is a fact about the
               filesystem and "are we connected" is a fact about a socket, and
               the four states in 04's table are the product of the two rather
               than five points on one axis. Modelling them as phases means the
               connection states have to carry install information anyway —
               `live` with no module is `Connect to sim`, not `Sim · <aircraft>`
               — and every transition then has to decide which axis it is
               moving on.

               So `installed` rides alongside the phase:
               `{ installed: boolean } & ({ phase: "offline" } | …)`, which is
               the shape `CapturedEvent` already uses for `t` and `via` and for
               the same reason — one axis per question.

               A third fact turned out to be needed too, and it is the one the
               design does not mention. **"Sim running, module silent" cannot be
               read directly off `link === null`**, because that is also true
               for the first moment of every connection: the module answers
               `start` within a frame or two, and a chip reading the flag
               directly would show `Restart sim` to somebody whose module is
               about to say hello. It needs a grace window, which is now three
               seconds and a timer on the live session — deliberately two orders
               of magnitude more than the reply takes, because the cost of
               waiting is a correct message arriving late and the cost of not
               waiting is telling somebody to restart their simulator for
               nothing.
    Changed:   `SimState` gains `installed` at the top level and `silent` on the
               live variant. Built `src/shared/link-install.ts` (the contract and
               the `UserCfg.opt` parser), `src/main/sim/install.ts` (discovery,
               install, uninstall), `install.test.ts` (19 tests), the dialog, and
               the four chip states.
    Affects:   04-connection

## 2026-08-23 — Uninstall would have deleted somebody else's scenery. Community is full of junctions.

    Stage:     2b, the install flow
    Expected:  removing the package is `fs.rm(target, { recursive: true })`
    Found:     04-connection's warning — "follow junctions when checking whether
               Link is already installed, and do not assume the folder is a
               plain directory of real subfolders" — is not hypothetical on this
               machine. `Community` holds 60-odd packages and **two of them are
               junctions into `Program Files (x86)`**, both from Pilot
               Experience Sim.

               Nothing stops `fsc-editor-link` being one of them. AddonLinker
               farms work exactly this way, and a developer pointing Community
               at `link/Packages/` with a junction is a setup somebody would
               reasonably build. Recursing into one to uninstall would delete
               the other end — a real package, somewhere the user never told us
               about.

               `fs.rmdir` on a Windows directory junction removes the reparse
               point and leaves the target alone. Node reports junctions as
               symlinks through `lstat`, so the two cases are distinguishable
               before anything is removed.

               Install has the same hazard from the other direction: copying
               into a junction writes *through* it, so a reinstall would
               silently modify whatever it points at.
    Changed:   One `removeEntry` used by both paths: `lstat` first, `rmdir` a
               link, recurse only into a real directory. Install replaces a
               junction with a real folder rather than writing through it.

               Three tests cover it, and they create real junctions rather than
               mocking `fs` — a mock would agree with whatever the
               implementation believed. They skip where symlink creation is not
               permitted (Windows wants Developer Mode or elevation) rather than
               passing vacuously; on this machine they run.

               Install also **replaces rather than merges**, for an unrelated
               reason worth recording: MSFS reads `layout.json`, which lists
               every file with its size, so a file left behind from an older
               build is not inert — it is a package the simulator considers
               corrupt.
    Affects:   none

## 2026-08-23 — Two version numbers for one package, and neither is trustworthy

    Stage:     2b, the install flow
    Expected:  compare the installed `package_version` against the one we ship
               to answer "is this the current build?"
    Found:     there are two versions and they already disagree. The manifest
               says `0.0.1`, from `AssetPackage Version` in
               `PackageDefinitions/fsc-editor-link.xml`; the module says `0.1.0`
               on the wire, from `k_version` in `module.cpp`. Same artifact.

               Neither is wrong exactly — they were bumped independently and
               nothing has ever compared them — but it means a version string is
               a statement about whether somebody remembered, not about what is
               on disk.
    Changed:   install compares the **module's bytes**, sha256 of
               `modules/fsc-editor-link.wasm`, shipped against installed. A hash
               cannot be forgotten during a release. The version string is still
               shown, because it is what a user would quote back, but nothing
               decides on it.

               This paid for itself immediately: running discovery against this
               machine reported `current: true` for the package `link:build`
               installed weeks ago, which independently confirms the copy now
               committed under `link/Packages/` is byte-for-byte the one that
               produced every capture in `fixtures/`.

               Left alone deliberately: unifying the two numbers needs a
               rebuild, which needs the SDK and a closed simulator. It is worth
               doing, and it is not worth doing at the cost of a hand-edited
               build artifact that no longer matches what a rebuild would
               produce.
    Affects:   none

## 2026-08-23 — `link/Packages/` is committed. No runner can ever rebuild it.

    Stage:     2b, the install flow
    Expected:  an open question, flagged in the plan as "if the built package
               should be committed so the app's CI never needs the SDK, flip it"
    Found:     it is not really a trade. The install flow copies a finished
               package into a Community folder, so the app has to *carry* one,
               and the module cannot be built anywhere but a maintainer's
               machine — the SDK has no unattended install and `fspackagetool`
               drives the game executable. A package built by hand is the only
               package there will ever be, so it is source in every sense that
               matters to the build.

               It is 302 KB and three files.
    Changed:   `link/.gitignore` no longer excludes `Packages/`, with the
               reasoning written where somebody would go to re-exclude it.
               `electron-builder.yml` ships it through `extraResources` to
               `resources/link/fsc-editor-link` — outside the asar, because
               installing means copying it out and MSFS cannot read an archive.

               One bug came out of resolving that path, and it is the kind worth
               naming: the checkout fallback originally counted `..` up from
               `import.meta.dirname`, which is `src/main/sim/` under vitest and
               `out/main/` in a build. **Any fixed number of levels is wrong for
               one of them**, and the tests could not have caught it — they run
               unbundled, so they exercise the layout that happened to work. It
               walks up looking for the folder now.
    Affects:   none

## 2026-08-23 — The `A:` read crashed the app. Positional reads were the wrong shape.

    Stage:     3, found in use
    Expected:  the watch list and the data definition are the same length, so
               reading one `float64` per watched variable is safe
    Found:     they are not, and it took down the main process:

                 RangeError: Illegal offset: 0 <= 476 (+8) <= 476
                   at RawBuffer.readFloat64

               One read past the end of a real message.
               **`addToDataDefinition` for a variable the simulator does not
               have is rejected asynchronously.** The entry never joins the
               definition, nothing throws where it was added, and the watch list
               still counts it. So the message carries fewer values than the
               list expects, and the loop walks off the end.

               `pa24-250.yaml` is the likely source — its twelve `A:` entries
               include several 2024 wear variables that may not exist on every
               build.
    Changed:   Requesting **tagged** data (`DATA_REQUEST_FLAG_TAGGED`), with the
               watch-list index passed as each entry's datum id. Every record
               now says which variable it is.

               Bounding the positional read would have stopped the crash and
               left a worse bug in place. A rejected entry in the *middle*
               shifts every value after it onto the wrong variable — wrong
               numbers that look entirely plausible, on a feature whose whole
               job is showing numbers. Tagging removes the assumption rather
               than guarding it.

               The reader moved into `src/main/sim/tagged.ts` with 8 tests,
               because it crashed while being a closure inside a connection
               handler that nothing could reach. One test is the failing message
               itself; another is the middle-gap case, which is the one that
               would never have announced itself.

               A second lesson, cheaper to state than it was to learn: this is
               the third bug in this project that only appears with a real
               simulator attached, and the second that a fixture would have
               caught if the code had been reachable from one. Reachable beats
               careful.
    Affects:   09-live-values

## 2026-08-23 — Change count is the wrong ranking signal. Two clocks are 88% of the stream.

    Stage:     2b, from the first real stream
    Expected:  "how often a variable changed on this aircraft" would be a
               reasonable strength for the `in sim` ranking signal
    Found:     it would rank clocks first. Four minutes of a live PA-24, 5,739
               change records across 428 distinct variables:

                 id 106   3514 changes   (essentially every tick)
                 id 102   1499
                 id 537      9
                 id 528      6
                 ...
                 418 of 428 variables changed once or twice

               **The top five ids are 87.7% of every record**, and the two
               leaders increment monotonically — 63848, 63850, 63852 and
               29518.2751, 29518.3753 — which is what a clock or a frame counter
               looks like, not a control.

               So the variables a profile author actually cares about are the
               ones in the *long tail*: the switch you flipped twice. Ranking on
               raw frequency would bury every one of them under a counter.
    Changed:   `sim_observation.changes` stays — it is cheap and it is real
               evidence — but it is not a magnitude to sort by. What the ranking
               wants from it is closer to **binary**: has this variable *ever*
               moved on this aircraft. That alone cuts ~6,150 enumerated names
               to the few hundred an aircraft actually touches, which is the
               reduction that matters.

               Beyond binary, the useful refinement is stage 4's, not a counter:
               a variable that moved *near an anchor* is interesting, and one
               that moves constantly is by definition never near anything in
               particular. 07-activity already calls that ambient and demotes
               it — this is the same rule arriving in the ranking, and the
               measurement says it is not a nicety.

               A frequency signal is still worth keeping for the inverse use:
               something changing every tick is a good candidate to *hide*.
    Affects:   06-variables-panel, 07-activity

## 2026-08-23 — The module streams, and a second client got no enumeration

    Stage:     2b
    Expected:  the rewritten reader would either connect and see the stream, or
               fail because the module was not running
    Found:     it connected and the module was streaming — `hello: 0.1.0 1 2282`
               and live deltas, so the whole wire works end to end for the first
               time. And the transcript had **zero `names:` lines**.

               The app was already running. It had connected first, sent
               `start`, and consumed the enumeration; the module's `start`
               branch read `if (names.empty()) enumerate()`, so with the table
               already walked it set no `names_pending` and sent nothing but a
               hello. There is one output area and every client reads all of it,
               so the reader arrived to a stream of ids it had no way to decode.

               It would not have shown up with one client, which is the only
               configuration the design imagined.

               Incidental, and consistent with the earlier churn finding: 2,282
               variables on a freshly started sim, against 5,364 and 6,152 in
               longer-running sessions. The table fills in as add-ons wake up.
    Changed:   `start` now always re-sends the names, enumerating only if the
               table has never been walked. Re-sending costs the first client
               nothing — the inserts are idempotent and names by id do not
               change.

               This is the first thing the standalone reader has caught that the
               app could not, which is most of the argument for keeping it. The
               app *tolerates* the bug: `receiveValues` drops values whose id is
               not in its enumeration, so it would have run quietly and stored
               less than it should.
    Affects:   none

## 2026-08-23 — Sim evidence lands in the database. Replay deliberately does not.

    Stage:     2b
    Expected:  write `sim_variable` and `sim_observation` as the module's events
               arrive
    Found:     two decisions in it that were not obvious until the code existed.

               **An aircraft change has to flush first.** Changes accumulate in
               memory and a swap arrives as just another event, so without a
               flush at that moment everything the Piper did would be credited
               to the Baron. That column is the entire reason the table exists —
               it is what `in sim` will mean — and getting it wrong would not
               fail, it would quietly teach the ranking something untrue.

               **A replay writes no evidence.** Replaying one capture twenty
               times would inflate every change count twentyfold, and
               `sim_observation.changes` is meant to say how often a variable
               really moved. So the replay path emits without observing, which
               is the one place the "replay reuses the real path" rule is
               deliberately broken — and it is commented as such at the seam.

               Changes seen before any aircraft is known are dropped. There is
               nowhere truthful to put them, and inventing an aircraft would be
               worse than the loss.
    Changed:   `src/main/sim/store.ts`, batched at 5 s. Nothing reads these
               tables during a session — they feed completions on a later
               launch — so latency costs only what is lost to a kill, and a few
               seconds of "this variable moved" is not worth fsync pressure. It
               never throws: bookkeeping on a background timer is not a reason
               to take down a working session.

               13 tests, the sharpest being that a previous aircraft's changes
               do not follow the next one.

               Also fixed: `sim-sandbox --print` **silently skipped 304 events**
               of the new kinds, because its switch had no default. The same
               omission in `ipc.ts` was a compile error, because that switch
               returns a value. It now ends in `const unhandled: never = event`,
               so the next event kind is a compile error there too.
    Affects:   05-data-model

## 2026-08-23 — Stage 2b: the module streams. Transport built, untested against the sim.

    Stage:     2b
    Expected:  a build rather than an investigation, since 2a and three sim
               sessions had answered everything that gated it
    Found:     it was. The only surprise was a compiler one: dropping
               `MSFS/Legacy/gauges.h` — no longer needed, since the modern var
               API replaced every legacy call — also dropped `DWORD` and
               `HANDLE`, which `SimConnect.h` assumes and does not include for
               itself. Fixed by including `MSFS_WindowsTypes.h` directly.

               Worth recording because of how it nearly passed: `check.mjs` ran
               against the *previous* `.wasm`, which was still on disk after the
               failed compile, and reported all twelve exports present. A build
               step that validates a stale artifact is a build step that lies.
               The rebuild now deletes the output first.
    Changed:   Built:

               - `src/shared/link.ts` — the wire format, and the parsers for it.
                 Text records rather than a binary struct, because volume is
                 bounded by what actually moves and a malformed *readable*
                 message beats plausible binary garbage. The format is written
                 out twice, here and in the module, since a wasm translation
                 unit and a vite bundle cannot share a header — so the two
                 agreeing is a thing tests have to enforce.
               - `link/src/module.cpp`, rewritten from the spike. Enumerate
                 once, cache ids, read every one by id at 15 Hz, send only what
                 moved past a 1e-6 deadband. Values read with
                 `FS_INVALID_UNIT`: the module has no idea what unit a given
                 profile asked for and would be guessing, so conversion happens
                 app-side where the entry is known.
               - `src/main/sim/link.ts` — the app's half, kept out of
                 `session.ts` so that the module's absence stays one branch
                 rather than a condition in every function there.

               Three details that came out of the earlier findings rather than
               from the design:

               **`last` is seeded with NaN**, so the first tick after
               enumeration reports every variable. Both deadband comparisons are
               false against NaN. Without it an app connecting mid-flight would
               see only what happened to move afterwards.

               **The init hello is not the handshake.** The module leaves one in
               the area at load so a late client can tell "not running" from
               "running but silent" — the distinction that cost two sim
               restarts. It names zero variables, so the app ignores it for
               announcement and waits for the reply to `start`.

               **The chip shows the module only when present.** Its absence is
               the ordinary state and everything works without it, so a badge
               saying "not installed" would be a permanent complaint about
               something most people have not chosen to install.

               19 tests over the protocol, including six malformed shapes: this
               area is writable by any SimConnect client, so a message we do not
               understand must cost one dropped read rather than the connection.
               Not yet done in 2b: writing `sim_variable` / `sim_observation`,
               and the install flow from 04-connection. Nothing has run against
               the simulator either — the module compiles, exports what MSFS
               needs and is installed, but no message has crossed the wire.
    Affects:   none

## 2026-08-23 — UI convention: shadcn everywhere, icon buttons for panel actions

    Stage:     2c, by correction
    Expected:  a native `<select>` and `<input type="checkbox">` were fine for a
               diagnostic panel, and `variant="link"` text buttons were an
               acceptable placeholder for clear/close
    Found:     neither is. Every control in this app comes from shadcn, and the
               Log panel was the only thing reaching around it. Native controls
               also ignore the theme completely, which shows the moment the
               window is dark.

               `variant="link"` is unfinished scaffolding rather than a style;
               panel actions are icon buttons, as the Profiles panel's rescan
               button already was.
    Changed:   `select`, `input`, `checkbox` and `toggle` added via
               `npx shadcn@latest add` — the project was already configured, and
               the CLI touched no dependencies and no CSS. The Log panel now uses
               `Toggle` for the source chips, `Select` for the level, `Input` for
               search, `Checkbox` for collapse, and ghost icon buttons for clear
               and close.

               Left alone deliberately: the search fields in `variables/`,
               `remote-connect/file-list.tsx` and `code-input.tsx` are bespoke by
               design — inline icons, their own clear buttons — and predate this.
               Converting them would be a redesign, not a correction.

               The standing rule: check `components/ui/` first and **add what is
               missing** rather than approximating it.
    Affects:   15-ui-surfaces

## 2026-08-23 — Units measured: 2.8% of `L:` variables have one. Not worth building for.

    Stage:     2b
    Expected:  unknown — the probe existed precisely to decide whether unit
               derivation was worth building, before building it
    Found:     **it is not.** Of 1,200 non-zero variables probed on the PA-24:

                 ~1010  native unit is `number`
                    23  genuinely dimensioned — gallons 6, feet 4, degrees 4,
                        mhz 4, knots 3, celsius 1, fahrenheit 1
                    11  dimensioned, unit outside the candidate list
                  ~156  no conversion under any unit at all

               So 34 in 1,200 — **2.8%** — carry a real dimension, and it is
               measured on a biased sample: 4,443 variables sat at zero and were
               undeterminable, because zero is the same number in every unit.

               The probe's own headline, "1044 carry a unit", is wrong and worth
               recording as a trap. It counted any variable where *some*
               candidate disagreed with the native read — but MSFS will convert
               a dimensionless number into `percent` or `radians` quite happily,
               so nearly everything trips that test. The signal was in which
               unit matched *first*, not in whether any disagreed.
    Changed:   **No unit-derivation machinery in 2b.** The measurement was the
               point of the exercise and it says the payoff is small: 97% of
               variables are `Number`, which is exactly what the corpus already
               defaults to. Building a candidate search into the product would
               be machinery for one variable in forty.

               What stays, because it is nearly free: `sim_variable.units` and
               `units_confirmed` are already in the schema, and 2b reads values
               anyway — so a variable can be checked against `number` alone when
               it happens to be non-zero. One extra read, not a search. Where
               they differ, that is the whole finding, and it is exactly the
               264× case that started this.

               **Autocomplete keeps doing what the corpus does** — omit the unit
               for `L:`, which 73% of real lines do. The earlier plan to lead
               with the sim's unit was based on the corpus being weak evidence;
               it is, but the sim agrees with it 97% of the time, so there is
               nothing to correct.

               The one case worth surfacing is the 2.8%: a profile writing
               `Number` where the sim says `gallons` is worth *showing*, still
               not worth rewriting.
    Affects:   06-variables-panel — the unit half of it, now decided small

## 2026-08-23 — Two Windows-environment traps in one build script

    Stage:     2b, build tooling
    Expected:  after the `${VAR:-}` guards, `link:build` would find the
               Community folder anywhere
    Found:     it found `/home/<user>/AppData/Roaming/...`, which has never
               existed. Git Bash can be started with a POSIX-style `HOME`
               unrelated to the Windows profile, and the fallback chain trusted
               it — a guess dressed as an answer.

               Asking Windows instead hit the second trap. `cmd.exe /c "echo
               %APPDATA%"` returns cmd's *banner*, because MSYS rewrites a
               leading single slash as a drive path, so the argument arrives as
               `C:/c` and cmd opens a shell rather than answering. `//c` is the
               escape.
    Changed:   The chain is now `FSCE_COMMUNITY` -> `APPDATA` -> `USERPROFILE` ->
               ask cmd -> derive from `USERNAME`, and it is verified by running
               the script with `APPDATA` and `USERPROFILE` stripped and `HOME`
               set to the POSIX path, which is the shape that actually failed.

               Both of these were only reachable through `npm run` from
               PowerShell. Testing bash directly — which is what I had been
               doing — has a different environment, and that is the second time
               that gap has produced a broken script. Exercise the documented
               command, not the convenient one.
    Affects:   none

## 2026-08-23 — Migration 2 applied. The corpus confirms the units prediction.

    Stage:     2b
    Expected:  a full rescan would populate `units_explicit` roughly as the raw
               file scan predicted — 5,389 written, 14,656 defaulted
    Found:     5,389 written, 14,655 defaulted, out of 25,622 corpus rows.

               The single row of difference is the raw regex counting a line the
               grammar does not treat as an entry. The grammar is the authority
               and one row in twenty thousand is noise, but it is worth knowing
               the two counts are not identical: a regex over lines and a fold
               over the grammar disagree slightly, and the grammar wins.

               So **73% of the corpus's `L:` units are defaults nobody chose**,
               now recorded as such rather than indistinguishable from a
               decision.
    Affects:   none

## 2026-08-23 — The corpus barely knows what units are. Schema migration 2.

    Stage:     2b, preparation
    Expected:  corpus consensus would be a reasonable default for a variable's
               unit in completions
    Found:     there is almost no consensus to consult. Across the corpus's
               20,045 `L:` get-lines:

                 14,656 (73%)  carry no unit at all
                  5,389 (27%)  write one, and 4,450 of those write
                               "Number", "number" or "Bool"

               Genuinely dimensioned units — Percent, Position 16k, Fahrenheit,
               Mhz, FT, degrees, Enum — total about **90 rows in 20,000**.

               So the `Number` on 18,000 stored rows is overwhelmingly *the
               absence of a decision*, produced by `splitUnits` defaulting when
               there is no comma. Treating that as evidence would be ranking
               silence as though it were a choice.

               Checked and cleared along the way: the grammar does strip
               trailing comments before the value is split, so `Bool # TQ TOGA 1`
               is not becoming a unit. A first pass with a cruder regex
               suggested it was.
    Changed:   **Migration 2**, three things.

               `corpus_entry.units_explicit` records whether the profile wrote
               the unit or left it out — indistinguishable afterwards, and very
               different evidence. Existing rows predate the column and would
               all claim "defaulted", so the migration clears `profile_file` and
               `corpus_entry` to force one full rescan. Verified against a copy
               of the real database: v1 to v2, 25,622 rows cleared, both new
               tables present.

               `sim_variable` — evidence from the simulator, keyed on the
               variable and **nothing else**. No workspace, and no aircraft:
               enumeration returns the same names whichever aircraft is loaded,
               so an aircraft column would be a lie repeated 6,150 times.

               It carries `units` and `units_confirmed`, which is three states
               rather than two — unconfirmed is not "no unit", it is "nobody
               could look". A variable sitting at zero reads the same in every
               unit, so most will start unconfirmed and become determinable only
               when they move.

               `sim_observation` — keyed on variable **and** aircraft, because
               that half genuinely is per aircraft. It is what `in sim` means
               now that the sim will not name an aircraft's variables.
    Affects:   05-data-model

## 2026-08-23 — The `L:` table is global. `in sim` becomes observation, not enumeration.

    Stage:     2b
    Expected:  changing aircraft would remove the outgoing one's `L:` variables
               and add the incoming one's, making the aircraft's set recoverable
               from the table
    Found:     it does neither. Snapshot on `pa24-250`, delta on
               `bksq-aircraft-baronpropress`:

                 6149 names -> 6152 names
                 ids stable for the first 6149 of 6149
                 3 appeared   (L:s2458, L:s2458_p, L:s2458_v — sound vars)
                 0 disappeared

               The Piper's variables did not leave **and the Baron's did not
               arrive** — they were already there. That is the whole finding:
               the table is global and pre-populated from every installed
               package, which is why `A320_FC_L_SPLR_4`, `PMS50_*` and
               `TDSGTNXI*` were sitting in it while a Piper was loaded.

               So there is no runtime signal for "this aircraft's variables".
               Not from enumeration, not from removal, not from the change
               notification — which fired 15 times and told us only that
               *something* moved.
    Changed:   `in sim` stops meaning "declared by this aircraft" and starts
               meaning **"observed to move while this aircraft was loaded"**.

               That is not a consolation prize, it is closer to the point. The
               product's question is which variable a switch moves, and a
               variable that never changes on an aircraft cannot be the answer
               to it. An observed set is evidence; a declared set is a claim.

               It also costs nothing extra. The module already diffs everything
               each tick — 03-link's reason for reading by id rather than
               through calculator code — so the observation falls out of work
               already being done. The stable ids found in the same run are what
               make that affordable: cache the id, never re-resolve the name.

               **The enumerated list is not merely a watch set.** An earlier
               draft of this entry said it was, and that was wrong. All ~6,150
               names go into the database as variables *confirmed to exist in
               the simulator*, which is what completions have wanted since stage
               1 — the corpus can only offer what somebody already wrote down.
               Volume is not the problem it looks like: ranking decides what
               surfaces first, and `in sim` is one more signal feeding that
               ranking rather than a gate on what is stored.

               Evidence-per-source in 05-data-model already has somewhere to put
               it, keyed by aircraft.

               **Static analysis does not need to come forward.** It remains the
               answer to the cold-start case in 13-report — a newly bought addon
               nobody has flown yet — which is a different question from the one
               `in sim` asks.
    Affects:   02-namespaces, 06-variables-panel, 03-link

## 2026-08-23 — `L:` ids are stable, and nothing is ever removed

    Stage:     2b
    Expected:  a snapshot / aircraft-change / delta would show the outgoing
               aircraft's variables disappear and the incoming one's appear,
               isolating a set that enumeration alone cannot
    Found:     two things, one solid and one that may kill the approach.

               **Ids are stable.** `ids stable for the first 6120 of 6120` —
               nothing shifted, and the new names were appended at the end. So
               the module can cache an id and read by it in the diff loop rather
               than re-resolving names every tick, which at 10-20 Hz over
               thousands of variables is the difference between affordable and
               not.

               **Nothing was removed.** `11 appeared, 0 disappeared`, and the
               eleven were `s222`, `s2450` and `PMS50_AUTOPILOT_VNAV_*` — a GTN
               avionics unit waking up, not an airframe.

               The reading is ambiguous and the transcripts cannot settle it:
               the two runs are 52 seconds apart, which is tight for an MSFS
               aircraft change. If the aircraft did change, the delta approach
               is dead — nothing is torn down and the incoming set did not
               appear either. If it did not, this is ordinary background churn
               and says nothing about aircraft at all.
    Changed:   The reader now stamps each transcript with the loaded aircraft
               and the command, from its own SimConnect connection. That
               ambiguity was avoidable and cost a sim session; a transcript
               should say what it is a transcript *of*.

               Transcripts are also written to `link/transcripts/` rather than
               only stdout. The first snap/delta pair was lost to terminal
               scrollback, which is a poor resting place for evidence in a
               project whose whole discipline is putting evidence on disk.

               If removal really never happens, the consequence is larger than
               one experiment: the `L:` table accumulates every aircraft loaded
               in a session, so "this aircraft's variables" cannot be recovered
               by watching the table at all, and 06's `in sim` filter needs a
               different source — most likely static analysis of the aircraft's
               own files, which is what 11-static-analysis exists for.
    Affects:   02-namespaces, 06-variables-panel

## 2026-08-23 — The live-value freeze is renderer-side. The Log panel gains the renderer.

    Stage:     3
    Expected:  the stage 3 symptom — a hint that appears once then freezes while
               values keep arriving — could be anywhere along a path that
               crosses two processes
    Found:     the main-side half is provably fine. Replaying
               `live-values.ndjson` emits **one value set per simvar event**,
               360-odd of them, with the values moving and the set accumulating
               to all six variables rather than replacing. Six tests over the
               real fixture, and they also pin that the fixture still carries
               `A:` names the PA-24 profile actually contains — a fixture whose
               names drifted would replay happily and light nothing.

               Combined with what the sim run showed — reopening the file
               displays *fresh* values — the map is current, so IPC and the
               store are working too. That leaves Monaco's repaint, and only
               Monaco's repaint.
    Changed:   Reading the code has now failed twice to find it, so the next
               step is measurement rather than a third reading. Two counters:
               one incremented when the change event fires, one when Monaco asks
               the provider for hints. Whichever stops moving is the answer, and
               neither is observable any other way — the provider is called by
               the editor, not by us, so no test can reach it.

               Reporting them exposed a real gap: **the Log panel could only
               show the main process.** Half the app is on the other side of the
               bridge and none of it was visible, which is a poor showing for a
               panel whose stated purpose is everything the system is doing —
               and in a packaged build there is no console to fall back on.

               So there is now a `ui` source and an `Api.log` for the renderer to
               write into it. The source is fixed at the main-process end rather
               than passed in: a renderer that could name itself `sim` could put
               words in the simulator's mouth.

               The counters report at `debug` every three seconds, and only when
               a number actually moved, so an idle session stays silent and the
               level filter buries them once stage 3 is settled.
    Affects:   none

## 2026-08-23 — `$APPDATA` does not survive npm-from-PowerShell

    Stage:     2b, build tooling
    Expected:  a bash script can read `$APPDATA` to find the Community folder
    Found:     not when it is reached as PowerShell -> `npm run` -> bash. The
                variable is absent, and with `set -euo pipefail` the script dies
                on its first substitution:

                  link/build.sh: line 26: APPDATA: unbound variable

               It worked in every test here because those ran bash directly,
               where the variable is present. The one path that matters — the
               documented `npm run link:build` — was the one never exercised.
    Changed:   Two fixes, and the second is the one worth having.

               Every environment read is now `${VAR:-}` guarded, with a fallback
               chain of `APPDATA` -> `USERPROFILE/AppData/Roaming` -> `HOME`.

               More usefully, the script now finds the Community folder the way
               **04-connection says the app must**: by reading
               `InstalledPackagesPath` out of `UserCfg.opt`, which is
               authoritative across MS Store, Steam and relocated installs. The
               hardcoded path is only the last fallback. The build script and
               the installer now answer the question the same way, which is
               worth more than the bug fix — it means the awkward cases get
               found here, where a wrong answer costs a rerun, rather than in
               the installer where it costs a user.
    Affects:   none

## 2026-08-23 — Settled: read `L:` through `fsVarsLVarGet`, with the entry's unit

    Stage:     2b
    Expected:  the earlier entry guessed "read raw through the legacy call", was
               corrected to "unsettled — it depends which read agrees with FS
               Copilot", and named a four-read test to decide it
    Found:     the test ran. On `L:Eng1_FuelQuantityCC`, id 3158:

                 1  legacy raw               29.092951
                 2  fsVarsLVarGet "number"    0.110129
                 3  fsVarsLVarGet native     29.092951
                 4  execute_calculator_code   0.110129   <- FS Copilot

               **The calculator matches the unit-converted read**, not the raw
               one. `FS_INVALID_UNIT` does mean "no conversion" — it returns the
               legacy value exactly — so all three behaviours are available and
               it is simply a question of which is correct here.

               On variables with no registered dimension — `Breakers`,
               `AltPRessKnob` — all four agree. This only ever mattered for the
               minority that carry a unit, which is why it went unnoticed for
               two entries.
    Changed:   **2b reads through `fsVarsLVarGet`, passing the unit from the
               profile entry.** That is the FS Copilot-compatible read, and the
               corpus is written for it: entries carry units, `splitUnits`
               already defaults `L:` to `Number`, and FS Copilot evaluates
               `(L:NAME, Units)` through the calculator.

               The original instinct — read raw, an `L:` variable is just a
               double — was wrong, and wrong in the direction that ships. Had it
               gone in, `09-live-values` would have shown `29.09` on a line
               whose value, as far as every piece of profile logic is concerned,
               is `0.110129`. Not a rounding difference: a different number,
               with nothing on screen to explain it.

               It also disposes of the reason to keep the legacy call. The
               modern API does everything it does — raw via `FS_INVALID_UNIT`,
               converted via a unit id — plus a real termination signal. The
               deprecation is correct and there is no case left for
               `get_name_of_named_variable` in our module.

               Which leaves the earlier speculation about why others still use
               the legacy call answered as far as it can be: MobiFlight is a
               hardware bridge and wants the raw stored double. We are matching
               a profile format, and want what the profile means.
    Affects:   03-link, 09-live-values — now decided, not open

## 2026-08-23 — The `L:` table grows while the sim runs

    Stage:     2b
    Expected:  the table changes when the aircraft changes, so snapshot / swap /
               compare isolates the aircraft's own set
    Found:     it changes anyway. Three counts from one session, no aircraft
               change between the last two:

                 5364 names   (first dump)
                 5341 names   (first snapshot)
                 6125 names   (second snapshot, minutes later)

               The change-notification count moved 2 -> 7 across the same
               stretch, so the handler sees the churn rather than missing it.

               784 names appeared between two snapshots of the *same* aircraft.
               Instruments initialising, GSX loading its menus, add-ons waking
               up — the table fills in as the session runs, not once at load.
    Changed:   A before/after delta around an aircraft change will be polluted
               by whatever else happened to register in the same window, so it
               cannot be the whole answer on its own. It is still worth
               measuring — the question is how much of the delta is the
               aircraft and how much is noise, and that needs the actual
               experiment run properly.

               Also a flaw in how the delta was being computed, found while
               reading this: it compared `snapshot[i] == now[i]` by index, which
               silently reports the entire tail as "new" if anything is inserted
               rather than appended. Now compared as sets, and it reports
               whether the common prefix survived — which is the separate,
               useful question of whether ids are stable.
    Affects:   02-namespaces, 06-variables-panel

## 2026-08-23 — fspackagetool runs in seconds, and does not write layout.json

    Stage:     2b, setting up
    Expected:  two unknowns left over from adopting the SDK's packaging tool:
               how long it takes, and whether it fully replaces what was being
               hand-written
    Found:     **Fast.** The whole pipeline — MSBuild, export check,
               fspackagetool, install — is about 17 seconds with the sim closed.
               The earlier hang was entirely the sim being open. So no fast path
               is needed for iterating on `module.cpp`; the earlier worry about
               that is closed.

               **It does not write `layout.json`.** No error, no warning:
               `_RPTErrors.xml` comes back as `<RPTErrors/>` and `_RPTInputs.xml`
               shows the `.wasm` correctly picked up under the `modules` asset
               group. It writes `manifest.json` and the module, and stops.

               Absence is not a statement that the file is obsolete. Every other
               package installed on this machine has one, Asobo's own Official
               2024 packages included, and the hand-built package that MSFS
               *did* register had one. So it is a gap in the tool.
    Changed:   `tools/layout.mjs` fills that one file after fspackagetool runs.
               The division is now: **fspackagetool owns `manifest.json`**, and
               it earns that — it corrected `minimum_game_version` from a
               hand-guessed `1.6.34` to the sim's actual `1.8.14`, and set
               `minimum_compatibility_version` to match, which is precisely the
               drift a hand-written manifest accumulates.

               `layout.json` keeps the two properties the first attempt got
               wrong: `date` is a bare number rather than a quoted string, and
               the digits survive intact — a FILETIME is past
               `Number.MAX_SAFE_INTEGER`, so it is assembled from a BigInt
               rather than round-tripped through a JS number.
    Affects:   none

## 2026-08-23 — Escapes collapse inside heredocs here; two source files had stray NULs

    Stage:     2b, housekeeping
    Expected:  writing `'\0'` from a quoted heredoc produces a backslash and a
               zero in the file
    Found:     it does not, reliably. Both `link/src/module.cpp` and
               `link/tools/read.mjs` had been carrying a **literal NUL byte**
               where a `'\0'` escape was intended — enough to make `grep` call
               them binary files, and enough for the compiler to warn
               (`-Wnull-character`) on a build nobody read closely.

               They happened to compile to the same behaviour, so nothing broke.
               Repeated attempts to repair them with the same mechanism failed
               silently, each one reporting a successful replacement while the
               byte stayed put.
    Changed:   Both fixed, by building the replacement from `chr(92) + chr(48)`
               so no layer between the shell and the file can reinterpret it.

               Worth knowing for anyone editing these files the same way: prefer
               a real editor tool over a heredoc for anything containing
               backslash escapes. The failure is silent in both directions —
               the write reports success and the file is unchanged.
    Affects:   none

## 2026-08-23 — `fsVarsLVarGet` converts units. It disagrees with the legacy read.

    Stage:     2a
    Expected:  asking for unit "number" is a no-op, and the two APIs return the
               same double for the same id
    Found:     they do for almost every variable, and then they do not.

                 L:Eng1_FuelQuantityCC   legacy 29.092951   modern 0.110129

               Same id (2599), read milliseconds apart in the same dispatch
               call. The ratio is **264.1716**, against 264.1720 US gallons per
               cubic metre — a match to five significant figures. That is a unit
               conversion, not drift and not coincidence.

               So `fsVarsLVarGet(id, unit, &out)` converts from the variable's
               registered native unit into the unit asked for, and
               `fsVarsGetUnitId("number")` is a real unit rather than "leave it
               alone". `get_named_variable_value(id)` returns the raw stored
               double.

               Most variables agreed exactly — `Blinking2Offset`,
               `C_Eng1_Main`, `BodyHead4Horizontal` — which fits: only variables
               with a registered native unit have anything to convert, and most
               `L:` variables are plain numbers.
    Changed:   **Nothing yet — 2b has to settle it first.** The first draft of
               this entry concluded "read raw through the legacy call". That was
               one variable's worth of evidence and an assumption about which
               API was misbehaving, and it does not survive contact with two
               other explanations:

               - **The unit argument may have been wrong.** `FS_INVALID_UNIT`
                 (-1) is defined in the header and is the obvious candidate for
                 "native value, no conversion". `fsVarsGetUnitId("number")` was
                 a guess at that meaning, not a documented one.
               - **Raw may not be the target at all.** FS Copilot reads through
                 `execute_calculator_code` with `wrap_expression(name, units)` —
                 RPN of the form `(L:NAME, Number)` — which applies unit
                 conversion. The corpus is written against *that* behaviour and
                 its entries carry units. So the question is not raw versus
                 converted; it is **which read agrees with FS Copilot**, because
                 profiles have to mean the same thing in both programs.

               Four reads of one dimensioned variable settle it, and they cost
               one dump:

                 1  get_named_variable_value(id)
                 2  fsVarsLVarGet(id, unitId("number"))
                 3  fsVarsLVarGet(id, FS_INVALID_UNIT)
                 4  execute_calculator_code("(L:NAME, Number)")

               Whichever matches 4 is the one to use. `L:Eng1_FuelQuantityCC` on
               the PA-24 is a known-dimensioned case to test against.

               What stands regardless: **the two APIs can return different
               numbers for the same id**, most variables are unaffected, and
               09-live-values would render whichever it was handed with nothing
               on screen to say a conversion had happened.
    Affects:   03-link, 09-live-values — as an open question, not a decision

## 2026-08-23 — The `L:` table is a superset too, and by twenty to one

    Stage:     2a
    Expected:  enumeration returns roughly what the aircraft has — the PA-24
               profile references 279 distinct `L:` variables, so something in
               that neighbourhood
    Found:     **5,364.** The aircraft's own share is about 5%.

               The names say where the rest comes from. The first forty ids are
               `C2L_BRIDGE_*`, `TDSGTNXI*` (a GTN 750 add-on), `WT_GNS530_*`,
               `WTG3XTouch_*`, `AP_KAP140_INSTALLED`, `PMS50_*`. Further in:
               a thousand-odd `FSDT_GSX_*` from ground services, `p42_cp_*`,
               `A320_FC_L_SPLR_4`. None of it is the PA-24. It is every other
               add-on installed on this machine, plus the sim's own globals.

               This is the *same* finding as the input-event one, in the second
               namespace: the runtime list is a superset of the aircraft's own,
               and the ratio is far worse here — 318 against 181 for `B:`,
               5,364 against 279 for `L:`.

               Ids are dense from zero and appear to be assigned in
               registration order, with globals and other add-ons occupying the
               low range. Not verified as a rule, and not safe to depend on.
    Changed:   "Enumerate `L:` and show the list" is not a feature — it is 5,364
               rows, 95% of which belong to software the user is not editing a
               profile for. The Variables panel's `in sim` filter from 06 needs
               to mean *this aircraft*, not *this simulator*.

               The likely mechanism is already proven to work: the LVar-set
               change notification fired twice during this session, so
               snapshotting the table across an aircraft load and taking the
               delta should isolate the aircraft's own set. That is 2b's first
               real question, and it needs no new API.

               A baseline captured at the main menu — before any aircraft —
               would give the same answer more crudely, and is the fallback.
    Affects:   02-namespaces, 06-variables-panel, 13-report

## 2026-08-23 — Stage 2a COMPLETE. All five questions pass; `L:` is reachable.

    Stage:     2a
    Expected:  unknown whether a module we built could enumerate `L:` at all
    Found:     PASS on all five, against MSFS 2024 and the A2A PA-24.

               1  the toolchain — MSBuild through the MSFS2024 toolset
               2  the package loads and announces itself
               3  **id-walking terminates cleanly**
               4  reads return values
               5  no collision with `fscopilot-bridge`, installed alongside

               **Question 3, the one everything rested on: it terminates.**
               5,364 variables, and both APIs stop at exactly id 5364 — the
               legacy call with a null name, the modern one with error 0x4
               (`INVALID_ARGS`). Same count, same names at the same ids. Two
               independent walks agreeing is what makes this an answer rather
               than an observation.

               The open question in 17 — "does walking ids still terminate
               cleanly on MSFS 2024" — is resolved yes. `L:` is reachable, which
               means the 84% of the corpus that stage 2 could not touch is now
               in reach.

               Also confirmed: **`fsVarsRegisterVarsStatusUpdateHandler`
               works.** It had fired twice by the time the dump ran. That is the
               hook for noticing the variable set change without polling, and it
               is what the superset problem above needs.

               The three-way diagnostic added after the previous failure earned
               itself immediately — the one-shot read returned
               "fsc-editor-link 0.0.1 loaded; module_init reached" before the
               dump began, so "did it load" was answered separately from "does
               it work" rather than both hiding behind silence.
    Affects:   17-open-questions — the `get_name_of_named_variable` question is
               resolved yes

## 2026-08-23 — The module becomes a sub-project, and fspackagetool cannot run with the sim open

    Stage:     2a, moving toward 2b
    Expected:  the spike would stay in `scripts/` until 2b gave the module a
               real home
    Found:     it had already stopped being a spike. Once the build moved to
               MSBuild it had a `.vcxproj`, a package definition and two tools,
               which is a sub-project wearing a scratch folder's name.

               It now lives in **`link/`**, mirroring `relay/` — the repo
               already had exactly this shape for the Cloudflare Worker, with
               its sources in the folder and its commands in the root
               `package.json` (`link:build`, `link:read`, beside `relay:dev`).

               Packaging moved to **fspackagetool**, from the SDK, so nothing in
               this repo describes what a Community package looks like either.
               That completes the reversal: MSBuild owns the flags, fspackagetool
               owns `manifest.json` and `layout.json`, and `tools/check.mjs`
               asserts what neither can — that the built module exports what
               MSFS calls into.

               **The cost, discovered by hitting it: fspackagetool drives
               `FlightSimulator2024.exe` to do the packaging, so it cannot run
               while the sim is open.** It does not fail — it hangs, holding the
               build until killed. Its normal runtime is still unknown, because
               it has not yet completed a clean run.

               That is less disruptive than it sounds: a package change needs a
               sim restart regardless, so the loop was always close-sim /
               build / start-sim. What is unknown is whether the packaging step
               costs seconds or minutes, which decides whether a fast path is
               worth having for iterating on `module.cpp`.
    Changed:   `link/` replaces `scripts/spike-link/`. `npm run spike:link`
               becomes `npm run link:read`.

               On CI, honestly: the module cannot be built on a hosted runner.
               MSBuild needs the MSFS SDK, which has no unattended install, and
               fspackagetool needs MSFS itself. The mitigation is the one the
               design already implies — 04-connection has the app *copying* a
               prebuilt package, never compiling one — so the module is a
               committed artifact and the app's CI never touches any of this.
               `check.mjs` is pure node, so a hosted runner can still verify the
               committed artifact exports what it must.
    Affects:   none

## 2026-08-23 — The module must export MSFS's allocator. Hand-driving clang was the wrong call.

    Stage:     2a
    Expected:  after fixing the package metadata, a module built by driving the
               SDK's clang and wasm-ld directly would run
    Found:     MSFS registered it — the Wasm Debug panel listed
               `fsc-editor-link.wasm` among 18 standalones — and then reported
               **`Status: FAILED`, "The module is not scheduled"**. So the
               package was finally correct and the *module* was not.

               Diffing it against `fscopilot-bridge`'s working `.wasm` gave the
               answer immediately. Ours was missing these exports:

                 malloc, free, mallinfo, mchunkit_begin, mchunkit_next,
                 get_pages_state, mark_decommit_pages, __wasm_call_ctors

               **MSFS drives a module's memory by calling into it.** Those are
               not decoration and not ours to implement — they are the SDK's own
               libc, all five of the allocator names present in
               `wasi-sysroot/share/wasm32-wasi/defined-symbols.txt`. They simply
               have to be *exposed* in the export table, and a hand-written link
               line does not do that by accident.

               The MSFS2024 toolset's `Microsoft.Cpp.MSFS.Common.targets` names
               every one of them in its `--export` list, along with
               `--stack-guard-page`, `/Zc:__cplusplus`, `-fstack-size-section`
               and `-mbulk-memory`. All of that was reconstructed by hand and
               all of it was incomplete.
    Changed:   **The module is built by MSBuild through the MSFS2024 toolset**,
               not by a clang command line in this repo. A 60-line `.vcxproj`
               that names its source file and an output path; every flag is
               inherited and stays correct across SDK upgrades on its own.

               The record, which is what settles the argument: three attempts
               driving the toolchain by hand, three failures, none of them in
               the C++ — a quoted `date`, two missing manifest fields, then
               eight missing exports. The compiler never once objected.

               Which is the deeper problem: **nothing about getting this wrong
               fails at build time.** A broken module links, installs and
               registers, then quietly never runs, and the feedback loop is a
               sim restart. So `check.mjs` now asserts the required exports
               against the built binary before it is installed, and the build
               fails there instead. The required list is FS Copilot's export set
               cross-checked against the toolset's own `--export` flags, not a
               guess.

               Packaging stays hand-rolled for now, on evidence rather than
               preference: the simulator accepted the generated `manifest.json`
               and `layout.json` this time — it registered the module — so that
               half is demonstrably correct. `fspackagetool` in `SDK/Tools/bin`
               is the equivalent move for packaging if it ever bites again.
    Affects:   none

## 2026-08-23 — First 2a attempt: the module did not load

    Stage:     2a
    Expected:  a package built by hand — manifest, layout, modules/*.wasm — is
               enough for MSFS to load a standalone module
    Found:     nothing came back, with one `exception 31` on the reader's first
               ClientData call. That is `OUT_OF_BOUNDS`, and for a ClientData
               definition it means offset+size exceeds the area — which for a
               256-byte definition at offset 0 means the area has size zero,
               i.e. **it does not exist**. The module never ran.

               Two differences from `fscopilot-bridge`'s package, both in files
               generated rather than written:

               - **`layout.json` had `"date"` as a quoted string.** MSFS writes
                 it as a bare number. It came out quoted because `JSON.stringify`
                 was given a string — and it was a string deliberately, because
                 the value is a Windows FILETIME near 1.34e17, past
                 `Number.MAX_SAFE_INTEGER`, so round-tripping it as a JS number
                 corrupts the low digits. Both constraints are real; the JSON is
                 now assembled by hand so the digits stay exact *and* unquoted.
               - **`manifest.json` was missing `minimum_compatibility_version`
                 and `release_notes`**, which fscopilot-bridge carries.

               `package_order_hint` is still deliberately absent. FS Copilot's
               is `PANEL_PATCH`, which exists to sequence its patch of
               `html_ui/pages/vcockpit/core/vcockpit.js` — confirmed present in
               their installed package. We patch nothing, so we need no hint.

               A dead end worth recording: `Content.xml` lists neither our
               package nor `fscopilot-bridge`, and FS Copilot demonstrably
               works. Community packages are not tracked there, so its absence
               says nothing and is not a diagnostic.
    Changed:   Beyond the two fixes, the spike now **distinguishes its own
               failure modes**, because "silence" was three different answers
               wearing one face:

               - the module writes a hello into the OUT area during
                 `module_init`, and a ClientData area holds its last value
               - the reader asks for that area **once** before subscribing, so
                 it reads what was written before it connected
               - exception codes are reported by meaning, not as numbers

               So the next run says which of three things happened: no area
               means no module, a hello and nothing after means the module runs
               but `Update_StandAlone` never ticks, a full dump means it works.
    Affects:   none

## 2026-08-23 — A Log panel, pulled forward for the same reason the Variables panel was

    Stage:     2c (new)
    Expected:  observability during the build was going to be terminal stdout,
               scratch scripts and reading NDJSON after the fact
    Found:     that is already the weakest part of working on this, and it gets
               worse in 2b: a WASM module's only voice is a transport we are
               simultaneously writing. Three of the four things worth watching —
               main-process warnings, file-watcher activity, remote events —
               have **nowhere to go at all** in a packaged build. The
               `sim: exception N on sendId M` warning added in stage 2 is
               invisible to anyone without a dev terminal.
    Changed:   A **Log** panel, sharing the bottom slot with Activity and
               toggled from a second bottom-aligned rail button.

               The argument is 1b's, almost exactly: everything it needs — the
               bottom panel, a horizontal splitter, persisted heights, a
               bottom-aligned rail button — is on stage 5's list regardless, so
               building it now is the same work earlier rather than extra. And
               `onSimEvent` was already built in stage 2 with no consumer, on
               the grounds that stage 4 would want to read the same stream live
               that it reads from a fixture. This is that consumer, early.

               **It is a view, not a system of record.** The capture file
               remains authoritative for sim events; a `LogEntry` is a display
               envelope carrying the raw event in `detail`. Nothing should ever
               read the ring buffer to answer a question about what the sim did.

               Two decisions taken:

               - **Shipped, not dev-only.** The users are profile authors, so
                 "send me what the Log panel says" is worth having, and
                 dev-only mostly means building it twice.
               - **Called Log in the UI**, `debug-log` internally. "Trace" was
                 considered and dropped; "Log" is what a person looks for.

               The buffer lives in **main**, not the renderer, for a reason that
               only shows up in practice: a renderer reload during development
               would otherwise wipe the history at exactly the moment it is
               being used. Main holds a bounded ring and the panel asks for the
               backlog when it mounts.

               Entries are **pushed in batches**. The stage 2 capture contains
               two bursts of 318 distinct events inside 2-4 ms, so one IPC
               message per event is not a theoretical problem — the fixture on
               disk is the stress test, and replaying it at speed is how this
               gets checked.
    Affects:   15-ui-surfaces

## 2026-08-23 — `get_name_of_named_variable` is deprecated. MSFS 2024 has a better `L:` API.

    Stage:     2a
    Expected:  the id-walk through `get_name_of_named_variable` that 02 and 03
               describe, and that MobiFlight uses, is *the* way to enumerate
               `L:`
    Found:     it still works and still links, but the 2024 SDK marks it
               `[[deprecated("Use MSFS_Event.h and MSFS_Vars.h instead")]]`. The
               compiler said so; nothing else would have.

               `MSFS/MSFS_Vars.h` is the successor and is better in three ways
               that matter here rather than cosmetically:

               - **Termination is an error code, not a null pointer.**
                 `fsVarsGetLVarName(id, buf, size)` returns `FsVarError`. The
                 open question in 17 — "does walking ids terminate cleanly" —
                 is asked against an API that has no way to say "no more", and
                 this one does.
               - **Reads take a unit.** `fsVarsLVarGet(id, unit, &out)` against
                 a `FsUnitId` from `fsVarsGetUnitId("number")`, where the legacy
                 `get_named_variable_value` returns a bare double.
               - **There is a change notification.**
                 `fsVarsRegisterVarsStatusUpdateHandler` fires with
                 `FS_VAR_TYPE_LVAR` and an op of `REMOVE` or `RESET` when the
                 variable set changes. If that works it replaces re-enumerating
                 on a guess — and it is the exact thing the SimConnect client
                 has no equivalent of for input events, where an aircraft change
                 is only discoverable after the fact.

               The whole namespace set is there as first-class ids — `FsAVarId`,
               `FsBVarId`, `FsEVarId`, `FsIVarId`, `FsLVarId`, `FsOVarId`,
               `FsZVarId` — which is worth knowing for later even though v1
               needs only `L:`.
    Changed:   The spike now runs **both** walks in a single dump and prints
               both counts, because "do they agree" is a cheaper question to
               answer now than after one of them is built on. Legacy stays in
               as the fallback: it is what MobiFlight has used for years, and
               deprecated is not removed.

               If the modern path works, 2b uses it and 03-link's "walk ids
               through `get_name_of_named_variable`" becomes an implementation
               note rather than the plan.
    Affects:   none yet — 03-link changes only if the sim run says the modern
               path works

## 2026-08-23 — A `.wasm` module builds from the SDK alone. No Visual Studio.

    Stage:     2a, question 1 — the one that gated the rest
    Expected:  a toolchain hunt. `FsCopilotWasm.vcxproj` declares
               `PlatformToolset: MSFS2024`, which reads like MSBuild and Visual
               Studio being required to build anything at all.
    Found:     the toolset is a wrapper, and its `.props` name the real tools.
               Everything needed is in `C:\MSFS 2024 SDK`:

                 compiler   WASM/llvm/bin/clang-cl.exe   (clang 15, Asobo fork)
                 linker     WASM/llvm/bin/wasm-ld.exe
                 target     wasm32-unknown-wasi
                 sysroot    WASM/wasi-sysroot
                 includes   wasi-sysroot/include, .../c++/v1, WASM/include,
                            SimConnect SDK/include

               Driven straight from a shell, a minimal module compiled and
               linked first try — 20 KB, no MSBuild, no `.vcxproj`, no IDE. So
               the module can be built by a script in this repo like anything
               else, and CI is not blocked on a Visual Studio image.

               Reading the produced binary back confirms it is structurally a
               gauge module and not just a well-formed wasm file:

                 exports  module_init, module_deinit, GetSimConnectVersion
                 imports  env.get_name_of_named_variable
                          env.get_named_variable_value

               **The `L:` API resolves against the host import table.** That is
               question 4 answered at link time — the functions exist, they are
               declared in `MSFS/Legacy/gauges.h` in the current 2024 SDK, and
               the linker binds them. What remains for question 3 is only
               whether walking ids *terminates*, which needs the sim.

               Two things learned from `FsCopilot.Bridge.Wasm` worth keeping:

               - The module lifecycle is `module_init` / `module_deinit`, plus
                 `Update_StandAlone(float)` — an MSFS 2024 per-frame hook. That
                 last one is where 03-link's "diff in-module at 10-20 Hz" goes,
                 and it removes the need to invent a timer.
               - **A module can open SimConnect from inside the sim.** They call
                 `SimConnect_Open` in `module_init` and talk to their app over
                 ClientData areas. So the module-to-app transport 03-link
                 proposes is demonstrated, not hypothetical.

               Also confirmed from source what 03-link inferred from the binary:
               `fscopilot-bridge` ships `html_ui/pages/vcockpit/core/vcockpit.js`
               under a `PANEL_PATCH` order hint. It really does patch a core
               file. Our package has no `html_ui` at all — just `modules/` — so
               the no-patching rule costs us nothing.
    Changed:   Question 1 is answered before the spike formally starts, and
               question 4 is answered at link time. 2a's remaining questions all
               need the simulator: does the package load and announce itself,
               does id-walking terminate, and does it coexist with
               `fscopilot-bridge`.

               The package format is a plain folder — `manifest.json`,
               `layout.json`, `modules/*.wasm` — and `layout.json` is only a
               file listing with sizes and Windows FILETIME stamps. We can
               generate it ourselves, which matters for 04-connection: the
               install flow needs no SDK on the user's machine, only ours at
               build time.
    Affects:   none — 03-link is confirmed rather than corrected

## 2026-08-23 — An aircraft change snapshots every input event before it announces itself

    Stage:     2, from the first live session
    Expected:  an aircraft change announces itself, and Activity draws a
               separator — 07-activity's model
    Found:     the announcement is the *last* thing to arrive. Ahead of it comes
               a burst of every input event currently subscribed, carrying its
               current value, inside a few milliseconds:

                 278.701s   318 events, 318 distinct, span 2ms
                 282.828s   aircraft -> microsoft-pilatus-pc6
                 ...
                 372.901s   318 events, 318 distinct, span 4ms
                 381.123s   aircraft -> pa24-250   (a reload of the same one)

               Not a flush of zeros — a state snapshot. Of the 318, 305 carried
               0 and the rest real values: five at 1, six at 100, one at
               49.9969482421875. It is the aircraft's control positions, sent
               all at once.

               It leads the `aircraft` event by 4.1 s the first time and 8.2 s
               the second. So a separator placed where the aircraft event
               arrives is **4-8 seconds too late**: 318 anchors have already
               been attributed to the outgoing aircraft, each of them looking
               exactly like a switch someone touched.

               A smaller relative of the same thing appeared at 295.598s — 45
               distinct events in 0 ms, all of them AS430 and radio entries from
               the PC-6's list. That one reads as a subsystem powering up rather
               than an aircraft transition, and it is not yet clear whether the
               two want the same treatment.
    Changed:   Activity needs a burst filter ahead of anchoring, and it is
               cheap: 318 distinct events in 2 ms is not a person. Nobody
               touches more than one control at a time, so a burst of many
               *distinct* events inside a few milliseconds is a machine
               announcing state and never an interaction.

               That is a different rule from both collapses already planned —
               anchor-side dedup handles one event arriving twice, repeat
               collapse handles one control touched five times, and this handles
               hundreds of controls reporting at once. Three rules, three
               reasons.

               Worth noting what this buys as well as what it costs: the
               snapshot is a free reading of every control's position at the
               moment of a change, which is exactly what a "what state was the
               aircraft in" question wants. Filtered out of the feed, kept in
               the buffer.
    Affects:   07-activity

## 2026-08-23 — Stage 2 verified live. The double-fire is frame-locked, and tighter than measured.

    Stage:     2
    Expected:  the client would connect and enumerate as the stage 0 spike did,
               and the double-fire would be the 25-55 ms stage 0 recorded
    Found:     PASS on every count. One 437-second session against MSFS 2024 and
               the A2A PA-24: connected, `pa24-250` derived from the loaded
               path, **318 input events enumerated — matching stage 0 exactly**,
               subscription firing by name, 771 events captured to disk and the
               file renamed to name its aircraft.

               The session happened to change aircraft twice, which tested a
               path nothing else had: `microsoft-pilatus-pc6` enumerated 260,
               and the PA-24's 318 came back on return. A second per-vendor data
               point, consistent with the runtime list being a superset.

               **The double-fire is tighter than stage 0 measured, and it is
               bimodal.** Across 53 consecutive same-name same-value pairs in
               genuine interaction:

                 17-21 ms   43 pairs
                 37-40 ms    9 pairs
                 261 ms      1 pair

               So the echo is bounded at 40 ms, not 55, and clusters at roughly
               one and two frames — which suggests it is frame-locked rather
               than a press and a release. The single outlier at 261 ms is
               `INSTRUMENT_HSI_KNOB_COURSE_KNOB_CRS`, a continuous rotation
               reporting the same value twice during a drag: a *genuine* repeat,
               and exactly the thing dedup must not eat.

               That brackets the window from both sides. Anything up to ~40 ms
               is an echo, the nearest real repeat is 261 ms, and a threshold
               near 100 ms sits six times clear of the noise on one side and
               2.5× clear of real data on the other. Stage 0's 25-55 ms was the
               right neighbourhood read from six switches; this is 53 pairs.

               Also confirmed: **exactly two events per interaction, not four.**
               The enumeration race closed just before this session was real —
               six `aircraft` events produced only four enumerations, the
               generation guard having dropped the superseded chunks. Without
               it every event would have been subscribed twice and the doubling
               would have looked entirely legitimate in the data.

               Incidental: `aircraft-loaded` reports twice on a load, once
               through `systemState` and once through `eventFilename`. Harmless
               — re-enumeration is idempotent and the guard covers the overlap —
               but it is why the event count is six rather than three.
    Changed:   Stage 2's exit criterion is met. The dedup window in stage 4 has
               a measured bound rather than an estimated one; 07-activity's
               amendment about the double-fire stands, with 40 ms as the number.
    Affects:   07-activity

## 2026-08-23 — Adopting node-simconnect quietly made the packaged app unshippable

    Stage:     2
    Expected:  adding a dependency and importing it is the whole job
    Found:     not for this one, and not in this repo. Two traps, neither of
               which shows up in development.

               **`electron-builder.yml` excludes `node_modules` wholesale**,
               with a comment explaining that main and preload import nothing
               but Electron and node builtins. That was true when it was
               written. `externalizeDepsPlugin` leaves `node-simconnect` as a
               bare import in `out/main/index.js`, so with the exclusion in
               place a packaged build ships a main process importing a module
               that is not there.

               Measured rather than assumed, by rebuilding with the old `files`
               list: the asar comes out holding `out` and `package.json` and no
               `node_modules` at all, and resolving `node-simconnect` the way
               `out/main/index.js` would — `createRequire` from inside the
               package — gives `MODULE_NOT_FOUND`. As a static import that
               throws while `index.js` is still evaluating, so it lands before
               `app.whenReady()` and there is no window at all.

               Neither `npm run dev` nor `npm start` can see any of this: both
               resolve out of the real `node_modules`, which is right there on
               disk. It is visible only in something electron-builder produced,
               and it applies to every target it produces — nsis, portable and
               `--dir` share one `files` list.

               **`regedit` cannot run from inside an asar**, and `asarUnpack`
               alone does not fix it. node-simconnect reads the SimConnect port
               from the registry through `regedit`, which shells out to `.vbs`
               scripts it locates with `path.join(__dirname, 'vbs')`. `cscript`
               is a separate process and cannot read inside `app.asar`.

               Unpacking the scripts puts them on disk but does not change the
               path regedit derives, so the spawn still failed with
               `Can not find script file ...app.asar/.../regList.wsf`. It needs
               `setExternalVBSLocation` pointed at the unpacked copy as well.
               Both halves were found by running the packaged build, because
               neither is visible any other way.

               The registry failure is milder than it looks, and worth writing
               down so nobody re-derives it: `autodetectServerAddress` tries
               `SimConnect.cfg`, then the named pipe, and only then the
               registry — and `findSimConnectPortIPv4` catches its own failure
               and returns 2048. So a packed `regedit` raises nothing. It
               silently picks the wrong port on any machine where the named pipe
               is absent, which is the configuration stage 0 was actually on:
               the spike resolved port 65441 from the registry.
    Changed:   Three things, and the third is the one that matters.

               - `files` re-admits node-simconnect's full 17-package runtime
                 closure after the blanket exclusion, with a note in the YAML
                 about regenerating it.
               - `asarUnpack` covers `node_modules/regedit/vbs/**`, *and* the
                 client calls `setExternalVBSLocation` on load. `regedit` became
                 a direct dependency to say out loud that we configure it, and
                 so both it and node-simconnect resolve to one hoisted copy —
                 module-level state is useless if there are two.
               - **The client loads node-simconnect with a dynamic import** and
                 treats failure as "no simulator this session". A static import
                 puts an optional capability on the path to opening a window: if
                 the packaging above is ever wrong again, the app should lose
                 the sim, not fail to start.

               That last one has a cost worth naming. A missing module now
               produces a chip reading `Sim offline`, which is exactly what a
               closed simulator produces, so the failure is invisible unless
               someone reads the console. It is logged loudly for that reason,
               and the packaging is verified against a real build rather than
               trusted: `ELECTRON_RUN_AS_NODE` against the packaged exe loads
               node-simconnect out of the asar and reads
               `SimConnect_Port_IPv4 = 65441` — the same port the stage 0 spike
               found, which is what makes it the right answer and not merely a
               successful call.
    Affects:   none — this is a packaging trap, not a design change

## 2026-08-23 — Captures keep the double-fire; dedup moves to read time

    Stage:     2
    Expected:  the earlier entry "Every input event fires twice" says Activity
               must collapse identical (event, value) pairs "before anchoring",
               which reads like something the transport should do on the way in
    Found:     doing it at the source would be a mistake, and the earlier entry
               is the reason why: it records that the cause was *not*
               investigated — press-and-release and an echo of the system's own
               write are both still live explanations. Those two want different
               handling, and only one of them is a duplicate.

               A capture that deduped on the way in could never settle the
               question, and every fixture recorded before it was settled would
               be unusable afterwards.
    Changed:   Nothing about the intent — Activity still collapses the pair
               before anchoring. What is fixed is *where*: the capture is
               verbatim, and the collapse is part of the derivation in stage 4,
               alongside the repeat collapse it is distinct from.

               This is the same principle stage 4 already states for findings —
               raw events persist, findings are a view computed over them — and
               it now applies one layer earlier, at the point events are
               written down.
    Affects:   none — it refines where an existing decision is implemented

## 2026-08-23 — `L:` cannot be read from a SimConnect client. The module is on the critical path.

    Stage:     2, before starting it
    Expected:  the module was off the critical path. Stage 0 asked whether `B:`
               input events could be reached client-side, got yes, and concluded
               the module was "justified solely by L: enumeration" — something
               v1 could therefore ship without.
    Found:     that conclusion conflates enumerating *names* with reading
               *values*. Both are module work, and only the first was ever
               questioned.

               node-simconnect 4.2.0 exposes `clientData`, `commBus`,
               `executeAction` and `enumerateSimObjectsAndLiveries`, and nothing
               resembling `execute_calculator_code` or a named-variable read.
               There is no client-side path to an `L:` value. 03-link already
               assigns that read to the module via `get_named_variable_value`;
               what is new is that nothing else can do it.

               What it costs, counted against the stage 1 database — 12,105
               variables over 61 profiles:

                 L:  10,124 distinct   20,044 uses    not readable
                 A:     554 distinct    2,875 uses    readable
                 H:   1,016 distinct    2,005 uses    observable only
                 B:     367 distinct      643 uses    readable

               84% of distinct variables and 78% of uses are out of reach. Only
               6 of 61 profiles are majority-`A:`. On `pa24-250.yaml` — the
               aircraft stage 0 verified against, and the one named in stage 3's
               exit criterion — it is 279 `L:` against 12 `A:`.

               So stages 3 and 4 are buildable but not demonstrable. Stage 3's
               exit, "open pa24-250.yaml and see values update", would light 12
               lines out of 291. Stage 4's, "flipping the DME switch ranks
               L:DmeOnOffKnob first", cannot pass at all — that variable is
               invisible to the client.

               The architecture is unharmed. The plan's argument that
               enumeration widens the watch set without touching the anchor
               model, the finding shape, the ranking or any table still holds.
               The exit criteria were wrong, not the structure.
    Changed:   The module moves into v1 and onto the critical path — by
               decision, not only by this finding. Reading `L:` is what forces
               it, but the same module is what unblocks probe, the live half of
               the Variables panel, and the `H:` CommBus route. Paying for the
               toolchain once buys all of them, so it is worth more than the one
               feature that compels it.

               Two stages inserted, following the 1b precedent rather than
               renumbering: **2a** a throwaway Link spike, same shape as stage 0
               — toolchain, one byte over ClientData, and does id-walking
               actually terminate on 2024 — and **2b** the module for real,
               with the install flow from 04-connection that came back into
               scope with it. Stages 3, 4 and 5 keep their numbers and recover
               their original exit criteria.

               One consequence lands inside stage 2 itself: every captured event
               carries a `source`, because there are now two producers rather
               than one. Cheap to add now, a fixture migration later.
    Affects:   02-namespaces, 17-open-questions

## 2026-08-18 — Variables panel pulled forward into v1

    Stage:     1b (out of order, by request)
    Expected:  the panel was scoped out of v1 as "the database's viewer, nothing
               depends on it"
    Found:     it is cheaper than that reasoning assumed. The store already
               holds the whole VarIndex from scanVars(), and 06 specifies the
               search index living in memory anyway — so the panel needed **no
               new main-process code and no new IPC**. Pure renderer work over
               data that was already there.

               The rail buttons it needs were on stage 5's list regardless, so
               building them now is the same work earlier rather than extra.
    Changed:   v1 scope gains the panel. Stages 2-5 are unaffected: nothing they
               do depends on it, and nothing it does gets in their way.

               What is built: search with the full ranking, namespace filters,
               ranked rows, expandable detail (documentation, shared/master
               split, distinct set expressions with their profiles).

               What is **not** built, because there is no evidence to show yet:
               the `in sim` and `new` filters, live values in rows, probe,
               insert-at-cursor and reveal-in-Activity. 06 describes all of
               those; only the search half of it exists.
    Affects:   06-variables-panel

## 2026-08-18 — SQLite ORDER BY silently reordered the corpus

    Stage:     1
    Expected:  ordering the fold with `ORDER BY f.dir, f.name, e.ordinal` to
               match what listFiles already produced
    Found:     it does not. SQLite's default collation is byte order, so every
               uppercase letter sorts before every lowercase one;
               `localeCompare`, which listFiles uses, does not. So
               `PMDG 737-600.yaml` came before `bksq-aircraft-baronpro.yaml`
               where the sidebar puts it after.

               The effect was invisible in aggregate — same variables, same
               counts — and wrong in the details that are actually read: which
               twelve profiles a variable credits, which comment becomes its
               documentation, which `set:` expressions are offered. On
               `A:NAV OBS:2` the documentation changed from the Black Square
               profile's "NAV 2 OBS" to nothing at all.

               Caught only by a full-corpus differential against the previous
               implementation. Every fixture in the unit tests was lowercase,
               so none of them could see it.
    Changed:   The fold no longer orders in SQL. `compareProfiles` is exported
               from files.ts and used by both listFiles and the projection, so
               there is one statement of the order rather than two that looked
               equivalent. A regression test with a deliberately mixed-case pair
               is now in vars.test.ts.
    Affects:   none — this is an implementation trap, not a design change

## 2026-08-18 — Stage 1 complete. The dictionary is database-backed.

    Stage:     1
    Expected:  a schema migration and a rewrite of how the corpus is stored
    Found:     both exit criteria met against the real corpus — 64 profiles,
               12,578 variables.

               **Identical output.** A differential against the pre-database
               implementation, field by field over every entry, matches exactly
               after the collation fix above. The projection groups by name
               *and* units to reproduce the old shape, while the rows underneath
               store units per occurrence as 05-data-model requires. Reproducing
               the denormalized view from the normalized one was the real test
               of the storage model, and it holds.

               **Incremental.** Cold scan 338ms, warm scan 88ms. The remaining
               88ms is the fold, not I/O: unchanged profiles are not opened at
               all. Refolding 12,578 variables on every rescan is worth
               revisiting when the Variables panel queries SQL directly rather
               than through this projection.
    Changed:   Two refinements to 05-data-model, both narrower than what it
               describes rather than different:

               - Evidence is a table per source (`corpus_entry` now, sim and
                 static later) rather than one table with a `source` column and
                 nullable payload. The shapes genuinely differ.
               - Corpus tables are scoped to a `workspace` row. Sim evidence
                 will not be — an aircraft is an aircraft whichever folder of
                 profiles is open.

               `Api.scanVars()` is unchanged, so the renderer, preload and
               completions are untouched.
    Affects:   05-data-model

## 2026-08-18 — Stage 0 complete. Aircraft key confirmed; two findings about layout.

    Stage:     0 (question 2, and the last outstanding one)
    Expected:  the loaded-aircraft path to yield the SimObject folder name
    Found:     PASS. It reports

                 SimObjects\Airplanes\pa24-250\presets\a2a\pa24-250\config\aircraft.CFG

               which yields `pa24-250` — matching FS Copilot's log and
               `pa24-250.yaml` exactly, as 05-data-model predicted. The aircraft
               key decision is now verified live rather than inferred.

               Two things about that path matter beyond the answer:

               **It is relative to the package root.** No drive, no package
               name — it begins at `SimObjects\`. So the key names the aircraft
               but does not locate it. Mapping key -> package folder needs its
               own index, built by walking Community, Community2024 and the
               Official folders for `SimObjects/Airplanes/<name>`.

               **The loaded aircraft.cfg is a thin variant file.** In the 2024
               preset layout the substance lives in a sibling `common/`:

                 presets/a2a/pa24-250/config/aircraft.cfg   2 lines, a title
                 presets/a2a/pa24-250/config/systems.cfg    0 circuits
                 common/config/systems.cfg                  37 named circuits

               Neither file declares a `base_container` or any other pointer —
               the layering is by convention. Following the loaded path and
               reading the files next to it would yield almost nothing.

               Also: the extension came back as `aircraft.CFG`. Match
               case-insensitively throughout.
    Changed:   Analysis needs a layout resolver: walk up from the loaded path to
               the `SimObjects/Airplanes/<folder>` root, read `common/` as the
               base and the preset as an overlay, rather than assuming either
               the classic 2020 layout or the loaded file's own directory. The
               `systems.cfg` circuit-naming result in 11-static-analysis was
               read from `common/` and stands; how that file gets found does
               not.
    Affects:   05-data-model, 11-static-analysis

## 2026-08-18 — Stage 0 passes against the sim. The module is off the critical path.

    Stage:     0
    Expected:  unknown whether input events were reachable from a plain client
    Found:     MSFS 2024 (SunRise 12.2, build 282174.999, SimConnect 12.2),
               A2A PA-24, connected first try on the SunRise protocol.

               PASS 1  connects with no SDK
               FAIL 2  aircraft-loaded — a bug in the spike, not the sim; see
                       the entry below
               PASS 3  A: values delivered, including CIRCUIT CONNECTION ON:3
               PASS 4  318 input events enumerated
               PASS 5  subscription fires on a cockpit click, by name:
                       SWITCH_BATTERY_MASTER_2STATES, SWITCH_LIGHT_LANDING_L,
                       SWITCH_LIGHT_STROBE, SWITCH_PITOT_HEAT and so on

               Names are exactly what a profile author would want to see.
    Changed:   nothing — v1 scope holds as written. The WASM module stays off
               the critical path and is justified solely by L: enumeration.
    Affects:   17-open-questions — the "can B: be reached client-side" question
               is resolved yes

## 2026-08-18 — Every input event fires twice

    Stage:     0
    Expected:  one event per interaction
    Found:     every switch produced two identical events 25-55 ms apart, same
               value both times:

                 21:23:59.667  SWITCH_BATTERY_MASTER_2STATES = 0
                 21:23:59.694  SWITCH_BATTERY_MASTER_2STATES = 0
                 21:24:01.171  SWITCH_LIGHT_LANDING_L_2STATES = 1
                 21:24:01.197  SWITCH_LIGHT_LANDING_L_2STATES = 1

               Consistent across all six switches flipped. Cause not
               investigated — press and release, or the input-event system
               echoing its own write.
    Changed:   Activity must collapse identical (event, value) pairs inside a
               short window before anchoring, or every finding is doubled and
               the repeat-collapse count is wrong by a factor of two. This is
               anchor-side dedup, distinct from the repeat collapse already
               planned, which is about genuine separate interactions.
    Affects:   07-activity

## 2026-08-18 — The runtime input-event list is a superset of the aircraft's own

    Stage:     0
    Expected:  roughly the 127 counted statically in A2A_Inputs.xml
    Found:     318 at runtime. A2A defines 181 across two files (127 in
               A2A_Inputs.xml, 54 in A2A_External_Inputs.xml). The remaining
               ~137 are sim-provided: the first fifteen enumerated are all
               CLICKSPOT_* and WALKAROUND_* from MSFS 2024's own interaction
               templates, not from the aircraft at all.
    Changed:   The static count is not a discoverability predictor. An aircraft
               defining few input events of its own may still enumerate
               hundreds of generic ones, so "this aircraft defines 5 input
               events, use a mark instead" would be both wrong and misleading.
               The prediction has to come from the runtime list minus the
               sim-global set, or be dropped. The measured per-vendor counts in
               02-namespaces remain valid as counts of *aircraft-authored*
               events, but their interpretation there is wrong.
    Affects:   02-namespaces, 13-report

## 2026-08-18 — node-simconnect is pure JS and implements the input-event API

    Stage:     0
    Expected:  unknown whether a JS client exists that needs no SDK, and whether
               it implements the newer input-event calls at all
    Found:     node-simconnect 4.2.0. No native code — no .node binaries, no
               binding.gyp; dependencies are debug, ini and regedit. So no
               SimConnect SDK and no DLL.

               It implements the full input-event surface:
                 enumerateInputEvents, enumerateInputEventParams,
                 getInputEvent, setInputEvent, subscribeInputEvent,
                 unsubscribeInputEvent
               with matching RECV ids and an InputEventDescriptor carrying
               { name, inputEventIdHash, type }.

               Transport discovery works with the sim closed: it resolved a
               localhost port (65441) from the registry and got ECONNREFUSED,
               which is the expected sim-not-running signature rather than a
               configuration failure.

               Also present, unexpectedly: a `commBusEvent` receive type. That
               is the channel 03-link proposes to observe FS Copilot's H: event
               stream on, and its presence here suggests that may be reachable
               client-side too. Not investigated.
    Changed:   nothing yet. This answers the offline half of questions 1 and 4.
               Whether the sim actually returns the PA-24's 127 input events,
               and whether subscription fires on a click, still needs the sim.
    Affects:   none

## 2026-08-18 — node:sqlite works under Electron 43

    Stage:     0 (question 6)
    Expected:  verified on standalone Node 22.19; Electron bundles its own Node
               build and might differ
    Found:     Electron 43.4.0 runs Node 24.18.1 with SQLite 3.53.1.
               DatabaseSync opens, DDL and prepared statements work, no flag
               needed. Tested via ELECTRON_RUN_AS_NODE against
               node_modules/electron/dist/electron.exe.
    Changed:   nothing. Confirms the storage decision in 05-data-model; no
               better-sqlite3 native-rebuild fallback needed.
    Affects:   17-open-questions — this question is now resolved

---

## 2026-08-18 — Question 2 failed on a spike bug, not a sim limitation

    Stage:     0
    Expected:  requestSystemState("AircraftLoaded") to return the .cfg path
    Found:     RecvSystemState carries { requestID, dataInteger, dataFloat,
               dataString }. The spike read `state.stringValue`, which is
               undefined, so its guard was always false and it reported
               nothing — silently, which is the worst way for it to be wrong.
               No SimConnect exception was raised, so the request itself was
               accepted.
    Changed:   Spike fixed to read `dataString`, and to print every systemState
               unconditionally so a field mismatch is visible rather than
               silent. Question 2 is unanswered, not failed — needs one more
               sim run.
    Affects:   none
