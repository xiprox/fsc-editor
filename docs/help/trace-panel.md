# The Trace panel — build plan

    Status:  **built 2026-09-20** and seen in the app against the real
             corpus. Steps 1 and 3–7 below are done; step 2 was a note not to
             re-propose something. 71 tests on the model. What is still open
             is the Open section, unchanged except where noted.
    Look:    trace-panel.html — open it. It is the approved design, rendered.
             The panel now matches it; the file says to delete it at that
             point, which has not been done because deleting is a separate
             proposal (CLAUDE.md).
    Design:  settled 2026-09-19 over nine mockup iterations with the user.
    Parent:  plan.md §3 — the entry trace. Read that first for *why*.
    Order:   read this whole file before writing anything. Several of the
             obvious improvements were built and rejected; they are listed.
    Parity:  the last section is the plan for keeping the model true to FS
             Copilot. It is unbuilt and it outranks the panel.

This exists because the design was settled in conversation and the conversation
will not survive. Everything below is a decision already taken, not an option
still open; the open ones are listed at the end and are few.

---

## What is already built

- **`src/shared/trace.ts`** — the model. Mirrors eight C# functions, 52 tests
  written from the source rather than from the implementation. Returns
  `{ send: TraceStep[], apply: TraceStep[] }`; a step is
  `{ id, label, detail, state }` with `state` one of `ok | failed | skipped |
  unknown`. A step past a closed branch is **marked, never dropped**.
- **`src/renderer/src/lib/caret.ts`** — the caret, which is *not* the store's
  `activeLine` (that is the first visible line and drives the sidebar).
- **`src/renderer/src/lib/entry-trace.ts`** — `entryAt`, `bindingsFor`,
  `traceFor`. Calls `setter:preview`, the same IPC the run popover uses, so
  main stays the only place JavaScript is evaluated.
- **`src/renderer/src/components/trace/index.tsx`** — the first cut. Correct
  and ugly; this plan replaces its rendering, not its plumbing.
- Store: `"trace"` is a third `BottomPanel`. Rail button is in the bottom
  group beside Issues, **neutral** — no tone, like Variables and Log.

## The shape, settled

### Chrome

- A **bottom panel**, third beside Log and Issues. Not a side panel: the detail
  lines run 60–100 characters and need the wide short slot.
- Header row: `Trace`, then the **locator**, and nothing else. The value fields
  moved into the columns.
- **Locator** wears the title bar's FS Copilot island treatment —
  `bg-fsc-island`, **no border**, `rounded-md` (8px, from
  `--radius: 0.625rem`), `--fsc-label` text, mono 10.5px. Reads
  `master · lines 31–33`. Clicking reveals those lines.
- No entry-name row. The name is already the subject of both first steps, and
  the row cost more than it carried.
- Body: `border-top`, 14px above and below; each column padded 14px; the
  divider is **its own 1px grid column** (`1fr 1px 1fr`) so neither half owns
  it.

### Columns

- Headings **When it changes here** / **When a value arrives** — uppercase,
  10.5px, `letter-spacing: .06em`, muted, with **14px** beneath them.
- Each column carries exactly one binding, and this is the point rather than a
  convenience: the model takes two, one per direction. Left is
  `current` — the value here. Right is `value` — the one that arrives.
- The field's label **is the binding's name**, in
  `--syntax-injected` (mono, 11px, semibold) — the same colour those two
  identifiers have inside a `set:` expression. Typing in the right field and
  watching the `builds` row change is the panel teaching the binding rather
  than asserting it.
- Field: 112px wide, 22px tall, mono 11px, `--radius-sm`. Wide enough for
  `16256` and `1013.25`, which the slot has room for.
- **Live `current`**: text in `--sim-value` with a 5px lamp of the same colour
  inside the right edge. Typing overrides — text returns to `--foreground` and
  the lamp goes out. Clearing goes back to live. The old `now …` /
  `current unknown` readouts are gone, absorbed into this.
- **Both fields reset when the trace moves to another entry** (2026-09-20).
  Typing `50` into `value` to see what a throttle does and then moving to a
  landing light must not leave `50` in the field: the number was about an
  entry no longer on screen, and the panel would be answering a question
  nobody asked. Implemented as a `key` on the body — the remount *is* the
  reset, and it clears the trace with the fields, so a stale trace can never
  be drawn under a fresh locator.

  Keyed on **block and name, not the line**, so editing text above an entry —
  which moves every line number below it — does not throw away what was typed.
  Moving the caret within one entry keeps both fields.

### The timeline

Grid `12px | 56px | 1fr`. A 1px rail in `--border` down the first column, a 7px
node per step. First and last nodes clip the rail so it starts and stops at
them.

| state | node | rail below | text |
| --- | --- | --- | --- |
| `ok` | filled, muted | `--border` | normal |
| `failed` | filled `--destructive`, 3px ring in `--destructive-surface` | `--destructive-border` | normal — the label carries the colour |
| `skipped` | hollow, muted outline **at 30%** | dashed 3 on / 2 off, `--muted-foreground/40` | everything muted, **including its syntax colours** |
| `unknown` | hollow, muted outline **at 70%** — **not dashed, 2026-09-20** | `--muted-foreground/25` | normal |

**Failure never recolours the detail.** The detail is syntax-coloured and a
destructive red over it fights the palette. The timeline says *where*, the
words say *what*. This constraint arrived with the highlighting and improved
the design.

`unknown` reads exactly like `ok` on purpose: those steps already say
*only while…*, *unless…*, *never probed* in words.

**The dash is gone (2026-09-20).** A 1px dash on a 7px circle is three tick
marks at this pixel density and reads as a rendering fault, not a state — and
it was doing no work either, because `skipped` was *also* a hollow ring, so
the two differed by a dash nobody could resolve.

The four are told apart by **weight** now, which survives being small: filled
for `ok`, a ring for `unknown`, a fainter ring for `skipped`, colour for
`failed`. Fill against no fill is the most legible distinction there is at
seven pixels.

**A rail belongs to a transition, not to a row.** Each row draws two
segments: from its top down to the node centre in the *previous* step's rail
style, and from the node centre to its bottom in its own. That is what the
state table means by *rail below* — a step's state says how the thread leaves
it, not how it arrives.

Drawing one segment per row for its whole height was wrong in a way that
showed: a `skipped` row dashed its own **incoming** segment, and the dash put
a 3px void directly above the node, so the thread appeared to stop short of
the circle it was arriving at. The two segments meet at 9px, where the node
covers the join — and it removes the first/last clipping as a special case,
since the first row simply has nothing above it and the outcome nothing below.

