/**
 * Stage 4's exit criterion, and the measurements behind it.
 *
 * Run against `pa24-interaction.ndjson.gz` — 75 seconds sliced out of a real
 * session, with real cockpit interaction in it — rather than a stream somebody
 * wrote to make the algorithm look good. That distinction is the point: the
 * reason proximity ranking had to be demoted is a fact about what a running
 * simulator does, and no fabricated fixture would have contained it.
 */

import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  AMBIENT_PER_SECOND,
  MARK_BEFORE_MS,
  WINDOW_AFTER_MS,
} from "@shared/activity"
import type { CapturedEvent } from "@shared/sim"

import { anchorsIn, baselinesIn, findingsFor } from "./activity"
import { readCapture } from "./sim/replay"

const CAPTURE = join(
  import.meta.dirname,
  "sim",
  "fixtures",
  "pa24-interaction.ndjson.gz"
)

const events = readCapture(CAPTURE)

/** A hand-built stream, for the rules that need an exact shape. */
function stream(
  parts: ({ at: number } & (
    | { input: string; value?: number }
    | { changed: string; value: number }
  ))[]
): CapturedEvent[] {
  return parts.map((part) =>
    "input" in part
      ? {
          t: part.at,
          via: "client",
          kind: "input",
          name: part.input,
          hash: "0",
          value: part.value ?? 1,
        }
      : { t: part.at, via: "link", kind: "var", name: part.changed, value: part.value }
  )
}

describe("anchors", () => {
  it("folds the duplicate every interaction produces", () => {
    // Measured at 17–40 ms across a real session. Two reports, one flip.
    const anchors = anchorsIn(
      stream([
        { at: 1_000, input: "SWITCH_BATTERY_MASTER_2STATES" },
        { at: 1_019, input: "SWITCH_BATTERY_MASTER_2STATES" },
      ])
    )

    expect(anchors).toHaveLength(1)
    expect(anchors[0]!.repeats).toBe(2)
  })

  it("keeps a genuine repeat of the same control apart", () => {
    // The nearest real one measured was 261 ms — a course knob reporting the
    // same value twice during a continuous turn. Swallowing it would lose an
    // interaction the user made.
    const anchors = anchorsIn(
      stream([
        { at: 1_000, input: "KNOB_CRS" },
        { at: 1_261, input: "KNOB_CRS" },
      ])
    )

    expect(anchors).toHaveLength(2)
  })

  it("drops a machine snapshot, however many events it is", () => {
    // An aircraft change snapshots every input event: 318 distinct in 2 ms,
    // seconds before the aircraft event a separator would be drawn at.
    const snapshot = Array.from({ length: 40 }, (_, i) => ({
      at: 5_000 + i,
      input: `CONTROL_${i}`,
    }))

    expect(anchorsIn(stream(snapshot))).toHaveLength(0)
  })

  it("keeps one control touched many times, which is a person", () => {
    // 118 reports of one knob, in the capture. Distinctness is what separates
    // this from the snapshot above — not the count, and not the rate.
    const turning = Array.from({ length: 60 }, (_, i) => ({
      at: 5_000 + i * 30,
      input: "KNOBS_EVENT_NAVINSTR_KNOB",
    }))

    const anchors = anchorsIn(stream(turning))
    expect(anchors).toHaveLength(1)
    expect(anchors[0]!.repeats).toBe(60)
  })
})

