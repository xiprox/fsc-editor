# The double write — a probe plan

    Question:  `SimClient.Set` has four `if`s and no `else`. Does an entry
               whose write matches one of the first three **also** go through
               the catch-all — and for a `K:` event, does that mean it fires
               twice?
    Stakes:    the trace panel says `should` and marks the step `unknown`. If
               this confirms, it becomes `will`, the step becomes `ok`, and a
               `master:` entry writing a TOGGLE event becomes a **diagnostic**
               rather than a note in a panel.
    Status:    **unrun.** Written 2026-09-20 for the user to run; the
               `wait-for-the-human` rule covers cockpit experiments.
    Safety:    probe A/B toggle an **engine starter**. Cold and dark, parked,
               brakes set, engines off. Do not run these with an engine
               running or during a start sequence.

---

## What is already known, and what is not

**The C# is not in doubt.** `SimClient.cs` ~226:

```csharp
if (name.StartsWith("L:")) SetLVar(name, sUnits, Convert.ToSingle(values[^1]));
if (name.StartsWith("A:")) SetSimVar(name[2..], sUnits, values[^1]);
if (name.StartsWith("K:")) TransmitKEvent(name[2..], values);
// B / H / Z / Others
if (name.Length > 2 && name[1] == ':')
    Execute($"{string.Join(' ', values…)} (>{name})");
```

Four `if`s, no `else`, and `K:TOGGLE_STARTER1` satisfies both the third and
the fourth. Reading alone says both run.

**The calculator fires K: events — already proved.** v1-log 2026-08-29, the
arity probes: `2 16240 (>K:KOHLSMAN_SET)` run as calculator code moved both
altimeters to 1015. So the fourth branch is not inert for a `K:` name.

**What is untested is the two together**, on a live FS Copilot, end to end.
That is the whole gap, and it is one session's work.

## The line this is about

`SWS_Pilatus_PC12_5B.yaml`, in the `master:` block:

```yaml
  - get: A:GENERAL ENG STARTER:1, Bool     # line 55
    set: (>K:TOGGLE_STARTER1)
```

`prepended`, so an incoming `1` builds `1 (>K:TOGGLE_STARTER1)`. `master:`, so
FS Copilot pattern-matches rather than runs it: target `K:TOGGLE_STARTER1`,
operands `[1]`. Then branch three fires the event and branch four runs the
expression. If both land, the peer's starter ends **off** while the pilot in
control has it **on**.

It is a real line in a shipping profile, which is why this aircraft is the
subject rather than a synthetic one.

---

## A · does one calculator write move this starter?

Establishes that branch four is live for *this* event on *this* aircraft,
rather than only for `KOHLSMAN_SET` on the Baron.

```bash
npm run link:read -- watch "A:GENERAL ENG STARTER:1"
```

Leave that running in one terminal and note the baseline. In another:

```bash
npm run link:read -- exec "1 (>K:TOGGLE_STARTER1)"
```

**Expect** the watched value to flip. If it does not, stop — branch four does
nothing here and the whole finding is aircraft-specific, which is itself worth
recording.

## B · do two writes cancel?

The consequence, without FS Copilot in the picture. Run the same `exec` a
second time.

```bash
npm run link:read -- exec "1 (>K:TOGGLE_STARTER1)"
```

**Expect** the value back at its baseline. This is the *toggle ends where it
started* claim, tested directly.

Leave a beat between the two — a toggle fired twice inside one frame may be
coalesced by the aircraft's own code, and that is a different answer from
"it fired twice", not the same one. If they cancel with a pause and not
without, record both: it changes the finding from "always" to "usually".

## C · the definitive one — does FS Copilot itself double-fire?

A and B prove the mechanism can do it. Only this proves FS Copilot does.

Two machines (or two instances) on Remote Connect, both on the PC-12, cold and
dark. Peer B watches `A:GENERAL ENG STARTER:1`:

```bash
npm run link:read -- watch "A:GENERAL ENG STARTER:1"
```

Pilot A, in control, flips the starter **once**.

| what B's starter does | what it means |
| --- | --- |
| ends **on**, matching A | one write lands. The catch-all is inert after a `K:` branch, and the model's `unknown` was right to hedge. |
| ends **off** | **both writes land.** The event fired twice. Confirms the reading. |
| flickers on then off | both land, visibly. Same conclusion, with the sequence observable. |

Note which, and whether B's value settles or oscillates — an oscillation would
mean the echo suppression is also involved and that is a second finding.

---

## What each outcome changes

**If C ends off** — the double write is real.

- `trace.ts`: the `execute` step's state goes `unknown` → `ok`, and its copy
  goes `should fire twice` → `fires twice`. Rows 44b/44c in copy-registry.md.
- `fscopilot-behavior.md`: the "read in the source, never probed" caveat on
  the no-`else` branches is replaced with the probe.
- **A new rule becomes possible**: a `master:` entry whose setter writes a
  `K:` event containing TOGGLE is a defect, not a curiosity — the sync it is
  meant to do, it undoes. The PC-12 line above is the first corpus hit; sweep
  for the rest with `check:grammar`'s corpus walk.
- The trace panel's `unknown` outcome node stops being needed for this shape.

**If C ends on** — the catch-all does not reach the sim after a `K:` branch.

- The `execute` step is wrong to exist for `L:`/`A:`/`K:` and should be
  dropped there, leaving it only where it is the sole route.
- Worth finding out *why*, since the C# says otherwise — most likely the
  event is consumed before `Execute` runs, or `Execute` is rejected. Capture
  the module's reply either way; `link:read` prints `exec: #1 ok|err -> …`.

**If A fails but the KOHLSMAN probe still holds** — the answer is per-aircraft
and per-event, which is the same shape as the `b-write-op` finding: the
behaviour is decided by set-code authored per preset and cannot be settled
statically. The trace keeps `should` permanently and says so for a reason it
can name.

---

## Recording it

v1-log.md, in the existing form — **Stage / Expected / Found / Changed /
Affects**. The transcripts from `link:read` go with it; a probe whose output
was paraphrased is a probe somebody re-runs.