**Every rail is on the `--muted-foreground` family**, including the dashed
one. It was on `--border` — 10% white in dark — and a dash paints only two
fifths of the line, so its coloured segments came to about 4%: not faint,
absent. With a transparent segment landing just above a node's top edge, the
thread appeared to stop short of the circle, which reads as a broken rail
rather than a dashed one. At 40% inside the dash the perceived weight is
around 16% against the `ok` rail's 25% — still the faintest of the four,
which is right, but present.

**The dash is 3 on, 2 off, and the rhythm is arithmetic rather than taste.**
Every position in the gutter is fixed, so the dash's phase against a node is
fixed too: a segment above a node starts at the row's top, the 7px node's top
edge is at 5.5, the 11px outcome's at 3.5. At 2 on / 3 off the bands fell
0–2 on, 2–5 off — a **3px void against the 7px node's edge**, the thread
stopping short of the circle it arrives at. At 3 on / 2 off they fall 0–3 on,
3–5 off, 5–5.5 on: ink touches the 7px node and leaves the 11px one a 0.5px
hair. Changing the period reopens it, so check the arithmetic rather than the
look if this is ever tuned.

**A hollow node fills with `--sidebar`.** A ring is transparent, so the rail —
drawn first, by the same row — ran straight through its middle: a hairline
across the circle, on every `unknown` and `skipped` node in both columns. A
filled node hides the rail by being opaque; a hollow one has to be told to,
and it uses the panel's own background so it punches the thread rather than
painting over it. The `failed` node needs nothing: its 2px
`--destructive-surface` ring is opaque and already occludes.

The outcome node takes the same treatment with one exception: its `unknown`
ring is **2px**, not 1. An 11px circle with a hairline outline reads *lighter*
than the 7px filled dots above it, which would make the ending look less
important than an ordinary step. At 2px the ring leaves a 7px hole and carries
a filled dot's weight while plainly not being one.

### The outcome row

Last step of each half. Node **11px, solid `--foreground`** (or `--destructive`
when the outcome is that nothing useful happened), label `result` in
foreground semibold, no bottom padding.

**Five endings, and nothing beyond them.** Every one is computed:

1. `<n>` is sent to the other pilot — *unreliably* appended for `master:`
2. the calculator runs `<code>`
3. `<EVENT>` fires with `[<args>]`
4. `<n>` is written to `<NAME>, <units>` — plus *and `<EVENT>` never fires*
   when the `ParseSet` fallback swallowed a named event
5. nothing is applied — with the reason

An outcome names **variables and events, never aircraft systems**. A draft said
*"the altimeter is set to 1016 millibars"*, which requires knowing that
`A:KOHLSMAN SETTING MB:1` is an altimeter. Nothing in the model knows that, the
SDK description is generative prose, and that is exactly how the hover card
came to serve `########### Pilot Lower Panel #########` as a description.

Note the asymmetry, and keep it: on a **`shared:`** entry the honest ending is
only that the calculator *receives* the code — we do not evaluate RPN — so
ending 2 partly restates `builds`. On **`master:`** FS Copilot parses rather
than runs, so the target, the operands and the fallback are all known and the
ending is genuinely new information. That is the same split that makes
`dead-set` findable and `no-write` only inferable.

### Syntax colouring

Every fragment that is code is painted with the editor's own `--syntax-*`
tokens through its actual scope map, so a name looks here exactly as it looks
in the file: `ref.prefix` bold, `ref.name`, `ref.write` bold, `ref.unit`,
`rpn.number`, `js.injected` for `value`/`current`, `yaml.key` for `skp:`,
`yaml.block` for `shared`/`master`, `--syntax-operator` for punctuation.

Two corrections that came out of doing it: **`TOGGLE` is a `--syntax-string`**,
not a keyword — it is a literal substring FS Copilot searches the built
expression for. And the CLR type is `--syntax-keyword`, because `int` and
`double` *are* keywords in the language they come from.

**Prose stays prose.** A duration, a rate and a count are not painted — only
things you could point at in the file. Without that rule the panel becomes a
rainbow and colour stops meaning anything.

**Where the mockup and the model disagree, the model won** (2026-09-20). The
mockup's `echo` row reads *the next change of this name is not sent back*; the
model names the variable. Kept as the model has it — it is tested copy, it
reads in parallel with the `skp:` row beside it, and *this name* asks the
reader to remember which name. Listed here because the mockup is otherwise the
authority and a future reader will notice the difference.

### The type, and its tooltip

`— as int` keeps the precise word, with a **dotted underline in its own colour**
and a tooltip carrying the consequence. Use the shadcn `Tooltip`, not `title`.

Two things the build got wrong first time, both fixed 2026-09-20 and both easy
to repeat: Tailwind's default border colour is the interface `--border`, so
`border-b border-dotted` draws the underline in 10% white and it reads as a
rendering fault rather than a hint — it wants **`border-current`**. And the
tooltip opens with **`delay={0}`** on the *trigger*, not the root: the type is
one word inside a sentence already being read, and Base UI's 600ms default is
long enough that the hint gets given up on.

| type | tooltip |
| --- | --- |
| `int` | Whole numbers only. A fraction is dropped on the way to the simulator, so a control that moves smoothly here syncs in steps. |
| `double` | A 64-bit float — about fifteen digits of precision. |
| `float` | A 32-bit float — about seven digits of precision. |
| `string` | Text rather than a number, so it is compared as text. |

### The editor highlight

While the panel is open, the traced entry's lines carry a **neutral lift**
(≈10% `--foreground`, tune in place). It follows the caret to the next entry
and clears when the panel closes. A Monaco decorations module beside
`live-decorations.ts`; "panel is open" is store state and decorations live
outside React, which is the same seam `sim-values.ts` already solves.

---

## Work, in order

> **All of this is built.** Kept as written rather than rewritten in the past
> tense, because the reasoning is why the code looks the way it does. Three
> things came out differently and are marked **· done differently** where they
> arise; the day's log entry in log.md has them together.

### 1 · model: the `result` step

`traceEntry` appends one terminal step to each half, per the five endings
above. It is a step like any other, so it carries `state`.

