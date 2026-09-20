# New copy — review registry

    Purpose:  Every string a user reads that was written during the help
              overhaul, with everything a rewrite needs, queued for a copy pass.
    Reviewer: to be gone over with Fable.
    Order:    newest session first; within a session, by surface.

This is **not** the string registry `docs/copy.md` rejects, and it must never
become one. The code owns every string; what is quoted here is a **snapshot for
review**, and if the two differ the code is right and this file is stale.

What this file is for: a copy pass should be able to rewrite an entry without
opening the editor, running the app or reading the diff. So each entry carries
its own context — where it appears, who is reading it and what they were doing
when it appeared, what it has to accomplish, and what it may not do.

## The shape of an entry

    ### <short name>

    **Where** file:line
    **Venue** the surface it renders on, and how it is rendered
    **Seen when** what the user did to make it appear
    **Goal** what the string has to accomplish
    **Constraints** length, format, vocabulary, anything it may not say
    **Draft** the current text
    **Notes** why it says what it says; known weaknesses
    **Status** pending · kept · rewritten

**Status** stays after review so a second pass knows what the first settled.
Maintainer prose — `docs/`, code comments, log entries — is not copy and does
not belong here.

**Seen** says whether the string was watched rendering in the running app, and
is separate from Status — a string can be perfect and unreachable. It takes
`rendered` (watched in the app, on the date given), `unreachable` (the surface
does not fire; see the gaps list in [plan.md](plan.md)) or `unchecked`. A
`unreachable` entry is not worth a copy pass until it renders.

## The venues, once

Said here rather than in forty entries.

- **Monaco hover widget** — one popup, markdown, appears after a delay when
  the pointer rests on a name. Width is Monaco's, roughly 500px, and the card
  should not need scrolling. No live values: the gutter already shows those,
  and a hover renders once so anything live would be a frozen snapshot.

  On a clean name the card is alone in the popup. On a name carrying a
  diagnostic the popup stacks **three** sections, in this order: the marker's
  plain text, the **Why** section, then the card. So a reader meeting a
  problem reads three of our texts in a row, written in three places by three
  rules — read them together, not one at a time.
- **Completion detail column** — one line to the right of the item in the
  list, truncated hard. Perhaps 40 characters survive at a usable width.
- **Completion documentation panel** — markdown, to the side of the list,
  room for paragraphs. This is where a long explanation belongs.
- **Key hover** — the Monaco hover widget again, but on a key (`shared:`,
  `get:`, `skp:`) rather than on a name: the only help a reader gets for the
  file's *shape*. One section — the key, then its summary, then its detail —
  from `key-docs.ts`. It was monaco-yaml's until 2026-09-19 and showed nothing
  at all for as long as it was; it is ours now, and it renders.
- **Squiggle** — the marker's tooltip. Plain text, no markdown: verdict,
  consequence and remedy run together as one paragraph.
- **Issues row** — one line, the verdict alone.
- **The hover's Why section** — markdown, under the marker's text, one
  paragraph per fact the diagnostic cites, each followed by its basis.

## The voice, once

`docs/copy.md` is the source of truth. What binds most often here: second
person; consequences in the future tense; fact then consequence after an em
dash; one vocabulary — *the app*, *the FSC folder*, *the workspace*, *the
other pilot*, *the pilot in control*, *the aircraft in the sim*, *input event*
and never *bus*, *sim module*. Rules of the language say **should**, never
must. No advice the author could work out alone.

---

# Session 2026-09-19 — dropping monaco-yaml

The strings Opus 5 wrote that day are in
[copy-registry.md](copy-registry.md), with where each one is and why it says
what it says.

---

# Session 2026-09-19 — help overhaul, stages 1–2

Stage 1 converted every diagnostic to verdict · consequence · remedy. Those 29
strings are tabulated in [plan.md](plan.md)'s rule catalogue with their
severity, confidence and basis, and that table is the review surface for them
rather than 29 entries here. Everything else from both stages is below,
including the one rule written after that table was drawn.

**The app was driven over these on 2026-09-19** and every entry carries what
that showed, in a **Seen** field. Of the 19: six rendered, and are quoted as a
reader sees them; three are **unreachable** and one half so, because the `skp:`
hover and the schema hovers do not fire at all; the remaining nine are
unchecked, since reaching them means driving completion and the first pass did
not. The four unreachable entries are not worth a copy pass yet — the defects
behind them are on the gaps list in [plan.md](plan.md).

## Facts

