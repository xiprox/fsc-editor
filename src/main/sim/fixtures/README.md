# Captured simulator sessions

Real sessions, recorded from MSFS by `capture.ts` and read back by
`readCapture`. They are evidence, not test data someone wrote: every timestamp
and value is what the simulator actually sent.

**Do not edit them.** A fixture that has been tidied cannot answer questions
about what the sim really does, which is the only reason to keep one. If a case
is missing, record another session.

Add one by copying it out of `%APPDATA%/fsc-editor/captures/` and describing it
here.

## pa24-250-session.ndjson

MSFS 2024 (SunRise 12.2), A2A PA-24. 437 seconds, 771 events. The first session
ever captured, and the one that verified stage 2.

What is in it, and why each part is worth keeping:

| At | What |
| --- | --- |
| 10.5s | Aircraft reported **twice** — once via `systemState`, once via `eventFilename`. One load, two events. |
| 10.5s | 318 input events enumerated, matching the stage 0 spike exactly. |
| 278.7s | **318 distinct events in 2 ms** — an aircraft-change state snapshot, 4.1 s *before* the aircraft event at 282.8s. |
| 282.8s | Aircraft → `microsoft-pilatus-pc6`, which enumerates 260. |
| 295.6s | 45 distinct events in 0 ms, all AS430/radio — a subsystem powering up. |
| 299.1s | Aircraft → `pa24-250`, back to 318. |
| 372.9s | A second snapshot, 8.2 s ahead of a reload of the same aircraft. |
| 404–412s | Genuine interaction. Battery master twice, and **landing light R toggled eight times in a row** — the repeat-collapse case. |

Two properties stage 4 has to get right are both present, which is what makes
this worth committing rather than regenerating:

- **The double-fire.** 53 consecutive same-name same-value pairs. 43 fall at
  17–21 ms and nine at 37–40 ms, roughly one and two frames. The single 261 ms
  pair is `INSTRUMENT_HSI_KNOB_COURSE_KNOB_CRS` reporting the same value twice
  during a continuous rotation — a *genuine* repeat, and the thing dedup must
  not swallow. So the window is bracketed on both sides by real data.
- **The snapshots.** Hundreds of events at once, arriving seconds before the
  aircraft event a separator would be drawn at. Anchoring every one of them
  would produce 318 false findings attributed to the outgoing aircraft.

Both are written up in `docs/sim-vars/build/v1-log.md` under 2026-08-23.

## trace-coverage.yaml

**Synthetic, and not a capture at all** — the second file here that is test
data somebody wrote, and like `live-values.ndjson` it says so rather than
sitting among the recordings pretending otherwise. It is a *profile*, not a
session: twenty-five entries chosen so that between them the trace model takes
every branch it has.

It exists because the Trace panel has about thirty distinct row shapes and no
way to see them. Checking a copy change meant rendering cases by hand, one at
a time, and remembering which ones existed — which is exactly the kind of
thing that goes stale the week after it is written.

`trace-coverage.test.ts` walks it two ways:

- **The test.** It asserts the set of `phase/id/label/state` triples the walk
  produces against an explicit list of 33. Add a branch without a fixture
  entry and it fails; delete the entry that was the only one reaching some row
  and it fails. The list is explicit rather than derived on purpose — a
  derived expectation would pass for a fixture covering nothing.
- **The review aid.** `trace-coverage.txt` beside it holds every distinct
  column, generated. It **proves nothing** — it is read off the
  implementation, which `trace.test.ts`'s header warns is worthless as
  evidence — but this panel is almost entirely copy, and a copy change is
  reviewable only when you can see it. Update it with `-u` and read the diff.

The entries use real names out of the corpus wherever a real one fits, and two
are real lines: `SWS_Pilatus_PC12_5B.yaml:55` for the `K:` double fire, and
the `${value * 16} 1 (>K:2:KOHLSMAN_SET)` shape the corpus gets wrong thirteen
times.

**For manual testing**, drop it in a Definitions folder and walk the caret down
it with the Trace panel open — every row, state and tooltip the panel has
appears in order.

## live-values.ndjson

**Synthetic, and one of two files here that are.** Everything else is
evidence; this one is a fixture built by hand, and it says so rather than
sitting alongside real captures pretending otherwise. The other is
`trace-coverage.yaml`, which is not a session at all.

Sixty seconds of the PA-24 profile's six most visible `A:` variables ticking
once a second — Kohlsman climbing, the transponder counting, both OBS knobs
rotating, avionics master toggling, rudder trim drifting. The names and units
are the real ones out of `pa24-250.yaml`.