**· done differently.** Two things. `state` is not `ok` for 1–3 and `failed`
for 4 and 5: ending 4 is an ordinary success when the write is a real one —
the fallback *is* the design for the 60% of the corpus with no `set:` — and
turns `failed` only when it swallowed a named event. `failed` means *not what
the entry says it does*, which is the same criterion as the outcome node's
"nothing useful happened".

And there are **two more endings than five**, both on the send side, both
forced: a half whose `read` step failed cannot end "is sent to the other
pilot" (`nothing is sent — ${name} is never read`), and a half with nothing
read locally has no value to name (`the new value is sent to the other
pilot`). Both are in copy-registry.md, marked as additions.

Tests from the C#, one per ending, plus: a `shared:` run ends with ending 2; a
`master:` fallback ends with 4 **and names the swallowed event**; a closed guard
ends with 5.

### 2 · model: `phase` is **not** added

Recorded so it is not re-proposed: grouping steps under captions
(*it is read* / *before it is sent*) and renaming labels to plainer words were
both built and rejected — they made it more confusing, not less. The outcome
row does that job.

### 3 · grammar: the entry's extent

The locator needs the entry's last line, block-scalar bodies included. That
walk **already exists** in `run-entries.ts`, with the subtlety already reasoned
out: a blank line inside a literal block *is* part of the value; a blank line
before the next entry is not.

Move it into `entriesFromLines` as `at.end`, have both callers read it, and
prove `run-entries` behaves identically. Same shape as the `parseWrite`
consolidation — one walk, proved unchanged.

**· done differently.** They share the *rule*, not the loop. `run-entries`
accepts a `get:` under any block and `entriesFromLines` keeps only the two
that hold entries, so having it read `at.end` would have changed its answer
for a malformed file. `extendsEntry` is exported from the grammar and both
walks call it — which is where the subtlety lives, so it removes the drift
this step was guarding against without changing behaviour.

### 4 · panel: the rendering

Everything under *The shape, settled*. The plumbing in
`components/trace/index.tsx` and `lib/entry-trace.ts` stays; `bindingsFor` gains
a second typed field so `current` can be overridden rather than always read from
`simValue`.

**· done differently.** `TraceStep.detail` is `Part[]` rather than a string.
The panel cannot work out which fragments are code: this document's own mockup
paints the `1013` in *1013 is sent to the other pilot* and leaves the `33` in
*about 33 times a second* alone, and those are identical as text. Only the step
that built them knows which is a value and which is a rate — so the model marks
its fragments and the panel renders what it was given. `detailText()` is there
for anything wanting the words; every `detail` string is unchanged.

Two traps found while building it, both in log.md and worth repeating here:
a Tailwind class built by interpolation (`` `text-[var(--syntax-${t})]` ``) is
**never emitted**, so the colours have to arrive as an inline custom property;
and `font-mono` is not the editor's face, so the panel uses a new
`--font-editor` token instead.

### 5 · the highlight

As above. Verify it follows the caret, survives a tab switch, and clears on
close.

### 6 · verify in the app

Drive it with the CDP recipe in the `driving-the-app` memory. **`Ctrl+G` takes
`line:column`**; `Home` is smart home and lands `indent` columns off. Read the
rendered lines out of the editor before debugging — a probe reported the panel
broken twice when the app's buffer simply had an extra blank line.

### 7 · docs

log.md entry; plan.md §3 marked; **every new string into
copy-registry.md** — the five outcome endings, the four type tooltips, the two
binding labels, the column headings.

---

## Amendment — 2026-09-20: the result row stopped being a restatement

Everything above this section is the design as approved. This is what changed
after it was built and read against the real corpus, and **where it conflicts
with the sections above, this section is current.**

### What prompted it

The `result` row restated its immediate predecessor in twelve of the thirteen
shapes the model can produce. An `L:` write read `writes  L:FOO = 1, as a
32-bit float` and then `result  1 is written to L:FOO, Number`; a `K:` event
read `fires  K:FOO with [1]` and then `result  K:FOO fires with [1]`. On a
`master:` `K:` entry the built string appeared **five times in six rows**.
Only the `dead-set` fallback ending carried anything its predecessor did not.

The resolution follows the reading the user made on sight: *the result is the
nicer sentence.* So the outcome keeps the fact, and the mechanism row above it
keeps only what the outcome cannot carry — which is always the **sync** half:
the datum type, the coercion, the zeroing.

### Rows withdrawn

| row | why |
| --- | --- |
| `send` | Transport is not the author's concern — the block already decided it and nothing can be done about it either way. And *a dropped update is overtaken* was **wrong**: `Sample(30ms)` over a `SIM_FRAME` + `CHANGED` subscription is bursty, not a 33 Hz carrier, so the last sample of a movement has nothing behind it. `unreliably` left the send ending with it. |
| `fires` | Ending 61 verbatim, minus the verb. |
| `runs` | Ending 60 without the code; the empty case repeated ending 65 word for word. |
| `instead` | Ending 62 says it and also names the swallowed event. |
| `nowhere` | Ending 66 says it, and is already `failed`. |
| `sends` (operands) | The label said *sends* on the receiving side, where nothing is sent; `sends` already meant two other things in the panel. Survives as `args`, drawn **only** when `ParseParam` zeroed an operand. |

### Rows rewritten

- **`writes` (`L:`)** — `as a 32-bit float — ${units} is ignored`. The value
  and target moved to the ending, and the ending stopped appending the units
  to an `L:` name, which contradicted this very row: `SetLVar` hardcodes
  FLOAT32.
- **`writes` (`A:`)** — `in ${units} — as ${type}`, worded to match the
  read-side twin so both directions name the type alike.
- **`rounds`** — what is left of `fires`, drawn only when `NormalizeValue`
  changed an operand, showing the raw values above an ending showing the
  coerced ones.

### Operand notation

**`[0] 1, [1] 16256`, never `[1, 16256]`.** The full argument is in
copy-registry.md under *Operand notation*; the short version is that
`1 16256` written and `[1, 16256]` rendered are the same two tokens in the
same sequence meaning opposite things, and a positional list reads
left-to-right as source order, which is the misreading `k-operand-order`
exists to catch. Slot names from the SDK catalogue are **not** used, and that
is a separate decision — see the registry for why.

### What this changes about §2

§2 records that renaming labels to plainer words was built and rejected, and
that still stands: no vocabulary sweep was done here. One label changed,
`sends` → `args`, because it named the wrong action on the wrong side of the
panel. The column is still grammatically uneven and is deliberately left so.

### The governing idea: it is a timeline, so one row per thing that happens

