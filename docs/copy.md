# Copy

Every string a user reads — panel text, tooltips, empty states, native dialogs,
footer status, errors, diagnostics, hover cards, completion docs — is held to
this file. It is the **why** and the rules; the strings themselves live beside
the code that shows them, with a comment when the wording is doing something
deliberate. There is no string registry, on purpose: the best copy in this app
is good because of the state and the comment sitting next to it.

## Voice

**Second person.** The reader is *you*. The app is *the app* — it does not name
itself in body copy, and never says *our*. In titles it is **FSC Editor**.

**Fact, then consequence or the way out, after an em dash.**
"Could not reach the clipboard — select the code and copy it."
"They will be lost — the remote copy replaces them."

**A consequence is in the future tense.** "Your changes will be lost", "the
simulator will not see this one until it restarts". Never "your changes are
lost" for something that has not happened yet.

**Name the mechanism, not the advice.** "MSFS scans packages when it starts, so
the simulator you have open will not see this one until it restarts." Never
"try restarting". The reader can act on a mechanism; advice invites them to
wonder whether it will help.

**Do not narrate the UI.** Not "using the button below"; not "start typing to
see results". The control is there. And do not describe a state in words that go
stale when a control is added — "restart this editor" was wrong the day a
*Search again* button appeared under it.

**Contractions are a judgement call**, sentence by sentence. Not a rule either
way.

**No "please", no exclamation marks, no "successfully", no "oops".** The app has
no personality to perform and does not thank or apologise.

## Shapes

**Buttons are the specific verb.** Don't save · Overwrite · Take all · Stop
sharing · Use this folder · Write report. Never OK, Yes, Continue, Submit.

**Titles are noun phrases in sentence case.** "Sim module not responding" ·
"No profile open" · "Run setter".

**Every control is sentence case; data is data.** Source names, log levels,
variable names and identifiers keep their own case and their mono face.

**Empty states: what this is for, then what to do.** A title, one sentence, at
most two actions. A state that has to justify itself reads as one that is not
sure. Two panels showing the same condition at the same time say the same words.

**Dialogs: the message asks, the detail states the consequence.**
"Save changes to a320.yaml?" / "Your changes will be lost if you close this
file without saving."

**Errors say what happened and what it means in the same breath.**
"FS Copilot was not found on this PC. Start it and search again, or choose the
folder yourself."

## Vocabulary

One word for each thing, everywhere a user reads it.

