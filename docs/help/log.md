# Editor help — build log

    Purpose:  What the build discovered, and what changed as a result.
    Plan:     plan.md
    Order:    newest first

Findings and decisions, recorded as they happen — the same convention as
[sim-vars/build/v1-log.md](../sim-vars/build/v1-log.md): a verification that
resolved a question, anything that contradicts a design doc, a decision a later
session would otherwise re-derive, and an approach abandoned **with why**. Not
what got implemented and when; that is what commits are for.

```
## YYYY-MM-DD — one-line summary
Stage:     which stage of plan.md
Expected:  what was believed going in
Found:     what turned out to be true
Changed:   what this changes about the plan, or "nothing"
Affects:   design docs this amends, or "none"
```

---

> **Renamed 2026-09-20 — the names below were updated in place.** Our own
> environment variables moved from `FSC_` to `FSCE_`, because FS Copilot runs
> its own relay and its own variables, and one prefix over both read as one
> project: `FSC_DEFINITIONS` is now `FSCE_WORKSPACE`.
>
> Only the names changed; the entries record what happened. Bare
> `FSC_` anywhere else is FS Copilot's — the `L:` variables inside profiles,
> the client data on the wire — and is left alone.


## 2026-09-19 — The trace, built in three phases; §3 costed it at half

    Stage:     3 — the entry trace
    Expected:  §3's estimate: "about 100 lines of C#: `Set`, `ParseSet`,
               `ApplyTo`, `SimClient.Set`", then a panel.
    Found:     Eight functions, not four, and two of the extra ones carry
               behaviour no rule or doc had written down. The constructor's
               units default, `TransmitKEvent`, `SimClient.Stream` and
               `SimConnectExtensions.InferDataType` all decide something the
               trace has to say. fscopilot-behavior.md gained four sections
               from this and is the better record; what follows is what the
               building turned up rather than what it produced.

               **§3's hard part 2 is closed.** It parked the toggle guard
               because "which type arrives per unit has not been traced".
               `InferDataType` → `ToClrType` traces it: empty units are a
               **string**, `feet` and `percent` are **ints**, and `Number` —
               the constructor's own fallback, so the commonest unit in the
               corpus — is a **double**, because `case "number":` is
               commented out of the int list. An `L:` variable ignores the
               table and is FLOAT32 both ways.

               Reading it turned up something better than the answer sought.
               `Coordinator.AddLink` starts `currentValue` at **null**, and
               `ApplyTo` tests that raw parameter — not the `current ?? value`
               it used two lines earlier to build the expression. So
               `value.Equals(null)` is false and **the first incoming apply
               after connecting is never toggle-guarded**, however equal the
               numbers look. No rule and no doc had this.

               **Three bugs in the first cut of the model, all found by
               reading rather than by running.**

               1. `splitArgs` split on `\s+`. The C# is `Split(' ')` — the
                  space character only — then `Trim()`, so `1\t2` is *one*
                  operand, is not a number, and is sent as `0`. The model said
                  `[2, 1]`. `master-set.ts` had it right all along, which is
                  the argument for consolidating rather than the reverse.
               2. The echo step vanished when the expression was empty.
                  `Skip.Next(Get)` runs *before* `sim.Execute`, and `Execute`
                  returns early on a blank string — so nothing reaches the
                  simulator and the mark stands anyway.
               3. `SimClient.Set`'s missing `else` was stated as fact. The
                  behaviour doc records it as read in the source and never
                  probed, and flags it as a possible upstream bug. It is
                  `state: "unknown"` now, with the hedge in the text.

               **Five things the first cut did not cover at all**: the `K:`
               five-parameter ceiling; `NormalizeValue`, which rounds away
               from zero and wraps a negative, so `-1` travels as
               `4294967295`; `L:`/`A:` writes taking the **last** operand;
               the read side, where a bare name returns `Observable.Empty`
               and the entry is inert in *both* directions; and the type
               table above.

               **The consolidation's near-miss.** Moving `dead-set` and
               `master-set-shape` onto the shared parser, swapping `match[2]`
               for `write.name` typechecked and passed every test — and
               silently changed a user-facing message, because `ParseSet`
               strips a `K:n:` arity before writing. The message would have
               quoted `K:BAR` at somebody who typed `K:2:BAR`. Only the
               byte-diff of the corpus dump caught it; `master-set-shape` has
               zero corpus hits, so the sweep itself could not. `ParsedWrite`
               carries both names now, and the trace gained the step it was
               silently skipping.

               **`activeLine` is not the caret.** It is the first *visible*
               line and drives the sidebar highlight. The panel was built
               against it and reported line 1 for every entry in the file.
               The two names are close enough that the mistake is worth a
               line here: scrolling moves one and never the other.

               **The panel forced a model change, and a truer one.** §3 says
               steps "go grey" when a branch closes; the model returned early
               and *omitted* them, which would reflow the rows under the value
               field and `docs/ui.md` forbids that in as many words. The model
               now returns the whole path and marks what did not happen —
               which is also more faithful, since the `return` above
               `Skip.Next(Get)` means the echo genuinely does not happen.

               **Phase 4's decision, measured rather than argued.** Before
               costing "rules read the trace for JavaScript setters", the
               corpus was asked how often the answer depends on the value:
               543 of 6,373 `shared:` JS setters (8.5%) and **53 of 137**
               `master:` ones (39%) give a different verdict across
               `[0, 1, 2, 5, 50, 100, -1]`. Every varying case sampled is
               deliberate authoring — `switch (value) { case 0: … case 5: … }`
               with an empty default, inert outside its cases by design. A
               rule tracing at an arbitrary sample would flag working code
               some 596 times in this corpus. So per-branch diagnosis is out
               on evidence, not on taste.
    Changed:   §3 marked built. Phase 4 stays open with the measurement
               attached, so it is not re-argued from scratch.
    Affects:   fscopilot-behavior — four new sections (the send pipeline, the
               type table, `NormalizeValue`, the null-`current` guard case)

    Method:    The rules-read-the-model step was proved rather than asserted:
               all 356 corpus diagnostics dumped before and after — rule id,
               severity, confidence, basis, facts cited, full message, fix
               title, every edit span — and diffed. Byte for byte identical.
               That dump is the only reason the `K:n:` message change was
               caught, and it is worth keeping as the shape of any future
               refactor of a rule.

               **A probe that looked broken and was not.** Two runs of the
               panel reported "put the caret in an entry" on lines that
               obviously held one. The app's buffer had an extra blank line,
               so line 8 was `shared:` and line 15 was blank — the panel was
               right both times and the driver was reading a file that had
               moved under it. Read the rendered lines out of the editor
               before debugging working code.

