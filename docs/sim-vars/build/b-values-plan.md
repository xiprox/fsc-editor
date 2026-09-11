# `B:` live values — build plan

    Status:     **built 2026-09-04, all six steps — not yet exercised against
                a running simulator.** Typecheck, 804 unit tests and a build
                pass; whether a value reaches a gutter has not been watched
                happening. The measurements below were taken against a running
                A220 on 2026-09-03 and substantially revised on 2026-09-04,
                when the subscription was finally tested with somebody at the
                controls
    Extends:    09-live-values, 02-namespaces
    Log:        v1-log.md — the 2026-09-04 entry first, then the two
                2026-09-03 ones it corrects

**Start here**, then read the 2026-09-04 entry at the top of
[v1-log.md](v1-log.md). Between them that is enough to build this without any
of the conversation that produced it.

## What it is

A live value in the gutter, and in the Variables panel, for `B:` input events —
the last namespace with a working read that the app does not use.

[namespaces.ts](../../../src/shared/vars/namespaces.ts) currently says:

```ts
B: { read: null, why: "input-event values arrive by subscription, not yet as live values" }
```

That is honest about the app and wrong about the simulator. Both halves of it
are answered below.

## The measurements, so nobody re-takes them

Taken with `npm run sim:probe`, a read-only `node-simconnect` client running
beside the app, on an A220 (464 input events, 463 distinct) — first cold and
dark on 2026-09-03, then powered on the runway with somebody working the
overhead on 2026-09-04. The second session is why half this table changed:
every question about *change* needs a hand on a control, and the first had
none.

| Question | Answer |
| --- | --- |
| Can a value be read at all? | **Yes.** `getInputEvent(requestId, hash)` answered for **all 464**. |
| What type? | **Every one a `number`**, and every one *declares* `DOUBLE`. Zero strings, though the API types values `number \| string`. |
| Is the subscription a change feed? | **Yes.** Eleven latching switches reported real transitions, in order, while somebody worked the overhead — every detent of a three-position switch included. |
| Does subscribing deliver a current value? | **No.** Four of five events subscribed in an earlier probe sent nothing at all. This is the one real gap. |
| Do untouched events ever report? | **No, and that is correct.** 433 stayed silent because nobody touched them; ten of them spoke the instant they were pressed. |
| Is the module needed? | **No.** Both calls are plain SimConnect. |

The "not a change feed" answer this table used to carry came from watching a
cold-and-dark aeroplane nobody was touching for five seconds. Re-run with
`npm run sim:probe` on a powered airframe with a person at the controls.

### Two kinds of event

The measurement that reframes the rest:

| | Behaviour | Value | Example |
| --- | --- | --- | --- |
| **Latching** | reports value changes | real state (0/1/2) | `AIRLINER_OVH_LTS_BEACON` |
| **Momentary** | reports a *firing* per press | **always `0`** | `AIRLINER_FCU_ALT_PUSH` |

**Nothing tells you which is which.** The descriptor's type is `DOUBLE` for all
464, `enumerateInputEventParams` returns `";FLOAT64"` for all 464, and FS
Copilot does not use the input-event API at all. It is authored in the
aircraft's model behaviors — the same wall
[b-preset.ts](../../../src/shared/lang/rules/b-preset.ts) documents for writes.

### What that decides

**The subscription is the read for updates, and `getInputEvent` is the read for
the first value.** Structurally this is closer to `L:`'s stream than to the `A:`
data definition, with a one-shot read bolted on where subscribing falls short.

The subscription is already running for all 464 on every aircraft load
(`enumerated()` subscribes the whole table), so updates cost nothing that is not
already being paid. It keeps its existing job as Activity's anchor unchanged.

## The work

### 1. A fourth read mode

`read` is typed `"definition" | "stream" | "watch" | null`. `B:` becomes
`"input"`. The panel's live cells follow for free — `readable()` is
`readOf(name) !== null`.

While in that row: `B:` is currently `units: "converted"`, which looks wrong for
a namespace with no unit conversion. `raw` is the likely answer, and it is a
one-line change to make deliberately rather than by accident.

### 2. Name → hash, and the preset strip

SimConnect addresses events by `inputEventIdHash`. `session.ts` holds
`live.names` as hash → name; the reverse is new, with the same per-aircraft
lifetime — cleared on a swap, because hashes are reassigned.

The catch is the one the 2026-09-03 rule fix is about: a written name is
`ID_Preset` and **only the ID has a hash**. Resolution therefore strips one
trailing `_Word` — whichever word it is, unless it is all digits — as `absent()` in
[rules/b-preset.ts](../../../src/shared/lang/rules/b-preset.ts) does.

Consequence to state plainly in the UI work: a `get: B:AIRLINER_FCU_CHRONO_2_Push`
line shows the value of `AIRLINER_FCU_CHRONO_2`. There is no per-preset value,
because there is no per-preset anything.

**Make the strip one shared helper**, used by the resolver and by the rule. Two
copies of this rule is how the next wrong diagnostic gets written.