Arrived at last, and it is what the rest of this amendment was groping for.
The rows are a sequence of things that happen, in order — so:

> **A step is drawn for each thing that happens. The result states the net.
> Where only one thing happens, the result is that thing and no separate step
> is drawn for it.**

That single rule explains every removal above, and it finally gives the result
a job no step can do. It also fixed the row this amendment had already
rewritten twice and still got wrong.

**The `also` row was prose where a row belonged.** It read
`also  1 (>K:TOGGLE_STARTER1) — FS Copilot sends the event, then runs this as
well, so it should fire twice` above `result  K:TOGGLE_STARTER1 fires with
[0] 1`. A reader counting rows saw one firing; a reader reading the sentence
saw two. A timeline was *describing* an event rather than listing it.

Two writes is **two rows**, twins, same label, in the order they happen:

```
fires   K:TOGGLE_STARTER1 with [0] 1                          ● ok
fires   K:TOGGLE_STARTER1 again, from the calculator —
        the name matches two write routes and FS Copilot
        takes both                                            ◌ unknown
result  K:TOGGLE_STARTER1 fires twice — the toggle
        reverses itself                                       ◌ unknown
```

**The twin says why, and that was the last thing missing.** *from the
calculator* names where the second write comes from and leaves the reader
asking why there is a second write at all. The answer is the missing `else` —
`SimClient.Set` tests four prefixes in a row, a `K:`/`L:`/`A:` name satisfies
its own test **and** the catch-all, and nothing stops after the first. Stated
as a fact about **the name**, so it needs no vocabulary the reader lacks.

**`fires twice`, not `should fire twice`.** The hedge is the hollow node,
which is what `unknown` draws and means everywhere else in the column. Saying
it in words as well hedged twice for one doubt.

The repetition **is** the finding: the same label appears twice because the
same thing happens twice. And the ending now states the **count**, which no
step states — each firing is true on its own and the defect is only in the
pair. That sentence is why the panel is worth opening on the PC-12's
`set: (>K:TOGGLE_STARTER1)`.

Endings by shape, all of them now the net rather than a restatement:

