# Copy registry — 2026-09-19, Opus 5

Strings Opus 5 **wrote** on 2026-09-19. For each: where it is, where it shows,
what the reader is doing when it appears, and why it says what it says.

Text moved verbatim from somewhere else is not here — only what was composed.
Where a string was adapted from an existing one rather than written from
nothing, the source is named.

---

## key-docs.ts

`src/renderer/src/lib/key-docs.ts`. Both entries below came out of collapsing
three tables into one: block descriptions existed in `profile-schema.ts` *and*
in completions.ts, and the three entry keys had a short wording in completions
and a longer one in the schema, which had never rendered because monaco-yaml's
worker was dead.

### 1 · `get:` summary

**Text** The variable to watch, optionally `NAME, units`. Required.

**Where** `ENTRY_KEY_DOCS.get.summary`
**Venue** first line of the `get:` key hover; also the completion detail column
**Shown when** the pointer rests on `get:`, or `get:` is offered while typing

**Background** The two tables disagreed. Completions said *"The variable to
watch. Required."* and the schema said *"Variable to watch, optionally `NAME,
units`."* Neither was a subset of the other — one carried that the key is
mandatory, the other that the value has a two-part shape. Collapsing the
tables forced a single sentence, and this is the union of the two. It is the
only sentence in the file that is not lifted from one of the originals.

The `NAME, units` shape matters at this spot because units are part of the
value rather than a separate key, which is the thing a first-time reader gets
wrong. "Required" is there because `get:` is the only key an entry cannot omit.

### 2 · `skp:` detail, opening sentence

**Text** For a control whose one press moves two synced variables.

**Where** `ENTRY_KEY_DOCS.skp.detail`, first line
**Venue** `skp:` key hover, under the summary
**Shown when** the pointer rests on `skp:`

**Background** In the schema this was a trailing clause of the opening
sentence — *"…whose next change will not be sent out when this entry sends —
for a control whose one press moves two synced variables."* When the summary
took the first half, the clause was left needing to stand alone, and was recast
as its own sentence.

It answers *why would I ever write this key*, which the rest of the paragraph
does not: everything after it is about where the mark is registered and when it
silently does nothing. Placed first so the use case arrives before the
mechanism.

---

## key-unknown.ts

`src/shared/lang/rules/key-unknown.ts`. A rule written on 2026-09-19 to replace
monaco-yaml's `additionalProperties: false`, which never ran. Both strings below
are modelled on `block-unknown`, the rule for the same mistake one level up;
that rule's consequence and its top-level remedy are reused word for word and
so are not listed here.

### 3 · verdict

**Text** `${key}: is not a key FS Copilot knows.` — e.g. *sett: is not a key
FS Copilot knows.*

**Where** `keyUnknown.run`, `verdict`
**Venue** squiggle tooltip, where it is followed by the consequence and the
remedy as one paragraph; alone as the Issues row
**Shown when** a `key: value` line uses a key that is not `get:`, `set:`,
`skp:` or one of the five blocks — most often `sett:` for `set:`

**Background** Adapted from `block-unknown`'s *"X: is not a block FS Copilot
knows."*, with *block* changed to *key* because this rule covers both a stray
key inside an entry and a stray one at the top level.

"FS Copilot knows" rather than "is invalid" because the file is valid YAML —
the objection is FS Copilot's, not the format's. The colon is included in the
quoted key so the reader sees the thing as it is written on their line.

### 4 · remedy, inside an entry

**Text** The keys inside an entry are get:, set: and skp:.

**Where** `keyUnknown.run`, `remedy`
**Venue** squiggle tooltip, last of the three parts
**Shown when** the stray key is inside an entry **and** no single suggestion is
close enough to offer — with one, a quick fix titled *Change to set:* replaces
this sentence

**Background** The sibling of `block-unknown`'s *"The blocks are shared:,
master:, include:, ignore: and pointer:."*, which is reused verbatim for the
top-level case. This one was needed because the vocabulary differs by position.

It states the vocabulary rather than advising, because the vocabulary is closed
and three items long — short enough to list, and the list is the whole answer.
No markdown: a marker tooltip renders none, so the colons do the work backticks
would.

---

## trace.ts

`src/shared/trace.ts`. The entry trace's step lines — the Trace panel shows
what FS Copilot will do with the entry under the caret, computed rather than
authored. Rendered as of 2026-09-19.

Each row is one step: a short label in a left column and a detail beside it.
The labels are verbs in the present tense, because the panel reads as a
sequence of things that happen, and lower case because they are column
headings rather than sentences. Every detail states what FS Copilot does, never
what the author should do. `state` is separate from the text and carries
whether the step succeeded, was skipped, failed, or is unknowable — the words
do not have to do that work.

### The send half — "WHEN IT CHANGES HERE"