It exists because the real capture contains **zero** `simvar` events: stage 2
never watched any `A:` variables, so nothing on disk could exercise stage 3's
live values. Replaying this drives the whole path — watch set, values back,
inlay hints — with MSFS closed:

```
npm run sim:sandbox -- src/main/sim/fixtures/live-values.ndjson
```

Open `pa24-250.yaml` and the hints should count upward. A hint that appears once
and then freezes is the bug this fixture was made to catch.


## link-session.ndjson

**Synthetic, and generated rather than written** — by
`scripts/make-link-fixture.ts`, which reads the names straight out of
`pa24-250.yaml`. 1,186 events: a handshake, the enumeration in three chunks,
every one of **279 real `L:` variables** reported once, then 15 Hz deltas for
twenty seconds.

It exists because the module's own output cannot be captured until somebody
starts MSFS with it installed, and stages downstream of the wire — `L:` live
values, Activity's anchoring, the Log panel's handling of `via: "link"` —
should not have to wait for that.

> **The previous version of this file claimed the same thing and was wrong.**
> It listed five names as real `L:` variables from `pa24-250.yaml`, and four of
> them did not exist in it — `AdfOnOffKnob` for the real `AdfOnOffKnobVolume`,
> and three invented outright. So the one fixture built to exercise `L:` hints
> could light a single line out of 295, and its README said otherwise. That is
> why it is generated now: reading the names out of the profile makes the
> mistake impossible rather than merely unlikely.

Two properties are deliberate and worth not flattening if this is ever
regenerated by hand:

- **The first tick reports every variable.** The module seeds its `last` array
  with NaN so the first comparison after enumeration is false for everything —
  without it an app connecting mid-flight would see only what moved afterwards.
  A fixture missing that would let a regression in the app's "keep every value"
  rule pass unnoticed.
- **The enumeration is chunked.** Three `vars` events, not one, because the wire
  chunks at 8 KB and a reader that assumes otherwise should fail here rather
  than against a live sim.

> **This file used to say "replace it with a real capture once one exists, and
> delete the generator with it". Real captures exist now, and that turned out
> to be the wrong instruction.** Every capture on disk was measured against the
> two properties above: exactly one has names strictly before values *and*
> reports every enumerated name, and that one is a parked A350 in which a
> single variable moves — a camera accumulator. The reason is structural rather
> than bad luck. A real session re-walks the table while values are already
> flowing, so names land after values; and it enumerates thousands of names of
> which a few hundred ever move, so "every name reported" cannot hold. Those
> two properties are the module's *contract*, and testing a contract wants a
> clean example of it, which is precisely what a generator is for.

So this file stays, and `bonanza-l-values.ndjson.gz` was added beside it rather
than over it. The values here are ramps and toggles, not evidence — for
evidence, use the real one.

```
npm run sim:sandbox -- src/main/sim/fixtures/link-session.ndjson
```

Note that replaying it writes **no** sim evidence. That is deliberate: the same
capture played twenty times would inflate every `sim_observation.changes` count
twentyfold, and that column is meant to say how often a variable really moved.

## bonanza-l-values.ndjson.gz

**The real counterpart to `link-session.ndjson`.** Fifteen seconds of a Black
Square Bonanza a minute after it finished loading, cut from
`2026-08-27T18-02-01` with `npm run sim:slice -- <capture> --from 600 --to
615`. 4,683 events: 7,592 names enumerated, 340 of them moving, and real
instruments among them — oil temperature, VSI and compass all with about 170
distinct readings in the window.

It exists because the generated fixture is too tidy to catch anything the app
does wrong under load, and one property here cannot be generated at all:
**eight names arrive after values have already started**, from a settle walk
still running while the module streams. `L:BKSQ_VOR_1_DERIVATIVE` is one of
them and reports 94 times afterwards, so "a variable that registers late still
reaches the editor" became a test instead of an assumption. That is the
aircraft-registers-its-avionics-late case, on disk, at last.

Two costs worth knowing before reaching for it:

- **A replay takes about six seconds**, against a fraction of that for the
  generated fixture, because a real enumeration is 7,592 names rather than 279
  and all of them go through the store. `values.test.ts` replays it **once**
  and shares the result across its cases for that reason.
- **It is not a contract example.** Names appear after values and most
  enumerated names never move, which is exactly what makes it realistic and
  exactly why the two structural tests still point at the generated file.

```
npm run sim:sandbox -- src/main/sim/fixtures/bonanza-l-values.ndjson.gz
```

## pa24-mark-cabin-vent.ndjson.gz

24 seconds of a PA-24, sliced from `2026-08-24T17-32-20`, holding **two marks**
made while pulling the cabin vent lever — a control MSFS reports no input event
for. The first fixture that carries its own marks, which is what makes it able
to reproduce a marking session: `findingsFor(events)` with nothing else passed
in gives what the panel gave at the time.