describe("marks", () => {
  /**
   * The case the hotkey exists for: a control the simulator does not report.
   * Nothing else in the stream marks that moment, so the mark has to.
   */
  it("anchors a mark when nothing was interacted with", () => {
    const events = stream([
      { at: 10_000, changed: "L:Mystery", value: 1 },
      { at: 60_000, changed: "L:Mystery", value: 0 },
    ])

    const anchors = anchorsIn(events, [{ t: 9_800 }])

    expect(anchors).toHaveLength(1)
    expect(anchors[0]!.kind).toBe("mark")
  })

  /**
   * "An interaction is a better anchor than a mark."
   *
   * The hotkey carries 200–400 ms of human reaction latency; the input event
   * carries the simulator's own timestamp of the click. Anchoring on the
   * interaction is the difference between four candidates and one, so a mark
   * next to one produces no finding of its own — it did its job by saying
   * *which* interaction you meant.
   */
  it("defers to an interaction inside its window", () => {
    const events = stream([{ at: 10_000, input: "SWITCH_BATTERY_MASTER_2STATES" }])

    // Pressed 300 ms late, which is the normal case.
    const anchors = anchorsIn(events, [{ t: 10_300 }])

    expect(anchors).toHaveLength(1)
    expect(anchors[0]!.kind).toBe("input")
  })

  it("still anchors a mark when the nearest interaction is far away", () => {
    const events = stream([{ at: 10_000, input: "SWITCH" }])

    // Well outside −3 s / +12 s.
    const anchors = anchorsIn(events, [{ t: 40_000 }])

    expect(anchors.map((anchor) => anchor.kind)).toEqual(["input", "mark"])
  })

  /**
   * "A second press within the window ends it early. Same mechanism, no extra
   * concept — it is just the next anchor closing the previous one."
   *
   * The *previous* one now, because a capture's window looks backwards: two
   * presses in quick succession are two questions about two different moments,
   * and the older must not swallow the newer one's history.
   */
  it("lets an earlier press close the next capture's history", () => {
    const anchors = anchorsIn([], [{ t: 10_000 }, { t: 14_000 }])

    expect(anchors).toHaveLength(2)
    expect(anchors[1]!.before).toBe(4_000)
    // The first keeps the full window; nothing precedes it.
    expect(anchors[0]!.before).toBe(MARK_BEFORE_MS)
  })

  /**
   * A person reacting is fuzzier than the simulator timestamping its own click,
   * and the two windows say so rather than sharing one compromise. The width is
   * almost all *behind* the press: you do the thing, then reach for the key.
   *
   * The tail is deliberately the shorter of the two — an input event's 600 ms
   * against a capture's 500 — because a capture cannot be shown as settled
   * until its window closes, and that wait is felt every single time.
   */
  it("gives a capture its width behind the press", () => {
    const [mark] = anchorsIn([], [{ t: 10_000 }])
    const [input] = anchorsIn(stream([{ at: 10_000, input: "SWITCH" }]))

    expect(mark!.before).toBeGreaterThan(input!.before)
    expect(mark!.before).toBeGreaterThan(mark!.after * 10)
  })

  it("ranks over a capture's window, not an interaction's", () => {
    const events = stream([
      // Four seconds *before* the press — far outside an input anchor's 50 ms
      // of tolerance, and the ordinary case for act-then-press.
      { at: 6_000, changed: "L:Mystery", value: 1 },
      { at: 90_000, changed: "L:Mystery", value: 0 },
    ])

    const findings = findingsFor(events, [{ t: 10_000 }])

    expect(findings[0]!.candidates[0]!.name).toBe("L:Mystery")
  })
})

describe("baselines", () => {
  /**
   * The case that inverts if the qualifier is dropped.
   *
   * A knob turned hard changes its variable faster than a heartbeat does. Rated
   * over the whole stream it looks ambient and gets discarded — the one
   * variable the user was asking about, confidently thrown away.
   */
  it("measures the rate while nothing is happening, not overall", () => {
    const quiet = Array.from({ length: 10 }, (_, i) => ({
      at: 10_000 + i * 1_000,
      changed: "L:Heartbeat",
      value: i,
    }))

    const burst = Array.from({ length: 40 }, (_, i) => ({
      at: 5_000 + i * 5,
      changed: "L:Knob",
      value: i,
    }))

    const events = stream([
      { at: 0, changed: "L:Knob", value: 0 },
      { at: 5_000, input: "KNOB" },
      ...burst,
      ...quiet,
      { at: 20_000, changed: "L:Heartbeat", value: 99 },
    ])

    const rates = baselinesIn(events, anchorsIn(events))

    // Every one of the knob's 40 changes falls inside the anchor window, so its
    // resting rate is what it does the rest of the time: nothing.
    expect(rates.get("L:Knob")).toBeLessThan(AMBIENT_PER_SECOND)
    expect(rates.get("L:Heartbeat")).toBeGreaterThan(0)
  })
})

