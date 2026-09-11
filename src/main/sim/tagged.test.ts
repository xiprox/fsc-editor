/**
 * The tagged reader, tested against the crash that produced it.
 *
 * `RangeError: Illegal offset: 0 <= 476 (+8) <= 476` — one float64 past the end
 * of a real message, in a loop that trusted the watch list to match what
 * SimConnect had actually accepted. The first case below is that message.
 */

import { describe, expect, it } from "vitest"

import type { SimVarWatch } from "@shared/sim"

import { readTaggedValues, type TaggedBuffer } from "./tagged"

/** Packs records the way SimConnect does: a uint32 datum id, then a float64. */
function message(records: [datum: number, value: number][]): TaggedBuffer {
  const buffer = Buffer.alloc(records.length * 12)

  records.forEach(([datum, value], index) => {
    buffer.writeInt32LE(datum, index * 12)
    buffer.writeDoubleLE(value, index * 12 + 4)
  })

  let offset = 0
  return {
    readInt32: () => {
      const value = buffer.readInt32LE(offset)
      offset += 4
      return value
    },
    readFloat64: () => {
      const value = buffer.readDoubleLE(offset)
      offset += 8
      return value
    },
    remaining: () => buffer.length - offset,
  }
}

const watching: SimVarWatch[] = [
  { name: "A:KOHLSMAN SETTING MB:1", units: "Millibars" },
  { name: "A:NAV OBS:1", units: "Degrees" },
  { name: "A:TRANSPONDER CODE:1", units: "Number" },
]

describe("readTaggedValues", () => {
  it("resolves each record against its datum id", () => {
    const values = readTaggedValues(message([[0, 1013], [2, 1200]]), 2, watching)

    expect(values).toEqual([
      { name: "A:KOHLSMAN SETTING MB:1", units: "Millibars", value: 1013 },
      { name: "A:TRANSPONDER CODE:1", units: "Number", value: 1200 },
    ])
  })

  it("survives a count larger than the buffer holds", () => {
    // The crash. SimConnect said three; the message carried one, because two
    // of the three variables were rejected when the definition was built.
    const values = readTaggedValues(message([[0, 1013]]), 3, watching)

    expect(values).toHaveLength(1)
    expect(values[0]?.name).toBe("A:KOHLSMAN SETTING MB:1")
  })

  it("keeps later values on the right variable when a middle one is missing", () => {
    // The reason tagging beats a bounded positional read. Positionally, a
    // rejected entry at index 1 would put the transponder's value on the OBS —
    // wrong data that looks entirely plausible.
    const values = readTaggedValues(message([[0, 1013], [2, 7000]]), 2, watching)

    expect(values.map((value) => value.name)).toEqual([
      "A:KOHLSMAN SETTING MB:1",
      "A:TRANSPONDER CODE:1",
    ])
    expect(values[1]?.value).toBe(7000)
  })

  it("drops a datum id that is not in the watch list", () => {
    // The watch set changed while this message was in flight. Losing a value is
    // right; guessing which variable it belonged to is not.
    const values = readTaggedValues(message([[99, 1], [1, 180]]), 2, watching)

    expect(values).toEqual([{ name: "A:NAV OBS:1", units: "Degrees", value: 180 }])
  })

  it("reads nothing from an empty message", () => {
    expect(readTaggedValues(message([]), 0, watching)).toEqual([])
  })

  it("reads nothing when the watch list is empty", () => {
    expect(readTaggedValues(message([[0, 1]]), 1, [])).toEqual([])
  })

  it("stops at the count even when more records follow", () => {
    const values = readTaggedValues(message([[0, 1], [1, 2], [2, 3]]), 2, watching)
    expect(values).toHaveLength(2)
  })

  it("keeps a negative and a fractional value intact", () => {
    const values = readTaggedValues(message([[1, -12.75]]), 1, watching)
    expect(values[0]?.value).toBe(-12.75)
  })
})