```
npm run sim:slice -- <capture> --from 8 --to 32 --out pa24-mark-cabin-vent.ndjson.gz
```

It exists because the session it came from produced **nothing**: 5,551 of 5,554
variables were rejected as ambient, the vent lever among them, found at +1.1 s
and discarded at a measured 0.94 changes a second. The buffer was 24 seconds
old and two mark windows covered 21.8 of them, leaving 2.1 seconds of quiet
time to infer every rate from — see `MIN_QUIET_MS`.

Two properties worth not flattening:

- **The second mark's answer is real and the first one's is not.** Mark 2 offers
  the vent lever cluster; mark 1 lands on the tail of the startup enumeration
  snapshot, ~2.1 s before it, and offers five thousand variables that all
  "moved once, next to an anchor". That is a known open problem, not a flaw in
  the fixture — it is the reason the fixture is worth keeping.
- **It starts 8 seconds into the session**, so the enumeration snapshot is
  inside the window rather than cropped out of it. A slice that began later
  would hide the case above.

## pa24-many-controls.ndjson.gz

115 seconds of a PA-24 with **six different controls** worked in it — the beacon
switch, the starter, the fuel indicator, the glovebox, the ADF inner knob and
the heading bug. 148 input events, 243,858 changes, 31 anchors.

```
npm run sim:slice -- <capture> --from 10 --to 125 --out pa24-many-controls.ndjson.gz
```

**Variety is what it is for.** `promiscuity` — how many different controls a
variable answers to — is the ranking's leading term after direction, and a
fixture holding one control cannot test it. A 55-second five-control slice was
cut first and thrown away for that reason: it contained exactly one toggle
switch, so the toggle's click sound answered to one control and scored as
specific as the switch itself. Two toggles is the minimum that makes the
measurement mean anything, and this has them.

It is 1.7 MB, the largest fixture here, and the size is the price of that
variety: the controls are spread over two minutes because that is how long it
takes a person to work six of them.

Do not re-slice it narrower without checking `activity-promiscuity.test.ts`
still passes. The before-and-after test in it compares this ordering against the
proximity-only one it replaced, and a fixture with fewer controls will narrow or
erase the difference it is asserting.

## pa24-early-report.ndjson.gz

60 seconds of a PA-24 with the pitot heat switch flipped sixteen times and the
battery master twice — both controls whose right answer is known, worked
repeatedly on purpose.

```
npm run sim:slice -- <capture> --from 15 --to 75 --out pa24-early-report.ndjson.gz
```

It is kept because of two orderings it disproved, and both were invisible in
every earlier fixture:

- **A control's own variable routinely reports *before* the control does.**
  `L:` arrives through the WASM module and input events through SimConnect, and
  the offset between them carries tens of milliseconds of transport noise. The
  window had always opened 50 ms early to absorb it; the sort had not, and
  filed anything negative last. `L:Battery1Switch` placed **15th of 16** here
  for reporting 2 ms early. See `JITTER_MS`.
- **Sub-millisecond offsets are parse order, not sim order.** The app stamps
  each value with `Date.now()` as it parses, so one 8 KB message spreads its
  ~192 values across a couple of milliseconds. With the first fix in, the
  battery master still placed eighth because `L:Battery1Charge` at −1 ms beat
  the switch at −2 ms. See `SAMPLE_MS`.

The repetition is the point. One flip of one switch would have shown neither —
both only appear as a pattern across many anchors, and the pitot heat switch
being worked sixteen times is what made the mean position meaningful.

## `pa24-beacon-input.ndjson.gz`

Five seconds of `pa24-many-controls` around `SWITCH_LIGHT_BEACON_2STATES` going
1 → 0, for `values.test.ts`'s question: does a `B:` value reach the renderer at
all?

```
npm run sim:slice -- <capture> --from 3 --to 8 --out pa24-beacon-input.ndjson.gz
```

**The `var` events are then removed.** The window holds 10,715 `L:` deltas and
four input events, and the deltas took the replay from about a second to forty —
long enough that the test could not be run at a sane timeout. Nothing about how
a `B:` value is assembled passes through them, and the `vars` announcements are
kept so the session still stands alone. Everything remaining is untouched real
capture, at its original timings.

Note that `sim:slice` reads raw NDJSON only, so a `.gz` source has to be
decompressed before slicing even though the script writes `.gz`.

It exists because the bug it now catches shipped: `emit` does not feed the
live-value store — only the replay and link paths call `absorbValues`, and each
SimConnect handler does its own — so the input-event handlers captured every
value, recorded it as evidence, and showed none of it.