## 2026-09-19 — monaco-yaml dropped; the schema layer is ours, and it renders

    Stage:     after 2 — closing the last of the three defects
    Expected:  a dependency removal, then building back two features from
               scratch.
    Found:     Both features already had a seat. The work was mostly deciding
               where the prose lives, and the deciding factor was that the
               user was **already living in this option without having chosen
               it** — monaco-yaml has contributed nothing since monaco-editor
               0.53, so removing it changed nothing that worked. What it
               removed was 13 packages and a `configureMonacoYaml` block that
               said `hover: true, validate: true` about a service that answered
               every request with *Missing requestHandler*.

               **The prose was being said three times, not twice.** The plan
               already knew block descriptions existed twice. Pulling the
               schema apart found a third: `get:`, `set:` and `skp:` each had
               a short wording in completions' `ENTRY_DOCS` and a long one in
               the schema's `markdownDescription`, and the long ones had never
               rendered. `profile-schema.ts` is now `key-docs.ts` — one table,
               `summary` + `detail`, covering the five blocks and the three
               entry keys. Completions take `summary`; the hover takes both.
               One new sentence in the whole move: `get:`'s summary, which was
               two different sentences in the two places and is now their
               union.

               **`key-unknown` is `block-unknown`'s sibling, and the source
               says so.** `Definitions.cs` builds **one** deserializer for the
               document with `.IgnoreUnmatchedProperties()` commented out, so
               an unmatched property on a `Config.Link` throws exactly as one
               on `Config` does. `sett:` does not disable a setter; it
               disables the profile and everything it includes. Same
               consequence text as `block-unknown`, word for word, because two
               wordings would imply two severities.

               **The corpus sweep earned its keep twice.** First hit: two
               modules — `AS_GNS430.yaml`, `AS_GNS530.yaml` — where the rule
               called `shared:` an unknown key. Not a rule bug in the end, but
               it found one: **both files open with a UTF-8 BOM**, and our
               grammar does not tolerate it. Line 1 classifies as a `mapping`
               with `indent: 1`, `context.block` stays **null for the entire
               file**, and all 22 entries are therefore attributed to no
               block. Those two files have been getting **no entry-level or
               profile-level analysis at all**, silently, and nothing noticed
               until a new rule tripped over it. Strip the BOM and the same
               file analyses normally.

               FS Copilot is unaffected: `Definitions.cs` reads with
               `File.ReadAllText`, which strips a UTF-8 BOM, and `.Trim()`s
               besides. So the files load in the sim and only the editor
               trips. Left as a finding rather than fixed — it is the format
               classifier, not this change.

               The rule itself now refuses to flag any name the format defines,
               whatever line kind it arrived as, which is the correct
               semantics independently of the BOM. Second hit: `nearest`'s
               default budget of two edits reaches `get` from `sett` as well
               as `set`, so the tie rule correctly refused both and the most
               obvious typo in the format shipped without a fix. Two edits on
               a three-letter key is two-thirds of the word; inside an entry
               the budget is now one, and the top level keeps two so the two
               siblings agree where they overlap.
    Changed:   Gaps list: monaco-yaml struck out, and *Schema-level failures
               in our own voice* with it. The BOM finding added. 30 rules.
    Affects:   none

    Method:    Verified in the app after a full rebuild, with the dependency
               gone from `node_modules`:

               - `shared:`, `include:`, `get:`, `skp:`, `set:` all render
                 summary and detail — text that has never reached a reader.
               - `sett:` draws the `key-unknown` error with its Why section.
               - `A:INDICATED ALTITUDE`, the `skp:` value and the quoted
                 template's `value` still render as before.
               - Syntax colouring survives: line 7's `shared` still tokenizes
                 as `mtk41 mtkb`, so dropping monaco-yaml did not disturb the
                 `yaml` language id — monaco-editor registers it itself.
               - The console no longer carries *Missing requestHandler*.

               **A cold JavaScript worker fakes a missing hover.** The first
               pass of the sweep showed the quoted template's `value` without
               its TypeScript card, which looked like a regression from the
               morning's fix. Re-probed at the same position: four sections,
               `var value: number` among them. The first hover after a reload
               loses the race with the TypeScript worker's start-up. Probe a
               suspicious negative twice before believing it — the same
               lesson as the stale widget and the smart `Home`, in a third
               costume.

