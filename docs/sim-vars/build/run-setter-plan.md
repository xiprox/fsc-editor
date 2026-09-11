# Run setter — build plan

    Status:     all five stages built. Setters have been run against a live
                aircraft from inside the app — stage 5's first half is met.
                Its second half, the revert line, is unconfirmed: a revert is
                returned over IPC to the popover and never written to the
                capture, so no evidence of one survives a session
    Supersedes: 10-probe, entirely
    Log:        v1-log.md — one log for the whole effort, whatever the plan
                being worked is called

**Start here**, then read the top of [v1-log.md](v1-log.md). Between them that is
enough to build this without any of the conversation that produced it.

## What it is

A play button on every **entry**. Click it, enter a value, and the setter runs
against the live simulator — the same setter FS Copilot would run, with the
same `value` injected.

On the entry rather than on the `set:` line, because **an entry with no `set:`
is still runnable** and those are the majority. FS Copilot writes the value
straight to the `get:` variable when no setter is written, and 15,933 of the
corpus's 26,533 entries — 60% — are that case. They are also the plainest
switches in any profile, which makes them the ones most worth a one-click
check. The button therefore sits on the `set:` line when there is one and on the
`get:` line when there is not; everything after that is identical.

## Why it replaces probe

[10-probe](../10-probe.md) proposed writing a raw value to a candidate variable
to learn whether it is the control or an indication downstream of it. This
answers a better question with less machinery.

- **Probe tests a variable. Running the setter tests the line you wrote.** A
  setter is a JavaScript template literal producing calculator code —
  `` set: "`${value * 100} (>L:Com1FreqInnerKnob)`" `` — so running it exercises
  the expression, the multiplier, the target name and the units together. Those
  are the bugs an author actually produces, and probe structurally cannot find
  any of them because it never runs your code.
- **It needs no new concept.** Probe had to be taught: cause versus symptom,
  restore discipline, what a probe result is. A play button in front of `set:`
  is understood before anything is read.
- **Probe's payoff comes free.** "A variable that reverts shortly after being
  written will desync if bound" is just *watch the variable after running the
  line*. It arrives as a consequence of pressing play rather than as a feature
  somebody has to know exists.
- **One mechanism, not five.** 10-probe needed per-namespace mechanics —
  `fsVarsLVarSet` for `L:`, calculator for `K:`/`H:`, the input-event API for
  `B:`, an inversion for `A:`. A setter emits calculator code whatever it
  targets, so one module command covers all of it.

What is lost: probe's `A:` inversion, which was the seed of
[14-sweep-and-testing](../14-sweep-and-testing.md). Nothing here forecloses it.

## What is already known

Measured or verified during the design. **None of it needs re-deriving.**

| | |
| --- | --- |
| `execute_calculator_code` | in `MSFS/Legacy/gauges.h`. Needed — `fsVarsLVarSet` is *not* enough, because a setter emits arbitrary calculator code rather than a value |
| The dropped include | 2b removed `gauges.h` and that also removed `DWORD`/`HANDLE`, which `SimConnect.h` assumes. `MSFS_WindowsTypes.h` is already included now, so re-adding it should be clean — see the 2b log entry |
| The wire | commands are plain text in an 8 KB area, so arguments are free. `LINK_COMMANDS` is a fixed string union and has to stop being one |
| Observation window | **1 second catches 97.4%** of the aircraft's own reversions. Measured over 6,760 A→B→A patterns across 101 variables: median 83 ms, p90 464 ms, 92.4% inside 500 ms |
| Quick-pick viability | median variable has **73 distinct values** in 75 s — useless as a list. But 30% have ≤2 and 40% have ≤10, so picks appear only below a threshold (~8) |
| Where picks come from | the **`get:` variable's** observed values, not the write target's. `value` is the *input* to the expression; `${value * 100}` writes a hundred times it. They differ for every transforming expression |
| Decorations | inject **text, not DOM**. `content` is a string plus a CSS class, so an icon means a `mask-image` on that class — how VS Code draws codicons inline |
| Hit-testing | `onMouseDown` gives `CONTENT_TEXT` with a position and `detail.mightBeForeignElement`, and will **not** say which injected text was hit. Infer from position; we control them |
| The popover | needs real DOM, so a content widget (`addContentWidget`). One at a time |