| shape | result |
| --- | --- |
| `K:` **toggle**, twice | `${EVENT} fires twice — the toggle reverses itself` |
| `K:` **inc**/**dec**, twice | `${EVENT} fires twice — the value moves two steps` |
| `K:` **set**/**on**/**off**, twice | `${EVENT} fires twice with [0] … — the same value both times` |
| `K:` no op in the name, twice | `${EVENT} fires twice with [0] …` |
| `L:`/`A:`, twice | `${n} is written to ${NAME} — twice, with the same value` |
| one write only (`B:`/`H:`/`Z:`) | `the calculator runs ${code}` — and **no** step row |

**Absolute and relative is the real distinction, not event and variable.** A
draft said a doubled *event* was the finding, which is too broad:
`K:LANDING_LIGHTS_SET` fired twice lands the same value, exactly as a doubled
`L:` write does. Only a relative op comes out somewhere else.

The vocabulary is `parse.ts`'s `INPUT_OP` — `set|inc|dec|toggle|on|off` —
read on a `K:` name, where the op may lead as well as trail. Over the corpus's
312 distinct `K:` names that splits 58 toggle, a handful of step, 176
absolute, and a remainder like `AP_MASTER` and `AP_ALT_HOLD` that **are**
relative and do not say so. Those fall through to the count alone, claiming
nothing — the honest answer for a name the app cannot read.

A `B:` name never reaches this table: it matches only the catch-all, so it is
written **once** and no twin is drawn. The op in a `B:` preset's name is
`b-write-op`'s business, not this panel's.

All the twice-shaped endings are `unknown`, because the second write is, and
they draw with the hollow outcome node accordingly. The `L:`/`A:` one reads
*with the same value* so the reader can see why a doubled write is harmless
there and not on an event.

### The twin shows the rebuilt expression only when the operands reorder

Which closes the last of this pass's open items. `Execute` is handed
`string.Join(' ', values)` over `ParseSet`'s **reversed** array, so
`16256 1 (>K:2:KOHLSMAN_SET)` reaches the calculator as
`1 16256 (>K:KOHLSMAN_SET)` — a genuinely different program, and the twin
saying *rebuilt as* is the only place the author is told.

The test is the **operands alone**, not the whole string. The other two ways
the rebuilt expression differs already have rows: the `K:n:` arity is
`strips`, and the dropped units are the `writes` row's *`Bool` is ignored*.
Comparing whole strings fired on those too and printed a near-identical
expression under every `L:` write in the corpus — noise standing where a
finding should be.

### The `and runs` row, rewritten

It said *a second write, from a branch with no else; read in the source, never
probed* for every prefix. Two faults: the words were spent on where the
behaviour was found rather than on what happens, and it was **false for `B:`,
`H:` and `Z:`**, where the calculator is the only route and there is no first
write for it to be second to.

Three shapes now, chosen by whether a branch above already claimed the write:

| shape | reads |
| --- | --- |
| only write (`B:`/`H:`/`Z:`) | **no row** |
| second write, `L:`/`A:` | `also  ${code} — FS Copilot writes the value, then runs this as well, so it should be written twice` |
| second write, `K:` | `also  ${code} — FS Copilot sends the event, then runs this as well, so it should fire twice` |
| second write, `K:…TOGGLE` | …`; a toggle ends where it started` |

**Naming both routes is the clause that earns its place.** A draft said only
*twice* and left the reader's first two questions open — why twice, and is
this my line's fault. Six words answer both: it is FS Copilot doing two
things, not the setter being wrong.

**Effect first, mechanism not at all.** A first attempt kept the route —
*the calculator runs it too* — and was rejected on sight: it answers a question
nobody asked, and it leans on a word the app uses 15+ times and has never
introduced (see *the word "the calculator"* in copy-registry.md, which is an
open system-level question). What the author needs is the count.

And where it is the **only** write, no row is drawn at all. Saying so was the
row's entire content, `builds` already showed the expression, and the ending
already says what happens to it.

The hedge is **`should`**, per docs/copy.md's rule that the consequence is the
sentence carrying the confidence. The `K:` shape is where it bites: a variable
written twice with the same number lands the same number, but an event fired
twice does not.

The label is **`also`**, which closes the oldest item in the Open list below —
`and runs` was the one label that overflowed the 56px gutter.

### An `unknown` outcome no longer draws as a settled one

The panel's `bad` test was `failed || skipped`, so the one `unknown` ending —
the calculator-only route — took the solid `--foreground` node, identical to a
live-verified result, one row under a hedge. It now takes a hollow dashed node
at outcome size, which is what `unknown` means everywhere else in the column.
The label stays foreground semibold, per the rule above that `unknown` reads
like `ok` apart from its node.

### `master:` said what did not happen

Rewritten twice, and the lesson is that **this row makes no negative claim at
all**.

It began as `master:  not run — read as args (>NAME, units)`. *Not run* reads
as **skipped**, as though the row were a dead end and everything under it had
not happened — and it is the busiest branch in the file.

The second attempt, *a master: entry is matched, not run by the calculator*,
fixed that and bought a **contradiction**: three rows down the twin says the
write comes *from the calculator*. Both were true — `ApplyTo` does not hand
the *author's* expression over, while `SimClient.Set`'s catch-all reassembles
one from the parsed pieces and runs that — but that is far too fine a point to
carry in a clause, and on screen it read as the panel arguing with itself.

The third, *a master: setter as args (>NAME, units) — the shape it has to
fit*, had no contradiction and **no meaning either**. It described the regex
rather than the aircraft: the panel talking about itself.

```
builds  50 (>K:TOGGLE_STARTER1)
parses  the name and the numbers manually, because the entry is master:
fires   K:TOGGLE_STARTER1 with [0] 50
```

The action, in words with no jargon in them — and the two rows around it are
now visibly the string it parses and the two things it found. The row
introduces them rather than abstracting over them, and *because the entry is
master:* answers the only other question it raises, which is why a `shared:`
entry has no such row.

Three word choices, each closing one of the earlier failures:

- **`parses`, not `reads`** — the send half already has a `read` step, for
  reading the variable out of the simulator. `read` and `reads` on one screen
  for different things is the `sends`/`send` near-collision again.
- **`manually`** — this is what replaces *not run by the calculator*. It says
  FS Copilot does the work itself and claims nothing about where the write
  goes next, so it cannot fight the twin three rows down.
- **`numbers`, not `value`** — `value` is a painted identifier in this panel,
  and it is not what gets parsed out: on `${value * 16} 1 (>K:2:KOHLSMAN_SET)`
  the numbers are 16256 and 1.

**The pattern notation is gone.** It was there so a reader could check their
line against it, but `match-write` already says *no `(>…)` at the end — this
text is never used* in words, at the moment it matters. `trace.test.ts` holds
the row to the rest: the `parse` step must not mention the calculator while
the twin does.

### The `kind` row says what the kind *does*

Also out of the walkthrough. `implicit` always carried its consequence —
*no `set:`, so the value is written to `NAME`* — and the other three named
only the test that chose them. On the PC-12's `set: (>K:TOGGLE_STARTER1)`
that left `kind  prepended — starts with (` above `builds  1 (>K:TOGGLE_STARTER1)`
with **nothing on screen saying where the `1` came from**.

All four now end in a consequence, worded from `setter.ts`'s own table so the
panel and the resolver describe one mechanism in one vocabulary. `literal`
gets the sharpest: it does not merely pass its text through, it **ignores the
incoming value**.

### `calculator` is glossed rather than removed

Settled 2026-09-20. The word survives in exactly one row — ending 60 — and it
is the SDK's own term (`execute_calculator_code`), so replacing it would teach
a vocabulary nothing else uses. That is the argument that kept `int` in the
type tooltips, and it applies here.

A new `term` paint marks it: **prose**, in prose's colour and face, with the
dotted underline and a hover definition. The underline is deliberately the
same affordance the CLR type gets — in this panel one underline means "there
is more here", and a second mark for the same idea would teach nothing. What
differs is underneath: `int` is a word the *simulator* chose and its tooltip
carries the consequence; `calculator` is a word *we* chose and its tooltip
carries the meaning.

`TERM_DOC` lives in `trace-paint.ts` and **wants to move**. Nothing about it
is trace-specific: `facts.ts`, `key-docs.ts`, `hover-card.ts`,
`set-templates.ts`, `run.ts` and `setter.ts` all say `calculator` with no
gloss of their own, and `docs/copy.md`'s vocabulary table still does not list
it. A second surface wanting it is the signal to lift it beside `facts.ts`,
not to copy it.

### The probe that would settle the hedge

**[double-write-probe.md](../sim-vars/build/double-write-probe.md)** — written
2026-09-20, unrun. The `also` row says `should` because nobody has watched the
double write happen, but the evidence is closer to settled than that word
suggests: the C# has four `if`s with no `else`, and v1-log 2026-08-29 already
proved the calculator fires `K:` events. Only the two together are untested.

If it confirms, `should` becomes `fires twice`, the step goes `unknown` → `ok`,
and a `master:` entry writing a TOGGLE event becomes a **diagnostic** — the
sync it is meant to do, it undoes. `SWS_Pilatus_PC12_5B.yaml:55` is the first
corpus hit.

### Still open, from this pass

- ~~**The `and runs` row carries the same order ambiguity.**~~ — settled: the
  twin now says *rebuilt as* whenever the operands reorder. Kept below for the
  mechanism, which is worth reading once. `SimClient.Set`'s catch-all is
  `Execute($"{string.Join(' ', values)} (>{name})")` over the **reversed**
  array, so for `16256 1 (>K:2:KOHLSMAN_SET)` the row correctly prints
  `1 16256 (>K:KOHLSMAN_SET)` — a genuinely different program from the line on
  the page, rendered as bare RPN that looks like source text. It wants the
  same treatment the operand rows got.
- **The double spaces in the `echo` and `skp` details** (`is not sent back
  (2s)`) collapse to one in HTML, so the intended gap never renders.

---

## Open

- ~~**`2 s` or `2s`.**~~ — settled 2026-09-19: **`2s`**, no space, lower case.
  The rule is in `docs/copy.md` under Typography and the model already writes
  it that way. The rest of the app is **not** swept — four places still spell
  it otherwise, listed in copy.md's pending list.
- ~~**The `and runs` label does not fit 56px.**~~ — settled 2026-09-20:
  the step is now labelled **`also`**, which fits. Not a rename for its own
  sake; the detail changed to lead with *twice*, and `and runs` beside it was
  the same word twice in one row.
- ~~**Row gap is 9px**~~ — settled 2026-09-20: **8px**, the recommendation
  below it, because `docs/ui.md` wants the 4px grid and the line-height does
  carry the difference.
- **Nine steps do not fit** the slot's initial 260px; a `K:2:` event scrolls.
  Decide whether the slot should open taller for this panel. *Still open* —
  built with the body scrolling and the slot left at 260px, which is the
  status quo rather than an answer.
- **Do `current` and `value` teach themselves?** They are deliberately the
  identifiers a setter spells rather than English words, on the argument that
  typing in one and watching `builds` change teaches what they mean. For a
  reader who has never opened a `set:` line they are two unexplained nouns,
  and the only place the meaning is spelled out is the accessible name, which
  a sighted reader never sees. Raised in copy-review.md; needs a reader who
  has not seen the code.
- **`--font-editor` and `EDITOR_OPTIONS.fontFamily` are two copies** of one
  stack (2026-09-20). Monaco measures the face itself so it takes a literal,
  not a custom property. The system-level fix is making Tailwind's
  `--font-mono` the editor face app-wide, which would also put `var-chip` and
  the Log in it — recommended, not done, because it repaints every mono
  element in the interface.
- **`trace-panel.html` is still in the tree.** This file says to delete it
  once the panel is built and matches, which it now is and does. Not deleted:
  removing a file is a separate proposal under CLAUDE.md, and it wants the
  user's word rather than a tidy-up.

**The largest open item is not in this list.** It is the whole last section of
this file — the parity plan — and it is unbuilt. §3's own words are that a
trace which lies is worse than no trace, and the panel now makes the model's
answers look authoritative in a way a squiggle did not.

---

## The reference rendering

**[trace-panel.html](trace-panel.html)** — open it in a browser. Four states
(a JavaScript setter, the corpus's `dead-set`, a working `master:` event, a
closed guard) at the app's own tokens and geometry. It is the agreed design; if
this document and that file disagree, the file is what was looked at and
approved.

It is a static mockup with no build step and nothing imported — a design
reference kept beside the plan that describes it, not a component. Delete it
once the panel is built and matches.

## Exact values

Taken from the mockup, so they do not have to be re-derived by eye.

| thing | value |
| --- | --- |
| slot height | 260px — the store's `BOTTOM.initial`, unchanged |
| panel padding | `px-3` (12px), matching `PanelHeader` |
| header | `h-9` (36px), title 12.5px medium |
| body | `border-top`, 14px above and below |
| columns | `grid-template-columns: 1fr 1px 1fr`; each section padded 14px |
| column heading | 10.5px, uppercase, `letter-spacing: .06em`, muted, medium; **14px** beneath |
| timeline grid | `12px | 56px | 1fr`, `gap: 0 8px` |
| rail | 1px `--muted-foreground/25`, centred in the 12px column — **2026-09-20**, was `--border` (10% white in dark), which left the thread invisible between nodes that were fully bright |
| node | 7px, `left: 2.5px`, **`top: 5.5px`** — 2026-09-20, was 4px, which put its centre 1.5px above the text it names |
| outcome node | 11px, `left: 0.5px`, **`top: 3.5px`** — as above |
| failed node ring | **`0 0 0 2px var(--destructive-surface)`** — 2026-09-20, was 3px, which spanned −0.5 to 12.5 inside a 12px column and bled into the label gutter; docs/ui.md wants 2px rings anyway |
| step label | mono 10.5px muted, `padding-top: 1px` |
| step detail | 12px, `line-height: 1.5`, `padding-bottom: 9px` — see Open |
| outcome detail | 12.5px, no bottom padding |
| code fragments | mono 11.5px |
| binding name | mono 11px, semibold, `--syntax-injected` |
| field | 112px × 22px, mono 11px, `--radius-sm` |
| live lamp | 5px circle, `--sim-value`, `right: 7px` inside the field |
| locator | `h-20px`, `px-2`, `--radius-md` (8px), `bg-fsc-island`, no border, `--fsc-label`, mono 10.5px |
| editor highlight | ≈10% `--foreground`, neutral |

**Everything in the gutter hangs off one number: 9px**, the optical centre of
the detail's first line (12px at `leading-[1.5]` is an 18px line box). Each
node is placed by subtracting half its own size, and **both** rail ends stop
there — the first node did not clip before, so a 4px stub of thread stood
above it at the top of both columns on every entry.

The ordinary node is `--muted-foreground/70` rather than the flat token: at
full strength every dot was exactly as loud as the label beside it, and a
column of eight competed with the sentence. The rows worth looking at are the
failures and the ending, and they stand out only if the rest stands down.

`--radius: 0.625rem`, so **`rounded-md` is 8px** and `rounded-sm` is 6px. The
editor's mono stack is `'Cascadia Code', 'JetBrains Mono', Consolas, 'Courier
New', monospace`.

## Draft copy for everything new

Register each of these in [copy-registry.md](copy-registry.md) as it lands.
They are drafts by the rule at the top of plan.md.

**Column headings** — `When it changes here` · `When a value arrives`

**Binding labels** — `current` (left) · `value` (right). Lower case, mono, the
identifier exactly as a setter spells it.

**The five outcomes.** `${n}` is the bound value; names and units come from the
parsed write or the entry.

| shape | text |
| --- | --- |
| send, `shared:` | `${n} is sent to the other pilot` |
| send, `master:` | `${n} is sent to the other pilot, unreliably` |
| apply, `shared:` runs | `the calculator runs ${code}` |
| apply, event fired | `${EVENT} fires with [${args}]` |
| apply, variable written | `${n} is written to ${NAME}, ${units}` |
| apply, fallback swallowed an event | …the above, then `, and ${EVENT} never fires` |
| apply, nothing | `nothing is applied — ${reason}` |

Reasons for the last: `value already matches current` (guard closed) ·
`the expression is empty` · `${NAME} matches no branch`.

**Type tooltips** — in the table above, under *The type, and its tooltip*.

**Empty states** — keep the two already shipped: `No file open.` and
`Put the caret in an entry to trace it.` The first is word-for-word the Issues
panel's, deliberately, because they share a slot.

## Where the outcome comes from, per shape

So the `result` step is derived rather than invented. All in
`src/shared/trace.ts`, and all already computed by the time the step is added:

- **send** — `entry.block`; the text mirrors the existing `send` step, which
  already says reliably/unreliably from `SendAll(..., unreliable: master)`.
- **apply, shared, ran** — `built.code`, after the guard did not stop it.
- **apply, event** — `parseSet(...)` gives `name` and `values`; the `K:`
  branch of `routeSteps` already formats them, normalisation included.
- **apply, variable** — the same `parsed.name` / `parsed.values[^1]`, plus
  `parsed.units`.
- **apply, fallback** — `parseSet(...).matched === false`; the swallowed event
  is the *written* setter text when `parseVar(text).ns !== null` and it holds
  no whitespace or parens — the same test `dead-set` uses for its `bare` fix,
  so the two agree by construction.
- **apply, nothing** — the guard's `skipped`, or `code === ""`, or
  `routeSteps` having produced the `nowhere` step.

## Tried and rejected — do not re-propose

Each of these was built as a mockup and turned down by the user, with the
reason. They look like good ideas on paper, which is why they are listed.

- **Phase captions** grouping steps (*it is read* / *before it is sent* / *the
  code is applied*). "Starts getting confusing." The outcome row does this job.
- **Plain-language labels** — `kind`→`how`, `builds`→`code`, `match`→`check`.
  Rejected with the phases. The labels stay as the model has them.
- **Verdict-first layout** — the answer in a banner with the steps as evidence.
  Duplicates the Issues panel, which already owns that sentence.
- **Pipeline / waterfall** — stages left to right. The details are sentences,
  so the stages wrap and the reading order dies; it also cannot honour
  "nothing moves", since a stage resizes with its text.
- **Frames** — a debugger stack. Fine, but the rail carries the sequence better
  and the two were merged instead.
- **A sixth tone for the panel.** Amber was asked for and withdrawn: hue 70 is
  `--warning` and hue 75 is `--remote-changed`, so an open Trace button reads
  as a caution. Ochre 50 collides with `--syntax-injected` (35) *inside* the
  panel; teal 190 collides with `--syntax-number` (195), five degrees apart in
  the same box. **Settled: no hue.** The rail button is neutral like Variables
  and Log, and the editor highlight is a neutral lift. The reasoning is that
  this panel's content is already the syntax palette — eleven colours carrying
  meaning — and a twelfth for the chrome is the first thing to compete with
  them.
- **An entry-name row** under the header. Removed: the name is the subject of
  both first steps already.
- **Replacing `— as int` with a consequence** (*whole numbers only*). The type
  is kept, with a dotted underline and a tooltip carrying the consequence.

## State of the tree

`src/shared/trace.ts`, `trace.test.ts`, `lib/caret.ts`, `lib/entry-trace.ts`
and `components/trace/` are this work. Everything else modified in the working
tree is unrelated in-flight work from the same day — **the tree runs
uncommitted for long stretches**, so never `git checkout`/`restore`/`stash` a
path. See CLAUDE.md.

At the time of writing: 1093 tests, typecheck, lint and Prettier clean.
`src/shared/trace.ts` and `expression.ts` carry pre-existing Prettier
deviations at HEAD; do not reformat them wholesale, only the lines you touch.

## Verification, when the panel is built

The CDP recipe is in the `driving-the-app` memory. The three traps, all of
which produced false results in this work:

1. **`Home` is smart home** — it stops at the first non-whitespace character,
   so `Home` + `ArrowRight`×(col−1) lands `indent` columns off. Use `Ctrl+G`
   with `line:column`.
2. **A dismissed hover leaves its widget on screen**, so a stale popup reads as
   a result. Prove it is gone — absent *or* zero-height — before each probe.
3. **Read the rendered lines out of the editor before debugging.** The panel
   was twice reported broken when the app's buffer simply held an extra blank
   line and the probe's line numbers were stale.

And one for this panel specifically: the first hover or trace after a reload
can lose the race with a worker starting. Probe a suspicious negative twice.

---

# Parity with FS Copilot — how the model stays true

**Not built. This is the plan for it**, and it matters more than the panel:
§3's own words are that a trace which lies is worse than no trace, and the
panel makes the model's answers look authoritative in a way a squiggle does
not.

## The problem, stated honestly

`src/shared/trace.ts` is a **hand-written mirror** of eight C# functions. Its
correctness rests on one person having read them right, and the record from the
day it was written says that is not a safe bet:

- `splitArgs` used `\s+` where the C# is `Split(' ')`. Real divergence: `1\t2`
  is one operand and sends `0`; the model said `[2, 1]`.
- The echo step vanished on an empty expression, because `Skip.Next(Get)` runs
  *before* `Execute` returns early.
- Five behaviours were simply missed — the `K:` five-parameter ceiling,
  `NormalizeValue`, `L:`/`A:` taking the last operand, the read side, the type
  table.

All three were found by **re-reading**, not by any check. Nothing in the repo
would have caught them, and nothing today would catch the next one — or notice
FS Copilot changing underneath.

## Four layers, cheapest first

Each says something different, and the difference is the point.

### 1 · Anchors on the model — *the code I read is still there*

The mechanism exists: `facts.ts` entries carry
`anchors: [{ file, anchor }]` — a verbatim one-line snippet — and
`npm run check:claims` asserts each snippet is still in its file. 26 anchors
today, none of them the trace's.

Give every mirrored behaviour in `trace.ts` the same treatment: a table of
`{ behaviour, file, anchor }`, checked by the same script (extend it, do not
write a second one). A miss means FS Copilot moved under a step, and names
which.

**Cannot say** the model reads the code correctly — only that the code is
still there to be read.

### 2 · A pin, and a bounded diff — *what changed since*

`docs/fscopilot-behavior.md` already pins a commit and documents the re-verify
procedure. The model should pin the same way, in one constant:

```ts
/** The FS Copilot commit this model was read against. */
export const MIRRORED_AT = "5d6b313"
```

Auditing then becomes a bounded action rather than a re-read:

```bash
git -C ~/dev/fsc/src diff 5d6b313..HEAD -- \
  FsCopilot/Simulation/Definitions.cs \
  FsCopilot/Simulation/Coordinator.cs \
  FsCopilot/Simulation/Skip.cs \
  FsCopilot/Connection/SimClient.cs \
  FsCopilot/Connection/SimConnectExtensions.cs
