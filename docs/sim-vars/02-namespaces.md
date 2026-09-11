# Namespaces

    Purpose:    Why "scan the sim for variables" is four unrelated problems.
    Depends on: nothing
    Decides:    what is enumerable, what is only observable, coverage expectations

> **Amended by the build.** The typed API in `MSFS_Vars.h` extends the module's
> id-based read to `Z:`, `O:`, `I:` and `E:`, and a missing name is *detectable*:
> resolve returns -1 rather than creating, so "not in this aircraft" is a state
> the UI can assert, not a guess. The four-problem framing below stands; the
> table's mechanics column predates this. See the log entry "The typed variable
> API works, and the sim announces invalidation" in [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** The runtime input-event list is a *superset* of the
> aircraft's own definitions — the PA-24 enumerates 318 where A2A defines 181,
> the rest being MSFS 2024's own `CLICKSPOT_*` and `WALKAROUND_*` templates. The
> per-vendor counts below are counts of aircraft-authored events and remain
> correct; the conclusion drawn from them about sparse feeds and empty states
> does not. See the log entry "The runtime input-event list is a superset of the
> aircraft's own" in [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** The `L:` row's "Enumerable? Yes, in-sim only" is
> about *names*. Values are in-sim only as well — there is no client-side read
> for an `L:` variable, enumerated or not, so the module is required to show a
> value and not merely to discover one. See the log entry "`L:` cannot be read
> from a SimConnect client" in [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** The `L:` runtime table is a superset of the
> aircraft's own too, and far more lopsidedly than `B:` — the PA-24 enumerates
> **5,364**, of which roughly 5% are the aircraft's. The rest are other
> installed add-ons and the sim's globals. See "The `L:` table is a superset
> too" in [build/v1-log.md](build/v1-log.md).

The single most important framing decision in this plan: **there is no such
thing as "the list of sim variables."** Each namespace has its own mechanics,
and a UI presenting one "Rescan" button over all of them will feel broken for
three of the four.

| Namespace | Enumerable? | Mechanism |
| --- | --- | --- |
| `A:` | Statically | Fixed SDK list (~1,200, many indexed). Ship it. The sim supplies values and per-aircraft relevance, not names. |
| `L:` | Yes, in-sim only | Walk ids through `get_name_of_named_variable` until null. Aircraft-specific and undocumented — the gold, and the reason for our own module. |
| `K:` | Statically | Fixed documented list. Ship it. |
| `H:` | No | Not obtainable from the sim. Observable live via `onInteractionEvent`, and parseable from the aircraft's model behavior XML. |
| `B:` | **Yes, live** | `EnumerateInputEvents` returns the per-aircraft list with values; `SubscribeInputEvent` gives change notifications. No WASM required. |

## Why `B:` matters most for Activity

Input events are the modern switch layer, they are enumerable, they are
subscribable, and they carry human-meaningful names. The PA-24's
`model/Inputs/A2A_Inputs.xml` defines 127 of them — `RADIO1_DME_Switch`,
`BUTTON_EDM730_Step`, `Elevator_Trim`, `PortableLamp_Main` — and its presets
name the gesture: `_Push`, `_PushBoth`, `_Drag`, `_DragX`.

So "which control did you just touch" is answerable by name, with the sim's own
timestamp, with no DOM hooking. See [07-activity](07-activity.md), where this
becomes the primary anchor.

## But coverage varies enormously

Distinct `<InputEvent ID=...>` definitions, counted across installed addons:

| Aircraft | Input events |
| --- | --- |
| A2A Aerostar 600 | 288 |
| A2A PA-24 | 127 |
| Black Square Bonanza | **5** |

On the A2A aircraft Activity will be rich and the hotkey nearly redundant. On
the Black Square it will produce five rows ever and marks carry the entire
feature. Older 2020-era ports with pure-XML mouse callbacks are the same story.

Two consequences that must not be lost downstream:

- **The empty state has to explain itself.** "This aircraft defines 5 input
  events — use a mark to capture a window" rather than a blank list that reads
  as a bug.
- **The count is knowable before connecting.** It falls out of the addon
  Analysis, so [13-report](13-report.md) can predict which discovery workflow
  an aircraft will need.

## `H:` and the DOM layer

FS Copilot's bridge already captures this: `hook.js` patches
`instrument.onInteractionEvent` on every instrument and reports
`{type:'hevent', name}`, alongside mouse, input and keypress events with stable
per-element ids and the instrument identifier.

For our purposes `B:` covers the 3D cockpit, and `H:` mostly matters inside
HTML/JS instruments — EFBs, tablets, glass panels. Valuable but secondary, and
it is the one source obtainable without shipping any code of our own (see the
CommBus note in [03-link](03-link.md)).

## Pure-XML interactions

Some aircraft wire a click straight to RPN in a mouse callback, with no input
event and no H: event. There is no runtime signal for these at all.

They are recoverable from the other direction: if Analysis knows from the model
XML that element `SWITCH_BATTERY_MASTER` writes `L:XMLVAR_Battery`, then seeing
that variable move *is* seeing the element, and the finding can be labelled
with the element's name and tooltip. Derived rather than observed, same answer.