## 2026-09-19 — The quoted setter fixed by moving one question, not adding a field

    Stage:     after 2 — closing the defect the sweep found
    Expected:  to add an unquoted view beside `Expression.text` and teach the
               two JavaScript gates to prefer it.
    Found:     That design was wrong, and the giveaway was in the call sites.
               Every consumer of `Expression.text` wants the *value*:
               `js-bridge` builds the shadow document from it, the hover runs
               `tokenAt` over it, and `analysis.ts` only ever touches it
               through the `unquoted()` that converts it. **Not one wants the
               raw span.** A second field would have made the conflation
               official and given the codebase two ways to be wrong.

               So `text` simply became the value, and `startColumn` moved to
               point at it — inside the quote rather than on it. The offset
               shift then has nowhere to live *because `startColumn` is the
               field whose job it already was*. `offsetIn` and `positionIn`
               are untouched and now correct for quoted setters;
               `js-bridge.ts`, `monaco-setup.ts`, `completions.ts` and
               `profile-hover.ts` are untouched and all four became correct;
               `analysis.ts` **lost** `unquoted()` and its per-site
               `+ analyzed.delta`, and its `at()` collapsed to `positionIn`.
               One function changed, one file shrank, four broken ones were
               never opened. That the 1,018 existing tests — including the
               analysis tests that assert columns on quoted setters — passed
               unchanged is the proof the delta really did fold in.

               **The new primitive went to grammar.ts, beside the family it
               completes.** `plainValue` measures the span, `scalarValue`
               reads the value; `valueSlice` is the third question, *where
               the value sits inside the span*, which is what everybody was
               re-deriving privately.

               **Writing its test found a second bug.** The verbatim check was
               `scalarValue(span) !== inner`, and `'it''s'` slipped through:
               `plainValue` ends a quoted span at the first matching quote, so
               it reads that span as `'it'`, and comparing against the span
               finds `it` on both sides and agrees. Asking `scalarValue(raw)`
               — the whole line — reads `''` as the one quote it is and
               disagrees. The old `unquoted()` missed this too; its guard was
               a backslash check, which `''` does not trip.
    Changed:   Gaps list: the quoted-setter defect struck out. `analysis.ts`'s
               header section on the quote gap now says where the work went
               instead of describing work it no longer does.
    Affects:   none

    Method:    Verified in the app on all three setter shapes, same word, same
               name, after a clean reload:

               | | hover `value` | `value.` + Ctrl+Space |
               | --- | --- | --- |
               | quoted one-liner | `var value: number` + doc | 9 rows |
               | block scalar | `var value: number` + doc | 9 rows |
               | unquoted one-liner | `var value: number` + doc | 9 rows |

               **Read a reload, not a hot module replace.** The first
               verification run showed completions fixed and the hover still
               missing, which looked like a half-landed change and is not: the
               page was mid-HMR. A full `page.reload()` before probing made
               the two agree. Corpus counts behind all of this were taken with
               the repo's own grammar rather than by regex — 10,418 setters,
               6,536 JavaScript, 5,933 of those quoted, and **0** whose value
               is not a verbatim slice of its span.

               One edge left, and it predates all of this: TypeScript's
               quickinfo returns nothing at offset 0 of the expression, so
               hovering the **very first character** of an unquoted one-line
               setter gives no card while every later character does.

