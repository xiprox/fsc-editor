# FS Copilot behavior

What FS Copilot actually does with a profile — read from its source, not
inferred from its output. This is the authority behind the dialect rules in
[sim-vars/18-language-core](sim-vars/18-language-core.md);
[profile-format](profile-format.md) covers the comment convention, this
covers execution.

## Source pin, and how to check this doc is current

Read against the FS Copilot checkout at commit `8a920e0` ("Initial commit",
2026-04-25), whose `src/` submodule (`~/dev/fsc/src` here) sits at `5d6b313`
("Add var replay to dev mode…", 2026-08-15) **with local modifications**
(bridge hook.js, a Definitions module, the .sln — none of the files cited
here).

Every claim below cites a file and an *anchor* — a short verbatim snippet.
Line numbers drift; anchors survive. To re-verify a claim, grep its anchor:

    git -C ~/dev/fsc/src log -1 --format=%h         # 5d6b313 → doc is current
    grep -n "ANCHOR" <cited file>                    # moved? read around it

All paths below are under `src/` in that repo. `Definitions.cs` is
`FsCopilot/Simulation/Definitions.cs`; `SimClient.cs` is
`FsCopilot/Connection/SimClient.cs`.

`src/shared/trace.ts` mirrors these same functions in code rather than in
prose, and has the same problem with a stronger consequence. The plan for
keeping it in parity — anchors, a pin, a corpus golden master, and a
differential harness that runs the real C# — is in
[help/trace-panel.md](help/trace-panel.md), last section.

## The four setter kinds

`Definition.Set(value, current)` — Definitions.cs, anchor `public string
Set(object value` (~line 239). Branch-for-branch what
`src/shared/setter.ts` models:

| kind | trigger | produces |
| --- | --- | --- |
| implicit | `_set == null` | `{value} (>{Get}, {Units})` — or without units when the entry has none. **The units go into the write.** |
| javascript | `_set.IndexOfAny(['\'', '`', '?', '{', '}']) >= 0` | Jint evaluates with `value`/`current` in scope; the result string is the expression. An evaluation error logs and yields the empty string, which does nothing only in a `shared:` entry — see below. |
| prepended | `_set.StartsWith('(')` | `{value} {_set}` |
| literal | anything else | `_set`, exactly as written — the value is **not** prepended |

Anchor for the trigger set: `IndexOfAny(['\''` (~248). Note `"` is *not* a
trigger — but our `scanEntries` unquotes YAML before this ever matters.

**A JavaScript setter that throws is inert only in `shared:`.** The catch
logs and returns `string.Empty` — anchor `Unable to parse event expression`.
A `shared:` entry hands that to `SimClient.Execute`, which returns early on
blank input — SimClient.cs anchor
`if (string.IsNullOrWhiteSpace(expression)) return;` — so nothing changes in
the sim. A `master:` entry hands it to `ParseSet` instead, where the empty
string fails `SetRegex().Match(exp)` and takes the no-match fallback — anchor
`return Get;` — so the value is written to the `get:` variable, as for any
setter the regex cannot read (see below).

## The execution split: shared vs master

`Definition.ApplyTo(sim, value, current, fromPeer)` — Definitions.cs,
anchor `public void ApplyTo` (~305). The entry's block decides *how* the
expression runs, not just who is authoritative:

**`shared:` entries** run the built expression through the calculator
(`sim.Execute`) — real RPN — with two exceptions:

- If the expression contains `">K:#"` it is routed through `ParseSet` and
  transmitted as a SimConnect event instead. Anchor: `Contains(">K:#")`.
- **The toggle guard.** Anchor: `Contains("TOGGLE",
  StringComparison.OrdinalIgnoreCase` (~326). If the expression contains
  `">K:"` *or* `">B:"`, and contains the substring `TOGGLE` anywhere,
  case-insensitively, and `value.Equals(current)` — the apply is skipped.
  There is no structural notion of "a toggle entry": it is a substring
  test on the built expression, so `(>B:PARKBRAKE_Toggle)` matches as
  intended, and a variable named `L:ToggleGuard` inside an expression that
  also writes any `K:`/`B:` would match by accident. For JS setters the
  test runs on the *evaluated output*, so a branch that returned a
  non-toggle string is not guarded.

  **`current` is null until this machine has read the variable once.**
  `Coordinator.AddLink` starts `currentValue` at null — anchor
  `object? currentValue = null` — and only the local stream assigns it. The
  guard tests that raw parameter, not the `current ?? value` used two lines
  earlier to *build* the expression, so `value.Equals(null)` is false and the
  first incoming apply after connecting is never guarded, however equal the
  numbers look.