describe("the real capture", () => {
  it("holds the interaction this was sliced for", () => {
    const anchors = anchorsIn(events)
    const battery = anchors.filter(
      (anchor) => anchor.name === "SWITCH_BATTERY_MASTER_2STATES"
    )

    // Twice: on, then off. Each reported twice and folded to one.
    expect(battery).toHaveLength(2)
    expect(battery.every((anchor) => anchor.repeats === 2)).toBe(true)
  })

  /**
   * The number that reordered the design.
   *
   * If this ever drops to something small, the capture has been replaced with a
   * quieter one and the tests below stop proving anything.
   */
  it("has a couple of hundred variables moving near any interaction", () => {
    const anchors = anchorsIn(events)
    const anchor = anchors.find(
      (a) => a.name === "SWITCH_BATTERY_MASTER_2STATES"
    )!

    const near = new Set(
      events
        .filter(
          (event): event is CapturedEvent & { kind: "var" } =>
            event.kind === "var" &&
            event.t >= anchor.t &&
            event.t <= anchor.t + WINDOW_AFTER_MS
        )
        .map((event) => event.name)
    )

    expect(near.size).toBeGreaterThan(150)
  })

  /** Stage 4's exit criterion. */
  it("ranks the battery master's own variable first", () => {
    const findings = findingsFor(events)
    const found = findings.filter(
      (finding) => finding.anchor.name === "SWITCH_BATTERY_MASTER_2STATES"
    )

    expect(found).toHaveLength(2)

    for (const finding of found) {
      expect(finding.candidates[0]!.name).toBe("L:Battery1Switch")
      expect(finding.candidates[0]!.tier).toBe("direct")
    }

    // On, then off — the ranking carries the value, so the feed can say what it
    // became rather than only that it moved.
    expect(found[0]!.candidates[0]!.value).toBe(1)
    expect(found[1]!.candidates[0]!.value).toBe(0)
  })

  it("cuts 192 candidates to a shortlist a person can read", () => {
    const finding = findingsFor(events).find(
      (f) => f.anchor.name === "SWITCH_BATTERY_MASTER_2STATES"
    )!

    // The whole value of the feature in one assertion: a couple of hundred
    // variables moved, and this is what it is willing to say about them.
    expect(finding.candidates.length).toBeLessThan(30)
    expect(finding.candidates.length).toBeGreaterThan(2)
  })

  /**
   * The tiers, which the capture shows as flat bands rather than a gradient:
   * the switch at 46 ms, the bus at 123 ms, and what the bus feeds at 200 ms.
   */
  it("separates what the switch is from what the switch caused", () => {
    const finding = findingsFor(events).find(
      (f) => f.anchor.name === "SWITCH_BATTERY_MASTER_2STATES"
    )!

    const direct = finding.candidates.filter((c) => c.tier === "direct")
    const downstream = finding.candidates.filter((c) => c.tier === "downstream")

    expect(direct.map((c) => c.name)).toContain("L:Battery1Switch")
    expect(downstream.map((c) => c.name)).toContain("L:BatteryElecPower")
    expect(direct.length).toBeLessThan(downstream.length)
  })

  it("never offers a variable that is always moving", () => {
    for (const finding of findingsFor(events)) {
      for (const candidate of finding.candidates) {
        expect(candidate.baseline).toBeLessThanOrEqual(AMBIENT_PER_SECOND)
      }
    }
  })
})
