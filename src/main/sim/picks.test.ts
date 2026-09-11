/**
 * Quick picks, and the threshold that decides whether there are any.
 *
 * The interesting assertions are the refusals: a list that is really a sample
 * of a continuous variable would invite a click on a meaningless number, so
 * "no picks" has to be the answer more often than "some picks".
 */

import { describe, expect, it } from "vitest"

import type { CapturedEvent } from "@shared/sim"

import { picksIn, PICK_LIMIT } from "./picks"

function moved(value: number, name = "L:FlapLever"): CapturedEvent {
  return { t: 1, via: "link", kind: "var", name, value }
}

describe("picksIn", () => {
  it("offers the positions a switch has been seen at, ascending", () => {
    const events = [moved(1), moved(0), moved(1), moved(0)]

    expect(picksIn(events, "L:FlapLever")).toEqual([0, 1])
  })

  it("sorts as positions on a control, not as history", () => {
    const events = [moved(50), moved(0), moved(100), moved(25)]

    expect(picksIn(events, "L:FlapLever")).toEqual([0, 25, 50, 100])
  })

  it("gives up on a variable with too many values to be a list", () => {
    // The median `L:` variable takes 73 distinct values in 75 seconds. A
    // truncated list of those would look like a set of choices while being an
    // arbitrary sample of one.
    const events = Array.from({ length: PICK_LIMIT + 2 }, (_, at) => moved(at))

    expect(picksIn(events, "L:FlapLever")).toBeNull()
  })

  it("keeps a variable sitting exactly on the limit", () => {
    const events = Array.from({ length: PICK_LIMIT }, (_, at) => moved(at))

    expect(picksIn(events, "L:FlapLever")).toHaveLength(PICK_LIMIT)
  })

  it("says nothing about a variable nothing has reported", () => {
    expect(picksIn([moved(1)], "L:SomethingElse")).toBeNull()
  })

  it("ignores other variables, however busy they are", () => {
    const noisy = Array.from({ length: 50 }, (_, at) => moved(at, "L:FuelFlow"))

    expect(picksIn([...noisy, moved(0), moved(1)], "L:FlapLever")).toEqual([
      0, 1,
    ])
  })

  it("reads `B:` firings, which arrive under the bare enumerated id", () => {
    // The wire carries no prefix — `store.ts` adds it on the way into the var
    // index, not onto the event.
    const fired = (value: number): CapturedEvent => ({
      t: 1,
      via: "client",
      kind: "input",
      name: "AIRLINER_OVH_LTS_BEACON",
      hash: "1",
      value,
    })

    expect(picksIn([fired(0), fired(1)], "B:AIRLINER_OVH_LTS_BEACON")).toEqual([
      0, 1,
    ])
  })

  it("resolves a suffixed `B:` get: name to the id the sim reports", () => {
    // `get: B:X_Toggle` appears 232 times in the corpus and is legal dialect:
    // only the id has a hash, so only the id ever fires.
    const fired: CapturedEvent = {
      t: 1,
      via: "client",
      kind: "input",
      name: "AIRLINER_OVH_LTS_BEACON",
      hash: "1",
      value: 2,
    }

    expect(picksIn([fired], "B:AIRLINER_OVH_LTS_BEACON_Toggle")).toEqual([2])
  })

  it("offers a momentary event's zero, which is the value a run binds", () => {
    const press = (t: number): CapturedEvent => ({
      t,
      via: "client",
      kind: "input",
      name: "AIRLINER_FCU_ALT_PUSH",
      hash: "2",
      value: 0,
    })

    expect(
      picksIn([press(1), press(2), press(3)], "B:AIRLINER_FCU_ALT_PUSH")
    ).toEqual([0])
  })

  it("ignores a non-numeric input value rather than widening the list", () => {
    const odd: CapturedEvent = {
      t: 1,
      via: "client",
      kind: "input",
      name: "AIRLINER_OVH_LTS_BEACON",
      hash: "1",
      value: "ON",
    }

    expect(picksIn([odd], "B:AIRLINER_OVH_LTS_BEACON")).toBeNull()
  })

  it("does not let a firing answer for a variable in another namespace", () => {
    const fired: CapturedEvent = {
      t: 1,
      via: "client",
      kind: "input",
      name: "L:FlapLever",
      hash: "3",
      value: 4,
    }

    expect(picksIn([fired], "L:FlapLever")).toBeNull()
  })

  it("reads `A:` values too, which arrive as a different event", () => {
    const simvar: CapturedEvent = {
      t: 1,
      via: "client",
      kind: "simvar",
      name: "A:BATTERY VOLTAGE",
      units: "Volts",
      value: 24,
    }

    expect(picksIn([simvar], "A:BATTERY VOLTAGE")).toEqual([24])
  })
})