Two traps `live-decorations.ts` already paid for, and this will hit both:
**`showIfCollapsed` is required** or a zero-width decoration draws nothing at
all, and **`.mtk<n>` beats a single-class selector** because Monaco injects its
token colours into a runtime `<style>` after the bundle. Scope the CSS under
`.monaco-editor`.

## Fidelity — does confirming it here mean it works in FS Copilot?

The question the whole feature rests on, so it is answered here rather than
discovered later. **Yes for the write. Not for the sync loop around it.**

FS Copilot's watcher "wraps expressions and evaluates them through
`execute_calculator_code`" ([03-link](../03-link.md)), which is the same MSFS
function this calls. Same calculator, same parser, same effect on the aircraft.
If the preview reads `0 (>L:Battery1Switch)` and the write lands, FSC running
that expression with that `value` does the identical thing.

Three differences, worst first.

**`current` can differ, and 13% of setters use it** — 1,380 of 10,404. FSC reads
through the calculator `(L:NAME, Units)`, which converts; our module reads raw
(`FS_INVALID_UNIT`) and labels with the requested unit without converting. It
only bites where the unit genuinely converts — ~17 `L:` lines in the corpus, and
`A:` is unaffected because SimConnect converts on request — but for
`value > current ? INC : DEC` a wrong `current` flips the branch. That makes it
a correctness gap rather than the display inaccuracy it is for live values.

> **So `current` is editable in the popover, not just displayed.** It turns an
> invisible divergence into a number somebody can see and correct, and it makes
> the tool better regardless: both branches of that ternary become testable
> without touching the aircraft.

**Jint versus V8.** FSC builds a Jint engine with exactly two values bound; we
evaluate in V8. Template literals and arithmetic agree — `Number`→`String` is
spec-defined and both implement it — and the editor already targets Jint's
surface deliberately (`lib: ["es2023"]`, no DOM), so completions never offer
what Jint lacks. Real but small.

**No sync loop.** `skp:` suppresses the next change of a named variable — echo
suppression — and none of that is replicated. It does not affect whether the
write works, and its absence is arguably the point: without echo suppression the
raw revert is visible, which is exactly what the desync warning needs.

So confirming a setter here confirms **the expression, the calculator code and
the write**. It does not confirm how FSC's sync loop behaves around it, which is
a different question and the one the revert classification answers separately.

## Stages

### Stage 1 — The wire — **built and verified**

`exec 1 1 (>L:Battery1Switch)` answered `#1 ok -> 0` in a pa24-250, twice. The
step the plan said to distrust — re-adding `gauges.h` — compiled clean.

- `LINK_COMMANDS` becomes a command plus an optional argument. Keep the text
  format; it is 8 KB and readable, which is why the last three bugs here were
  findable
- Module: an `exec` branch calling `execute_calculator_code`, and a reply
  carrying success plus the returned value
- `npm run link:read -- exec "<code>"` so the module can be driven without the app

**Needs a module rebuild, so MSFS closed**, then MSFS open to verify.

**Expect this stage to be the one that surprises.** Everything in this plan is
reasoning and measurement; none of it is running code. Re-adding `gauges.h` is
the specific step to distrust — 2b removed it and took `DWORD`/`HANDLE` with it,
and while `MSFS_WindowsTypes.h` is already included now, "should be clean" is
doing real work in that sentence. The 2b log entry also records that
`check.mjs` once validated a *stale* `.wasm` after a failed compile and reported
twelve exports present; the build deletes the output first now, but a compile
failure here is worth reading rather than skimming.

**Exit — met.** `npm run link:read -- exec "1 (>L:Battery1Switch)"` moves the
switch in the cockpit.

### Stage 2 — Resolving an entry — **built**

Pure, and testable against the real corpus. `src/main/sim/setter.ts`.

**Four branches, not one.** `Definition.Set` has four and this mirrors them, in
the order they occur in the corpus:

| kind | entries | |
| --- | --- | --- |
| `implicit` | 15,933 | no `set:` — `<value> (>NAME, Units)`, and units-less for `K:`/`H:` |
| `javascript` | 6,720 | evaluated with `value` and `current` in scope |
| `prepended` | 2,017 | starts with `(`, so the value goes in front |
| `literal` | 1,863 | sent exactly as written |

**A caveat that turned out to be the stage's main finding:** FS Copilot runs
these in Jint and we run them in V8, and the two disagree about more than
arithmetic — `Engine.Evaluate` runs a **script** and returns its completion
value, so top-level `return` is legal and a leading `{` is a block. Both matter
in the corpus. See the log entry for 2026-08-25.

