/**
 * Reading tagged `A:` data out of a SimConnect message.
 *
 * Its own file because it crashed in production and was untested — a reader
 * that walks a foreign buffer deserves better than being a closure inside a
 * connection handler where nothing can reach it.
 *
 * ## What went wrong, and why tagging fixes it
 *
 * The first version read values positionally, one `float64` per entry in the
 * watch list. That died with `Illegal offset: 0 <= 476 (+8) <= 476` — one read
 * past the end — because the definition and the watch list are not the same
 * length. `addToDataDefinition` for a variable this simulator does not have is
 * rejected **asynchronously**: the entry never joins the definition, nothing
 * throws where it was added, and the watch list still counts it.
 *
 * Bounding the positional read would have stopped the crash and left a worse
 * bug. A rejected entry in the *middle* shifts every value after it onto the
 * wrong variable, and wrong values that look right are harder to find than a
 * stack trace. Tagging removes the assumption instead of guarding it: each
 * record carries the datum id it belongs to, so a gap stays a gap.
 */

import type { SimValue, SimVarWatch } from "@shared/sim"

/** The part of node-simconnect's `RawBuffer` this needs. */
export interface TaggedBuffer {
  readInt32(): number
  readFloat64(): number
  remaining(): number
}

/** A datum id and a `float64`, which is what SimConnect packs per record. */
const RECORD_BYTES = 12

/**
 * Reads up to `count` tagged records, resolving each against the watch list.
 *
 * Every read is bounded rather than trusted: `count` is the sim's claim about a
 * buffer this process did not pack, and the crash it replaces came from
 * believing exactly that sort of claim.
 *
 * Records whose datum id is not in the watch list are dropped. That happens
 * when the watch set changed while a message was in flight — the right answer
 * is to lose one value, not to guess which variable it belonged to.
 */
export function readTaggedValues(
  buffer: TaggedBuffer,
  count: number,
  watching: SimVarWatch[]
): SimValue[] {
  const values: SimValue[] = []

  for (let read = 0; read < count; read += 1) {
    if (buffer.remaining() < RECORD_BYTES) break

    const datum = buffer.readInt32()
    const value = buffer.readFloat64()

    const watched = watching[datum]
    if (!watched) continue

    values.push({ name: watched.name, units: watched.units, value })
  }

  return values
}