The facts table (`src/shared/lang/facts.ts`) states each mechanism — what FS
Copilot or the simulator does — once, so that rules, hovers and eventually
reference pages cite it instead of retelling it. A fact renders in the hover's
Why section, as markdown, followed by its basis chip ("Based on FSC source
code"). **A fact says what happens and never what to do**; the remedy belongs
to the diagnostic, which knows the line. A test rejects "you should", "try"
and "consider".

Three were written this session. The other 27 are stage 1's, written in the
same sitting and equally unreviewed — treat the whole file as in scope if the
pass has room.

### skp-marks-on-send

**Where** [facts.ts:299](../../src/shared/lang/facts.ts#L299)
**Venue** hover Why section, markdown
**Seen when** hovering a diagnostic that cites it. No rule cites it yet — the
`skp:` family of rules is still on the gaps list — so today it reaches a reader
only through the schema and hover text written from it.
**Goal** state what `skp:` marks, on which side it happens, and the two
conditions under which it silently does nothing.
**Constraints** mechanism only, no advice. Markdown. The reader is looking at
one `skp:` line and needs to know whether theirs works.
**Draft**

> `skp:` names a second variable whose next change is not sent out. The mark
> is registered when **this** entry sends, and only from a `shared:` entry —
> it is for a control whose one press moves two synced variables. Only shared
> entries' outgoing changes are filtered, so the name has to be some `shared:`
> entry's `get:` for anything to be held back. A mark is spent by the first
> change, or expires 2 seconds after it was set.

**Notes** This replaces four copies of the opposite claim — every surface said
`skp:` suppressed the echo *after applying*. The source says otherwise
(`Coordinator.AddLink`), and `master` in that method means the entry's block,
not the machine's role. Four sentences is long for a fact; the last two are
each a way of being silently wrong, and it is not obvious which the reader
needs. Possibly two facts.
**Seen** unchecked (2026-09-19) — no rule cites it, so there is no hover that
shows it. Its short form, `SKP_NOTE`, is separately unreachable.
**Status** pending

### echo-held-back-automatically

**Where** [facts.ts:326](../../src/shared/lang/facts.ts#L326)
**Venue** hover Why section, markdown
**Seen when** as above.
**Goal** say that the echo a reader might reach for `skp:` to prevent is
already handled, so they do not add one that does nothing.
**Constraints** mechanism only. Must not read as advice against using `skp:` —
`skp:` has a real use, stated in the fact above.
**Draft**

> Applying an incoming value to a `shared:` entry marks that entry's own
> `get:` first, so the change it causes is not sent straight back to the other
> pilot. This is automatic and needs no `skp:`. A `master:` entry needs none
> either: it sends only from the pilot in control, who is not the one applying.

**Notes** The `master:` sentence is arguably a different fact, and explains a
mechanism most readers never wonder about. Cut candidate.
**Seen** unchecked (2026-09-19) — as above, nothing cites it yet.
**Status** pending

### bare-name-not-streamed

**Where** [facts.ts:343](../../src/shared/lang/facts.ts#L343)
**Venue** hover Why section, markdown
**Seen when** hovering the `get-no-prefix` error, which is the rule that cites
it.
**Goal** establish that an unprefixed name is completely inert, so the reader
understands the error is not cosmetic.
**Constraints** mechanism only. Must cover both directions — reading and
writing — because an entry can be either.
**Draft**

> A name with no `X:` prefix reaches neither the simulator nor the calculator.
> FS Copilot's stream falls through every branch and returns nothing, and a
> write matches no branch either. The entry is inert — nothing is read, sent
> or applied.

**Notes** "falls through every branch" is implementation vocabulary in a
sentence meant for a profile author. The middle sentence may be the one to go.
**Seen** rendered (2026-09-19), in the Why section under `get-no-prefix`,
headed "Why — Based on FSC source code". The three sentences run as one
paragraph, which makes the implementation clause harder to skip past, not
easier.
**Status** pending

## The hover card

`refCard` in `hover-card.ts` renders one markdown section in four parts:
identity, one description with its source named, **one** position-specific
fact, and a footer. The reader has stopped on a variable name in their profile
and wants to know what it is and whether they are using it correctly. The card
replaced a two-section one that ran a screen tall.

### SKP_NOTE — the `skp:` position fact

**Where** [hover-card.ts:41](../../src/renderer/src/lib/hover-card.ts#L41)
**Venue** hover, part 3. Shown by both `refHeader` and `refCard`.
**Seen when** hovering the name on a `skp:` line — the only position where
this is the whole of what the reader needs.
**Goal** say what naming this variable here does, in one line.
**Constraints** one line, italic, markdown. It is the only position fact the
card will show, so anything cut is not said elsewhere.
**Draft**

> _`skp:` names another variable whose next change is not sent when this entry
> sends — from a `shared:` entry only, within 2 seconds_

**Notes** The short form of `skp-marks-on-send`. "within 2 seconds" is
compressed to the point of vagueness — 2 seconds from what, the reader cannot
tell.
**Seen** unreachable (2026-09-19) — **the `skp:` hover does not fire at all**.
A `skp:` value shows no hover of any kind, so this sentence, the one this
whole stage turned on, currently reaches nobody. Not worth polishing until it
renders.
**Status** pending

### A bare name's nature line

**Where** [hover-card.ts:48](../../src/renderer/src/lib/hover-card.ts#L48)
**Venue** hover, part 1 — the clause after the em dash in the identity line,
where every other namespace puts a noun ("key event", "local variable").
**Seen when** hovering a name with no prefix.
**Goal** say this is not a kind of variable at all.
**Constraints** must fit the identity line's shape, which is `**name** — <this
clause>`. Every sibling clause is a noun phrase; this one is a sentence, which
is the tension.
**Draft**

> a bare name — with no prefix it reaches neither the sim nor the calculator

**Notes** Reads oddly in position, and the app confirms it. *the sim* is also
loose where the vocabulary says *the aircraft in the sim* or names the
simulator.
**Seen** rendered (2026-09-19). Verbatim: `ELT ACTIVATED — a bare name — with
no prefix it reaches neither the sim nor the calculator`. Two em dashes in one
line, as feared, and the line is long enough to wrap.
**Status** pending

### A bare `B:` write

**Where** [hover-card.ts:94](../../src/renderer/src/lib/hover-card.ts#L94)
**Venue** hover, part 3
**Seen when** hovering `(>B:SOMEPRESET)` — a write to an input event with no
`_Set`/`_Inc`/`_Dec` after it.
**Goal** warn without claiming it is broken. Whether a bare write lands is
decided by the code the aircraft attached to the preset; the corpus writes
hundreds of them bare and they work.
**Constraints** one line, italic. It is the longest note on the card by some
way. Must not say "cannot be written" — that was the old, wrong text.
**Draft**

> _whether a bare write lands is up to the aircraft — most state presets take
> `_Set`, `_Inc`, `_Dec`, but a preset named for an action often is the write_

**Notes** Two clauses joined with "but", both hedged; the reader gets no
verdict. The honest content is "we cannot tell you, here is how to tell", and
the second half is gesturing at that without saying it.
**Seen** unchecked (2026-09-19) — not reached in the first pass over the app.
**Status** pending

### Description source labels

**Where** [hover-card.ts:186–187](../../src/renderer/src/lib/hover-card.ts#L186)
**Venue** hover, part 2 — a trailing italic label after the description
sentence.
**Seen when** always, when the variable has a description at all.
**Goal** let the reader weigh the sentence they just read. A comment somebody
left in a profile is about this variable in this aeroplane; the catalogue's
line is about the variable in general.
**Constraints** very short — it rides on the end of a sentence. Parallel to
the basis chips in the Why section, which are all "Based on …", but these are
not chips and the long form would dominate the line.
**Draft**

> `· from a profile`   and   `· SDK`

**Notes** The two are not parallel: one is a phrase, the other an initialism.
"SDK" is also unexplained for a first-time reader — the basis chips say "the
MSFS SDK docs".
**Seen** rendered (2026-09-19), both forms. `Sets altimeter setting (Millibars
* 16). · SDK` reads well. `· from a profile` does not, and not because of the
label: it rendered as `########### Pilot Lower Panel ######### · from a
profile`. The corpus indexer is serving a section-heading comment as the
variable's description, and this label dutifully attributes it. **That is a
defect, not a copy problem** — it is on the gaps list — but it is worth the
copy pass knowing the label is currently vouching for garbage.
**Status** pending

### Operand positions

**Where** [hover-card.ts:209](../../src/renderer/src/lib/hover-card.ts#L209)
**Venue** hover, part 3 — a label on the first and last row of the operand
list.
**Seen when** hovering a key event the catalogue documents with two or more
parameters.
**Goal** the list is printed in *writing* order, which is the reverse of the
documentation's numbering. These two labels are what stop that looking like a
mistake. Operand order is the commonest error class in the corpus.
**Constraints** two or three words each. They label rows that look like
`` `[1]` Altimeter index — _pushed first_ ``.
**Draft**

> `pushed first`   and   `pushed last`

**Notes** Only the first and last row are labelled; a three-parameter event
leaves its middle row bare, which may read as an omission. "pushed" is also
RPN vocabulary a first-time reader has not met yet.
**Seen** rendered (2026-09-19) on `(>K:2:KOHLSMAN_SET)`, as two lines: `[1]
Altimeter index — pushed first` above `[0] Value to set — pushed last`. The
reversal reads correctly at a glance, which was the whole point of replacing
the count with the list.
**Status** pending

### Corpus footers

**Where** [hover-card.ts:248](../../src/renderer/src/lib/hover-card.ts#L248)
and [:260](../../src/renderer/src/lib/hover-card.ts#L260)
**Venue** hover, part 4 — the last line, italic.
**Seen when** the variable appears in the installed profiles. The write form
shows in write position, the read form everywhere else.
**Goal** company. How many other people's profiles use this name is the
single most reassuring — or alarming — thing the app can tell someone who is
unsure they have the right variable.
**Constraints** one line. The counts are facts about the workspace, not about
the aircraft.
**Draft**

> `_Written by 41 entries_`
>
> `_Read by 23 profiles — shared ×18 · master ×5_`

**Notes** The two count different units — entries in one, profiles in the
other — because that is what each source knows, and the asymmetry is not
explained. "×" is dense. Whether the block split earns its place on the card at
all is worth asking.
**Seen** rendered (2026-09-19), both forms: `Written by 3 entries` and `Read by
2 profiles — shared ×2`. Against a small workspace the numbers are small enough
to look like noise; the reassurance the line is for probably needs the real
corpus to land.
**Status** pending

The notes `refCard` picks from in `accessNotes`, `arityNote` and `unitNote`
are older text, not written this session, but the card now shows exactly one of
them and they carry more weight than they used to. Worth reading in the same
pass.

## Schema hovers

monaco-yaml renders these on the file's keys. They are the only help a reader
gets for the *shape* of a profile rather than for a variable, and the first
thing someone opening a strange file hovers.

### BLOCK_DOCS — the five blocks

**Where** [profile-schema.ts:21](../../src/renderer/src/lib/profile-schema.ts#L21)
**Venue** two at once. `summary` alone is the completion documentation for the
block key; `summary` + `detail` is the schema hover.
**Seen when** hovering `shared:`, `master:`, `include:`, `ignore:` or
`pointer:`, or completing one into an empty file.
**Goal** the summary decides whether this is the block you want; the detail
tells you what you are signing up for.
**Constraints** the summary is one line and must work with no detail after it.
Detail is markdown, a short paragraph. The five should read as a set — a
reader comparing `shared:` against `master:` is reading both.
**Draft**

> **shared** — Entries either pilot can drive.
> A change on either side is sent to the other, and the setter runs in the
> simulator's calculator exactly as built.
>
> **master** — Entries only the pilot in control drives.
> Sampled about 33 times a second and sent unreliably, so a dropped update is
> overtaken rather than resent. The setter is **not** run as RPN — see `set:`.
>
> **include** — Other profiles to merge in.
> Paths are relative to the workspace. A missing file is skipped silently, so
> a typo here costs you the whole module.
>
> **ignore** — Instruments whose interactions are never sent.
> Names are matched exactly, including case. A name that matches no panel does
> nothing, and there is no error either way.
>
> **pointer** — Instruments whose clicks and drags are sent by position.
> An item is an instrument identifier (`DisplayUnits`), which takes every
> panel that reports it, or a full panel key (`DisplayUnits|config=Default`).

**Notes** These were two separate sets of words — one in completion, one in the
schema — and this merges them into one table both read. The summaries are the
old completion text, largely unchanged; the details are new. `master:`'s detail
leads with sampling rate, which is probably not what a reader choosing a block
needs first. `include:`'s "costs you the whole module" is the only one that
warns, and it is the best line of the five.
**Seen** partly unreachable (2026-09-19). The **detail** halves are
schema-only, and monaco-yaml is contributing nothing — nothing appears on
`shared:`. The **summary** halves also feed completion's documentation panel,
which was not checked. So half of this entry is a copy question and half is a
defect; see the gaps list in [plan.md](plan.md).
**Status** pending

### The `get:` prefix list

**Where** [profile-schema.ts:74](../../src/renderer/src/lib/profile-schema.ts#L74)
**Venue** schema hover on `get:`
**Seen when** hovering the `get:` key, often while typing the first entry of a
new profile.
**Goal** get a reader to a working prefix fast, and stop them writing a name
without one.
**Constraints** markdown. Cannot list all seventeen namespaces — the hover
would be a table — but must not imply the five are all there are, which is
what the old text did.
**Draft**

> The common prefixes: `A:` simulation variable, `L:` local variable, `K:` key
> event, `B:` input event, `H:` HTML event. Seventeen are recognised in all —
> hover a name to see which it is.
>
> A name with no prefix reaches neither the simulator nor the calculator, and
> the entry does nothing.

**Notes** "Seventeen are recognised in all" is a number the reader can do
nothing with. The second paragraph duplicates what the `get-no-prefix`
diagnostic says on the line itself, which is the better venue for it — and the
diagnostic is the half that actually renders.
**Seen** unreachable (2026-09-19) — **monaco-yaml contributes nothing**, not
hovers and not diagnostics. On the gaps list in [plan.md](plan.md); not worth a
copy pass until it renders.
**Status** pending

### `skp:`

**Where** [profile-schema.ts:100](../../src/renderer/src/lib/profile-schema.ts#L100)
**Venue** schema hover on `skp:`
**Seen when** hovering `skp:`, or reading somebody else's profile and finding
one.
**Goal** `skp:` is the least-understood key in the format and was documented
backwards everywhere. This is the long-form explanation the other surfaces
compress.
**Constraints** markdown, three paragraphs, and the longest string in the
schema. Must state the *send* direction first, because the reader may arrive
carrying the old, wrong idea.
**Draft**

> The **name of another variable** whose next change will not be sent out when
> this entry sends — for a control whose one press moves two synced variables.
>
> The mark is registered on the **sending** side, and only from a `shared:`
> entry. In a `master:` entry `skp:` does nothing, and neither does a name that
> no `shared:` entry watches. The echo after applying an incoming value is
> automatic and needs no `skp:`.
>
> `skp: true` registers a counter under the literal string `true` and does
> nothing.

**Notes** Three paragraphs where the second is entirely negative — three ways
it does nothing, in one breath. The `skp: true` paragraph exists because 16
corpus lines do exactly that; it may be an odd thing to meet before any example
of `skp:` working. There is no example here at all, which for this key is
probably the real gap.
**Seen** unreachable (2026-09-19) — **monaco-yaml contributes nothing**, not
hovers and not diagnostics. On the gaps list in [plan.md](plan.md); not worth a
copy pass until it renders. Note that `skp:` is now unreadable from
**both** of its surfaces — this one and the hover on the value.
**Status** pending

## Completion

### `ENTRY_DOCS.skp`

**Where** [completions.ts:763](../../src/renderer/src/lib/completions.ts#L763)
**Venue** completion documentation panel, for the `skp:` key itself.
**Seen when** typing inside an entry and completing the third key.
**Goal** one line that gets the direction right, where the schema hover has
paragraphs.
**Constraints** one sentence, though it renders in a panel with room. Should
not contradict the schema — this is the same key in a second venue.
**Draft**

> Another variable whose next change will not be sent when this entry sends.
> `shared:` only.

**Notes** "`shared:` only" is a fragment doing a lot of work. The old text was
one line too and was wrong; this is the same shape, corrected, rather than
rethought for the venue.
**Seen** unchecked (2026-09-19) — not reached in the first pass over the app.
**Status** pending

### A `B:` preset with no `_Set`

**Where** [set-completions.ts:140](../../src/renderer/src/lib/set-completions.ts#L140)
**Venue** completion **detail column** — one truncated line beside the item.
**Seen when** completing a write target inside `(>…)` and the candidate is a
bare input-event preset the aircraft has enumerated no `_Set` for.
**Goal** the completion is about to insert the bare name. Say why it is not
adding `_Set`, and that the bare name may still be right.
**Constraints** **the hard one** — this is the detail column, and it is
truncated at roughly 40 characters at a usable width. The draft is 76 and will
be cut mid-sentence.
**Draft**

> no _Set on this aircraft — a bare write lands only if the preset is the
> action

**Notes** Too long for its venue, which I did not check when writing it. The
first clause alone ("no `_Set` on this aircraft") may be the whole of what
fits, with the rest moving to the documentation panel.
**Seen** unchecked (2026-09-19) — not reached in the first pass over the app.
**Status** pending

## Setter templates

`set-templates.ts` offers the shapes a `set:` value can take, each with a
documentation panel explaining the kind FS Copilot will assign it. The file is
long, predates the voice in `docs/copy.md`, and `docs/copy.md` names it as
still owed a pass. What follows is only the lines touched this session.

### EMPTY_BRANCH

**Where** [set-templates.ts:56](../../src/renderer/src/lib/set-templates.ts#L56)
**Venue** completion documentation panel. Appears in three templates — the
one-line empty-branch guard, the guarded toggle, and the `switch` block.
**Seen when** picking a template whose expression can evaluate to `''`.
**Goal** the same text means two different things depending on the block the
entry is in, and the templates are offered in both. In `shared:` an empty
string is a working guard. In `master:` it is not a guard at all — the value
falls through to the `get:` variable, and for a `K:` `get:` that fires the
event the guard was meant to prevent.
**Constraints** markdown, a paragraph. Rides after a template-specific
sentence, so it cannot open with a subject the reader has lost track of.
**Draft**

> In a `shared:` entry an expression that evaluates to the empty string does
> nothing — the calculator is not called at all. In a `master:` entry it is
> not a guard: empty text matches no `(>NAME)`, so FS Copilot falls back to
> writing the incoming value to the `get:` variable, which for a `K:` `get:`
> fires the event.

**Notes** Two sentences, the second with three clauses and a conditional at
the end. It is the most important correction in this session's prose and the
least readable string in it.
**Seen** unchecked (2026-09-19) — not reached in the first pass over the app.
**Status** pending

### The guarded-toggle template

**Where** [set-templates.ts:169](../../src/renderer/src/lib/set-templates.ts#L169)
**Venue** completion documentation panel
**Seen when** picking the one-line guarded toggle.
**Goal** unchanged from before; the edit removed an inline "which does
nothing" that contradicted `EMPTY_BRANCH`, now appended in full below it.
**Constraints** as above.
**Draft**

> **JavaScript.** Fires the event only when the two sides actually differ, and
> evaluates to the empty string when they already agree.

**Notes** The sentence now ends on a fact the paragraph after it immediately
qualifies. Reads as a stumble.
**Seen** unchecked (2026-09-19) — not reached in the first pass over the app.
**Status** pending

### `(>B:…)  input event`

**Where** [set-templates.ts:93](../../src/renderer/src/lib/set-templates.ts#L93)
**Venue** the completion item's own label.
**Seen when** completing a `set:` value.
**Goal** name the shape being inserted.
**Constraints** a label, two columns, aligned by spaces with its siblings
(`(>K:…)  key event`, `(>L:…)  local variable`).
**Draft**

> `(>B:…)  input event`

**Notes** Renamed off "bus event", which the vocabulary forbids. No other
change.
**Seen** unchecked (2026-09-19) — not reached in the first pass over the app.
**Status** pending

### GUARD_NOTES — *peer* → *the other pilot*

**Where** [set-templates.ts:45](../../src/renderer/src/lib/set-templates.ts#L45)
and [:53](../../src/renderer/src/lib/set-templates.ts#L53)
**Venue** completion documentation panel, shared by the one-line and block
guard templates.
**Seen when** picking either guard.
**Goal** unchanged; only the vocabulary was corrected.
**Constraints** as above.
**Draft**

> …`value` arrives over the wire with the other pilot's numeric type and
> `current` comes from the simulator…
>
> …this guard swallows the first update if the other pilot beats the sim to it.

**Notes** Both sentences are long and technical and were not otherwise
touched. The whole of `GUARD_NOTES` wants the pass this file is for.
**Seen** unchecked (2026-09-19) — not reached in the first pass over the app.
**Status** pending

## Diagnostics

### get-no-prefix

**Where** [get-no-prefix.ts:74](../../src/shared/lang/rules/get-no-prefix.ts#L74)
**Venue** four at once — the Issues row shows the verdict alone; the squiggle
shows verdict, consequence and remedy run together as plain text; the hover
adds the Why section with `bare-name-not-streamed`; the lightbulb shows the fix
title.
**Seen when** a `get:` line names a variable with no `X:` prefix. Seventeen
lines in the installed profiles do, including one that is plainly a typo for
`L:XPDR_CLR`.
**Goal** this is an error, and the reason it needs one is that nothing else
will ever tell them — FS Copilot loads the profile without complaint and the
entry is simply dead.
**Constraints** verdict ≤ 80 characters, plain text, no backticks, readable
alone as a row. Consequence in the future tense. The remedy appears **only**
when no fix is offered, so the two must not repeat each other. Severity error
requires confidence certain.
**Draft**

> **Verdict** This name has no namespace prefix.
>
> **Consequence** The entry will do nothing — the value is never read, sent or
> applied, and FS Copilot will load the profile without complaint.
>
> **Remedy** (only when no fix is offered) Prefixes are a letter and a colon:
> A:, L:, K:, B:, H:.
>
> **Fix title** Change to A:NAV ACTIVE FREQUENCY

**Notes** The consequence mixes tenses — "will do nothing", then "is never
read". The remedy is a definition rather than an instruction, on purpose: which
namespace the name belongs to is the one thing the author knows and the app
does not. Whether that reads as helpful or as evasive is exactly the question
for the pass.
**Seen** rendered (2026-09-19). The squiggle runs all three parts together as
one paragraph, ending `…without complaint. Prefixes are a letter and a colon:
A:, L:, K:, B:, H:.fsc(get-no-prefix)` — the rule id abuts the full stop with
no space, which is Monaco's doing, not the copy's, but it is what a reader
sees. The Why section follows in its own section below it. This is the longest
squiggle of the 29 and it shows.
**Status** pending

## Trace panel — 2026-09-20

The panel's own strings, as opposed to the step lines the model produces
(those are rows 1–45 of [copy-registry.md](copy-registry.md) and were written
on 2026-09-19). Everything below was composed while building the panel.

**Venue, once.** A bottom panel, third beside Log and Issues — wide and short,
260px tall, two columns side by side. Each column is a timeline: a rail, a
7px node per step, a mono label in a 56px gutter, and a detail line of 12px
text running 60–100 characters. Fragments of the file are painted in the
editor's own syntax colours and face; everything else is prose in the
interface font. The reader is an author with a profile open, caret in an
entry, asking *what will FS Copilot actually do with this*. They can type into
two fields and watch the path change.

### The locator

**Where** `components/trace/index.tsx`, `Locator`
**Venue** a filled island beside the panel title, mono 10.5px, clickable
**Seen when** always, whenever an entry is being traced
**Goal** say which entry this is about, and get the reader to it
**Constraints** must fit one short line beside the title; the block word is
painted as code because it is a key from the file
**Draft**

> master · lines 31–33
>
> shared · line 58

**Notes** Replaced an entry-name row under the header — the name is already
the subject of both first steps. Singular when the entry is one line, because
*lines 31–31* reads as a bug. The separator is a middle dot rather than a
comma because neither half is subordinate.
**Seen** rendered (2026-09-20), both forms, against the CRJ and the CJ4.
**Status** pending

### The binding fields

**Where** `components/trace/index.tsx`, `Half` and `Field`
**Venue** the right end of each column heading: a mono label, then a 112×22
field. The left field shows the simulator's reading in `--sim-value` with a
small lamp until it is typed over.
**Seen when** always
**Goal** name the two values a setter is handed, and let them be changed
**Constraints** the label is the identifier a setter spells, exactly — lower
case, mono, `--syntax-injected`. The accessible names carry what the one-word
labels cannot.
**Draft**

> `current` — *The value this entry reads here*
>
> `value` — *The value arriving from the other pilot*

**Notes** The labels are deliberately not English words: typing in the `value`
field and watching the `builds` row change is the panel teaching what the
identifier means, rather than asserting it. The risk is that a reader who has
never opened a `set:` line sees two unexplained nouns. The accessible names
are the only place the meaning is spelled out, and they are invisible to
sighted readers — that may be the wrong trade.
**Seen** rendered (2026-09-20).
**Status** pending

### The five endings — two additions

**Where** `src/shared/trace.ts`, the `result` step
**Venue** the last row of each column, larger node, `result` in the gutter
**Seen when** always; it is the row the panel exists to produce
**Goal** say what actually happens, in one line, naming only variables and
events — never aircraft systems, because the model does not know what an
aircraft system is
**Constraints** computed from values the model already holds; no adjectives it
cannot derive. The nine texts are rows 56–66 of copy-registry.md.
**Draft** (the two that are not in the settled five)

> nothing is sent — A:LIGHT LANDING is never read
>
> the new value is sent to the other pilot

**Notes** Both are forced rather than chosen. The first exists because ending
a half "is sent to the other pilot" directly under a red `read` step would be
the panel contradicting itself on one screen. The second because `current` is
null before the variable first moves locally, and naming a value the model
does not have would be a placeholder wearing an answer's clothes — so the
sentence goes to the future tense, which is what the half is about anyway.
*The new value* is the weak phrase here; *whatever it changes to* is longer
and clearer, and the pass should pick.
**Seen** rendered (2026-09-20) — the second on every entry, since the probe
ran with no simulator attached.
**Status** pending

### The type tooltips

**Where** `src/renderer/src/lib/trace-paint.ts`, `TYPE_DOC`
**Venue** a shadcn tooltip on a dotted underline under `int`, `double`,
`float` or `string`, inside a `read` or `writes` detail
**Seen when** the pointer rests on the type word
**Goal** say what the resolved CLR type costs the author, without replacing
the word itself
**Constraints** one or two sentences; no C# vocabulary beyond the type name;
must not read as an error, because the type is usually fine
**Draft**

> **int** Whole numbers only. A fraction is dropped on the way to the
> simulator.
>
> **double** A 64-bit float — about fifteen digits of precision.
>
> **float** A 32-bit float — about seven digits of precision.
>
> **string** Text rather than a number, so it is compared as text.

**Notes** Replacing the word with its consequence was tried and rejected — a
panel that renamed the type would teach a vocabulary nothing else uses. The
other three exist partly so the underline does not appear to mean "trouble" on
`int`, which is the one with a consequence worth acting on.

**Two changed on 2026-09-20 and the snapshot above is refreshed.** `int` lost
*so a control that moves smoothly here syncs in steps* — the sentence this
entry called "the phrase doing the work" and "least likely to survive a pass",
and it did not: the first clause already says it. `double` lost *decimals
survive* and gained a digit count, because `float` beside it named seven while
`double` named none, and comparing the two is the whole reason anyone hovers
either. binary64 carries 53 significant bits, about 15.9 decimal digits;
*fifteen* is the conservative round-trip figure and is spelled out to match
`float`. *Decimals survive* is not missed — `int` directly above says a
fraction is dropped, so the contrast is structural.

The four now divide cleanly: `int` states a consequence, `double` and `float`
state a precision and differ only in the number, `string` states how it is
compared. That symmetry is new and is worth not flattening in a pass.
**Seen** rendered (2026-09-20) — `int` opened on JF_RJ_100's throttle entry,
dotted underline in `--syntax-keyword`, help cursor, full text in a 256px
popup, opening in 13ms. The other three were not reached; they share one code
path. `float` is reachable now on any `L:` entry, which it was not then: that
row said *as a 32-bit float* in prose and carried no tooltip at all.
**Status** pending

## Update control — 2026-09-20

The title bar's update affordance. Written while building the release pipeline
(`docs/pipeline/`), not during the help overhaul, and filed here because it is
copy and every new string belongs in the registry.

**Venue, once.** The window's title bar — an 11px-tall strip, the app name at
its leading edge, the FS Copilot launch island absolutely centred. The control
is a 28px square immediately after the app name, teal (`tone-update`). It is
absent almost always: nothing is shown while a check runs or while an update is
merely available, nothing while a Remote Connect session is live, and nothing at
all in a portable or development build. The reader is somebody editing a
profile who has not asked about updates and is not thinking about them.

### The confirmation label

**Where** `components/update-button.tsx`
**Venue** revealed to the right of the icon on the first click, inside the same
button, 12px interface text; the button widens and nothing else moves
**Seen when** an update has finished downloading and the reader clicks the icon
once
**Goal** say that the second click restarts the app, before it does
**Constraints** one short line — the button grows to fit it and shares a 44px
strip with the app name and the centred launch island. Must not imply a
download is about to start; the download already happened.
**Draft**

> Click again to update and restart

**Notes** This **narrates the UI**, which `docs/copy.md` forbids — *"not 'using
the button below'"*. Deliberate, and the exception is narrow: that rule is about
prose describing controls the reader can already see, and this is a confirm
affordance, where the instruction *is* the semantics. A button that does not
fire on its first click has to say so or it reads as broken.

Considered and rejected: *Update and restart* alone (true, but gives the reader
no reason to believe a second click is needed rather than a first click having
failed) and a version number in the label (the strip is narrow, and which
version it is does not change the decision).
**Seen** rendered (2026-09-20), by publishing a `ready` state into the store of
a running development build — the same value main publishes. The button widens
from 28x28 to 222x28: the height does not change, and at the narrowest window
the app allows (940px) there are still 89px between its right edge and the
centred launch island. What has *not* been seen is the control appearing on its
own, which needs a packaged build with a newer release behind it.
**Status** pending

### The resting label

**Where** `components/update-button.tsx`, `aria-label`
**Venue** screen readers only; the button shows a download glyph and nothing else
**Seen when** an update is staged and the control has not been clicked
**Goal** name the action and the version for somebody who cannot see the glyph
**Constraints** one phrase, no punctuation, verb first
**Draft**

> Update to version 0.2.0 and restart

**Notes** Carries the version where the visible label does not, because a screen
reader user gets no second glance at a release note. Replaced by nothing once
armed — the visible text becomes the label.
**Seen** rendered (2026-09-20), as above: reads *Update to version 0.2.0 and
restart* at rest, and is absent once armed.
**Status** pending

### The downloading label

**Where** `components/update-button.tsx`, `ProgressRing aria-label`
**Venue** screen readers only; visually a teal progress ring in the same 28px box
**Seen when** a download has been running for more than 400ms
**Goal** say what the ring is measuring
**Constraints** one phrase; must not promise a restart, which is not offered yet
**Draft**

> Downloading an update

**Notes** Indefinite article rather than *the update* — the reader has not been
told about one, and this is the first they hear of it.
**Seen** rendered (2026-09-20), as above, on a `progressbar` carrying
`aria-valuenow` when the size is known and nothing when it is not.
**Status** pending

### Settings — About

**Where** `components/settings/groups/about.tsx`
**Venue** the last section of the Settings dialog, two rows: *Version* with a
mono value on the right, *Updates* with an 11px explanation under the label and
a `Check now` button on the right
**Seen when** the reader opens Settings and scrolls to the bottom. Most will
never come here — the app updates itself and the title bar does the asking.
**Goal** say which version this is, and say why updating is or is not possible
on this machine
**Constraints** one line per state; the explanation sits under a label in 11px
muted text and has to fit two lines at dialog width
**Draft**

The standing explanation, one of three:

> New versions download in the background. The title bar will offer to restart
> when one is ready.
>
> This is a portable build, so it cannot replace itself — download a new version
> to update.
>
> Updates are off in a development build.

And after pressing *Check now*, replacing it:

> This is the newest version.
>
> A new version is downloading — the title bar will offer to restart when it is
> ready.
>
> A new version is ready — the title bar will restart the app into it.
>
> Could not reach the update server — the app will try again later.

**Notes** The answer replaces the standing explanation rather than joining it:
after asking a question, the explanation is not what is wanted. *Check now*
rather than *Check for updates* — the section is already called Updates.

The three standing lines are the only place the app admits a build might not be
able to update itself; without them a portable user waits forever for an offer
that is never coming. The portable line points at a download rather than a link
because the app has no way to open a browser and should not grow one for this.

The two failure-ish lines both name what happens next, per `docs/copy.md` —
fact, em dash, future tense.
**Seen** rendered (2026-09-20) in a development build: the section reads
*About · Version · 0.1.0 · Updates · Updates are off in a development build*,
with no button, which is correct where a check has no answer to give. The other
five lines are unseen — they need a build that can update.
**Status** pending

## Empty workspace — 2026-09-20

Choosing a folder with nothing in it used to be refused at setup, so the app
had no from-scratch path at all: no FS Copilot, nobody sent you a profile, no
way past the first screen. The strings below are what that path now says, from
the refusal that no longer fires to the file it eventually writes.

**The reader, once.** Somebody who has just pointed the app at an empty folder.
They may never have seen a profile. The simulator is very often *not* running —
that is the ordinary state of a profile editor — so nothing here may lean on
the aircraft being known.

### Profiles — the empty panel

**Where** `components/file-tree.tsx`, `NoProfiles`
**Venue** the Profiles sidebar, ~212px of usable width, centred vertically in
the list area: an `Empty` with an icon tile, a 13px title, an 11.5px
description over three wrapped lines, and one `outline` button
**Seen when** the workspace holds no `.yaml` files anywhere under it
**Goal** say the list is empty because there is nothing, not because something
failed; offer the one way out; and land the naming rule before the field asks
for a name
**Constraints** the title must match the editor's state, which is on screen at
the same time. The description deliberately does *not* — that one is about the
workspace and what to do with it, this one is the one fact a first profile gets
wrong, and repeating a sentence eight inches away is not what "say the same
words" asks for.
**Draft**

> No profiles yet
>
> FS Copilot needs a profile to have the same name as the aircraft's folder in
> the sim.
>
> *button* New profile

**Notes** Replaces `No profiles in this folder.` — a bare `<p>` with no action
on it, and *folder* where the vocabulary table says *workspace*. "yet" is
carrying the whole tone: the old line read as a verdict on the folder. The
description is the naming rule this registry previously flagged as homeless
under *The name field*; the placeholder is now the reminder rather than the
only statement of it. A first draft ended *— that name is how FS Copilot finds
it* and was cut: it is the same fact told backwards, and the em dash made two
clauses out of one.

*Folder* is the right word and is worth defending in review: the key comes from
the `AircraftLoaded` path — `SimObjects\AIRPLANES\pa24-250\…\aircraft.CFG` —
and `folderFromPath` in `main/sim/session.ts` takes the segment after
`Airplanes`. **The open question is whether a reader knows that.** It is
`bksq-aircraft-baronpropress`, not *Baron G58*, and nothing in this sentence
stops somebody typing the name the sim's aircraft list shows. A disambiguating
tail (*not its title*) was drafted and not taken — it costs a fourth wrapped
line in a 212px column.
**Seen** rendered (2026-09-20), against an empty scratch workspace, centred,
`--muted-foreground` like every other description.
**Status** pending

### The editor with nothing to open

**Where** `components/editor-empty.tsx`, `NoProfiles`
**Venue** the middle of the window, full editor width, at panel metrics — 13px
title over 11.5px description, then at most two buttons
**Seen when** same condition, with no file open
**Goal** what the workspace is, and the two things that change it
**Constraints** two actions at most; must not mention the aircraft, because the
second half of the sentence has to hold when the sim is off
**Draft**

> No profiles yet
>
> There is nothing in the workspace to edit — start one here, or drop a
> profile into the folder.
>
> *buttons* Create profile for &lt;aircraft&gt; · Rescan
> *or, with no sim* New profile · Rescan

**Notes** Was *No profiles in this folder* / *Nothing here to edit yet. Add a
profile to the folder and rescan, or start one for the aircraft in the sim.* —
whose second clause pointed at a sim that is usually not running, from the one
state where it was the only offer being made. The em dash is doing
fact-then-way-out.

It no longer ends *and rescan*, though a Rescan button sits under it: the
workspace is watched, so a profile dropped into the folder appears on its own,
and the sentence was teaching the opposite. The button stays as the recovery
path for a dead watcher — unnarrated, which is the normal case for a control.
**Seen** rendered (2026-09-20), the aircraft form. The no-sim form is unseen —
it needs the simulator closed.
**Status** pending

### The name field

**Where** `components/file-tree.tsx`, `NamingRow` via `NameField`
**Venue** a 20px input in the top row of the Profiles list, behind the file
icon, at the top level's indent. A refusal wraps underneath it in 11px muted
text with a warning glyph.
**Seen when** *New profile* is pressed, from the panel header or either empty
state
**Goal** say what to type without a visible label
**Constraints** the accessible name carries what the placeholder cannot; the
placeholder has ~200px and must survive truncation
**Draft**

> *aria-label* Name of the new profile
> *placeholder* Aircraft name

**Notes** *Aircraft name* over *Name* because the name is load-bearing: FS
Copilot loads the aircraft's own folder name plus `.yaml` and nothing else, so
a free-text name is the one thing a first profile gets wrong. The empty state
directly above states the rule; this is the reminder while typing.
**Seen** rendered (2026-09-20), focused, with a refusal under it.
**Status** pending

### Naming refusals

**Where** `shared/profile/aircraft.ts` `profileFilename`, and `store.ts`
`createNamedProfile`
**Venue** under the name field, wrapped, muted; the field keeps the name and
takes the `aria-invalid` ring
**Seen when** Enter or blur on a name that cannot be used, or on a write that
did not happen
**Goal** say what is wrong with the name in front of them
**Constraints** plain text, no markdown; the character list must wrap rather
than truncate, since the characters that fall off the end are the ones needed
**Draft**

> A profile needs a name.
>
> A profile name cannot contain &lt; &gt; : " / \ | ? *
>
> &lt;name&gt;.yaml already exists.
>
> &lt;name&gt;.yaml is already open.

**Notes** The first two came from `main/files.ts` unchanged, where only rename
could reach them; they are now the new-profile field's too. The last two are
new and are deliberately different sentences — *exists* is a file on disk,
*open* is a profile started a minute ago and not saved yet, and telling them
apart is the difference between "pick another name" and "you already did this".

Since the named flow writes the file on Enter, `saveRefused`'s sentences from
`main/files.ts` — the locked-file and full-disk ones, written for the save
error bar — can now surface **in this field** instead. They were not written
for a 212px column under an input, and they name FS Copilot as the likely
culprit, which is odd phrasing for a file that does not exist yet. Worth a look
in the same pass.
**Seen** rendered (2026-09-20), the illegal-character one. The disk failures
are unchecked.
**Status** pending

### The refused folder

**Where** `components/setup.tsx` `browse`, and
`components/settings/groups/workspace.tsx` `browse`
**Venue** a bordered error block under the folder list on the setup screen, and
under the path box in Settings
**Seen when** a chosen folder holds files and none of them is a profile — the
only refusal left, now that an empty folder is accepted
**Goal** say this folder is not it, and name the thing they were about to try
next
**Constraints** one line; the path is data and is not quoted
**Draft**

> There is nothing to edit in C:\… — an empty folder works too, if you are
> starting a profile from scratch.

**Notes** Was *— no Definitions folder, and no profile files*, which described
the old rule and would now read as a refusal of the exact thing somebody came
here to do. Both surfaces say it identically on purpose.
**Seen** unchecked — needs a folder of non-profile files.
**Status** pending

### The setup footer, and the folder dialog

**Where** `components/setup.tsx` footer; `main/workspace.ts` `chooseWorkspace`
**Venue** 12px muted prose at the foot of the setup screen; the Windows folder
picker's title bar
**Seen when** every first run
**Goal** say that FS Copilot is not required, and now that a folder with
nothing in it is a real answer
**Constraints** the footer is already two sentences and should not become four
**Draft**

> You don't need FS Copilot to use this app — any folder of *.yaml profiles
> works, and an empty one works too if you are starting a profile from
> scratch. Choosing the FSC folder also lets you launch, restart and stop it
> from the title bar.
>
> *dialog title* Choose a folder for your profiles

**Notes** The dialog was *Choose your FSC folder*, which asks somebody starting
from scratch for a thing they do not have.
**Seen** the footer rendered (2026-09-20); the dialog title unchecked.
**Status** pending

### The starter profile

**Where** `shared/profile/aircraft.ts` `newProfile`
**Venue** a file, in the editor, in the editor's own syntax colours — comments
italic and dim, the one live entry at full strength with its sim value beside
it. About 50 lines. It is the longest single piece of copy in the app and the
only one the reader can edit.
**Seen when** *New profile*, or *Create profile for &lt;aircraft&gt;*
**Goal** teach the format to somebody who has never seen one, from a workspace
with no other profile to read
**Constraints** wrapped to the same 78 columns the formatter pads headings to;
everything but the one read-only entry is commented out, so the file cannot do
anything; must survive `formatProfile` unchanged, which is asserted in
`aircraft.test.ts`
**Draft** see the function — a header, an `EXAMPLE` section, three subsections
(*Watching a variable*, *Applying what arrives*, *Holding back a second send*),
and a closing paragraph naming `master:`, `include:`, `ignore:` and `pointer:`.
**Notes** Replaces a five-line stub whose whole teaching content was
`# Example entry`. The explanations are lifted in substance from
`lib/key-docs.ts`, which is the same material the key hovers show — they should
be read against each other in a pass, since a reader meets both. Known
weaknesses: the prose is long, and it repeats in comments what a hover would
say on demand; and the live entry draws a `not-settable` info squiggle, which
predates this file and is discussed in the notes on `newProfile`.
**Seen** rendered (2026-09-20), the whole file, highlighted, with a live value
on the entry.
**Status** pending