```

Five files, and the diff is the whole audit surface.

### 3 · A golden master over the corpus — *the model changed*

Snapshot the model's full output — every step, both halves — for every setter
in the installed corpus, at a fixed set of bindings. Any edit to `trace.ts`
then shows as a diff.

This technique is **already proven in this repo**: the byte-diff of all 356
corpus diagnostics is what caught the `K:n:` message regression during the
parser consolidation, which typechecked and passed every test.

**Cannot say** the output is right — only that it did not change unintentionally.

### 4 · Differential testing against the real C# — *the model and FS Copilot agree*

The real answer, and it is available: **dotnet 9.0.317 is installed**, and
`FsCopilot.csproj` targets `net9.0` with Avalonia rather than WPF.

A small console harness compiles the files it needs — `Definitions.cs` is the
main one, and it references `SimClient` exactly once — with Jint, YamlDotNet
and Serilog, plus a stub `SimClient` that records calls instead of touching
SimConnect. It reads a table of cases as JSON and writes what FS Copilot
actually produced: the built string, the parsed name, units and operands, and
which `SimClient` method would have been called with what.

The TS model runs the same table. A divergence is a parity bug, found
mechanically.

**This is the only layer that would have caught the `\s+` bug**, and it catches
the whole class.

The case table comes from two places:

- **the corpus** — every setter in the installed profiles, at several bindings,
  so the shapes people actually write are covered;
- **adversarial cases**, written deliberately: a tab between operands, a
  trailing space after `(>…)`, `K:12:`, a negative operand, six operands, an
  escaped `\n` in a double-quoted scalar, an empty setter, a JavaScript setter
  that throws, a name with no prefix.

A maintainer script rather than a test, for the reason `check:format` is one:
the checkout lives outside the repository and a test that needs somebody else's
folder fails on a fresh clone. `npm run check:parity`.

## What to build, and in what order

1. **Layer 2** first — it is a constant and a paragraph, and it makes every
   later audit bounded.
2. **Layer 1** — extend `check-claims.ts` to read trace anchors. Mechanical.
3. **Layer 4** — the harness, and **record its output as a fixture** in the
   same pass. Half a day, and it retires the guessing. The recording is what
   makes any of this runnable in CI; see below.
4. **Layer 3** last — cheap, and it becomes much less important once 4 exists,
   though it still catches accidental edits between parity runs.

## Coverage — what is mirrored and what is deliberately not

An auditor needs this, or an absence reads as a gap.

**Mirrored:** `Definition` units defaulting · `Definition.Set`'s four kinds
(through `resolveSetter`) · `ParseSet` whole, fallback included ·
`ApplyTo`'s block split, `>K:#` route, toggle guard and echo ·
`SimClient.Set`'s four branches · `TransmitKEvent`'s five slots and
`NormalizeValue` · `SimClient.Stream`'s read branches ·
`Coordinator.AddLink`'s send pipeline · `InferDataType` → `ToClrType`.

