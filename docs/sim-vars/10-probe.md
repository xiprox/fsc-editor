# Probe

    Purpose:    Writing to a candidate to find out what it actually is.
    Depends on: 03-link, 07-activity
    Decides:    per-namespace mechanics, restore discipline, cause-vs-symptom, safety

> **Amended by the build.** The per-namespace table below predates the typed
> API: `Z:`, `O:`, `I:` and `E:` read and write through `MSFS_Vars.h` by id, not
> through `execute_calculator_code`. See "The typed variable API works, and the
> sim announces invalidation" in [build/v1-log.md](build/v1-log.md).

> **Superseded by the build.** This is not being built. Running the profile's
> own `set:` line answers a better question — it exercises the expression, the
> multiplier, the target and the units, which are the bugs an author actually
> produces and which probe cannot find because it never runs the author's code.
> Probe's payoff survives: "a variable that reverts shortly after being written
> will desync if bound" is what you get by watching the variable after running
> the line. See [build/run-setter-plan.md](build/run-setter-plan.md) and
> "Probe is replaced by running the setter" in [build/v1-log.md](build/v1-log.md).
>
> The `A:` inversion below is the one idea with no successor, and it is the seed
> of [14-sweep-and-testing](14-sweep-and-testing.md) rather than of this.

Observation tells you a variable *changed*. Only writing tells you whether it is
the control or merely an indication downstream of the control.

## Per namespace

| Namespace | How |
| --- | --- |
| `L:` | Direct: `value (>L:NAME)` through `execute_calculator_code`. |
| `K:` | Fire: `1 (>K:EVENT)`. |
| `H:` | Fire: `(>H:Event)`. |
| `B:` | Set through the input-event API. |
| `A:` | **Mostly not writable.** Inverted: fire the `K:` event and watch whether the `A:` variable follows. |

The `A:` inversion is the recorder run backwards, and it is the seed of the
automated sweep in [14-sweep-and-testing](14-sweep-and-testing.md).

## Discipline: read, write, observe, restore

Snapshot the current value, write, capture the window, put it back. That makes
probing `L:` variables safe enough to do casually.

Events have no undo. That is what the blocklist is for.

## Cause versus symptom — the real payoff

FS Copilot's own log shows the failure this prevents:

    Skip counter for 'L:XMLVAR_ELT_STATE' expired (590.72s > 2.00s).
    Possible desync detected.

That is what binding the wrong variable looks like: a value gets synced that the
aircraft's own logic immediately overwrites, and the two machines fight.

A probe distinguishes them in one action:

- **Cause** — writing it moves the cockpit, and it holds.
- **Symptom** — writing it does nothing visible, or the aircraft stomps it back
  within a few hundred milliseconds.

**A variable that reverts shortly after being written will desync if bound.**
That can be detected automatically and warned about at authoring time, before
anybody flies with the profile. Nothing else in the ecosystem can say it, and it
is precisely the class of bug this editor exists to prevent.

It also answers the `shared` versus `master` question that an entry needs — see
entry candidates in [05-data-model](05-data-model.md).

## Generating the `set:`

A successful probe knows the expression it just executed, so the entry can be
written from it rather than typed. Combined with corpus samples for
structurally similar variables, that is most of what
[13-report](13-report.md) needs for one-click insert.

## Results are evidence

"Writable, holds, moved these three others" is a durable fact about this
aircraft and goes in the evidence table like anything else. Probing the same
variable later on a different aircraft is a different row.

## Safety

This writes to a live simulator someone may be flying.

- Explicit action, never automatic.
- Confirm for anything but `L:` writes that restore cleanly.
- A blocklist of destructive event-name patterns — fire, extinguisher, cutoff,
  gear, shutdown — which also governs the sweep.
- Surface what it is about to do in words before doing it.