| Say | Never |
| --- | --- |
| the app (body copy), FSC Editor (titles) | FSC Profile Editor, this editor, our app |
| FS Copilot on a screen's first mention, then FSC | — |
| the FSC folder (the FS Copilot install) | installation folder |
| the workspace (the folder the app has open) | — |
| the other pilot (FS Copilot's sync partner) | peer, the other side |
| the aircraft in the sim | the loaded aircraft, the aircraft that is loaded |
| the pilot in control (FS Copilot's master) | the master, the machine in control |
| sim module | Link package, Link module (only inside `npm run link:build`) |
| input event (`B:`) | bus, bus event |
| the host · peers (the count) | the remote, people, guests |
| Choose | Select |
| Open in File Explorer | Show in Explorer |
| dev mode | Dev mode |
| the last N seconds | the past N seconds |

## Registers

**Body copy** — everything above.

**Log lines** (`log(...)` in main, shown in the Log panel) — lowercase, terse,
"did X — reason". "install failed — {reason}", "{n} profiles on disk".

**Hover cards and completion docs** — markdown. Italic asides, code in
backticks, the SDK's own words first when there are any.

**Diagnostics** — written in parts, through `diagnose` in
`src/shared/lang/rules.ts`, because no single string fits a squiggle, an Issues
row and a hover at once.

- **Verdict** — the finding in a breath, 80 characters at most, readable alone
  as an Issues row. "This setter never runs." No mechanism, no hedge.
- **Consequence** — what will happen because of it, future tense. Where the
  confidence is not `certain`, this is the sentence that says so: "will
  probably do nothing".
- **Remedy** — only what a quick fix cannot say. A rule of the language is
  said as one — "every block *should* end with its own }" — and a move the
  author can work out for themselves is left to them.
- **Why** — not prose in the rule. The mechanism is a fact in
  `src/shared/lang/facts.ts`, stated once and cited by id; the hover renders
  it under the marker. A fact says what FS Copilot or the simulator does,
  never what to do about it.

Verdict, consequence and remedy are **plain text** — a marker renders no
markdown, so a backtick there is a backtick on screen. Facts are markdown.
Who tested what, on which aircraft, on which date, belongs in a fact's
`record` or the rule's file comment, never in front of the user.

Severity is what breaks; confidence is how sure; basis is where the knowledge
came from. They are three fields and none is derived from another — except
that an `error` must be `certain`.

Fix titles are imperative and name the result: "Change to K:2:NAME", "Remove
the unit", "Swap the operands".

**Refusal reasons** returned from main are lowercase fragments; the surface that
shows one prefixes it ("Failed — {reason}"), so a reason composes anywhere.

## Typography

`…` (one character) for in-progress states and truncation. The em dash with
spaces on both sides. Digits for numbers. Every count handles its singular —
"1 profile", never "1 profiles". Parentheticals and "e.g." are a smell; say the
thing or leave it out.

**A time unit closes up against its number: `2s`, `500ms`, `30ms`.** No space,
lower case, no plural. This was decided 2026-09-19 after the app was found
spelling it three ways in four places — `}ms` in Activity, `} ms` in Log and
in the run-setter popover, `` ms` `` in the panel picker. SI would put a space
there; a dense UI label reads better as one token, and a number cannot be
separated from its unit by a line break. **Existing spellings are not yet
swept** — see the list below.

## Copy written but not yet reviewed

New strings from the help overhaul are in
[help/copy-review.md](help/copy-review.md), each with where it renders, what
the reader was doing when it appeared, what it has to accomplish and what
constrains it — enough to rewrite one without opening the code. That file is a
worklist, not a registry: the code owns the strings and the quoted drafts are
snapshots. Nothing in it has had a pass against the voice above.

Each entry also says whether it was **seen rendering**. Four are currently
unreachable — the `skp:` hover and the schema hovers do not fire — so the text
written for them cannot be read in the app at all. Skip those until they
render; polishing copy nobody can see is the one way this worklist wastes the
pass.

## Where this stands

Pass 1 (September 2026) went over every string and settled the vocabulary and
voice above. Surfaces still owed a holistic pass, in order:

1. **Sim module** — chip, install dialog, Settings group, `install.ts` reasons,
   and the Radar empty states that describe it. An overhaul, not a wording pass:
   the pitch, the four steps and the naming get written as one piece. Some of
   its strings still say "FSC Editor" and "Link package" until then.
2. **Radar** — the auto-capture control is described three ways in three
   places; the Capture hint; "Manual Capture"; "No results."
3. **Diagnostics, hover cards, completions, schema docs** — their own register.
   Diagnostics are done (the parts shape, above); the hover card is down to
   four parts and one position fact (`hover-card.ts`, `docs/help/plan.md`);
   "bus" is gone, and the sync partner is *the other pilot* everywhere in
   these surfaces. What is left here is the setter templates, which are long
   and were not written to this voice. Empty states elsewhere still say "this
   folder" where the table now says *workspace* — the Profiles and editor pair
   were rewritten when the empty workspace landed, and two are left:
   `remote-connect/profile-picker.tsx` and `variables/index.tsx`.
4. **Time units** — the `2s` rule above is written but not applied. Four
   places spell it otherwise today: `components/activity/index.tsx` (`}ms`,
   already closed up), `components/log/index.tsx` and
   `components/run-setter/panel.tsx` (`} ms`), `components/panel-picker/
   panel.tsx`. A one-pass sweep, and each one is a rendered string rather than
   a comment, so check the diff rather than grepping blind.
5. **README and `docs/`** — the product name and whatever the passes above
   change.
