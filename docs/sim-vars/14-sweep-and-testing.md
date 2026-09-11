# Sweep and testing

    Purpose:    What becomes possible once discovery works, and is worth designing toward.
    Depends on: 10-probe, 07-activity
    Decides:    the automated sweep, profile regression, the two-machine test

Nothing here is v1. It is recorded because each item is a rearrangement of
primitives built earlier, and two decisions elsewhere exist to keep them
reachable.

## Automated sweep

`B:` input events are enumerable. So they can be iterated: fire each one, record
what moved, and build an event-to-variables map for the whole aircraft,
unattended.

That is a complete interaction map generated without supervision, and it exists
only because enumeration, the recorder and the probe are already built. On the
A2A Aerostar that is 288 events, which is an afternoon by hand and minutes
automatically.

**Guardrails**, sharing the blocklist from [10-probe](10-probe.md):

- explicit opt-in, never a background activity
- parked, engines off, on the ground
- blocklist of destructive patterns — fire, extinguisher, cutoff, gear,
  shutdown
- ideally a throwaway flight, and say so
- abortable, with restore of anything restorable

## Profile regression

Addons update and quietly rename or re-scope variables. Today the first sign is
that something stopped syncing mid-flight.

With enumeration and probe, a whole profile can be run as a checklist:

- does every `get:` still exist on this aircraft?
- is it still writable?
- does it still hold after a write, or does it revert?

The output is exactly which entries the last update broke. Same three
primitives, arranged differently, and it pairs with the update diff in
[13-report](13-report.md) — one says what the addon changed, the other says
what that did to the profile.

## The two-machine test

A profile's entire job is keeping state in agreement between two machines, and
Remote Connect already provides the second one.

Set on A, verify on B, and assert the profile does the thing it claims. That is
the only test that exercises what the file is for.

## What keeps these reachable

Two decisions made earlier exist partly for this:

- **The Activity event stream is serializable** ([07-activity](07-activity.md)),
  so findings can travel over the relay rather than existing only as live
  objects. That also allows "watch my peer flip a switch on an aircraft I do not
  own."
- **Probe results are evidence** ([10-probe](10-probe.md)), so a regression run
  is a comparison against recorded facts rather than a fresh investigation each
  time.