## 2026-09-19 — Both dead hovers traced; a third, older gap under them

    Stage:     after 2 — following up the first look
    Expected:  two independent puzzles, one of them ours.
    Found:     One cause each, both exact. Then a wider sweep found a third
               that neither the look nor the gaps list had, and it is the
               largest of the three.

               **`skp:` — ours, and fixed.** `expressionAt` was claiming the
               line. Its guard read "any `continuation`/`entry` whose key is
               not `get:`", and `CONTINUATION_KEYS` is `["set", "skp"]`, so a
               `skp:` value came back as an expression: `expressionAt` on
               `skp: L:ALT_MIRROR` returned `{ text: "L:ALT_MIRROR",
               javascript: false }`. Nothing downstream noticed, because every
               other caller asks for `key === "set"` or for `javascript`
               first. The hover does not: it walks its territories in order
               and territory one ends in an unconditional `return null`, so
               the `skp:` territory below it was unreachable. The guard is now
               named positively — `holdsExpression`, `key === "set"` — on both
               the one-line and the block-scalar paths. Verified in the app:
               `L:ALT_MIRROR` renders its card with `SKP_NOTE`.

               **monaco-yaml — a dependency break, not a binding problem.**
               The schema is bound; the worker never starts. `monaco-worker-
               manager` (monaco-yaml's dependency) calls
               `monaco.editor.createWebWorker({ moduleId, label, createData })`
               and **monaco-editor 0.53.0 removed that signature** — it takes
               `{ worker }` now. `opts.worker` is `undefined`, worker creation
               throws, Monaco falls back to its own editor worker, and every
               call into the YAML service fails. The console says so in full:

                   Could not create web worker(s). Falling back to loading
                   web worker code in main thread…
                   Missing requestHandler or method: doHover
                   Missing requestHandler or method: doValidation
                   Missing requestHandler or method: getCodeAction /
                   findLinks / getFoldingRanges

               Placed exactly by diffing the releases: 0.52.2 still reads
               `opts.moduleId`, 0.53.0 reads `opts.worker`. We are on 0.55.1.
               monaco-yaml 5.5.1 is the latest release and dev-depends on
               `monaco-editor@^0.54` — untested against 0.55, broken since
               0.53, and there is no upstream fix. So the `label === "yaml"`
               branch in `MonacoEnvironment.getWorker` is never reached, and
               `hover: true` / `validate: true` were never the question.

               **The third: a quoted JavaScript setter gets no JavaScript.**
               `Expression.text` for a one-line value keeps the YAML quoting —
               the whole `"...(>K:KOHLSMAN_SET)..."` including the double
               quotes. The JavaScript service is handed that verbatim, so the
               shadow document is `function __expr() { "…" }`: a string
               literal. A name inside a `${…}` hole is not code to it. No
               quickinfo, no completions, no signature help.

               `analysis.ts` already solves this — `unquoted()` strips the
               pair and carries a `delta` so spans still land — but that
               function is private to it, and the hover/completion path never
               learned. Measured in the app, side by side, same word, same
               offset into the same name:

               | | block `set: \|` | quoted one-liner |
               | --- | --- | --- |
               | hover on `value` | `var value: number` + its doc | nothing |
               | `value.` + Ctrl+Space | 9 rows — `toFixed`, `toPrecision`, `valueOf`, … | widget opens `message`, **0 rows** |

               So it is not only the hover: completions and signature help go
               through the same gate and are equally dead.

               The corpus says how much this is worth. Of 10,418 setters,
               6,536 are JavaScript — and **5,933 of them are quoted
               one-liners**, against 601 block scalars. Nine in ten JavaScript
               setters have had no JavaScript intelligence at all.

               **And 22 setters are judged by the wrong rules.**
               `Expression.javascript` is `isJavaScript(text)` computed
               *before* unquoting, and `'` is a trigger character. So
               `set: '0 (>B:LIGHTING_ASCRJ_YOKEC_APDISC_BTN_KEY_PUSH)'` — 22
               lines across the CRJs, P180 and ce750w — is read as JavaScript
               by the editor, where FS Copilot sees the quotes stripped, finds
               no trigger, and sends it literally. `analysis.ts` gets this
               right (`setKind` on the unquoted text); only the two JavaScript
               gates are wrong.

               **None of the three is today's work.** `js-bridge.ts`,
               `monaco-setup.ts`, `refs.ts` and `tokens.ts` are identical to
               HEAD; `expression.ts` is the only file in that path that moved,
               and only by the fix above. The `skp:` guard has been wrong
               since HEAD — it became visible today because `SKP_NOTE` was
               written today.
    Changed:   Gaps list: the `skp:` defect struck out, monaco-yaml's entry
               given its cause, and the quoted-setter defect added at the
               head. The monaco-yaml decision — pin to 0.52.2, shim the worker
               handshake, or drop the dependency — is open and is the user's.
    Affects:   none

    Method:    Same isolated instance as the first look, on a copy of the
               corpus, with a purpose-built probe profile covering every hover
               kind: block key, entry key, `get:` name and units, `skp:` name,
               RPN ref and word, quoted template, block scalar, ref inside a
               JS string, bare name, `include:` path, `ignore:` and `pointer:`
               items, and a comment as a negative control.

               **The trap this time was the caret, and it faked three
               negatives.** `Home` in Monaco is *smart* home: on an indented
               line it goes to the first non-whitespace character, not column
               1. The previous recipe — `Home`, then `ArrowRight` ×(col−1) —
               therefore lands `indent` columns too far right on every
               indented line, which is every line that matters here. It read
               as "no hover on `switch`, none on `value` in a block scalar"
               when the caret was in fact sitting on the space after `)`.

               The fix is to stop counting: **`Ctrl+G` takes `line:column`**
               and lands exactly. And the driver now *proves* where it is
               rather than assuming — `.monaco-editor .cursor`'s `style.left`
               in pixels, calibrated against `End` and column 1 on a known
               line, converts back to a column, and every probe reports a
               mismatch. Two calibration points and a monospace font are the
               whole trick. Monaco 0.55 has no `textarea.inputarea` to read a
               selection out of any more, so the pixel route is the one left.

## 2026-09-19 — Seen in the app: the card is right, two hovers never fire

    Stage:     after 2 — first look at stages 1–2 in the running app
    Expected:  a look at the card to be a copy exercise. Everything had tests.
    Found:     The card renders as designed, and two surfaces it shares the
               editor with do not render at all.

               **Works.** The `K:2:KOHLSMAN_SET` write target shows the four
               parts in one section — identity, `Sets altimeter setting
               (Millibars * 16). · SDK`, the operand list with `[1]` above
               `[0]`, `Written by 3 entries`. `get-no-prefix` fires on the
               bare name with its Why section citing `bare-name-not-streamed`;
               `dead-set` fires on the `master:` entry with both its facts.
               Stage 1's shape survives contact.

               **Does not fire — `skp:`.** No hover of any kind on a `skp:`
               value. That is `profile-hover.ts`'s third territory, and it
               means `SKP_NOTE` — the sentence corrected this session after
               being wrong in four places — never reaches a reader. Not
               diagnosed; the cause is still open.

               **Does not fire — the schema, and not just its hover.**
               Nothing on the `shared:` block key, nothing on `skp:`. That
               puts `BLOCK_DOCS`' details, the `get:` prefix list and the
               schema's `skp:` paragraphs in the same bucket as `SKP_NOTE`.

               The first draft of this entry said "the schema does validate,
               so this is not the same failure" — **that was an assumption,
               and checking it killed it.** A probe with `sett:` inside an
               entry and a `notablock:` at the top produced exactly **one**
               squiggle, on `notablock:`, which is our own `block-unknown`.
               monaco-yaml said nothing about `sett:`, which
               `additionalProperties: false` should reject. So monaco-yaml is
               contributing neither hovers nor diagnostics, and the schema may
               not be bound at all.

               Not diagnosed. `hover: true` and `validate: true` are both set
               in `configureMonacoYaml`. The obvious suspect — models carrying
               a URI the schema's `fileMatch` misses — does **not** look like
               it: the URIs are `file:///definitions/<rel>.yaml` and the match
               is `**/*.yaml`. Start somewhere else.

               This also corrects the gaps list, which claimed an unknown key
               inside an entry "gets monaco-yaml's *Property sett is not
               allowed*". It gets nothing.

               **Three sections, not two.** With a diagnostic on the span the
               popup stacks marker + Why + card. The design in plan.md §4 says
               two. The Why section is ours as much as the card is, so "one
               section of ours" was written before the Why section existed.

               **A description that is a comment.** `ELT ACTIVATED` renders
               its description as `########### Pilot Lower Panel #########`.
               The corpus indexer is taking a section-heading comment as the
               variable's doc, and the card presents it as prose with
               `· from a profile` after it.
    Changed:   Order gains "fix what the look found" before the trace model.
               Four items added to the gaps list. The affected copy-review
               entries are marked unreachable so the copy pass does not polish
               text nobody can see.
    Affects:   none

    Method:    Isolated instance — `npm run dev -- -- --remote-debugging-port=9335
               --user-data-dir=<scratch>`, `FSCE_WORKSPACE` pointed at a
               **copy** of the corpus in scratch plus a probe profile, so the
               real Definitions folder was untouched. Hovers driven by caret
               rather than pointer: Ctrl+G to the line, Home, ArrowRight ×n,
               then Ctrl+K Ctrl+I (Monaco's Show Hover). Read from
               `.monaco-hover .hover-contents`.

               **The trap, twice.** A position with no hover leaves the
               *previous* widget on screen, so it reads as a result — two
               probes were recorded as duplicates of a third before the driver
               was made to prove the widget had gone (`waitForFunction` on
               `.monaco-hover` absent or empty) before each trigger. The same
               trigger produced hovers at three positions and nothing at
               three, which is what makes the two negatives worth acting on.

## 2026-09-19 — The hover card is one section, and one fact

    Stage:     2 — the hover card
    Expected:  the plan's anatomy to drop in: four parts, the cut content
               behind a "More".
    Found:     More has nowhere to go. The Reference panel it opens is stage
               6. The user's call was to trim anyway and judge the card on its
               own terms, so the samples, the file list and the headings are
               simply not in the hover — `documentation()` still assembles
               them for completion's panel, which is a venue with room.

               The "one position-specific fact" rule also settled an older
               question. A `K:2:` call matching its catalogue entry used to be
               told "takes 2 parameters, pushed **reversed**", which is true
               and not news. It now gets the parameters themselves in writing
               order — `[1]` above `[0]` — which says the same thing while
               being the thing the reader came for. A mismatch still outranks
               both.
    Changed:   `refCard` renders; `refHeader` stays beside it rendered by
               nothing, as the pieces the card picks from. `profile-hover.ts`
               returns one block where it returned two.
    Affects:   none

## 2026-09-19 — Four surfaces said skp: backwards; the source says send

    Stage:     2 — the wrong prose
    Expected:  to correct the direction and move on.
    Found:     Reading `Coordinator.AddLink` line by line turned up more than
               the direction. `master` there is `!def.Shared` — the entry's
               block, not the machine's role — so the whole skip mechanism is
               shared-only in both halves: `Skip.Next(def.Skip)` fires only
               from a shared entry's *send* subscription, and `Skip.Should` is
               only consulted on shared entries' outgoing streams. A `skp:` in
               a `master:` entry does nothing, and so does a name that no
               shared entry watches. The echo after applying is a separate
               line in `ApplyTo` and needs no `skp:` at all.

               Also confirmed for `SimClient`: a bare name matches no branch
               in `Set` and returns `Observable.Empty` in `Stream`. That is
               two facts, not one — `ns: null` in our parser covers a bare
               name *and* an unknown letter, and the unknown letter routes
               fine, because any letter with a colon goes to the sim module.
    Changed:   Three facts: `skp-marks-on-send`,
               `echo-held-back-automatically`, `bare-name-not-streamed`.
               Hover, `ENTRY_DOCS`, the schema and fscopilot-behavior.md all
               corrected from them. `parse.ts`'s comment no longer implies an
               unprefixed name reaches the sim. `get-no-prefix` written —
               error, certain.
    Affects:   fscopilot-behavior (skp section rewritten; bare-name row and
               the missing-`else` note added to the SimClient.Set table)

## 2026-09-19 — Completion was inventing input events

    Stage:     2
    Expected:  a prose fix — the hover's "a bare preset cannot be written".
    Found:     The prose was the small half. `writeOffer`'s `B:` branch
               appended `_Set` to every bare preset it was given, whether or
               not the aircraft has a name spelled that way — so completing a
               name could produce one the sim does not answer to, which looks
               exactly like a setter that works. The same premise the muted
               `b-write-op` branch was muted for.
    Changed:   `writeOffer` takes an optional `knows` predicate; the call site
               hands it the index. `_Set` is offered when it is enumerated,
               otherwise the name as written with a note saying a bare write
               lands only if the preset is the action. No index to ask means
               no guess.
    Affects:   none

## 2026-09-19 — toggle-guard retired; two evidence rules drop to info

    Stage:     1 — converting the rules
    Expected:  every shipped rule to survive conversion with its severity.
    Found:     Writing a verdict in plain words is a test a rule can fail.
               `toggle-guard` could not say when it mattered: FS Copilot only
               skips the entry when the incoming value already equals the
               current one, and for a plain set that apply would have changed
               nothing; for an increment, skipping is arguably better. Zero
               corpus hits.

               `b-value-constant` had fired spuriously in use: a control that
               does hold state fires without a change when it is worked
               against a stop, or while what it switches cannot change. Three
               firings and no change cannot tell that from a momentary button.
    Changed:   `toggle-guard` deleted (rule, exports, five tests). The *fact*
               stays in facts.ts — the setter templates describe the guard and
               the trace will show it as a step. `b-value-constant` is info,
               confidence possible, and states both readings in the user's own
               wording. If it still bothers, the next step is to require the
               pattern across two sessions. 28 rules.
    Affects:   sim-vars/18-language-core (toggle-guard row marked retired)

## 2026-09-19 — "input events register late" was never measured

    Stage:     1
    Expected:  b-preset-unknown's hedge to rest on an observation.
    Found:     It rests on an analogy. What was measured is the `L:` table —
               784 names appeared between two snapshots of one aircraft as
               instruments initialised and add-ons started (v1-log). That was
               carried to input events in a comment in `session.ts` ("the same
               reason the L: walk runs twice") and then repeated as fact by
               the rule, 18-language-core and the message.
    Changed:   The fact says what was measured and what was not. The remedy
               claims no mechanism: "It can also be missing because the
               aircraft has not finished loading, so check again once it has."
    Affects:   none amended; sim-vars/18-language-core repeats the claim

## 2026-09-19 — Two claims dropped or narrowed for want of a record

    Stage:     1
    Expected:  message text to be traceable to a probe or to source.
    Found:     `stack-balance` said "the sim reads missing operands as 0"; no
               entry in v1-log measures what the calculator does with a short
               stack (the arity probe measured missing *event parameters*, a
               different thing). `header-updated` said FS Copilot will offer
               to replace the profile "every time it checks"; the source is
               `updatedAt != null && updatedAt > defs.UpdatedAt`, so with no
               published profile for the aircraft nothing is offered.
               `block-conflict` said an incoming value is applied twice; in
               fact the pilot in control sends twice and each send reaches
               both entries on the other side, because incoming updates are
               matched by name alone — and the reverse direction is clean.
    Changed:   stack-balance claims only what the text shows. header-updated's
               consequence is conditional; its severity stays error by the
               user's call, and the eventual new-profile template should carry
               the date. block-conflict describes the real traffic. Open:
               whether the corpus's 30 both-blocks cases (mostly Aerosoft CRJ,
               master: first) are a deliberate fast-stream-plus-reliable
               pattern — if so the rule should be info.
    Affects:   none

## 2026-09-19 — Severity, confidence and basis are three fields

    Stage:     1 — the diagnostic shape
    Expected:  basis to cap severity (source → error, probed → warning,
               sdk-docs → info).
    Found:     The user's objection held: something the SDK defines
               definitively can be a high-severity error, and `k-arity`
               already is one. The cap conflated provenance with certainty.
               `not-settable` is info because 119 working corpus entries
               contradict the SDK column — low *confidence* — not because its
               basis is the SDK.
    Changed:   Three independent fields. Severity is what breaks, confidence is
               how sure, basis is provenance shown as a chip. One link only:
               an error must be certain, held by structured.test.ts.
    Affects:   none

## 2026-09-19 — The audit: prose checked against FS Copilot's source

    Stage:     before stage 1
    Expected:  the help text to be noisy but true.
    Found:     Read against `~/dev/fsc/src` (5d6b313). **Verified correct:** the
               JavaScript trigger characters, prepended and literal kinds, the
               ParseSet regex with its numeric parsing and reversal, the toggle
               guard, master/shared authority, silent skip of a missing
               include, unmatched keys throwing, the Updated regex, units
               defaults, the 2-second skip window, `current ?? value`, exact
               name matching.

               **Wrong:** `skp:` is explained backwards in four places — it
               registers when a shared entry *sends*, and the echo after
               applying is automatic. A bare name is not read as a simulation
               variable; it streams nothing and 17 corpus lines are dead.
               Bare `B:` writes are described three ways. The empty-branch
               guard "does nothing" only in `shared:`. Details and file names
               in plan.md, "Known-wrong text still live".

               Every one of these sat in a *copy* of a fact. That is the
               argument for the facts table.
    Changed:   The plan exists. The user chose to fix prose facts during the
               copy polish rather than first, since some will be cut.
    Affects:   fscopilot-behavior (skp section, and the SimClient.Set table's
               "anything else" row) — not yet amended

## 2026-09-19 — Decisions taken in conversation

    Stage:     all
    Found:     - The hover stays in Monaco's widget. A custom React card was
                 considered (one merged card, live value, shadcn styling) and
                 set aside: it means rebuilding delay, stickiness, keyboard
                 trigger, edge positioning and dismissal. Build the card as
                 data so the swap stays contained.
               - No live value in the hover card; it is already inline.
               - `pointer:` is valid everywhere. Upstream lacks it; the PR is
                 coming. FS Copilot version targeting is out of scope for now.
               - The trace is a panel, never inline — inline would move lines.
               - Vocabulary: the workspace (reversing "folder"), the other
                 pilot, the aircraft in the sim. Basis labels follow "Based on
                 …"; `grammar` has none.
               - Copy: rules of the language say "should"; no advice the
                 author can work out alone ("move it to shared:" was cut); a
                 heads-up reads as one; filler such as "on it" goes.
               - Probe anecdotes do not belong even in a fact's statement —
                 the Baron story went to the `record` field.
               - `include-missing` says only "was not found in the workspace":
                 modules ship with FS Copilot, so a miss is as likely to be
                 the wrong workspace as a wrong path.
    Changed:   all reflected in plan.md and docs/copy.md.
    Affects:   copy.md (vocabulary table, Diagnostics register)

## 2026-09-19 — Housekeeping found along the way

    Found:     `npm run lang:sweep` and `check:setters` default to the old
               `~/dev/fscopilot` paths and crash without `FSCE_WORKSPACE`
               (the corpus is `~/Documents/Definitions`). Raised as a separate
               task, not fixed here. `rules.ts`, `syntax.ts` and `b-write-op.ts`
               were already off-format at HEAD, so Prettier was not run over
               them. ESLint reports two pre-existing irregular-whitespace
               errors in `tokens.ts`. Nothing built in stage 1 has been seen
               in the running app.

## 2026-09-20 — The Trace panel, built

    Stage:     trace-panel.md steps 1, 3, 4, 5, 6, 7 (step 2 is a "do not
               re-propose" note and needed nothing)
    Built:     - **The `result` step.** `traceEntry` now ends each half with a
                 terminal step carrying `OUTCOME_ID`. Five endings as planned,
                 plus two the plan did not list — see Found.
               - **`at.end`.** `EntryLines` gained the entry's last line,
                 block-scalar bodies included, which is what the locator reads.
               - **The panel.** Everything under *The shape, settled*: the
                 locator, the two columns with one binding each, the live
                 `current` field, the timeline and its four states, the outcome
                 row, syntax colouring through the editor's own painters, and
                 the type tooltips.
               - **The editor lift.** `installTraceHighlight`, per editor,
                 beside the run button. Neutral ≈6% foreground.
               - **The fields reset when the trace moves to another entry**
                 (asked for late in the session). A `key` on the body, so the
                 remount is the reset — it clears the trace with the fields,
                 which also retires the stale-name guard the panel used to
                 need. Keyed on block and name rather than the line, so
                 editing above an entry does not discard what was typed.
                 Verified in the app: typed 50/7, moved entry → 1/empty; moved
                 within the entry → kept.
    Found:     - **The panel cannot paint from a string.** The approved mockup
                 colours `1013` in *1013 is sent to the other pilot* and leaves
                 `33` in *about 33 times a second* alone. Identical as text;
                 only the step that built them knows which is a value and which
                 is a rate. So `TraceStep.detail` is `Part[]` — prose as bare
                 strings, program text through a marker — and the panel renders
                 what the model marked. `detailText()` is there for anything
                 wanting the words. Every `detail` string is unchanged; the 52
                 existing tests passed untouched through the conversion.
               - **Two endings the plan's five do not cover.** A send half
                 whose `read` step failed must not end "is sent to the other
                 pilot", and a send half with nothing read locally has no value
                 to name. Added `nothing is sent — ${name} is never read` and
                 `the new value is sent to the other pilot`. Both are in the
                 copy registry as additions rather than drafts of the five.
               - **A Tailwind class built by interpolation is never emitted.**
                 `` `text-[var(--syntax-${token})]` `` compiles to nothing, so
                 the locator's block word and every `skp:` came out in the
                 surrounding grey. The two that *did* work were the two
                 `var-chip.tsx` happens to spell out in full. Colours now
                 arrive as an inline custom property; the token is still the
                 token. Worth remembering anywhere a palette is applied
                 programmatically.
               - **The type's dotted underline was drawn in `--border`.**
                 Tailwind's default border colour, not `currentColor`, so at
                 10% white over a coloured word it read as a rendering fault.
                 `border-current` — the plan did say "in its own colour".
                 Found by the user looking at it, not by the probe, which had
                 only asserted the style was `dotted`.
               - **Base UI puts a tooltip's delay on the trigger**, not the
                 root, which is why an earlier `delay` on `<Tooltip>` failed
                 typecheck and was dropped rather than moved. The type
                 tooltips now open in 13ms instead of 600.
               - **The panel's mono was not the editor's.** `font-mono` is
                 Tailwind's stack and the editor is Cascadia Code, so a name
                 did not look the same in both — which is the panel's whole
                 contract. Added `--font-editor` to `@theme`, used by the
                 panel only. `EDITOR_OPTIONS.fontFamily` still holds the same
                 stack literally, because Monaco measures the face and takes a
                 string; the two are two copies that must match. See Affects.
    Deviated:  The plan says to move `run-entries.ts`'s extent walk into
               `entriesFromLines` and have both callers read `at.end`. They
               cannot share the *loop*: `run-entries` accepts a `get:` under
               any block and `entriesFromLines` keeps only `shared:`/`master:`,
               so reading `at.end` would have changed its behaviour for a
               malformed file. They share the *rule* instead — `extendsEntry`,
               exported from the grammar — which removes the drift the plan was
               guarding against without changing what either walk answers.
    Verified:  1117 tests (52 → 71 on the trace model, +5 on the extent),
               typecheck, ESLint and Prettier clean over every file in this
               work. Driven in the app against the real corpus: all four of
               the mockup's states reproduced — a JavaScript setter on the
               C172's alternator, the CJ4's closed and open toggle guard, the
               CRJ's `master:` K: event, and JF_RJ_100's `dead-set` fallback,
               which ends `50 is written to A:GENERAL ENG THROTTLE LEVER
               POSITION:1, Percent, and K:THROTTLE1_SET never fires`.
    Open:      - The slot is still 260px and a nine-step half scrolls. The
                 body scrolls rather than the slot opening taller; the plan
                 lists deciding this as open and it still is.
               - `and runs` is the one label that overflows the 56px gutter.
                 Untouched.
               - Row gap is 8px, not the mockup's 9px — the plan's own
                 recommendation, taken because docs/ui.md wants the 4px grid.
               - `trace-panel.html` is still in the tree. The plan says to
                 delete it once the panel matches; not deleted, because
                 deleting is a separate proposal.
    Affects:   - `--font-editor` and `EDITOR_OPTIONS.fontFamily` are two copies
                 of one stack. The system-level fix is making Tailwind's
                 `--font-mono` the editor face app-wide, which would also put
                 `var-chip` and the Log in it — recommended, not done, because
                 it repaints every mono element in the interface.
               - `dead-set` now imports `bareEventName` from `trace.ts` rather
                 than testing the text itself, so its fix and the trace's last
                 line cannot disagree.