**Deliberately not:**

- **RPN evaluation.** We do not run the calculator, so a `shared:` setter's
  effect is unknowable to us — the trace ends at "the calculator runs it". This
  is a permanent limit, not a gap.
- **SimConnect data-definition caching and ids.** Irrelevant to what a profile
  author sees.
- **The network codec and packet types.** `Update` carries a name and a value;
  how it is encoded does not change the trace.
- **Timing beyond what is stated** — the 30ms sample, the 500ms `H:` delay and
  the 2s skip window are reported as facts, but the model does not simulate
  time, so it cannot say whether a particular change would actually be
  coalesced or suppressed. Those steps are `unknown` for that reason.

## Running these automatically — and the split that makes it possible

There is **no CI in this repository today** (no `.github/workflows`), and the
six `check:*` scripts are deliberately maintainer commands rather than tests,
for the reason CLAUDE.md gives: they read a `Definitions` corpus or an FS
Copilot checkout that lives outside the repo, and *a test that needs somebody
else's folder is a test that fails on a fresh clone*.

That rule is right and the mirror checks must not break it. The way through is
to notice that the four layers answer **two different questions on two
different clocks**:

| question | needs | when |
| --- | --- | --- |
| Does the model still agree with what we read? | nothing outside the repo | every push |
| Has upstream moved since we read it? | the FS Copilot checkout | on a schedule, and before a release |