Mirrors `SimClient.Stream` and `Coordinator.AddLink`.

| # | Label | Detail | Shown when | Background |
| --- | --- | --- | --- | --- |
| 5 | read | `${name} — as float, ${units} is ignored` | an `L:` name | `Stream` passes FLOAT32 explicitly for `L:`, whatever the units say. Stated because precision loss is invisible otherwise. **Rewritten 2026-09-20**: it read `${name}, as a 32-bit float` as **prose**, so the one row in the panel naming a datum type got no colour, no dotted underline and no tooltip, a line away from the `A:` branch that gets all three — two kinds of statement where there is one. `TYPE_DOC.float` already carries *a 32-bit float, about seven digits of precision*, which is the prose it replaces and more. The units clause came with it, so the read side and the `writes` row now say the same thing about the same fact. |
| 6 | read | `${name} in ${units} — as ${type}` — e.g. *A:LIGHT LANDING in Bool — as int* | an `A:` name | `InferDataType(units)` then `ToClrType`. The resolved type is named because the unit alone does not predict it: `Percent` and `Feet` are ints, `Number` is a double. |
| 7 | read | `${name}, an HTML event` | an `H:` name | Its own `Stream` branch. |
| 8 | read | `${name}, a key event` | a `K:` name | Its own `Stream` branch. |
| 9 | read | `${name}, through the calculator` | any other `X:` name — `B:`, `Z:` | `ClientVar`, the catch-all read branch. **`calculator` became a glossary term 2026-09-20** — it was the one place in the panel the word appeared as bare prose, so the same word was underlined and defined in the ending and not here. |
| 10 | read | `nothing — ${name} has no X: prefix, so it is never read` | a bare name | `Stream` falls through to `Observable.Empty`. Paired with the write side's row 45: the same entry is inert in both directions, and a reader who saw only one might think the other still worked. |
| 11 | sampled | about 33 times a second | `master:` only | `Sample(30ms)`. The rate rather than "throttled", because the number is the point: it is why a fast master value does not flood the link. |
| 12 | sends | only while you are the pilot in control | `master:` only | `.Where(_ => !master \|\| IsMaster)`. Second person because control is something the reader has or does not have right now, unlike the rest of the trace. |
| 13 | waits | half a second, because the name is H: | the name starts `H:` | `Delay(500ms)`, on the way out only, both blocks. The clause after the comma is there because the delay is triggered by the namespace and nothing else — seeing it on one entry and not another would otherwise be unexplainable. |
| 14 | unless | `a skp: elsewhere marked ${name} in the last 2s` | `shared:` only | `.Where(_ => !Skip.Should(getVar))`. "elsewhere" because the `skp:` that suppresses this entry is on a *different* entry, which is the part that surprises people. |
| 15 | skp | `the next change of ${skp} is not sent (2s)` | a `shared:` entry with `skp:` | `if (!master && def.Skip != null) Skip.Next(def.Skip)`. "the next change" because the counter is decremented once per suppression. The window is parenthesised as a qualifier, and closed up per docs/copy.md's time-unit rule (2026-09-19). Closed from two spaces to one 2026-09-20: consecutive spaces collapse in HTML, so the gap never rendered and only the source suggested otherwise. |
| 16 | skp | `${skp} is ignored — skp: does nothing in a master: entry` | a `master:` entry with `skp:` | Same `!master` guard read the other way. Its own line because the key is present and does nothing, which is invisible otherwise. |
| ~~17~~ | ~~send~~ | ~~to the other pilot, reliably~~ | — | **Withdrawn 2026-09-20.** See 18. |
| ~~18~~ | ~~send~~ | ~~to the other pilot, unreliably — a dropped update is overtaken~~ | — | **Withdrawn 2026-09-20**, both rows, on two grounds. Not the reader's concern: `SendAll(..., unreliable: master)` is decided by the block they already chose, and the panel's rule is that an FS Copilot internal earns a row only where it bears on **sync**. And the clause was false — it assumed a continuous 33 Hz carrier, but `Sample(30ms)` sits over a `SIM_FRAME` + `CHANGED` subscription, so a `master:` stream is bursty. The *last* sample of a movement has nothing behind it to overtake it, and losing it leaves the peer stale until the variable next moves. "to the other pilot" now lives only in the ending. |

### The apply half — "WHEN A VALUE ARRIVES"

Mirrors `Definition.ApplyTo`, `Definition.ParseSet`, `SimClient.Set` and
`SimClient.TransmitKEvent`.