### 3. The first value, once

`watchSimVars` already fans out on `readOf`: `"watch"` to the module,
`"definition"` to SimConnect. Add the `"input"` branch — but it fires **when a
name enters the watch set**, not per tick: resolve the name to a hash, issue one
`getInputEvent`, and keep request-id → name bookkeeping for the reply, since
`RecvGetInputEvent` carries a request id and no hash.

Everything after that arrives on the subscription, which is already running.

**Request-id hazard.** `ENUMERATE_BASE = 100` counts *up* without bound, a fresh
id per aircraft change. A fixed range for reads must sit well clear of it — not
at 200 — or a long session will collide with an enumeration and the chunks will
merge, which is the failure that base was introduced to prevent. Smaller than it
was when this meant a per-tick range, but not gone: watch sets change all
session.

### 4. `absorbValues`

It handles `simvar` and `var` and returns on everything else. That single
`return` is the entire reason no `B:` value has ever reached a gutter.

Values key as `B:ID`, matching what `store.ts` already records for a firing.
`watchedValues()` resolves a watched written name to its ID through the map
from step 2.

### 5. Numbers only, with a guard

All 464 values came back numeric. The API allows strings, so non-numeric values
are ignored rather than widening `SimValue` through the wire, capture, replay,
the gutter formatter and the value store — a ripple with zero observed cases
behind it. The descriptor's `why` then covers that remainder rather than the
whole namespace.

### 6. Telling an unreliable read from an untouched one

Rate used to be this section, and it is gone: one read per name per *watch
change* is nothing, and the subscription carrying the updates is already
subscribed. There is no cadence to choose.

What replaces it is the question a `get: B:` line actually raises. A momentary
event reads `0` between presses **and during them**, so `get: B:AIRLINER_FCU_ALT_PUSH`
is a broken read — a constant sitting in the slot where `A:` and `L:` show
something true. There are 651 `get: B:` lines across the corpus, so this is not
hypothetical.

**Polling faster does not detect this.** The value is `0` at every sample rate.
What proves the control was exercised is the *firing*, which the subscription
pushes at the moment of the press — the same transport step 3 already relies on.

#### The discriminator

Measured on the A220, 2026-09-04, over one 43.2-second window:

| | arrivals | span | shape |
| --- | --- | --- | --- |
| Tickers (21) | 174–179 | the whole window, max gap 0.3 s | continuous from subscribe onward |
| Pressed (10) | 1–10 | 0.0–1.2 s | isolated burst, silence either side |

No overlap. A burst is a firing; a continuous stream is a ticker whose arrivals
mean nothing. That gives four states:

| Observation | Verdict |
| --- | --- |
| burst arrivals, value changed | latching — the read is good |
| burst arrivals, value stayed `0` | **exercised and did not move — the read is unreliable** |
| no burst arrivals | never touched — no evidence, say nothing |
| continuous 4 Hz stream | ticker — only its *changes* count |

Row two is a diagnostic worth writing; row three is why it stays quiet for
somebody who simply has not flipped the switch yet. Evidence-gated exactly like
`b-preset-unknown`, and it appears and disappears with the simulator for the
same reason.

Built as `b-value-constant`, an entry rule in the evidence tier, with
`ENOUGH_FIRINGS = 3` — one firing could be a simulator stall misread as a press.

#### Prerequisite: `observe()` currently discards this

[store.ts](../../../src/main/sim/store.ts) drops a repeat arrival at an
unchanged value:

```ts
if (lastInput.get(name) === event.value) return
```

A momentary event pressed ten times at `0` takes that early return nine times.
Only the first arrival survives, recorded as existence — so "pressed ten times,
never moved" and "arrived once, never again" are the same record today, and
those are precisely the two cases this rule has to separate.

The dedup is not wrong; it is what stops the tickers dominating the movement
counts. It needs a **third counter beside `names` and `changes` — `firings`**,
gated on the burst-versus-continuous distinction rather than on value equality,
so tickers still cannot pollute it.

#### The limit, stated plainly

`AIRLINER_LDG_LEVER` ticks at 4 Hz reading `0` and never changed in the window
— a latching control that simply was not moved, with the aeroplane on the
runway. A latching control that also ticks and never gets exercised stays
unclassified. That is the correct outcome, but it makes the ticker set a blind
spot for this rule rather than a source for it.

## What comes free

- **Replay.** `capture.ts` already records `input` events, so
  `npm run sim:sandbox` replays gain `B:` values the moment `absorbValues`
  consumes them. No capture format change.
- **No redundant emits.** `recordValue` already no-ops when a value is
  unchanged, so the 4 Hz tickers cost nothing downstream.

## What is already built

Done on 2026-09-03, and this plan assumes it:

- The enumeration folds into the variable index as an `aircraft` facet
  (`inputEvent`), so the names are listable and completable.
- `observe()` records a firing as movement, deduplicated by last value — the
  tickers above are exactly why that guard exists.
- `b-write-bare` warns when a `set:` writes a bare enumerated ID.