**`master:` entries never run RPN.** `ParseSet` — anchor `public string
ParseSet` (~267) — matches the whole built expression against

    ^(?<args>.*?)\s*\(\>\s*(?<name>[^,\)]+)\s*(?:,\s*(?<units>[^\)]+))?\s*\)$

(anchor: `GeneratedRegex(@"^(?<args>`, ~216). That is: *anything*, then one
trailing `(>NAME[, units])`. Then:

- args split on spaces, each parsed as uint/int/double — **anything
  non-numeric becomes 0** (anchor: `object ParseParam`). A `master:`
  setter containing RPN reads or operators computes nothing.
- args are **reversed** — stack order to parameter order, confirming
  `[0]`-is-pushed-last from the authority.
- no args → `[value]`.
- a `K:N:` arity is stripped from the name (anchor: `set = $"K:{set[4..]}"`)
  — the parameters travel as event data, not in the name.
- **no regex match → fallback**: the target becomes `Get` with `[value]` —
  the value is written to the `get:` variable and the `set:` text never
  runs. This is why `set: K:THROTTLE1_SET` (JF_RJ_100, master block)
  "works": the fallback writes the throttle A: var; the K: event named in
  the setter is never fired.

## How writes reach the sim

`SimClient.Set(name, units, values)` — SimClient.cs, anchor `public void
Set(string name` (~223):

| prefix | mechanism | notes |
| --- | --- | --- |
| `L:` | SimConnect data definition, datum `L:NAME` | **FLOAT32**, only `values[^1]` (the last arg). The client-side L: write path — FS Copilot never needed a module for this. |
| `A:` | SimConnect data definition | last arg only |
| `K:` | `MapClientEventToSimEvent` + `TransmitClientEvent_EX1` | up to **5** parameters (anchor: `dwData4`); an event name starting `#` maps a numeric event id — the `(>K:#84132)` corpus form |
| anything else `X:`-shaped (`B:`, `H:`, `Z:`…) | wrapped back into calculator code: `values (>NAME)` | anchor: `// B / H / Z / Others` |
| a bare name (no `:` at the second character) | **nothing** — no branch matches | `Stream` falls through to `return Observable.Empty<object>();` as well, so such an entry is inert in both directions |

**These branches are `if`s with no `else`.** A `L:`, `A:` or `K:` name takes
its own path and then *also* matches `name.Length > 2 && name[1] == ':'`, so
the value is wrapped into calculator code and executed a second time. For a
`K:` event that means it is transmitted and then fired again through the
calculator. Read, not probed — worth a probe, and if real it is an upstream
bug that changes what a `master:` fallback write actually does.

## How a change leaves this machine

`Coordinator.AddLink(Definition)` — Coordinator.cs, anchor
`private void AddLink(Definition def)` (~91). The outgoing stream is built
from `SimClient.Stream(getVar, def.Units)` and then filtered, in this order:

| step | applies to | anchor |
| --- | --- | --- |
| sampled at 30 ms — about 33 a second | `master:` only | `Sample(TimeSpan.FromMilliseconds(30)` |
| only while this machine is the pilot in control | `master:` only | `.Where(_ => !master \|\| _masterSwitch.IsMaster)` |
| **delayed 500 ms** | any name beginning `H:`, both blocks | `if (getVar[0] == 'H') simRx = simRx.Delay` |
| dropped if a `skp:` counter is standing | `shared:` only | `simRx.Where(_ => !Skip.Should(getVar))` |

Then, in the subscription: `Skip.Next(def.Skip)` if the entry is `shared:`
and has one, and `SendAll(new Update(getVar, value), unreliable: master)` —
anchor `unreliable: master`. So a `master:` update is sent unreliably and a
`shared:` one reliably, which is the transport half of what the two blocks
mean.

`master` here is `!def.Shared` throughout — the entry's block, never the
machine's role. The `H:` delay is the one line that ignores the block.

Incoming updates are matched by **name alone** — anchor
`.Where(update => update.Name == getVar)` — with no notion of which block or
file declared them. Two entries sharing a name both receive.

## What type a value is

`SimConnectExtensions.InferDataType(unit)` then `ToClrType` — anchors
`public static SIMCONNECT_DATATYPE InferDataType(string unit)` (~44) and
`public static Type ToClrType` (~26).