| # | Label | Detail | Shown when | Background |
| --- | --- | --- | --- | --- |
| 19 | arrives | `an update named ${name}` | always, first step | Incoming updates are matched by name alone — not by block, not by file. Naming the match is what makes the two-blocks-one-name case legible. |
| 20 | applies | only while you are not the pilot in control | `master:` only | `.Where(_ => !master \|\| !IsMaster)`. The mirror of row 12, worded in parallel on purpose. |
| 21 | kind | `implicit — no set:, so the value is written to ${name}` | no `set:` | FS Copilot's fourth kind and the majority of the corpus. The clause after the comma is there because "implicit" alone says nothing to someone who has not read the source. |
| 22 | kind | prepended — starts with (, so the value goes in front | the value opens with `(` | The dash separates the name of the kind from the test that chose it, so a reader can check the verdict against their own line. **The consequence clause is 2026-09-20**: on the PC-12's `set: (>K:TOGGLE_STARTER1)` the `builds` row below reads `1 (>K:TOGGLE_STARTER1)` and nothing on screen said where the `1` came from. Wording from `setter.ts`'s own table, so the panel and the resolver describe one mechanism in one vocabulary. |
| 23 | kind | literal — no ' ` ? { } and does not start with (, so it is sent exactly as written and the value is ignored | neither other test matched | The characters are listed rather than described, because this kind is defined by their absence and "no special characters" would be wrong — a double quote is not one of them. **The clause is 2026-09-20** and is the sharpest of the four: a literal setter does not merely pass its text through, it **ignores the incoming value entirely** — a sync fact an author otherwise discovers by watching nothing happen. |
| 24 | kind | javascript — contains one of ' ` ? { }, so it is evaluated first | a trigger character is present | The exact set, because `?` surprises people and `"` is not in it. Clause added 2026-09-20 for parity with 21–23; `implicit` always carried its consequence and the other three named only the test that chose them. |
| 25 | builds | the built string itself | always | What `Definition.Set` produced. No prose at all — the string is the content, and anything wrapped round it would compete with it. |
| 26 | builds | an empty string | the setter built `""` | A JavaScript setter that threw returns `string.Empty`. Named rather than shown blank so the step does not look like a rendering fault. |
| 27 | builds | `nothing — ${reason}` | the JavaScript setter threw | The reason is the evaluator's own message, passed through. |
| 28 | parses | `the name and the numbers manually, because the entry is master:` | `master:` entries | **Rewritten four times on 2026-09-20, and the lesson is in the failures.** (1) `master: \| not run — read as args (>NAME, units)` — *not run* reads as **skipped**, as though the row were a dead end and everything under it had not happened; it is the busiest branch in the file. (2) `matched, not run by the calculator` — fixed that and bought a **contradiction**, because three rows down the twin says the write comes *from the calculator*. Both were true — `ApplyTo` does not hand the *author's* expression over, while `SimClient.Set` reassembles one from the pieces — and far too fine a point for a clause. (3) `a master: setter as args (>NAME, units) — the shape it has to fit` — no contradiction and no meaning either: it described the regex rather than the aircraft, which is the panel talking about itself. (4) the action in plain words, which survives. The rows underneath are visibly the two things named — the event and its operands — so the row introduces them instead of abstracting over them, and `because the entry is master:` answers the only other question it raises: why a `shared:` entry has no such row. **`parses`, not `reads`**: the send half already has a `read` step for reading the variable out of the simulator, and `read`/`reads` on one screen for different things is the `sends`/`send` near-collision again. **`manually`** replaces the whole *not run by the calculator* clause — it says FS Copilot does this itself without claiming anything about where the write goes next, which is what made drafts 2 and 3 fight the twin. **`numbers`, not `value`**: `value` is a painted identifier here (the right-hand binding, and the `guard` row's *value 1 ≠ current 0*), and on `${value * 16} 1 (>K:2:KOHLSMAN_SET)` the numbers parsed out are 16256 and 1 — neither is `value`. **The pattern notation is gone**; `match-write` already says *no `(>…)` at the end* in words at the moment that matters. |
| 29 | route | contains >K:# — parsed rather than run | a `shared:` built string containing `>K:#` | An undocumented escape hatch sending a shared entry down the master path. The step exists because nothing in the profile hints that this string is special. |
| 30 | guard | `is on — value ${v} = current ${c}, so it is skipped` | event write + TOGGLE + values equal | **Rewritten twice on 2026-09-20.** It began by naming the condition — *writes an event and says TOGGLE* — which **explained nothing**: a reader learns two substrings were found and still does not know why anyone looked. The purpose is that a repeated value would toggle twice, and it needs more room than a clause, so it went to a tooltip on `is on` and the row kept the comparison and the verdict. **`is on`, not `is tripped`** (the first suggestion): a guard that trips is one that stopped something, and in two of the three states this one does not. `is on` is true whenever the row is drawn. |
| 31 | guard | `is on — value ${v} ≠ current ${c}, so it runs` | as above, values differ | The same sentence with the comparison flipped, so stepping the value in the panel changes one clause and nothing else moves. |
| 32 | guard | `is on — value ${v} and no current, so it runs` | as above, and nothing read locally yet | **Cut from 190 characters on 2026-09-20.** It read *value 1, and nothing has been read here yet — so it runs. The guard compares against the local value, and there is not one until this variable changes on this machine* — two dashes, two sentences, and a clause explaining a clause. `no current` says the same thing: there is no local value, so the comparison cannot match, and a reader gets from there to *so it runs* unaided. The trailing *yet* went too — it added nothing the sentence did not carry, and the row reads tighter beside its two siblings, which are a bare comparison. The mechanism still holds — `currentValue` starts null and `ApplyTo` tests the raw parameter, so `value.Equals(null)` is false and an apply before this variable has moved locally is never guarded. |
| 33 | echo | `the next change of ${name} is not sent back (2s)` | any applied `shared:` update | `if (fromPeer) Skip.Next(Get)`, registered *before* `Execute` — so it stands even when the expression is empty and nothing reaches the sim. The reason `skp:` is not needed for an entry's own echo, which four surfaces used to state backwards. Worded in parallel with row 15 so the two marks read as one mechanism. Double space closed 2026-09-20, as row 15. |
| ~~34~~ | ~~runs~~ | ~~in the calculator, exactly as built~~ | — | **Withdrawn 2026-09-20.** It sat directly above `result  the calculator runs ${code}` and said the same thing without the code. Ending 60 carries it. |
| ~~35~~ | ~~runs~~ | ~~nothing — the expression is empty~~ | — | **Withdrawn 2026-09-20.** Worse than 34: `nothing — the expression is empty` sat above `nothing is applied — the expression is empty`, the same words twice. Ending 65 carries it, and the echo above still takes the `skipped` mark, so a stopped path is still visibly stopped. |
| 36 | match | no (>…) at the end — this text is never used | the built string does not end in a write | The `dead-set` finding as a step. "at the end" because the regex is anchored, which is why a setter with a write in the middle still fails. |
| ~~37~~ | ~~instead~~ | ~~`${value} → ${name}, ${units}`~~ | — | **Withdrawn 2026-09-20.** Ending 62 says it and says it better, because it also names the event the fallback swallowed. |
| ~~38~~ | ~~sends~~ | ~~`[${values}]`~~ | — | **Withdrawn 2026-09-20**, and it was the worst row in the panel. The label said *sends* on the **receiving** side, where nothing is sent to anybody — and `sends` already meant two other things in the same panel. The detail printed the reversed operand list one row above a route step that printed it again. See 39 for what replaced it and the notation note below. |
| 39 | args | `${parts} is/are not a number, so [0] 0, [1] …` | a matched write with a non-numeric operand | The surviving half of 38, and now **only** drawn when `ParseParam` zeroed something — that is the row's one piece of unique knowledge, and it is a sync fact the author cannot see in their own line. The offending parts are named because the cut is rarely where the author thinks: `(A:FOO,` and `Bool)` are two operands, both zero. Conditional on the entry's own operands rather than on either binding, so the caret changes it and typing does not — except for a setter interpolating `value` into the operand list. |
| 40 | writes | `${name} = ${n} — as float, ${units} is ignored` | the write targets `L:` | The datum type is the sync half — whether a fraction survives is what the author came to find out — and the units are named only to say they do not apply, because `SetLVar` hardcodes FLOAT32. **The type became a token on 2026-09-20**, matching row 5 and the `A:` row below, so both of an entry's directions name it the same way and both carry the tooltip. |
| 41 | writes | `in ${units} — as ${type}` | the write targets `A:` | **Rewritten 2026-09-20**, same reason as 40. Worded to match row 6, the read-side twin, so the entry's two directions name the type the same way. |
| ~~42~~ | ~~fires~~ | ~~`${name} with [${values}]`~~ | — | **Withdrawn 2026-09-20.** It was ending 61 verbatim, minus the verb. |
| 42c | rounds | `[0] ${raw} — to whole uints` | a `K:` write where `NormalizeValue` changed an operand | What survives of 42, and only when coercion did something. `TransmitKEvent` rounds away from zero and wraps negatives, so `-1` travels as 4294967295 — the row shows what the setter wrote and the ending shows what travels, which teaches the wrap instead of asserting it in prose. |
| 42b | strips | `${written} → ${name} — the arity travels as event data, not in the name` — e.g. *K:2:FOO → K:FOO* | a `K:n:` arity was written | `ParseSet` rewrites the name before writing, so the name FS Copilot targets is not the one on the page. Both are shown because a reader looking for `K:FOO` will not find it in their file. |
| 43 | drops | `${n} operand(s) — an event carries five` | a `K:` write with more than five operands | `dwData0`–`dwData4` and no more. Silent in FS Copilot. |
| ~~44~~ | ~~and runs~~ | ~~`… in the calculator — a second write, from a branch with no else; read in the source, never probed`~~ | — | **Withdrawn 2026-09-20.** Two faults. It spent its words on where the behaviour was found — *a branch with no else*, *read in the source* — which is the author of FS Copilot's vocabulary, not the reader's. And it was **wrong for `B:`, `H:` and `Z:`**, where the calculator is the only route and there is no first write for this to be second to. Replaced by 44a–44c. |
| ~~44a~~ | ~~runs~~ | ~~`${code} — the calculator is the only route for a ${prefix} name`~~ | — | **Withdrawn the same day it was written.** For `B:`/`H:`/`Z:` this is the only write, so the row's whole content was the route — an internal with no consequence the author can act on, one line under a `builds` that already showed the expression and one line above an ending that already says what happens to it. No row is drawn for these now. |
| 44b | writes | `${NAME} again, from the calculator — the name matches two write routes and FS Copilot takes both` | an `L:` or `A:` write | `SimClient.Set`'s four branches have no `else`, so this happens *in addition*. **Effect first, with the mechanism as the clause that earns it.** One draft led with the route — *the calculator runs it too* — which answers a question nobody asked. The next cut the mechanism entirely and said only *twice*, which left the reader's first two questions open: **why twice**, and **is this my line's fault**. Naming both routes in one clause answers both — it is FS Copilot doing two things, not the setter being wrong — and costs six words. `should` carries the confidence, per docs/copy.md — nobody has watched this in the simulator. |
| 44c | fires | `${NAME} again, from the calculator — the name matches two write routes and FS Copilot takes both`, plus `, rebuilt as ${code}` when the operands reorder | a `K:` write | The same row where it has teeth. A variable written twice with the same number lands the same number; an **event** fired twice does not. The toggle clause is appended only when the event name says so, using the same `/toggle/i` test `ApplyTo`'s guard uses, so the panel cannot claim a toggle the guard would not recognise. |
| — | — | the label is the **same verb as the row above** — `writes` or `fires`, never its own word | — | **2026-09-20, and it is the whole design.** This is a timeline, so two writes is two rows, twins, in the order they happen. A row carrying a *sentence* about a second write (`also … so it should fire twice`) made a timeline describe an event instead of listing it: a reader counting rows saw one firing, a reader reading prose saw two. The repetition **is** the finding — the same label twice because the same thing happens twice — and it closes the oldest open item in trace-panel.md, since `and runs` was the one label that overflowed the 56px gutter. |
| — | — | *the name matches two write routes and FS Copilot takes both* | the twin row, always | **The `why`, added last and the reason the row finally works.** *from the calculator* says where the second write comes from and leaves the reader asking why there is a second write at all. The answer is the missing `else`: `SimClient.Set` tests four prefixes in a row, a `K:`/`L:`/`A:` name satisfies its own test **and** the catch-all, and nothing stops after the first. Said as a fact about **the name** rather than about the C#, so it needs no vocabulary the reader does not have. |
| — | — | *, rebuilt as ${code}* | the twin, when the operands come out reordered | `Execute` is handed `string.Join(' ', values)` over `ParseSet`'s reversed array, so `16256 1 (>K:2:KOHLSMAN_SET)` reaches the calculator as `1 16256 (>K:KOHLSMAN_SET)` — a different program, and this is the only place the author is told. The test is the **operands alone**: the arity difference is already `strips` and the dropped units are already the `writes` row, and comparing whole strings printed a near-identical expression under every `L:` write in the corpus. |
| ~~45~~ | ~~nowhere~~ | ~~`${name} matches no branch — nothing is written`~~ | — | **Withdrawn 2026-09-20.** It sat above `result  nothing is applied — ${name} matches no branch`: one fact wearing two rows, and the ending is the better sentence and already `failed`. Ending 66 is now the only place it is said, and it remains the write-side pair to row 10. |

