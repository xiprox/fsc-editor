# UI surfaces

    Purpose:    Where all of this sits in the window.
    Depends on: 06-variables-panel, 07-activity
    Decides:    rail buttons, panel spans, footer chip, what is absent from v1

> **Amended by the build.** A second bottom panel, **Log**, shares the bottom
> slot with Activity and adds a second bottom-aligned rail button — the two
> replace each other rather than stacking. It is a raw view of everything the
> system is doing, where Activity is a view of what it *means*. See the log
> entry "A Log panel, pulled forward for the same reason the Variables panel
> was" in [build/v1-log.md](build/v1-log.md).

> **Amended by the build.** **Radar is a side panel now**, not a bottom one. It
> stacks under whichever of Remote Connect or Variables is open, sharing that
> column with a dragged divider, and its rail button moved to the top group.
> The bottom slot is Log and Issues — diagnostics and debug — and the rail's two
> groups now read as two subjects as well as two places. See "Radar left the
> bottom slot for the side column" in [build/v1-log.md](build/v1-log.md).
> Which of the column and the bottom slot gets the corner between them is
> conditional — see **Panel spans** below.

> **Amended by the build.** The footer's sim chip reports **state only** — no
> aircraft key, no `L:` count. Both are data wanting a surface of their own, and
> neither changes what the user would do next, which is all a status indicator
> is for. The simulator also has its own hue now, `--sim`, taken from the MSFS
> logo. See "The chip was a readout pretending to be a status indicator" in
> [build/v1-log.md](build/v1-log.md).

> **Convention, set by the build.** Every control comes from shadcn
> (`components/ui/`) — never a native `<select>` or checkbox — and panel header
> actions are ghost icon buttons rather than text. Add missing components with
> `npx shadcn@latest add` rather than approximating them. See "UI convention:
> shadcn everywhere" in [build/v1-log.md](build/v1-log.md).

## Layout

```
┌────────────────────────────────────────────────────────────────────────┐
│ FSC Profile Editor                                         ─  □  ✕     │ header
├────────────┬──────────────────────────────────┬──────────────────┬─────┤
│ Profiles   │ pa24-250.yaml  ×   A350.yaml     │ Variables     ⟳  │ ▤   │
│            ├──────────────────────────────────┤ ┌──────────────┐ │ ⇄   │ rail
│ ▾ pa24-250 │  - get: L:AdfOnOffKnob      ▸ 1  │ │ battery stby │ │     │
│   ELECTRIC │  - get: L:BreakerAutopilot  ▸ 0  │ └──────────────┘ │     │
│   LIGHTS   │  - get: L:NotAThing         ⚠    │ ◍ in sim ◍ new   │     │
│ ▸ A350     │                                  │ ──────────────── │     │
│            │                                  │ L:BreakerAuto… 3 │     │
│            │                                  │ L:AdfOnOffKn…  7 │     │
│            ├──────────────────────────────────┴──────────────────┤     │
│            │ Activity        ⏺ live · Ctrl+Alt+M · pa24-250  ✕   │     │
│            ├───────────────────┬──────────────────────────────────┤    │
│            │ ▸ RADIO1_DME…   3 │ RADIO1_DME_Switch · drag         │ ⏺  │
│            │ ▸ Mark 21:04:12 8 │ direct                           │    │
│            │ ▸ BUTTON_EDM… 1×5 │  L:DmeOnOffKnob  0 → 1   +14ms   │    │
│            │ ▸ Elevator_Trim 2 │  L:DmeSelState   2 → 3   +16ms   │    │
│            │                   │ downstream (6)              ⌄    │    │
├────────────┴───────────────────┴──────────────────────────────────┴────┤
│ ◐  Workspace: …\Definitions  change      status   ⚡Sim  ⇄Remote       │ footer
└────────────────────────────────────────────────────────────────────────┘
```

## The rail

Not icon-only. Each entry is a **rectangular vertical button**: the icon
upright, the label rotated 90° **as a unit** — letters on their sides, reading
downward, which is the right-edge convention — sized to its own content with
padding. Buttons stack from the top and the remainder of the strip is empty.

    writing-mode: vertical-rl on the label only; the icon stays upright.

So "Remote Connect" is a tall button and "Variables" a shorter one. The active
button carries the open panel's treatment so the two read as connected.

**Two groups.** Side panels at the top (Remote Connect, Variables, and — per
the amendment above — Radar); the panels that toggle the **bottom** slot
bottom-aligned. The rail is full height, which is what makes bottom-alignment
mean anything.

## Panel spans

- **Profiles** — full height, always. Nothing overlaps it.
- **Variables** — a right-hand panel like Remote Connect, standalone. One of
  those two open at a time, chosen from the rail.
- **Activity** — *amended:* the lower half of that same right-hand column,
  under whichever side panel is open, with a dragged divider between them.
  Either can be open without the other, in which case it takes the column.
- **The bottom slot** — Log or Issues. How far it reaches is *conditional*, and
  the condition is how much is in the right-hand column:
  - **One panel there** — the slot spans **the editor and the right column**,
    stopping at the rail, and the column is shortened. As originally specified.
  - **Two panels there** — the **column wins**: it runs full height and the slot
    spans the editor only, ending at the column's edge. Two panels stacked are
    already short, and a slot neither of them is about should not take a third
    of what is left.

  Either way it never touches Profiles.

Activity is two halves — the findings feed and the detail table — *amended* to
stack rather than sit side by side, since a side-panel column has no room for
two columns. **The detail keeps its space even when nothing is selected** so
selection never makes the layout jump, and it is the half that carries the
remembered size.

## Footer

One new chip beside the existing Remote chip, with the four states in
[04-connection](04-connection.md). Before connecting it is the only
attention-drawing thing in the window; afterwards it is a quiet status showing
the aircraft.

## Editor

Inlay hints at end of `get:` lines and a warning squiggle for variables the
connected aircraft lacks ([09-live-values](09-live-values.md)). No new chrome.

## Absent from v1

- **No timeline.** Reasoning in [07-activity](07-activity.md).
- **No pop-out window.** The bottom panel gives the width the table needs while
  keeping one window, one store and one preload contract. Pop-out remains
  possible later for a second monitor.

## New component work

- Vertical rail buttons with rotated labels.
- A **horizontal** splitter. The existing `usePanelWidth` and `Splitter` are
  width-only (`side: "left" | "right"`), so the editor/Activity divider is new.
- Persisted heights for the bottom panel, alongside the existing persisted
  widths.