| units | type |
| --- | --- |
| empty or whitespace | `string` (STRING256) |
| `string8/32/64/256`, `stringv`, `wstring`, `wstring256` | `string` |
| `string`, `text`, `title`, `name`, `model`, `category`, `airline`, `icao`, `registration`, `filename` | `string` |
| `bool`, `boolean`, `index`, `enum`, `mask`, `bitmask`, `flag`, `flags`, `count`, `items`, `state`, `switch`, `position index`, `position step`, `bcd16`, `bco16`, **`feet`**, **`percent`** | `int` (INT32) |
| anything else, **including `Number`** | `double` (FLOAT64) |

Two of these are worth saying out loud. `feet` and `percent` are in the INT32
list, so an altitude in feet is an integer on the wire. And `number` is in
that list **commented out** — anchor `// case "number":` — so the unit the
`Definition` constructor falls back to for an unlabelled entry, Definitions.cs
anchor `: "Number";`, resolves to a double. `K:` and `H:` entries are the
exception: they fall back to `string.Empty` instead — anchor
`(Get[0] == 'K' || Get[0] == 'H')` — which the first row makes a `string`.

An `L:` variable ignores the table: it is FLOAT32 in both directions, because
`SetLVar` hardcodes the datum type — anchor
`const SIMCONNECT_DATATYPE datumType = SIMCONNECT_DATATYPE.FLOAT32` — and
`Stream` passes it explicitly.

## K: event parameters are coerced to uint

`SimClient.TransmitKEvent` — anchor `private void TransmitKEvent`. Five
parameters travel (`dwData0`–`dwData4`) and a sixth operand is dropped
silently. Each one goes through `NormalizeValue`, anchor
`uint NormalizeValue(object val)`:

- a `float` or `double` is rounded **away from zero** and then cast —
  anchor `Math.Round(d, MidpointRounding.AwayFromZero)` — so `0.6` travels as
  `1` and `-0.5` as `-1` before the cast;
- the cast is `unchecked`, so a negative **wraps** rather than clamping:
  `-1` arrives at the simulator as `4294967295`.

## skp: — a send-side cross-reference

`skp:`'s value is a **variable name**, not a number. Definitions.cs anchor
`Skip = skp?.Trim()` (~236); consumed in Coordinator.cs, anchor
`if (!master && def.Skip != null) Skip.Next(def.Skip);` (~108).

**It fires on send, not on apply.** That line sits in the subscription to the
*local* stream — the one that calls `_net.SendAll` — so when this entry sends
a change, the *named other variable's* next change is marked and held back.
It is for a control whose one press moves two synced variables.

`master` in `AddLink` is `!def.Shared`: the entry's block, not the machine's
role. So `skp:` registers only from a `shared:` entry, and only shared
entries' outgoing streams are filtered — anchor
`if (!master) simRx = simRx.Where(_ => !Skip.Should(getVar));`. A `skp:` in a
`master:` entry does nothing, and so does a name no `shared:` entry watches.

**The echo after applying is automatic and needs no `skp:`.** Definitions.cs
`ApplyTo`, anchor `if (fromPeer) Simulation.Skip.Next(Get);` — the entry's own
`get:` is marked before the setter runs. It runs in the `Shared` branch only;
a `master:` entry needs none, since it sends only from the pilot in control,
who is not the one applying. Note the mark is registered even when the setter
builds an empty string and `Execute` returns early: nothing changes in the sim,
but the next genuine local change within the window is swallowed.

The counter (Skip.cs) expires after **2 seconds**, logging
`Possible desync detected` — the log line 10-probe quotes.

## ignore: — instrument names

`Definitions.Ignore` is a list of **instrument identifiers**; interactions
from those instruments are not sent to peers. Coordinator.cs anchor
`!_ignore.Contains(i.Instrument)` (~48). The Black Square profiles ignore
their tablets this way.

## The header date

`# Updated:` is read by a multiline regex anchored `^\s*#\s*Updated:` —
Definitions.cs anchor `UpdatedRx` (~27). Leading whitespace is tolerated;
a different key (`# Last Updated:`) is not, and leaves the profile dateless
— which is why the formatter rewrites that spelling.

## What this doc deliberately is not

Not a description of the sync protocol, the bridge, discovery, or the UI —
only the behaviors the editor's language rules and setter tooling stand on.
When a rule needs a new fact, read the source, add the fact here with its
anchor, and cite this doc from the rule.