## trace panel

`src/renderer/src/components/trace/index.tsx`. The panel's own chrome, as
opposed to the step lines above.

| # | Text | Venue | Shown when | Background |
| --- | --- | --- | --- | --- |
| 46 | When it changes here | column heading | always | From plan.md §3's mock-up, in sentence case rather than the mock-up's caps because the panel sets it in small caps itself. Names the direction rather than the mechanism — a reader who does not yet know the word "send" still knows what changing something here means. |
| 47 | When a value arrives | column heading | always | The pair to it. "Arrives" rather than "is received" because the entry is passive here: something lands on it. |
| 48 | Put the caret in an entry to trace it. | empty state | a file is open but the caret is not inside an entry | Says the action rather than the absence — "no entry selected" would describe the screen back to the reader. |
| 49 | No file open. | empty state | no file is open | Matches the Issues panel's wording exactly, because the two panels sit in the same slot and replace each other. |
| 50 | value | the right field's label | always | Lower case, mono, the identifier exactly as a setter spells it — and painted in `--syntax-injected`, the colour it has inside a `set:` expression. The field and the sentences that mention it agree because they are the same word. |
| 50b | current | the left field's label | always | Its pair. The two bindings the model takes, one per column: `current` is the value here, `value` is the one that arrives. |
| 51 | The value arriving from the other pilot | the right field's accessible name | screen readers | The label is one word and needs the whole sentence behind it. |
| 51b | The value this entry reads here | the left field's accessible name | screen readers | As above. "Reads here" rather than "current value" because the field is about this machine, which is the distinction the whole left column turns on. |
| 52–54 | *withdrawn* | — | — | The `now ${n}`, `not reading — sim not connected` and `current unknown — nothing read yet` readouts are gone. The live value moved **into** the left field, which shows it in `--sim-value` with a lamp while the simulator is supplying it and returns to the foreground when typed over. A readout beside the heading was saying, in words, what the field could show by being the thing itself. |
| 55 | `${block} · lines ${from}–${to}`, or `· line ${n}` for a one-line entry | the locator, beside the panel title | always | Replaces an entry-name row that sat under the header: the name is already the subject of both first steps. The block word carries its own `--syntax-block` colour, so `master` here is the same `master` as the one in the file rather than a word that matches. Singular when the entry is one line, because "lines 31–31" reads as a bug. |