Only the second needs anything external. The first can run anywhere the
moment the evidence is **vendored**.

### Vendor the evidence, not the source

Two committed fixtures, both small and both generated:

- **`src/shared/__fixtures__/trace-cases.json`** — the case table: a few
  hundred entries drawn from the corpus plus the adversarial list, with no
  expected output. This is the input.
- **`src/shared/__fixtures__/fsc-recorded.json`** — what the **real C#
  harness** answered for every one of those cases, recorded once, with the
  commit it was recorded at.

Then a plain vitest replays the model against the recording. No dotnet in CI,
no checkout, no corpus, and it still catches every divergence the harness would
have caught — because the harness's answers *are* the expectations. It is a
recorded differential, and it is the whole of layer 4's value minus the need
for FS Copilot to be present.

The harness re-runs only when the pin moves. That is the point: FS Copilot's
behaviour changes on FS Copilot's schedule, not on ours.

### What a workflow would hold, when there is one

**On every push** — `typecheck`, `test`, `lint`, and the recorded differential,
which is just part of `test`. Nothing new to configure; it works on a fresh
clone by construction.

**On a schedule — weekly, plus manually before a release** — a job that checks
out FS Copilot at `HEAD` and runs:

- `check:claims`, extended to the trace's anchors (layer 1) — *did the code we
  quoted move?*
- a diff of the five mirrored files against `MIRRORED_AT` (layer 2) — *what
  changed?*
- the harness against the same case table, compared to the recording (layer 4)
  — *does FS Copilot still answer the way we recorded?*

It should **open an issue rather than fail a build**. A red build says "you
broke something"; these say "upstream moved", which is not a regression and not
anybody's fault — it is a prompt to read a diff and either re-record or fix the
model.

**Needs deciding before any of this is written:** whether the FS Copilot
repository is reachable from CI at all. It is a private checkout on this
machine (`~/dev/fsc`, submodule at `src`). If it is not reachable, the
scheduled job stays a local `npm run` that a human triggers, and only the
recorded differential runs in CI — which is still the larger half of the value.

### The corpus golden master is local-only, permanently

Layer 3 reads the installed `Definitions` folder, which is the user's own and
will never be in CI. It stays a maintainer script beside `check:setters` and
`check:format`, and that is the correct home for it rather than a limitation.

## The honest limit

Even with all four layers, this is a mirror. It agrees with FS Copilot on the
inputs in the table, at the pinned commit, for the branches that are covered.
That is a much stronger claim than today's, and it is still not "correct" in
the abstract — which is why every step carries a `state` and the uncertain ones
say so in words.