`npm run check:setters` sweeps every profile on disk, the same way
`check:format` does, because the corpus lives outside the repository.

**Exit — met:** 26,533 entries resolve, 0 throw. The 8 refusals are findings
about profiles rather than about the resolver, and are listed in the log.

### Stage 3 — Watch for the one invisible outcome — **built**

`src/main/sim/run.ts`. It was going to classify three outcomes and report them
in a result line. It reports one, and says nothing about the other two, because
**the editor is already showing them**: the popover sits under the entry and the
`get:` line's live value sits directly above it, so "it moved and stayed" and
"nothing moved" are both on screen while you are looking at the panel anyway.

What is not on screen is a revert. The rates decide this:

| revert takes | the module, diffing at 15 Hz | your eye on the live value |
| --- | --- | --- |
| under ~66 ms | never reported at all | nothing |
| ~66-400 ms | one or two ticks | a flicker, if you happen to be looking |
| over ~400 ms | several ticks | readable |

Against a measured median of 83 ms and a p90 of 464 ms, the middle band is
where most reverts live — and there a revert and "nothing happened" **look
identical**, because both end with the live value reading what it read before.
Reading that as no-effect means rewriting a setter that was correct and never
learning the variable will desync. So the detector speaks there and nowhere
else.

The top row is an honest limit rather than an oversight: an excursion inside one
15 Hz tick reaches nobody, this detector included, since it reads the same
stream. Catching those needs the module to watch the target at frame rate and
report the excursion itself — a protocol change, worth it only if the gap turns
out to matter.

**Dropped: the finding list.** "What else moved in the window" needed a third
`AnchorKind` and a window shape for it, landing in ranking code that the
2026-08-24 capture-window entry had just settled. The mark hotkey already
answers "what moved just now" and answers it better, so this was scope rather
than a gap.

**Exit — met:** 16 tests over synthetic streams, most of them asserting that
nothing is said.

### Stage 4 — The inline control — **built**

- A play button in the editor's per-line margin, on every entry — the `set:`
  line when there is one, the `get:` line when there is not. **In the margin,
  not injected into the text**, which is where it started: injected text takes
  horizontal space, so a `set:` line with a button no longer lined up with the
  `get:` line above it that had none.   `linesDecorationsClassName` draws in the column `lineDecorationsWidth`
  sizes, outside the flow — widened from Monaco's default 10 px to 16 so the
  glyph has something to sit in, which moves every line by the same six pixels
  and so changes no indentation relative to any other
- Hit-testing is **exact**, not inferred. The plan expected to guess which
  injected text was clicked from the mouse position, since Monaco reports no
  injected text in a mouse target's `detail`. It does not have to:
  `IBaseMouseTarget.element` is the DOM element under the pointer and injected
  text carries our class, so a click is ours when the element says so
- Content-widget popover, titled *Execute setter*, on the app's own dialog
  treatment: one grid, so the labels form a column and the controls line up
  under each other whichever rows a given setter needs. Quick picks and the code
  preview take the control column on rows of their own rather than crowding the
  field they belong to, and the result line appears only when there is something
  the editor cannot show. Run on Enter; Escape or a click anywhere else closes
  it; a click on its own button toggles it. The first control takes focus when
  it opens and gets it back after every run

**The rest of the file dims while it is open.** The popover asks you to watch
one number — the live value on the `get:` line above it — and a screenful of
other entries is the competition for it. The open entry's text carries a marker
class and every `.view-line` without it is dimmed, which is the way round it has
to be: `opacity` cannot be undone by a child, so the lit lines are never dimmed
rather than dimmed and brightened back. Two decorations, not one per visible
line.

**It shows only what the setter reads**, decided by `setterInputs`:

| kind | value | current | preview |
| --- | --- | --- | --- |
| `implicit` | yes | no | **no** — the code is `<value> (>NAME, Units)`, and every part of that is on the line that was clicked |
| `prepended` | yes | no | yes |
| `literal` | **no** | no | yes — what you typed would change nothing |
| `javascript` | if mentioned | if mentioned | yes |

Which makes the common case nearly empty: an `L:` switch with no `set:` is one
field and a button. `value` and `current` are found by word-boundary match, so
`L:CurrentAltitude` does not summon a `current` field. A mention inside a string
still does — one field too many rather than one too few, against parsing the
expression to find out.

**The popover does not close on Run**, and that is the design rather than an
omission:

