# Marks and the hotkey

    Purpose:    The global hotkey, what it creates, and what Electron will not do.
    Depends on: 07-activity
    Decides:    stateless marks over start/stop, window defaults, buffer sizing, clash detection

## Stateless, because you are looking at another application

A mark is a point in time. Press the hotkey, get an anchor.

The alternative — a toggle that starts and stops recording — is worse for a
reason that has nothing to do with capability: **you press this key while the
simulator is fullscreen in front of you.** If you lose track of whether
recording is on, there is no way to find out without alt-tabbing, which is the
exact cost the hotkey exists to avoid. A stateless control cannot be out of
sync. Press it whenever something happens, press it five times, it is always
correct.

Everything a start/stop pair could express, two marks express better:

- **You cannot press start too late.** The interesting thing sometimes
  announces itself afterwards — an annunciator lights, a mode flips, something
  latches. A span has lost the preceding seconds; a mark on a running buffer
  takes the window before it.
- **Alt-tab noise falls outside.** Press, alt-tab, flip, alt-tab, press puts the
  focus and pause burst *inside* the span, where it looks like a finding. With
  marks at the flip, it is seconds away and ranks down.
- **Repeat correlation needs N anchors, not a span.** See the automatic collapse
  in [07-activity](07-activity.md).

## Window

Default **−3 s / +12 s** around the mark.

Forward-biased, because press-then-act is the common gesture. Not
forward-only, because the gap is variable and sometimes the press is late.

A second press within the window ends it early. Same mechanism, no extra
concept — it is just the next anchor closing the previous one.

## Persist wide, display narrow

When a mark fires, write a generous slice — **±60 s** — to the database, and
let any later adjustment work over the persisted slice.

Otherwise "drag the edge out a bit" works for as long as the buffer holds and
then silently stops working, which is the worst kind of bug: fine in testing,
broken on the interesting session. This also makes past findings revisitable
and keeps the v1-deferred timeline additive rather than a rewrite.

## The buffer

Changes only, in a preallocated typed-array ring in the main process. An event
is a variable id, a value and a timestamp — call it 16 bytes. Sixty seconds at
a pessimistic thousand changes a second is about **1 MB**. The renderer receives
slices, never the ring.

## An interaction is a better anchor than a mark

The hotkey carries human reaction latency — 200–400 ms, and variable. An input
event carries the sim's own timestamp of the actual click.

So when an interaction is present in the window, **anchor on it** and demote the
mark to disambiguation: which of the things you touched did you mean. That
tightens proximity ranking from a fuzzy half-second to tens of milliseconds,
which is the difference between four candidates and one.

## What Electron cannot do

- **No key-up event.** `globalShortcut` fires on press only. Hold-to-record
  needs a low-level hook (`uiohook-napi`), which is a native dependency that
  looks exactly like a keylogger to antivirus software. **Not doing it** — the
  running buffer makes press-once better anyway.
- **Partial clash detection.** `globalShortcut.register` returns false when the
  OS refuses, which catches other applications' `RegisterHotKey` bindings. It
  will **not** see MSFS's own keybindings, which are read through raw input. A
  key bound in the sim will both mark and do whatever the sim does.

So: attempt registration, report failure honestly, default to a combination the
sim does not bind, and state plainly in the UI that sim bindings cannot be
detected. Binding the key is offered front and centre in the Activity panel
header rather than buried in settings.