### The five endings

The last step of each half, labelled `result`. Every one is computed from a
value the model already had — see *Where the outcome comes from* in
trace-panel.md. An outcome names **variables and events, never aircraft
systems**: *the altimeter is set to 1016 millibars* would require knowing that
`A:KOHLSMAN SETTING MB:1` is an altimeter, and nothing in the model does.

| # | Text | Shown when | Background |
| --- | --- | --- | --- |
| 56 | `${n} is sent to the other pilot` | a `shared:` entry's send half | `n` is the local reading. Plain and short on purpose: this is the common case and the last line should not be the longest. |
| ~~57~~ | ~~`${n} is sent to the other pilot, unreliably`~~ | — | **Withdrawn 2026-09-20.** `unreliably` left with rows 17–18 and for the same reason: an adverb the reader can do nothing with is no better in the last line than it was in the middle. Both blocks now end on 56, and the block's real consequences stay where they are — `sampled`, the control gate, and the skip rows. |
| 58 | the new value is sent to the other pilot | the send half, when nothing has been read here yet | **Not in the plan's list of five.** `current` is null before this variable first moves locally, and naming a value the model does not have would be a placeholder wearing an answer's clothes. The future tense is what the half is about anyway. |
| 59 | `nothing is sent — ${name} is never read` | the send half, when the name has no `X:` prefix | **Not in the plan's list of five.** `SimClient.Stream` returns `Observable.Empty`, so nothing ever changes here to be sent. Required rather than optional: ending on "is sent to the other pilot" under a red `read` step would be the trace contradicting itself on one screen. |
| 60 | `the calculator runs ${code}` | a `shared:` entry that reached `Execute` | Partly restates `builds`, and that redundancy is the truthful version — we do not evaluate RPN, so what the aircraft then does is outside what this can know. |
| 61 | `${EVENT} fires with [0] ${a}, [1] ${b}` | a matched `K:` write that happens **once** | The operands that actually travelled, after reversal, normalisation and the five-slot cut. **Slot-labelled since 2026-09-20** — see the notation note below. Not a failure however many were dropped: `drops` above it says what was lost, and repeating it here would make the last line argue with itself. |
| 61a | `${EVENT} fires twice — the toggle reverses itself` | the write happens twice and the name says **toggle** | **The sentence no step can carry**: each firing is true on its own and the defect is only in the pair. **The** toggle, not **a** toggle — the definite article points at the event on this row rather than at toggles in general. *reverses itself* replaced *ends where it started* (2026-09-20): shorter, active, and it names the second firing undoing the first rather than describing the net position. | **The sentence no step can carry**: each firing is true on its own and the defect is only in the pair. This is why the panel is worth opening on the PC-12's `set: (>K:TOGGLE_STARTER1)` — a starter that comes back off. |
| 61b | `${EVENT} fires twice — the value moves two steps` | …and the name says **inc**/**dec** | The other relative op, given the same definite article as 61a — *it* was vaguer still than *the value*. |
| 61c | `${EVENT} fires twice with [0] … — the same value both times` | …and the name says **set**/**on**/**off** | **Absolute and relative is the real distinction, not event and variable.** A draft said a doubled *event* was the finding, which is too broad: `K:LANDING_LIGHTS_SET` fired twice lands the same value, exactly as a doubled `L:` write does. Vocabulary from `parse.ts`'s `INPUT_OP`. |
| 61d | `${EVENT} fires twice with [0] …` | …and the name carries no op at all | `AP_MASTER` and `AP_ALT_HOLD` **are** relative and do not say so, and the app cannot know. The count alone, claiming nothing. Over the corpus's 312 distinct `K:` names this splits 58 toggle, a handful of step, 176 absolute, and the rest here. |
| — | — | `fires twice`, **not** `should fire twice` | — | The hedge is the hollow outcome node, which is what `unknown` draws and means everywhere else in the column. Saying it in words as well hedged twice for one doubt, and the sentence the reader takes away should be short. |
| 62 | `${n} is written to ${NAME}, ${units}` — `${units}` omitted for `L:`, plus ` — twice, with the same value` when it happens twice | a matched `L:`/`A:` write, or a fallback that swallowed nothing | Ordinary success in both cases. The fallback is the whole design for the 60% of the corpus with no `set:` at all. **The `L:` exception is 2026-09-20**: the old sentence appended the entry's units to an `L:` name one row under a step saying the units do not apply, because `SetLVar` hardcodes FLOAT32. |
| 63 | `…, and ${EVENT} never fires` | appended when the `ParseSet` fallback swallowed a named event | The `dead-set` finding as an ending. Uses the same test the rule uses to decide whether to offer its `(>…)` fix, so the sentence and the fix cannot be about different text. |
| 64 | `nothing is applied — value already matches current` | the toggle guard closed | `value` and `current` are painted as the identifiers they are. The reason is named rather than left to the greyed rows above. |
| 65 | `nothing is applied — the expression is empty` | the built string is empty | `Execute` returns early. The echo above it still happened, which is why the rows are marked rather than dropped. |
| 65a | `nothing is applied — ${NAME} has no X: prefix` | a `shared:` entry whose built code **ends** in a write to a name with no namespace | **2026-09-20.** The one thing the panel knows about a `shared:` setter without evaluating RPN: `parseWrite` is anchored at the end, so when it matches, the last thing the calculator is asked to do is write that name — and a name with no `X:` prefix is not one it can write. It is `get-no-prefix`'s own finding, an **error** at **certain** confidence: *the entry is inert in both directions. Nothing is read, nothing is sent, nothing is applied.* Without it the panel contradicted that on one screen — send half all red, apply half all green ending on *the calculator runs 1 (>LANDING_GEAR_POSITION, Number)*, which is the shape of seventeen dead corpus lines described as working. Only where the code *ends* in the write: a write in the middle of a longer expression is one `parseWrite` cannot speak for. |
| 66 | `nothing is applied — ${NAME} matches no branch` | the parsed name reaches none of `SimClient.Set`'s four `if`s | The write-side pair to row 45. |

### The word *the calculator* — undecided, and used 15+ times

Raised 2026-09-20 and **not settled**. `the calculator` is the simulator's RPN
evaluator, and it is the SDK's own term — `execute_calculator_code`. The app
leans on it in `facts.ts`, `key-docs.ts`, `hover-card.ts`, `set-templates.ts`,
`run.ts` and `setter.ts`, and in the trace panel's own ending 60.

It is **not in docs/copy.md's vocabulary table**, so nothing decides it and
nothing introduces it. A reader meeting *the calculator runs 1 (>B:X)* with no
prior exposure has no way to know what is being named.

**Settled 2026-09-20: keep the word, gloss it.** Replacing it would teach a
vocabulary nothing else uses — the same argument that kept `int` in the type
tooltips. So the panel marks it with a new `term` paint: prose, in prose's
colour and face, with a dotted underline and a definition on hover.

#### `is on` — the toggle guard's trigger

**Text** FS Copilot checks if a given expression holds an event write (`>K:`
or `>B:`) and the text `TOGGLE`, anywhere in it. If yes, it skips the write if
the value hasn't actually changed.

**Where** `TERM_DOC["is on"]` in `trace-paint.ts`
**Venue** hover on *is on* in the `guard` row
**Shown when** the pointer rests on the phrase

A mechanism rather than a word, and it earns the same affordance for the same
reasons: it is the trigger for the row it sits in, it is genuinely surprising,
and it is in the way of the majority of readers, whose entry is an ordinary
toggle.

Condition first, consequence second — and both surprises fall out of it rather
than being spelled: *anywhere in it* is what makes `(L:ToggleGuard) 1 (>K:FOO)`
trip the guard with nothing toggle-ish in it, and needing the literal text is
what leaves `K:AP_MASTER`, a real toggle, unguarded. A draft stated both
explicitly and ran to five lines; a tooltip that long is one nobody finishes.

`hasn't` rather than `has not`: docs/copy.md makes contractions a judgement
call sentence by sentence, and the informal register suits a hint that exists
to be read in passing.

`TERM_DOC` is keyed by the rendered text, so a phrase is a key like any word.
The drift that invites — reword `term("is on")` in `trace.ts` and the tooltip
silently falls back to printing the phrase as its own definition — is pinned
by a test in `trace.test.ts`, which walks every shape the model can produce
and asserts the exact set of terms it emits.

#### `calculator`

**Text** The simulator's own expression evaluator.

One sentence. A longer draft went on to explain that it runs the RPN in a
`set:` line and that `(>NAME)` goes through it — true, and more than a tooltip
on one word in one row should carry. The gloss answers *what is that*; the row
it sits in answers the rest.

**Where** `TERM_DOC.calculator` in `trace-paint.ts`
**Venue** hover on *calculator* in ending 60
**Shown when** the pointer rests on the word

The dotted underline is deliberately the **same** affordance the CLR type
gets: in this panel one underline means "there is more here", and two marks
for that would teach nothing. The difference is underneath — `int` is a word
the *simulator* chose and its tooltip carries the consequence; this is a word
*we* chose and its tooltip carries the meaning.

Still owed at the system level: `docs/copy.md`'s vocabulary table does not
list it, and `facts.ts`, `key-docs.ts`, `hover-card.ts`, `set-templates.ts`,
`run.ts` and `setter.ts` all use it with no gloss of their own. `TERM_DOC`
wants to move beside `facts.ts` when a second surface asks for it — copying it
is the wrong answer.

### Operand notation — `[0] 1, [1] 16256`, never `[1, 16256]`

Settled 2026-09-20, and it governs rows 39, 42c and ending 61.

`ParseSet` reverses: `parts.map(parseParam).reverse()`, because `[0]` pops
from the top of the stack. So `16256 1 (>K:KOHLSMAN_SET)` fires as
`[0] 1, [1] 16256` — live-verified, v1-log 2026-08-29.

A bare positional list printed that back as `[1, 16256]`, which is a trap.
**`1 16256` written and `[1, 16256]` rendered are the same two tokens in the
same sequence, meaning opposite things**, with a pair of brackets as the only
thing telling them apart — so a reader cannot tell which side of the reversal
they are looking at. And a list reads left-to-right as *first, second*, which
is source-order intuition, so the notation invited precisely the misreading
`k-operand-order` exists to catch, in the panel meant to explain it.

Naming the slot leaves no order to interpret — only a value and the slot it
arrives in — and the author compares against their own line themselves. The
marker is punctuation, not a value: it is not a number anyone could point at
in the file, so it takes `--syntax-operator` rather than the number colour.

**Slot *names* are deliberately not used**, though `keyEventParams` is already
wired to the renderer and `K:KOHLSMAN_SET` documents
`"[0]: Value to set [1]: Altimeter index"`. Two reasons, and neither is
plumbing: it would render untrusted SDK prose in an authoritative panel, which
is the hazard that once served `########### Pilot Lower Panel #########` as a
hover description; and coverage is patchy exactly where it matters — 536 K:
events document a `[0]`, only 104 document a `[1]`, and `K:THROTTLE2_SET`
documents nothing. Numbers are always available. Its own decision, unmade.

### The type tooltips

`src/renderer/src/lib/trace-paint.ts`. The precise word is kept — `int` is
what the entry resolves to and what anyone reading the C# will see — with a
dotted underline and the consequence in the tooltip. Replacing it with its
consequence was tried and rejected: a panel that renamed the type would teach
a vocabulary nothing else uses.

| # | Type | Text | Background |
| --- | --- | --- | --- |
| 67 | `int` | Whole numbers only. A fraction is dropped on the way to the simulator, so a control that moves smoothly here syncs in steps. | The only one with a visible consequence, and the commonest surprise: `Bool`, `Percent` and `Feet` are all INT32 in `InferDataType`. Names what the reader would otherwise notice as a bug in their profile. |
| 68 | `double` | A 64-bit float — about fifteen digits of precision. | The case `Number` resolves to, so the commonest of the four. **Rewritten 2026-09-20** from *A 64-bit float: decimals survive*, which named no number while `float` beside it named seven — and the whole reason a reader hovers either is to compare them. Now the pair differs in exactly the digit count, which is the fact. binary64 carries 53 significant bits, about 15.9 decimal digits; *fifteen* is the conservative round-trip figure, and spelled out to match `float`. *Decimals survive* is not missed: `int` directly above already says a fraction is dropped, so the contrast is structural. |
| 69 | `float` | A 32-bit float — about seven digits of precision. | Every `L:` write, whatever the units claim. The digit count rather than "less precise", because "less" invites the question this answers. |
| 70 | `string` | Text rather than a number, so it is compared as text. | Reached by empty units, which is silent and easy to arrive at by accident. The comparison is the consequence that matters — the toggle guard and the echo both turn on it. |

Both section headings are in the code now, set in small caps by the panel.