- The value you are watching is on the line above it, so running and watching
  need neither a moved eye nor a moved hand. The next attempt is a new number
  and Enter, with focus kept in the field
- Failures have somewhere to land. A calculator rejection and an unresolvable
  setter are the two most likely things to happen to a person writing one, and
  a panel that vanished on click would have to invent a place to say so
- Re-running is how you undo — decided in Safety, below — and that is a value
  change away rather than a hunt for the button again

**The buttons only exist when a run would mean something.** Three conditions,
and they disappear rather than going grey — a disabled control invites the click
it then refuses, and the app says why elsewhere already (the footer chip, the
aircraft box in Profiles).

- **The Link module is present and current.** A run is
  `execute_calculator_code` inside the simulator, which nothing but the module
  reaches, and `exec` arrived in protocol 2 — an older module ignores it, which
  would be a three-second wait and then silence.
- **The sim is live.**
- **The open profile is the loaded aircraft's**, by `profileKey`, the same
  exact-match rule `CurrentAircraft` uses. This is the condition worth arguing:
  a run writes into the aircraft that is *loaded*, not into the file that is
  open, so a button on a PMDG profile while a PA24 is in the sim offers to write
  PMDG values into a Comanche. That is not a run that fails — it is a run that
  does something else, and nothing you read afterwards recovers the intent.

**Placement is load-bearing.** The widget is pinned to `BELOW` alone so Monaco
can never flip it over the `get:` line, which would hide the number the whole
arrangement exists to show. Two things make that possible:

- `scrollBeyondLastLine` is back on (it had been turned off with no reason
  recorded, against Monaco's and VS Code's default). Without it the last entry
  in a file has nothing underneath it and no amount of scrolling makes room —
  and it is independently right, since the last line can now be read somewhere
  comfortable rather than pinned to the bottom edge
- The popover scrolls itself into view **only when it would not fit**, and
  reserves 72 px beyond its measured height when it does. Late arrivals — an
  error, a revert notice — then have room to appear without the panel shifting
  under the cursor

**Exit — met:** the preview resolves and renders with the sim closed;
everything but execution works dry.

### Stage 5 — Live — **first half met, second half unconfirmed**

**Exit:** run a setter on a switch and watch the cockpit move, with the live
value on the `get:` line following it. Then run one on a variable the aircraft
owns and get the revert line, with a plausible elapsed time on it.

**The writes landed.** The captures of 2026-08-26 hold `exec` replies issued by
the app rather than by `link:read` — fifteen of them in one A350 session
between 20:29 and 20:45, every one `ok: true`, and singles in four more
captures the same evening. The wire, the resolver, the button and the module
therefore work together against a real aircraft.

**The revert line has no evidence either way**, and cannot get any as things
stand: `runSetter` returns the revert to the renderer over IPC, and nothing
writes it to the capture. Whether one was ever seen is a memory rather than a
record. Two ways to close it, whenever the sim is next open — watch for the
line deliberately on a variable the aircraft owns, or record the outcome of a
run into the capture so the question answers itself afterwards. The second is
worth more than this stage: it is the only outcome the editor cannot show, so
it is the only one worth keeping.

## Safety — decided, and deliberately light

10-probe's safety section does not carry over, and the reason is the shape of
the action rather than optimism: this is the user's own line, one explicit
click, no automation, no sweep.

- **No blocklist.** Decided. A setter can contain `(>K:ENGINE_CUTOFF)` and that
  is the profile author's business — if they want to kill the engine, that is
  their choice. 10-probe wanted a blocklist because a *sweep* fires events
  nobody chose; nothing here fires anything nobody chose.
- **No confirmation dialog**, for the same reason. The preview showing exactly
  what will execute is the whole of the mitigation, which is why it is not
  optional.
- **No automatic restore.** Decided. Probe restored because it wrote a value
  nobody asked for; here the user chose it, and putting it back would undo what
  they just requested. Running it again is how you revert.

## Working notes

- **The preview is load-bearing**, not decoration. It catches a wrong multiplier
  or a typo'd target without touching the simulator, and it is the only thing
  standing between a click and an arbitrary calculator expression
- Quick picks are session-scoped. The ring buffer holds two minutes of every
  value; `sim_observation` stores change *counts* and not values, so nothing
  survives a restart unless that changes
- Stages 2, 3 and 4 are buildable and testable with MSFS closed. Stage 1 needs
  it twice — closed to build the module, open to verify
