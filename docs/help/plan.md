# Editor help — build plan

    Status:  stages 1–2 built and seen in the app. Stage 1: facts table,
             structured diagnostics, all rules converted, Why hover section,
             check:claims. Stage 2: the one-section hover card, the wrong
             prose corrected at every surface, `get-no-prefix`, and the
             schema layer taken back off monaco-yaml. 30 rules, 30 facts.
             All three defects the first look found are fixed and seen
             rendering: the `skp:` hover, JavaScript inside a quoted setter,
             and the key hovers and key validation that monaco-yaml owed and
             never delivered. See the top of log.md. Of the design's six
             parts, §§1, 2, 3 and 4 are built; §5 (suppression) and §6
             (the Reference panel) are not started. §3's panel was finished
             and seen in the app on 2026-09-20 — trace-panel.md, and the
             entry in log.md. Its **parity plan is still unbuilt**, and that
             is the part that outranks the panel.
    Log:     log.md — newest first
    Copy:    copy-review.md — every new string, with its context, queued
             for a copy pass
    Scope:   everything the editor says to somebody writing a profile:
             diagnostics, quick fixes, the Issues panel, hovers, completion
             docs, schema docs, setter templates

**Start here**, then read the top of [log.md](log.md). Between them that is
enough to continue without the conversation that produced this.

**Every string written here is a draft.** As you write one, add an entry to
[copy-review.md](copy-review.md) carrying its venue, goal and constraints —
enough that the copy pass, which happens separately, can rewrite it without
opening the code.

Contents: the goal · what exists · why the signal was low · factuality · the
design (six parts, with the worked examples) · order · known-wrong text still
live · source findings not yet used · gaps · the rule catalogue as it stands ·
the facts as they stand · settled wording · working notes.

---

## The goal

An amazing help experience for somebody writing their first profile, and
accurate to the letter. Two constraints came with it:

- **Do not take prose at face value.** The existing text was AI-written,
  piece by piece. Every claim about FS Copilot is checked against its source
  (`~/dev/fsc/src`); every claim about the simulator is traced to a probe in
  `sim-vars/build/v1-log.md` or dropped.
- **Build the base for what comes later** rather than slapping it on: the
  trace, suppression, reference pages, more rules.

## What exists — the inventory

| Surface | Contents | Rendered as |
| --- | --- | --- |
| Squiggles | 30 rules in three tiers — 11 expression (`analyze`), 11 entry (`analyzeEntry`), 8 profile (`analyzeProfileView`) — and three families: `sim`, `dialect`, `setter` | plain text |
| Key validation | `key-unknown`, ours — an unrecognised key inside an entry or at the top level. Replaced monaco-yaml's `additionalProperties: false`, which never ran (2026-09-19) | squiggle, Issues row, Why section |
| Quick fixes | about half the rules carry one | lightbulb, and the wrench in an Issues row |
| Issues panel | one truncated line per diagnostic, plus rule id and position | `components/issues/index.tsx` |
| Hover | one Monaco popup. On a clean name, the card alone (`refCard`, `hover-card.ts`); on a diagnosed one, marker text · Why · card, in that order. A JS setter adds the TypeScript card, in all three shapes — quoted one-liner, plain one-liner and block — as of 2026-09-19, as does the `skp:` value | markdown, except the marker |
| Key hover | `key-docs.ts` — summary and detail for `get`, `set`, `skp` and the five blocks, rendered by `profileHover`'s first territory. Ours since 2026-09-19 | markdown |
| Completions | 11 slot kinds (`slotAt`); docs panel per item; 14 `set:` templates carrying teaching prose (`set-templates.ts`) | markdown |
| Signature help | JavaScript only, through `js-bridge` | — |
| Value cells | the `why` strings in `vars/namespaces.ts`, shown where a namespace cannot be read | UI copy |
| Docs | `fscopilot-behavior.md`, `profile-format.md`, README | not reachable from inside the app |

Every string was mixing some of seven things: **identity** (what this is),
**mechanism** (what FS Copilot or the sim does), **verdict**, **consequence**,
**remedy**, **provenance** (probes, counts, dates, aircraft), **caveat**. The
design below gives each its own place.

## Why the signal was low

Four structural causes. None is a wording problem, which is why a wording pass
would not have fixed it.

1. **One `message: string` served every venue.** `block-unknown`,
   `ref-unresolved` and `b-write-bare` ran 60–75 words. The Issues row cut that
   to its first clause. A marker renders no markdown, so backticks showed
   literally — `value-word`, with its triple backticks, came out as soup.
2. **Every message re-taught the pipeline.** There is nowhere to learn once how
   a `set:` is classified, built and routed by block, so each dialect rule
   carried its own lecture on it.
3. **Maintainer reasoning leaked into user text.** "Probed once, on the Black
   Square Baron…", "written by 12 corpus entries", "Reading the bare name is a
   different matter and is correct."
4. **The same fact was written in three to five places and the copies
   drifted.** Block descriptions existed twice, worded differently; the entry
   keys three times, and the longest of the three had never rendered. `skp:`
   is explained four times. Every factual error found sits in one of these
   copies. (The key docs are now one table — `key-docs.ts`, 2026-09-19.)

## Factuality — what was checked, and how it came out

Read against `~/dev/fsc/src` at `5d6b313`: `Definitions.cs`, `Coordinator.cs`,
`Skip.cs`, `SimClient.cs`, `MainViewModel.cs`.

**Verified correct:** the JavaScript trigger characters (`'` `` ` `` `?` `{`
`}`; a double quote is not one); prepended and literal kinds; the `ParseSet`
regex, its uint/int/double parsing with non-numeric → 0, and the argument
reversal; the toggle guard; `master:`/`shared:` authority; silent skip of a
missing include, resolved from the Definitions root; unmatched YAML keys
throwing (`.IgnoreUnmatchedProperties()` is commented out); the `# Updated:`
regex and the `MinValue` fallback; units defaulting to `Number`, or to none for
`K` and `H`; the 2-second skip window; `current ?? value`; exact ordinal name
matching; `Execute("")` returning early.

**Wrong, and fixed in diagnostics** — see log.md for each: the "missing
operands read as 0" claim; `header-updated`'s unconditional consequence;
`block-conflict`'s "applied twice"; "input events register late" stated as
measured.

**Wrong, and still live** — see *Known-wrong text still live* below.

**Could not be checked from here**, and is labelled by basis rather than
asserted: anything resting on a sim probe (bare `K:` pops one value, bare words
are ignored, a unit on an event is ignored, a calculator read creates a `Z:`
variable, momentary controls report 0), corpus counts, the SDK catalogue's
parameter strings, and `hook.js` panel matching (which exists only in the
pointer-forwarding fork, not upstream).

---

## The design

Four layers a reader can walk — squiggle → trace → concept page — while an
expert only ever reads a 12-word verdict. Plus two pieces of base the later
work needs.

### 1. The facts table — built

`src/shared/lang/facts.ts`. Each **mechanism** — what FS Copilot or the
simulator does — is stated once, in markdown, with a `basis`. Rules, and later
hovers, schema docs, templates and reference pages, cite it by id.

This is **not** the string registry `docs/copy.md` rejects. A verdict belongs
beside the code that reaches it, with the comment that explains it. What lives
in the table is only the other half — the mechanism — which is exactly the half
that was being retold and drifting.

- A fact says what happens, never what to do. The remedy belongs to the
  diagnostic, which knows the line. (`facts.test.ts` rejects "you should",
  "try", "consider".)
- A `source` fact carries **anchors**: a path under FS Copilot's `src/` and a
  verbatim one-line snippet. `npm run check:claims` greps every anchor against
  a checkout (`~/dev/fsc/src`, or an argument, or `FSCE_FSCOPILOT_SOURCE`) — 26 anchors
  today. Line numbers drift; anchors survive. It cannot say a fact is *true*,
  only that the code it was read from is still there to be read.
- Every other fact carries a `record`: where it was established. **Who tested
  what, on which aircraft and date, goes here and never in front of the user**
  — not even inside the statement. The Baron anecdote was moved out of the
  message, then out of the fact too.

Basis labels, as the hover shows them — one pattern, so the chip reads as a
kind of thing before it reads as words:

| basis | label | note |
| --- | --- | --- |
| `source` | Based on FSC source code | |
| `probed` | Based on sim testing | |
| `sdk-docs` | Based on the MSFS SDK docs | |
| `observed` | Based on live sim data | Always the user's own simulator — Remote Connect shares files, not sim data. Only ever about the aircraft the open file is the profile for (`aircraft-evidence.ts`, `profileIsFor`); another aircraft's profile, or an `include:` module, gets no such evidence. One caveat: `b-value-constant`'s activity counts accumulate across sessions in the local db, so "live" is slightly generous for that one rule. "The loaded aircraft" was rejected as a label: it could as easily mean the profile open in the app. |
| `corpus` | Based on other profiles | |
| `grammar` | *(none)* | An unclosed paren is its own evidence; a chip would label the obvious. |

### 2. Structured diagnostics — built

`diagnose()` in `src/shared/lang/rules.ts`. A finding is parts, because no one
string fits a squiggle, an Issues row and a hover at once.

Worked example — JF_RJ_100's `set: K:THROTTLE1_SET` under `master:`. Before,
one string for every venue:

> This setter never runs. A master: entry is not evaluated as RPN — FS Copilot
> matches the whole value against \`(>NAME[, units])\`, and this one does not
> end in a write, so the incoming value goes straight to A:GENERAL ENG… instead
> and this text is dead. Write it as \`(>K:THROTTLE1_SET)\` to fire the event.

After:

```ts
diagnose({
  ruleId: "dead-set",
  severity: "warning",
  confidence: "certain",
  basis: "source",
  why: ["master-parsed-not-run", "master-fallback"],
  verdict: "This setter never runs.",
  consequence:
    "The incoming value will be written to A:GENERAL ENG THROTTLE LEVER " +
    "POSITION:1 instead, and K:THROTTLE1_SET will never fire.",
  fix: { title: "Change to (>K:THROTTLE1_SET)", … },
})
```

| Venue | Shows |
| --- | --- |
| Issues row | the verdict |
| Squiggle | verdict + consequence + remedy, as plain `message` |
| Hover, under the marker | the **Why** section — the facts, as markdown, each with its basis (`why-card.ts`, registered in `diagnostics-store.ts`) |
| Trace (later) | the ✗ on its step |
| Reference page (later) | everything |

The parts:

- **verdict** — the finding in a breath. Plain text, ≤ 80 characters, readable
  alone as a row. "This setter never runs." System-1 friendly, zero filler, no
  mechanism, no hedge.
- **consequence** — what will happen, future tense. When confidence is not
  `certain`, this is the sentence that carries the hedge ("will probably do
  nothing").
- **remedy** — only what a quick fix cannot say.
- **why** — fact ids.
- **severity**, **confidence**, **basis** — three independent fields:

  | field | answers | drives |
  | --- | --- | --- |
  | severity | what breaks if the rule is right — the profile, an entry, wasted work, nothing | squiggle colour |
  | confidence | how sure — `certain` (follows from the text, or from source read line by line), `likely` (evidence with a known way of being wrong), `possible` (one probe, one aircraft) | the wording, and whether `error` is allowed |
  | basis | where the knowledge comes from | the chip only |

  The first draft had basis *cap* severity. That was wrong and the user caught
  it: something the SDK defines definitively can be a high-severity error, and
  `k-arity` already is one. `not-settable` is info because 119 working corpus
  entries contradict the SDK column — low confidence — not because its basis is
  the SDK. The only link kept: **an error must be certain.**

`structured.test.ts` runs a fixture profile through the real `analyzeProfile`
and holds every finding to: error ⇒ certain; verdict ≤ 80; no backticks in the
plain parts; a basis always; a `why` unless the basis is `grammar`; and no rule
left writing `message` by hand, which is what keeps a new rule from arriving in
the old shape. The register is written up in `docs/copy.md`.

### 3. The entry trace — built

What is unique here is that the app can *compute* what FS Copilot will do with
a line. So show it. A panel that follows the caret, one entry at a time, every
line computed and none authored.

A healthy `shared:` entry (names illustrative):

```yaml
shared:
  - get: A:LIGHT LANDING, Bool
    set: (>K:LANDING_LIGHTS_TOGGLE)
    skp: L:LANDING_LIGHT_SW
```
```
A:LIGHT LANDING, Bool                                        shared
───────────────────────────────────────────────────────────────────
WHEN IT CHANGES HERE                                       now ● 0
  1  send     to the other pilot
  2  skp      the next change of L:LANDING_LIGHT_SW is not sent  (2 s)

WHEN A VALUE ARRIVES                       value [ 1 ]   current ● 0
  1  kind     prepended — starts with (
  2  builds   1 (>K:LANDING_LIGHTS_TOGGLE)
  3  guard    writes >K: and contains TOGGLE — skipped when value = current
              1 ≠ 0, so it runs
  4  runs     in the calculator
  5  echo     the next change of A:LIGHT LANDING is not sent back  (2 s)
                                                        [ Run in sim ]
```

`value` is a field you type into; `current` is live when the sim is connected.
Set `value` to 0 and step 3 flips to "0 = 0, so it is skipped" and steps 4–5 go
grey. A beginner learns the toggle guard by doing, not by reading a paragraph.
Note where `skp` sits: on the **send** side — see *Known-wrong text*.

The corpus's `dead-set` case:

```yaml
master:
  - get: A:GENERAL ENG THROTTLE LEVER POSITION:1, Percent
    set: K:THROTTLE1_SET
```
```
WHEN A VALUE ARRIVES                                    value [ 50 ]
  1  kind     literal — no ' ` ? { } and does not start with (
  2  builds   K:THROTTLE1_SET
  3  master:  not run — read as  args (>NAME, units)
✗ 4  match    no (>…) at the end — this text is never used
  5  instead  50 → A:GENERAL ENG THROTTLE LEVER POSITION:1, Percent
```

The diagnostic *is* step 4. "Falls back to writing the `get:` variable" took 30
words in the old message; here it is one line showing the actual value.
`master-set-shape` works the same way: `(L:FOO) 2 * (>K:X)` shows
`args  (L:FOO)→0  2  *→0   sends [0, 2, 0]`.

**Why it is tractable**, which was the worry:

- The trace does not need to understand setters, only to do what FS Copilot
  does. Everything between "a value arrives" and "the sim is called" is about
  100 lines of C#: `Set`, `ParseSet`, `ApplyTo`, `SimClient.Set`. Four kinds,
  two blocks, the `>K:#` route, the toggle guard, skip registration. We already
  mirror most of it in scattered places — `setKind`, the regex and `NUMERIC` in
  `master-set.ts`.
- **Complex JavaScript is a black box, and that is correct.** FS Copilot does
  not understand the JavaScript either: it evaluates it, then inspects the
  *output string* — the toggle guard and `ParseSet` both run on the output. We
  can evaluate it too: main already resolves JS setters for the run popover
  (`setter.ts`; the renderer cannot, the CSP has no `unsafe-eval`). A 30-line
  `switch` shows as `value [ 2 ] → builds (>B:X_ON)` and steps 3–5 proceed on
  that string.
- That is also a large win on its own: `dead-set`, `master-set-shape` and
  `no-write` all go silent on JavaScript setters today. With the evaluated
  output they can run for a concrete value — the corpus has 6,720 such entries.
- **Build the model before the panel**, as a pure function in `src/shared`
  returning steps, and make the dialect rules read from it: `dead-set` becomes
  "the match step failed". Then a squiggle and the trace cannot disagree.

  > **Model built 2026-09-19** — `src/shared/trace.ts`, 51 tests written from
  > the C# rather than from the implementation. It mirrors eight functions,
  > not the four this section estimated: the `Definition` constructor,
  > `ParseSet`, `ApplyTo`, `SimClient.Set`, `TransmitKEvent`, `SimClient.
  > Stream`, `Coordinator.AddLink` and `InferDataType`. It takes the built
  > string as an input, so `Definition.Set` stays in main where the only
  > JavaScript evaluator is.
  >
  > **Hard part 2 is closed.** `InferDataType` → `ToClrType` gives the CLR
  > type per unit (`Percent` and `Feet` are ints, `Number` is a double, empty
  > units are a *string*, and an `L:` var is always a float), so the toggle
  > guard no longer hedges. Reading it turned up better: `currentValue` starts
  > null and `ApplyTo` tests the raw parameter, not the `current ?? value` it
  > used to build the expression — so **the first apply after connecting is
  > never toggle-guarded**.
  >
  > **The rules read from it (2026-09-19).** `master-set.ts`'s private
  > `PARSE_SET` and `NUMERIC` are gone; `dead-set` and `master-set-shape` ask
  > `parseWrite` and `isNumericParam`, the same functions the trace asks.
  > Proved by dumping all 356 corpus diagnostics before and after: byte for
  > byte identical. `no-write` needed no change — it asks `collectRefs`
  > whether there is any write at all, and never held a copy of the regex.

The hard parts, honestly:

1. **One value shows one branch.** Later: cheap samples — 0, 1, the live
   `current`, and any literal the text compares `value` against (`case 2:`,
   `value == 3`) — and list the distinct outputs.
2. **Value types.** The guard is `value.Equals(current)` on boxed .NET objects,
   so a `1.0` double is not equal to an `int` 1. Which type arrives per unit
   (`SimConnectExtensions.InferDataType`) has not been traced. Until it is, the
   step says "skipped when equal" and claims no result on edge cases.
3. **Fidelity.** A trace that lies is worse than none. Table tests derived from
   the C#, plus the `check:claims` anchors.
4. **The panel** is the bigger half of the work: following the caret, live
   bindings, greyed steps. **Its design is settled and written down separately
   — [trace-panel.md](trace-panel.md).** Read that before touching
   `components/trace/`; every decision in it was taken with the user over
   eight mockup iterations, including two that were built and rejected.

   > **Finished 2026-09-20** — the rendering in trace-panel.md, the model's
   > `result` step, `at.end` for the locator, and the editor lift. Driven in
   > the app against the real corpus; all four of the design's states
   > reproduce. What is left is listed under *Open* in that day's log entry
   > and in trace-panel.md's own Open section. **The parity work at the end
   > of trace-panel.md is not started.**
   >
   > **Built 2026-09-19** — `components/trace/`, a third bottom panel beside
   > Log and Issues, neutral colour, rail button in the bottom group. Two
   > halves side by side, because the slot is wide and short and an entry is a
   > thing with two directions.
   >
   > **It does not touch run-setter** (the user's call). It calls the same
   > `setter:preview` IPC that popover does, so main stays the only place
   > JavaScript is evaluated and the two can never disagree about what a
   > setter builds.
   >
   > **`activeLine` is not the caret.** It is the first *visible* line, and it
   > drives the sidebar highlight; the panel was built against it and reported
   > line 1 for every entry in the file. `lib/caret.ts` now carries the caret
   > properly, reported from the editor's existing cursor subscription.
   >
   > **A step is marked, never removed** — the model returns the whole path
   > and flags what did not happen, so typing in the value field cannot reflow
   > the rows under it. That is a model change the panel forced, and it is
   > more faithful either way: the `return` above `Skip.Next(Get)` means the
   > echo genuinely does not happen, which is what `skipped` says.

A panel, never inline: an inline view would push lines down, and `docs/ui.md`
says state changes never move a box. It probably sits with, or absorbs, the
run-setter UI (`components/run-setter/`) — not yet read closely. A second
diagnostics panel beside Issues is already planned for the rail.

### 4. The hover card — built

**Decided: stay inside Monaco's hover widget.** How that widget works, since it
was misdescribed once: there is one popup, and inside it Monaco stacks a plain-
text section for the marker and a markdown section for each block each hover
provider returns, separated by thin rules. Today that is up to four sections.
"One card" means the **card** is one section — not that the popup is. On a
diagnosed span the popup is three, and §2's venue table is where that was
decided: marker, then Why, then the card. Each answers a different question,
which is the whole point of the split — the finding, the mechanism, the thing.
A JavaScript setter adds TypeScript's, making four.

> **Seen in the app, 2026-09-19.** Three sections wherever there is a
> diagnostic on the span: marker, then the **Why** section, then the card,
> marker-first. That is §2's venue table exactly, and the app matches the
> design. The "two" this paragraph used to claim was a sentence written before
> the Why section existed and never reconciled — an arithmetic slip in one
> paragraph, not a disagreement about the design. Corrected above. With no
> diagnostic on the span the card is alone in the popup, as intended.
>
> Two hovers beside it turned out not to fire at all: the `skp:` value's and
> the schema's, on block keys and entry keys. Both fire now — see log.md. One
> consequence for the decision recorded below: it was costed partly on
> *losing monaco-yaml's key hover*, and monaco-yaml is gone, so that line of
> the costing no longer applies either way. The decision itself stands as
> taken; nothing here reopens it.

The custom alternative was considered and set aside: turn Monaco's hover off
and position a React card ourselves (run-setter's `widget.tsx` is already React
inside the editor). It would give one merged card with the verdict on top in
its severity tone, shadcn styling and tokens as `docs/ui.md` wants. It costs
rebuilding hover delay, stickiness, the keyboard trigger, edge positioning and
dismissal, and loses monaco-yaml's key hover (which the facts table replaces
anyway). So: **build the card as data** in a Monaco-free module — `hover-card.ts`
already is one — render it to markdown now, and the custom renderer stays a
contained swap.

Anatomy, in markdown — so no right alignment, and **no live value**: it is
already inline in the editor's gutter, and Monaco renders a hover once, so it
would be a frozen snapshot anyway.

```
K:2:KOHLSMAN_SET — key event
Sets the altimeter's Kohlsman setting.  · SDK

[1]  Altimeter index     pushed first
[0]  Value to set        pushed last

Written by 41 entries
```

1. identity — name and namespace noun
2. one description, its source named — a profile comment beats the SDK
3. **one** position-specific fact, by priority: an access problem, then arity
   and operand order, then a units note
4. footer — usage

`refCard` in `hover-card.ts`, one markdown block; `profile-hover.ts` returns
that and nothing else. The parts are the same functions the old `refHeader`
stacked, picked from rather than concatenated — `refHeader` stays beside it,
rendered by nothing, because a card is easier to judge against the thing it
replaced.

Two things decided while building it:

- **No More link.** The "Written as" YAML samples, the file list and the
  section headings were to move behind one, but the Reference panel it would
  open is stage 6. So they are simply not in the hover: `documentation()` still
  assembles them for completion's panel, a venue with room, and they come back
  to the hover when there is somewhere for More to go. The user's call —
  trimming now and judging the card on its own terms beat pulling stage 6
  forward.
- **The operand list replaces the matching-arity note.** A `K:2:` call that
  agrees with the catalogue used to get "takes 2 parameters, pushed
  **reversed**"; it now gets the parameters themselves, in writing order. A
  *mismatch* still wins over both — it is the fact, and the list is not.

### 5. Suppression comments — not started

```yaml
  # fsc-editor: allow dead-set — the fallback write is the point
  - get: A:GENERAL ENG THROTTLE LEVER POSITION:1, Percent
    set: K:THROTTLE1_SET
```

- One form only: a comment line directly above the entry, covering that entry.
- The same line in the header block covers the file
  (`# fsc-editor: allow header-updated`).
- The reason after the em dash is optional; the quick fix "Allow this here"
  leaves the caret there, because other people will read this file.
- A suppression that matches nothing becomes an info.
- FS Copilot ignores comments, so the file that loads is unchanged — the
  project's first rule.
- **Base work:** the grammar needs a new line kind, `directive`. Without it the
  scanner classifies the line as prose, the corpus indexer takes it as the
  variable's *description*, and it shows up in other people's completions. The
  formatter must pin the directive to its entry.

### 6. The Reference panel — not started

In-app, not a website. "Why" in the hover and the marker's rule id both open it.

**Rule pages** are mostly generated from what a structured diagnostic already
has:

```
This setter never runs                              dead-set · warning
──────────────────────────────────────────────────────────────────────
What FS Copilot does
  A master: setter is never run as RPN. The built text is matched against
  args (>NAME, units); with no match the value is written to the get:
  variable.                                    Based on FSC source code

Broken                              Fixed
  set: K:THROTTLE1_SET                set: (>K:THROTTLE1_SET)

In this file        line 212 · line 219 · line 240
When to allow it    The fallback write is what you want.
                    # fsc-editor: allow dead-set — …
See also            How a set: is built · The two blocks
```

The broken/fixed pair doubles as a test — broken must trigger the rule, fixed
must not — so a page cannot go stale.

**Concept pages** (~8) are the only authored prose, and are where the lectures
go once they leave the messages: the two blocks · how a `set:` is chosen and
built · `master:` does not run RPN · `K:` parameters and operand order · `B:`
input events · `skp` and echo · the toggle guard · namespaces and units. One
screen each, each embedding a live trace, preferably of an entry from the open
file. **Write one rule page and one concept page first** so the format can be
judged before the rest are built — the user's response to these was lukewarm
("okay, I guess let's see them"), so they have to earn their place.

---

## Order

1. ~~Facts table, the structured shape, every rule converted~~ — done, and
   confirmed rendering (step 3).
2. ~~The hover card, together with the wrong prose still live outside
   diagnostics~~ — done. Three facts were added for it:
   `skp-marks-on-send`, `echo-held-back-automatically`,
   `bare-name-not-streamed`. The master-block empty-string fallback needed no
   new fact — `master-fallback` already covers it, since empty text matches no
   `(>NAME)` either.
3. ~~See stages 1–2 in the running app~~ — done, and it earned its place in
   the order. The card is right; two hovers beside it turned out never to
   fire, which no test asked about because no test renders a hover.
4. ~~Make the unreachable text reachable~~ — done, and it was three defects
   rather than two. `skp:` and the key hovers were each one cause; between
   them sat a third nobody had noticed, because the sweep that found it was
   written to check the first two: **nine in ten JavaScript setters had no
   JavaScript at all**, the quoted ones. Every string in copy-review.md now
   renders.
5. ~~The found-not-invented defects left over~~ — done. The BOM is fixed; the
   heading-as-description is the user's *no*, recorded as one; and the
   popup-sections question turned out not to be a question — §2 had already
   answered it and §4 had one stale sentence, now corrected. Nothing here was
   redesigned.
6. **The copy pass — parked until Fable is available** (the user's call,
   2026-09-19). Every string Opus 5 wrote on 2026-09-19 is listed in
   [copy-registry.md](copy-registry.md) with where it lives and where it
   shows.
7. The trace model in `src/shared`; dialect rules read from it.
8. The `directive` line kind and suppression.
9. The trace panel, then the Reference panel — which is also what gives the
   hover's More somewhere to go.

Whether to fix factual errors *first* was discussed and deferred: some of that
prose will be cut during the polish, so fix as each surface is reached. Both
behaviour items are now done — completion no longer appends `_Set` blind, and
`get-no-prefix` is the rule for bare names.

## Known-wrong text still live

**None.** Everything this section listed is fixed, each surface now saying
what the source says:

- **`skp:`** — the hover (`hover-card.ts`), `ENTRY_DOCS` in `completions.ts`,
  the schema in `profile-schema.ts` and `docs/fscopilot-behavior.md` all say
  it now: the mark is registered on **send**, from a `shared:` entry only, and
  the echo after applying is automatic. Facts `skp-marks-on-send` and
  `echo-held-back-automatically`.
- **Bare names** — the hover says an unprefixed name reaches neither the sim
  nor the calculator; `parse.ts`'s comment no longer implies the sim receives
  it, and says what `ns: null` really covers (a bare name *and* an unknown
  letter, which are not alike — any letter with a colon routes to the sim
  module). `get-no-prefix` is the rule. Fact `bare-name-not-streamed`.
- **Bare `B:` writes** — one account in all three places: it is up to the
  aircraft. The hover says so, the rule stays muted, and completion no longer
  appends `_Set` to a name the aircraft never enumerated — `writeOffer` takes
  a `knows` predicate and offers the bare name with a note when there is no
  `_Set`.
- **The empty-branch guard** — `EMPTY_BRANCH` in `set-templates.ts` now
  separates the two blocks: nothing happens in `shared:`, and in `master:`
  the fallback writes the value to the `get:` variable.
- **"bus"** — gone from the schema and the template label; both say *input
  event*. The schema's prefix list names the five common ones and says there
  are seventeen, and adds what a name with no prefix does.
- **Block descriptions said twice** — one `BLOCK_DOCS` table in
  `profile-schema.ts`, with a `summary` for completion and a `detail` the
  schema's hover appends. `completions.ts` imports it.
- **`docs/fscopilot-behavior.md`** — the `skp` section is rewritten, and the
  `SimClient.Set` table has a bare-name row plus the missing-`else` note.

## Source findings not yet used

Things read in FS Copilot's source that nothing in the editor reflects yet.
Read, **not probed**.

- **`SimClient.Set` has no `else` before its last branch.** `L:`, `A:` and `K:`
  names each take their SimConnect path and then *also* match
  `name[1] == ':'`, which wraps the value back into calculator code and
  executes it. As written, a `master:` write to a `K:` event transmits it and
  fires it again through the calculator. Worth a probe; if real, it is an
  upstream bug and it changes what `dead-set`'s fallback does.
- **A guard that returns `''` still registers a skip.** In `ApplyTo`'s shared
  branch, `if (fromPeer) Skip.Next(Get)` runs before `sim.Execute(expression)`,
  and `Execute` returns early on an empty string. So nothing changes, but the
  counter is armed — and the next genuine local change of that variable within
  2 seconds is swallowed rather than sent.
- **A JavaScript setter must return a string.** `engine.Evaluate(_set)
  .AsString()` throws on a number or boolean; the catch logs and returns `""`.
  `value ? 1 : 0` silently does nothing (or, in `master:`, falls back).
- **The no-units default tests the first character, not the prefix:**
  `Get[0] == 'K' || Get[0] == 'H'`. Moot while bare names are dead, but it is
  how `HEADING INDICATOR` would lose its `Number`.
- **An `H:` `get:` is delayed 500 ms** before sending
  (`simRx.Delay(500ms)`). Nothing mentions it.
- **`master:` entries are sampled at 30 ms and sent unreliably; `shared:` sends
  every change, reliably.** This is the "once over each channel" in
  `block-conflict`, and the reason a both-blocks entry might be deliberate.
- **Duplicates multiply.** Incoming updates are matched by name alone, so two
  entries for one name each apply every update — and each sends. One change is
  up to four setter runs on the other side.
- **A YAML failure logs at Error level**, not Information — only a missing file
  logs at Information. `block-key.ts`'s file comment says otherwise.
- **An unknown key in an *included* module loses that module** and what it
  includes; the including profile survives. In a root profile it loses
  everything. `block-unknown` says "this whole file", which is right for both.
- **"No profile available for the {aircraft}"** is `MainViewModel`'s string for
  `ViewErrors.NotSupported`. That an empty definition set triggers it was not
  traced, so no fact claims it.

## Gaps worth closing

The first few came out of running the app rather than reading it, and are
**defects, not gaps**. Three are fixed and struck through; what is left at the
head of the list is the leftovers of that pass, and they stay there because a
defect found by use outranks a feature thought up at a desk.

- ~~**A leading BOM costs a file its whole analysis.**~~ — fixed
  (2026-09-19). Two corpus modules (`AS_GNS430.yaml`, `AS_GNS530.yaml`) open
  with a UTF-8 BOM; `﻿shared:` failed `BLOCK_KEY`, fell through to
  `KEY_VALUE`, and line 1 became a `mapping` at indent 1. `context.block` then
  stayed null for the **whole file**, so all 22 entries in each were
  attributed to no block and no entry-level or profile-level rule ran on them.
  `classifyLine` now classifies line 1 on a BOM-stripped copy while `text`
  keeps the raw line, so columns still mean what Monaco means by them, and the
  formatter leaves the BOM where it found it — FS Copilot strips it on read
  either way, so removing it would be a save that changes a file nobody asked
  to change.

- ~~**The `skp:` hover does not fire.**~~ — fixed (2026-09-19). `expressionAt`
  claimed the line: its guard excluded `get:` only, and `skp` is the other
  continuation key, so territory one swallowed the hover before territory
  three could answer. The guard now names `set:` positively.
- ~~**A quoted JavaScript setter gets no JavaScript.**~~ — fixed
  (2026-09-19). `Expression.text` kept the YAML quoting, so the JavaScript
  service was handed a string literal and had nothing to say about the code
  inside `${…}` — nine in ten JavaScript setters in the corpus, measured.
  `text` is now the value and `startColumn` points at it, so the offset shift
  folds into the field that always meant it; `analysis.ts` lost its private
  `unquoted()` and every mapping site's `+ delta`, and `grammar.ts` gained
  `valueSlice` beside `plainValue` and `scalarValue`. The same change fixes
  the 22 single-quoted literal setters that were read as JavaScript because
  `'` is a trigger character.
- ~~**monaco-yaml contributes nothing — not hovers, not diagnostics.**~~ —
  dropped (2026-09-19). The cause was a dependency break, not a binding
  problem: `monaco-worker-manager` calls
  `monaco.editor.createWebWorker({ moduleId, label, createData })` and
  monaco-editor **0.53.0 replaced that signature** with `{ worker }`, so the
  worker never started and every request answered *Missing requestHandler*.
  monaco-yaml 5.5.1 is the latest release and still calls the old signature.
  Rather than pin three releases back or hand-match a private worker
  handshake, the two things it owed us are now ours: `key-docs.ts` holds the
  prose and `profileHover` renders it, `key-unknown` reports an unrecognised
  key. Nothing was lost — it had all been dead since the editor moved past
  0.52.
- ~~**The popup stacks three sections, not two.**~~ — not a defect
  (2026-09-19). §2's venue table already puts the Why section in the hover,
  under the marker; three sections is the design, and the app matches it.
  §4's "two" was one stale sentence, now corrected there. The design was
  never the problem here, and a session spent most of an afternoon circling
  it before reading §2.

- **The verdicts restate the facts they cite — Opus 5 wrote them badly.**
  Five of the eight rules that fire on the corpus *and* cite a fact re-say
  that fact in their own verdict or consequence, at 41–50% content-word
  overlap: `duplicate-get` ↔ `one-subscription-per-entry`,
  `get-unit-meaningless` ↔ `unit-ignored-without-units`, `stack-balance` ↔
  `setter-kind-by-shape`, `get-no-prefix` ↔ `bare-name-not-streamed`,
  `header-updated` ↔ `updated-date-compared`. Hovering `NO_PREFIX_NAME` serves
  one fact three times in ninety words, with *the simulator* and *the sim* in
  the same popup. The other 22 rules are unmeasured, not clean. Opus 5 wrote
  all of it; see [copy-registry.md](copy-registry.md) for the 2026-09-19
  strings.

- ~~**`get-no-prefix`**~~ — built. Error, certain, basis `source`. The fix is
  offered only when the catalogue recognises the name as a simulation
  variable, because `A:` is right for most of the 17 dead lines and wrong for
  `LXPDR_CLR`, which wants `L:` and a missing character.
- **A `skp` family** — a value that is not a name (16 corpus lines, such as
  `skp: true`); `skp` in `master:`; a name no shared `get:` declares (needs the
  include tree).
- **A JavaScript setter whose result is not a string.** Needs evaluation — a
  natural first customer for the trace model.
- **`skp:` in a `master:` entry**, and a `skp:` naming a variable no
  `shared:` entry watches — both do nothing, and `skp-marks-on-send` now
  states why. Cheap for the first; the second needs the include tree.
- **Empty-branch guards in `master:`.**
- ~~**Schema-level failures in our own voice.**~~ — `key-unknown` built
  (2026-09-19): an unknown key inside an entry or at the top level, error,
  certain, with `block-unknown`'s consequence word for word because the
  consequence is the same. **Still open:** a *duplicate* block, and a known
  key carrying the wrong shape (`shared: x`, which throws on the type rather
  than on the name) — neither has a rule.
- **`invisible-chars` knows nine characters** — NBSP, the three zero-widths,
  BOM, four curly quotes. Other Unicode spaces (U+2000–200A, U+202F, U+3000)
  match JavaScript's `\s`, so the tokenizer treats them as ordinary whitespace
  and nothing is said. En and em dashes pasted for a minus are not caught.
- **RPN word hovers** that say what the word does, not only "pops 2, pushes 1".
- **A units card** — `profile-hover.ts` already leaves the span free for one.
- **Operand help while typing a `K:2:` call** — the corpus's commonest mistake
  class has signature help for JavaScript only.
- **The new-profile template, when there is one, should carry `# Updated:`**;
  `header-updated` stays as the backstop. There is no template today, only the
  header completion.
- **Open question:** are the corpus's 30 both-blocks cases (mostly Aerosoft
  CRJ, `master:` first) a deliberate fast-stream-plus-reliable pattern? If so
  `block-conflict` should be info.

---

## The rule catalogue, as it stands

29 rules. Verdict · consequence · remedy, as the marker shows them. Fix titles
in brackets.

### Expression rules

| Rule | sev · conf · basis | Text |
| --- | --- | --- |
| `rpn-unterminated` | error · certain · grammar | This ( is never closed. Everything after it will be read as part of it. [Close with )] |
| `rpn-braces` | error · certain · grammar | This } has no if{ or els{ to close. / This if{ is never closed. Every if{ and els{ block should end with its own }. |
| `invisible-chars` | warning · possible · grammar | This is a curly quote, not a straight quote. You probably did not mean it — it usually arrives with pasted text, and it may not be read as the character it looks like. / There is a zero-width space here. You probably did not mean it — it usually arrives with pasted text, and nothing on screen shows it is there. [Replace with … / Remove it] |
| `ns-access` | warning · likely · sdk-docs | A key event is fired, not read. This read will give nothing. To fire it, write (>K:X). / A gauge variable cannot be written from a profile. This write will do nothing. / Environment variables are read-only. This write will do nothing. |
| `unit-meaningless` | info · likely · sdk-docs | A key event has no units. The Bool here will be ignored. [Remove the unit] |
| `k-arity` | error · certain · sdk-docs (operands laid out) | KOHLSMAN_SET takes 2 parameters and this call passes 1. Only the last value will reach the event, and its other parameters will be 0. [Change to K:2:KOHLSMAN_SET] |
| | warning · likely (otherwise) | …passes 1. The parameters it leaves out will be 0. Push them in this order: Altimeter index, then Value to set. |
| | warning · likely (too many) | TOGGLE_ICS takes 1 parameter and this call passes 2. The SDK documents no use for the extra value. [Change to K:TOGGLE_ICS] |
| `k-operand-order` | warning · likely · sdk-docs | KOHLSMAN_SET's values look swapped. As written, the synced value will be read as the Altimeter index and 1 as the Value to set. [Swap the operands] |
| `b-write-op` | warning · likely · sdk-docs | B:X_Inc names an action, not a value. Reading it will probably not give the control's position — that is probably on B:X. [Change to B:X] · *its bare-write branch stays muted behind `BARE_WRITE_MUTED` and unconverted* |
| `b-preset-unknown` | warning · likely · observed | The aircraft in the sim has no input event SAFETY_ELT_2_Push. This write will do nothing. SAFETY_ELT_2 is not there either. It can also be missing because the aircraft has not finished loading, so check again once it has. |
| `b-write-bare` | warning · possible · observed | X is an input event ID, not an action. This write will probably do nothing. An action should follow the ID, as in X_Set or X_Toggle — which ones exist depends on the aircraft. |
| `stack-balance` | warning · likely · grammar | This needs 2 values and the stack has 1. It will not compute what it looks like it computes. / This setter leaves 1 value on the stack. The value FS Copilot puts in front may never be used, so the setter would ignore what it was sent. / …A value left over usually means something was meant to use it. |

### Entry rules

| Rule | sev · conf · basis | Text |
| --- | --- | --- |
| `get-no-prefix` | error · certain · source | This name has no namespace prefix. The entry will do nothing — the value is never read, sent or applied, and FS Copilot will load the profile without complaint. [Change to A:X] · *the fix only when the catalogue knows the name; otherwise the remedy names the shape* |
| `dead-set` | warning · certain · source | This setter never runs. The incoming value will be written to A:X instead, and K:Y will never fire. [Change to (>K:Y)] |
| `get-preset-unknown` | warning · likely · observed | *b-preset-unknown's verdict and remedy.* This entry will never report anything. |
| `b-value-constant` | info · possible · observed | X has fired 10 times and its value has not changed. This might mean that this event carries no value and can't be relied upon. Or it might mean that the value hasn't changed between these 10 instances. |
| `ref-unresolved` | warning · likely · observed | The aircraft in the sim has no Z:X. This entry will sync a constant 0 and nothing will look broken — FS Copilot's own read creates the variable. A variable can appear late, so check on an aircraft that has finished loading before changing it. |
| `get-unit-meaningless` | info · likely · sdk-docs | *word for word `unit-meaningless`* — the same finding on a different line should not read as a new one. |
| `not-settable` | info · possible · sdk-docs | The SDK lists A:X as read-only. With no set: line the incoming value is written straight to it, and that write may go nowhere. The usual way round is a K: event in a set: line. |
| `prepended-unused` | warning · likely · source | This setter never uses the value it is sent. A:X will be set to whatever this computes, not to what the other pilot sent. |
| `value-word` | warning · certain · source | value only exists in a JavaScript setter, and this is not one. The calculator will ignore it, and the rest will run without it. To use it, write the setter as a JavaScript template string. |
| `master-set-shape` | warning · certain · source | A master: setter computes nothing. (A:FOO, and Bool) will each be sent as 0 — everything before (>K:BAR) is read as plain numbers. |
| `no-write` | error · certain · source | This setter writes nothing — there is no (>…) in it. A:X will never apply a value from the other pilot. [Change to (>X)] |

`prepended-unused` has zero corpus hits; it needs a setter that starts with `(`
yet brings every operand itself — a read-negate-write toggle such as
`(A:FOO, Bool) ! (>A:FOO, Bool)`. `no-write` is decided from the text alone:
a `shared:` literal or prepended setter with no `(>…)` anywhere, including
inside strings and template holes.

### Profile rules

| Rule | sev · conf · basis | Text |
| --- | --- | --- |
| `duplicate-get` | warning · certain · source | L:X is already declared, identically, at line 3. Every change will be sent twice and every incoming value applied twice — a double press for a push or a toggle. |
| `block-conflict` | warning · certain · source | L:X is in both master: and shared: (also at line 12). When the pilot in control changes it, the change will be sent twice (once over each channel), and the other pilot will run both setters for each one. |
| `include-missing` | warning · certain · source | modules/paload.yaml was not found in the workspace. [Change to modules/payload.yaml] |
| `header-updated` | error · certain · source | This profile has no Updated date. If a published profile exists for this aircraft, FS Copilot will offer to replace this one every time it checks, however current this one is. Add a header line such as # Updated: 2026-08-29. |
| `block-unknown` | error · certain · source | sharde: is not a block FS Copilot knows. This whole file will fail to load — none of its entries will sync, and nothing it includes will either. [Change to shared:] · *with no near match:* The blocks are shared:, master:, include:, ignore: and pointer:. |
| `ignore-duplicate` | info · certain · source | X is already ignored, at line 3. The repeat changes nothing. |
| `panel-missing` | info · likely · observed | No panel in the aircraft in the sim is called displayunits. This entry will have no effect. [Change to DisplayUnits] / DisplayUnits is in the aircraft in the sim, but not with this key. This entry will have no effect. The keys there are …. DisplayUnits alone takes every panel that reports it. [Change to DisplayUnits] |

`duplicate-get`'s double sync is certain from source and has never been tested
in the sim. `include-missing` says nothing more on purpose: modules ship with FS
Copilot, so a miss is as likely to be the wrong workspace as a wrong path.
`header-updated` stays error by the user's call.

Retired: **`toggle-guard`** — see log.md. Its fact remains.

## The facts, as they stand

30 in `facts.ts`. Source-backed (anchored, swept — 33 anchors):
`master-parsed-not-run`, `master-fallback`, `unknown-key-fails-load`,
`setter-kind-by-shape`, `implicit-setter`, `shared-runs-in-calculator`,
`toggle-guard` (cited by no rule now), `one-subscription-per-entry`,
`block-authority`, `include-missing-skipped`, `updated-date-compared`,
`ignore-is-a-set`, `skp-marks-on-send`, `echo-held-back-automatically`,
`bare-name-not-streamed`.
Sim-tested: `k-bare-pops-one`, `k-zero-pushed-last`,
`input-events-listed-by-id`, `b-write-needs-action`,
`input-events-register-late` (which says plainly that it was measured for `L:`
and not for input events), `momentary-reads-zero`, `calculator-read-creates`,
`bare-word-ignored`, `unit-ignored-without-units`, `pointer-matches-exactly`
and `panel-key-query` (both to move to `source` with anchors once upstream has
`hook.js`). From the SDK: `b-value-on-id`, `ns-fired-not-read`, `ns-read-only`,
`sdk-settable`.

The three added in stage 2 are the last of that list; `master-empty-falls-back`
was not needed, because `master-fallback` already says what happens to a
setter that does not end in `(>NAME)` and empty text is one of those.

## Settled wording

In `docs/copy.md`:

- **the workspace** — the folder the app has open. This *reversed* the earlier
  "folder, never workspace". Several empty states still say "this folder"
  (editor, file tree, Remote Connect picker) while Settings is titled
  "Workspace"; noted, not swept.
- **the other pilot** — FS Copilot's sync partner. Never peer, never the other
  side. (Remote Connect keeps *the host* and *peers*.)
- **the aircraft in the sim** — never "the loaded aircraft".
- **the pilot in control** — FS Copilot's master.
- Rules of the language are normative: "should end with", "should follow".
- No advice the author can work out alone — "Move the entry to shared:" was
  cut: they probably had a reason to try it under `master:`.
- A heads-up reads as one: "You probably did not mean it".
- Filler goes: "on it".
- The user's own phrasing is kept verbatim where given, parentheses included
  (`block-conflict`, `b-value-constant`), over the house rule that
  parentheticals are a smell.
- `pointer:` is a valid block — the upstream PR is coming — and is never
  flagged. FS Copilot version targeting is out of scope for now.

## Details worth keeping

**Stage 1 made the hover longer, not shorter.** The Why section is a *fifth*
possible section in the popup (marker, TypeScript card, ref header, entry
documentation, Why). That is acceptable only as a waypoint: stage 2 has to net
reduce — the ref header and the entry documentation merge into the one card.

**The Issues row shows the verdict and nothing else.** The consequence and
remedy are not visible from the panel at all; you have to go to the squiggle.
Undecided: a second line, an expanding row, or leave it — the planned second
diagnostics panel beside Issues may be the better home. The row still shows the
rule id, which could become the link to the rule page. Markers already carry
`source: "fsc"` and `code: ruleId`; Monaco accepts `code: { value, target }`,
which renders the id as a link — the cheapest way into the Reference panel.
Hover markdown can also carry command links (`isTrusted`) for "More" and "Why".

**Completion contradicts `not-settable`.** `writeOffer` in `set-completions.ts`
*withholds* an `A:` variable from write position when the SDK says it is not
settable — the same column `not-settable` now treats as low confidence, because
119 working corpus entries contradict it. One of the two is wrong. Likely fix:
offer it, with a note, rather than hide it. Same file as the `_Set` append.

**The setter templates' other claims were checked and hold**: `current` falls
back to `value` before the sim has reported the variable (`current ?? value`),
so a `!!value !== !!current` guard swallows the first update; FS Copilot's own
guard covers `K:`/`B:` names containing TOGGLE and not `H:` events. Only
`EMPTY_BRANCH` is wrong, and only under `master:`.

**Corpus baseline after conversion** — `lang:sweep` over the 65 profiles in
`~/Documents/Definitions`, for spotting a regression in rule *logic* (the
conversion changed wording only):

    duplicate-get 196 · not-settable 116 · k-arity 71 · get-unit-meaningless 60
    block-conflict 30 · k-operand-order 16 · rpn-unterminated 10
    stack-balance 9 · dead-set 6 · header-updated 5 · no-write 5
    include-missing 2

Evidence rules (`b-*`, `ref-unresolved`, `panel-missing`) never fire in a sweep;
they need an aircraft. Six of the ten unterminated hits are P180 lines ending in
a stray `'` — `${value} (>K:COVER_0_SET)'` — never looked at.

**How the code is shaped**, so a new rule matches the rest:

- `diagnose({...})` is generic over the extra fields, so entry rules pass
  `target: "get" as const` and profile rules pass `line`. `why` is `readonly`.
- Where one rule has several findings, or two rules share evidence, the common
  fields are one `as const` object spread into each — `FOUND` in
  `stack-balance.ts` and `panel-missing.ts`, `ABSENT` in `b-preset.ts`, `found`
  in `ns-access.ts`. Severity, confidence and basis are then decided once, with
  the comment that justifies them.
- The comment beside `confidence` says *why that level*. That is where the
  reasoning that used to leak into messages now lives.
- Tests assert on `verdict`, `consequence`, `remedy` or `why` — never on
  `message`, which is only their concatenation.
- The Why section is `**Why** — _label_`, then each fact's statement, with the
  fact's own label under it only where it differs from the verdict's.
- `slotName()` in `k-operand-order.ts` cuts an SDK parameter description to its
  first clause; `k-arity` uses it to name slots in push order instead of
  quoting the raw `[0]: … [1]: …` string.

**Two docs now overlap the facts table** and will drift the way the messages
did unless one is made the authority. `docs/fscopilot-behavior.md` states the
same mechanisms with hand-kept anchors (and still pins `~/dev/fscopilot`, the
old path, and has `skp` wrong). `sim-vars/18-language-core.md` carries its own
rule catalogue. Proposed: `facts.ts` is the authority for mechanisms and this
file for user-facing copy; the other two cite rather than restate.

**`check:claims` has a blind spot by design.** It proves an anchor is still in
the file, not that the fact is true, and it sweeps upstream only — the two
`pointer:` facts are marked sim-tested because `hook.js` exists only in the
fork. When the upstream PR lands, give them anchors.

**How the user works**, as seen this session: edits files live while work is in
progress (a fact's wording was changed mid-conversion — "a key it doesn't
recognize"), and the direction is always plainer. Contractions are welcome.
Reads every string; expect line-by-line feedback and leave the wording easy to
change — one constant, one line.

## Working notes

- **Nothing built in stage 1 has been seen in the running app.** First thing
  next session: Issues rows showing verdicts; the Why section under a marker;
  whether Monaco puts it above or below the marker text.
- Verify scripts through their documented `npm run` command from PowerShell
  (CLAUDE.md). `check:claims` was; its failure path exits 1 with one line.
- `lang:sweep` and `check:setters` default to the old `~/dev/fscopilot` paths
  and crash without `FSCE_WORKSPACE=%USERPROFILE%\Documents\Definitions`.
  Raised as a separate task, not fixed here.
- `rules.ts`, `syntax.ts` and `b-write-op.ts` were already off-format at HEAD,
  so Prettier was not run over them. ESLint has two pre-existing irregular-
  whitespace errors in `tokens.ts`. `invisible.ts` holds literal invisible
  characters as map keys — edit it with care.
- The tree runs uncommitted. `toggle-guard.ts` is the one file deleted, at the
  user's request; it is at HEAD if wanted.
- Do not run a cockpit experiment while the user is away. Everything marked
  "not probed" above waits for them.
