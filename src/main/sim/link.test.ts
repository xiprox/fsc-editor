/**
 * The Link protocol, from the app's side.
 *
 * Worth testing hard for one reason: this channel is fed by a separate program
 * compiled by a separate toolchain, and the two halves of the format are
 * written out twice because they cannot share a header. Nothing but a test
 * notices when they drift.
 *
 * The other half is hostility. Any SimConnect client can write to this area, so
 * every malformed shape here has to cost one dropped read rather than the
 * connection.
 */

import { beforeEach, describe, expect, it } from "vitest"

import { formatLinkCommand, LINK_AREA_BYTES, packWatchAdds } from "@shared/link"

import {
  linkState,
  onWatchResolution,
  receiveLink,
  resetLink,
  watchResolution,
  watchedRefs,
} from "./link"

beforeEach(() => resetLink())

/** As the module sends it: a fixed-size area, NUL-padded past the payload. */
function area(body: string): string {
  return body.padEnd(LINK_AREA_BYTES, "\0")
}

describe("hello", () => {
  it("reports the module once it names a variable count", () => {
    const events = receiveLink(area("hello 1 0\n0.1.0 1 5364\n"))

    expect(events).toEqual([
      { kind: "link", version: "0.1.0", protocol: 1, variables: 5364 },
    ])
    expect(linkState()).toMatchObject({ present: true, version: "0.1.0" })
  })

  it("does not announce the stale hello left at module_init", () => {
    // The module writes a hello into the area when it loads, so a client
    // connecting later reads one describing zero variables. That is the "it is
    // running" signal, not the handshake — announcing it would report a module
    // with no variables every time the app connects.
    const events = receiveLink(area("hello 1 0\n0.1.0 1 0\n"))

    expect(events).toEqual([])
    expect(linkState().present).toBe(true)
  })

  it("announces only once, however often the module repeats itself", () => {
    const first = receiveLink(area("hello 1 0\n0.1.0 1 100\n"))
    const again = receiveLink(area("hello 2 0\n0.1.0 1 100\n"))

    expect(first).toHaveLength(1)
    expect(again).toEqual([])
  })

  it("flags a module older than this app expects", () => {
    receiveLink(area("hello 1 0\n0.0.9 0 10\n"))
    expect(linkState().outdated).toBe(true)
  })
})

describe("names", () => {
  it("takes a partial chunk starting past zero, as a rescan sends it", () => {
    // `rescan` sends only what registered since the last walk, so the first
    // line of its message is not id 0. Ids are absolute either way — the app
    // indexes by them, and a value naming an id it has no name for is dropped.
    const events = receiveLink(area("names 4 0\n6150 LateSwitch\n"))

    expect(events).toEqual([
      { kind: "vars", from: 6150, names: ["L:LateSwitch"] },
    ])
    expect(linkState().variables).toBe(6151)
  })

  it("records the enumeration and reports the chunk", () => {
    const events = receiveLink(
      area("names 2 3\n0 AdfOnOffKnob\n1 DmeOnOffKnob\n")
    )

    expect(events).toEqual([
      { kind: "vars", from: 0, names: ["L:AdfOnOffKnob", "L:DmeOnOffKnob"] },
    ])
  })

  it("keeps ids across chunks, since a chunk does not start at zero", () => {
    receiveLink(area("names 1 1\n0 First\n"))
    const second = receiveLink(area("names 2 0\n900 Later\n"))

    expect(second).toEqual([{ kind: "vars", from: 900, names: ["L:Later"] }])
  })

  it("keeps a name containing spaces", () => {
    // Only the first space separates id from name; the rest belong to it.
    const [event] = receiveLink(area("names 1 0\n5 Some Odd Name\n"))
    expect(event).toEqual({ kind: "vars", from: 5, names: ["L:Some Odd Name"] })
  })
})

describe("values", () => {
  beforeEach(() => {
    receiveLink(area("names 1 0\n0 AdfOnOffKnob\n1 DmeOnOffKnob\n"))
  })

  it("resolves ids to namespaced names", () => {
    const events = receiveLink(area("values 3 0\n0 1\n1 0.5\n"))

    expect(events).toEqual([
      { kind: "var", name: "L:AdfOnOffKnob", value: 1 },
      { kind: "var", name: "L:DmeOnOffKnob", value: 0.5 },
    ])
  })

  it("drops a value whose id was never enumerated", () => {
    // Happens when the module re-enumerates and the app has not caught up. A
    // value with no name is not something to invent a name for.
    expect(receiveLink(area("values 4 0\n99 1\n"))).toEqual([])
  })

  it("keeps negatives and exponents intact", () => {
    const events = receiveLink(area("values 5 0\n0 -1.5e-7\n"))
    expect(events[0]).toMatchObject({ value: -1.5e-7 })
  })
})

describe("hostile and malformed input", () => {
  const rejected = [
    ["empty", ""],
    ["no newline", "hello 1 0"],
    ["short header", "hello 1\n"],
    ["unknown kind", "gibberish 1 0\npayload\n"],
    ["non-numeric seq", "values x 0\n0 1\n"],
    ["only NULs", "\0\0\0"],
  ] as const

  for (const [why, raw] of rejected) {
    it(`ignores ${why} rather than throwing`, () => {
      expect(() => receiveLink(area(raw))).not.toThrow()
      expect(receiveLink(area(raw))).toEqual([])
    })
  }

  it("skips unparseable records but keeps the good ones beside them", () => {
    receiveLink(area("names 1 0\n0 Good\n"))
    const events = receiveLink(area("values 2 0\nrubbish\n0 7\nalso rubbish\n"))

    expect(events).toEqual([{ kind: "var", name: "L:Good", value: 7 }])
  })

  it("survives a payload with no trailing newline", () => {
    const events = receiveLink(area("names 1 0\n0 NoNewline"))
    expect(events).toEqual([{ kind: "vars", from: 0, names: ["L:NoNewline"] }])
  })
})

describe("exec", () => {
  it("carries the result back with the token its caller sent", () => {
    const events = receiveLink(area("exec 1 0\n7 ok 1\n"))

    expect(events).toEqual([{ kind: "exec", token: 7, ok: true, value: 1 }])
  })

  it("reports code the calculator rejected, rather than dropping the reply", () => {
    // The caller is waiting on this. A rejected expression that arrived as
    // silence would be indistinguishable from a module that is not running.
    expect(receiveLink(area("exec 1 0\n7 err 0\n"))).toEqual([
      { kind: "exec", token: 7, ok: false, value: 0 },
    ])
  })

  it("passes on a reply for a token nobody here sent", () => {
    // The output area is a broadcast: a `link:read` running a setter beside the
    // app produces one of these, and something did happen in the aircraft.
    expect(receiveLink(area("exec 1 0\n99 ok 0\n"))).toHaveLength(1)
  })
})

describe("watched", () => {
  it("resolves watch-handle values through the mapping, verbatim", () => {
    // Watched names arrive prefixed — the app wrote them — so no `L:` is
    // added the way it is for the enumeration's bare names.
    receiveLink(area("watched 1 0\n1000000 1 Z:AUDIO_Knob_Selector_1\n"))

    expect(receiveLink(area("values 2 0\n1000000 3\n"))).toEqual([
      { kind: "var", name: "Z:AUDIO_Knob_Selector_1", value: 3 },
    ])
  })

  it("drops a value whose handle is not in the mapping", () => {
    // A handle from a set the app has already replaced. The next mapping is
    // in flight; one dropped read beats a value pinned to the wrong name.
    expect(receiveLink(area("values 1 0\n1000005 3\n"))).toEqual([])
  })

  it("replaces the mapping whole, so an empty message is a reset", () => {
    receiveLink(area("watched 1 0\n1000000 1 Z:Foo\n"))
    receiveLink(area("watched 2 0\n"))

    expect(receiveLink(area("values 3 0\n1000000 3\n"))).toEqual([])
  })

  it("holds a chunked mapping back until the final chunk lands", () => {
    receiveLink(area("watched 1 1\n1000000 1 Z:Foo\n"))
    // Half a map must not resolve anything — the old map still applies.
    expect(receiveLink(area("values 2 0\n1000001 4\n"))).toEqual([])

    receiveLink(area("watched 3 0\n1000001 1 E:ZULU TIME\n"))
    expect(receiveLink(area("values 4 0\n1000001 4\n"))).toEqual([
      { kind: "var", name: "E:ZULU TIME", value: 4 },
    ])
  })

  it("carries resolution, which is what protocol 5 added it for", () => {
    /*
     * An unresolved ref reports no values by definition, so before this the
     * app saw only silence — indistinguishable from a switch nobody touched.
     * The mapping now says which, and the module re-sends it when that moves.
     */
    receiveLink(area("watched 1 0\n1000000 0 Z:NotOnThisAircraft\n"))
    expect(watchedRefs().get(1000000)).toEqual({
      name: "Z:NotOnThisAircraft",
      resolved: false,
    })

    receiveLink(area("watched 2 0\n1000000 1 Z:NotOnThisAircraft\n"))
    expect(watchedRefs().get(1000000)?.resolved).toBe(true)
  })

  it("ignores a line whose state field is not 0, 1 or 2", () => {
    // A protocol-4 module against this app: the old two-field line would
    // otherwise parse with the name as its state.
    receiveLink(area("watched 1 0\n1000000 Z:Foo\n"))
    expect(watchedRefs().size).toBe(0)

    // And a state this app has no meaning for is refused, not guessed.
    receiveLink(area("watched 2 0\n1000000 3 Z:Foo\n"))
    expect(watchedRefs().size).toBe(0)
  })

  it("keeps a name with spaces whole in the mapping", () => {
    receiveLink(area("watched 1 0\n1000000 1 E:ZULU TIME\n"))
    expect(receiveLink(area("values 2 0\n1000000 71396\n"))).toEqual([
      { kind: "var", name: "E:ZULU TIME", value: 71396 },
    ])
  })
})

describe("resolution as a signal", () => {
  /** Wakes recorded, with the subscription cleaned up per test. */
  function listen(): { count: () => number; stop: () => void } {
    let woken = 0
    const stop = onWatchResolution(() => {
      woken += 1
    })
    return { count: () => woken, stop }
  }

  /** A module on the current protocol, which is what makes verdicts count. */
  function hello(protocol = 6): void {
    receiveLink(area(`hello 1 0\n0.7.0 ${protocol} 1200\n`))
  }

  it("says nothing before the module has said hello", () => {
    // Null, not []: "nothing is watched" and "nobody is answering" are the
    // same array and opposite facts, and only the second must mute the rule.
    expect(watchResolution()).toBeNull()
  })

  it("withholds everything from a module too old to say 'not tried'", () => {
    // Protocol 5 called a fresh ref absent, so believing it would warn about
    // every variable the app had just asked to watch.
    hello(5)
    receiveLink(area("watched 1 0\n1000000 0 Z:Foo\n"))

    expect(watchResolution()).toBeNull()
  })

  it("wakes when a ref is found absent, and again when it appears", () => {
    hello()
    const woken = listen()

    receiveLink(area("watched 1 0\n1000000 1 Z:Foo\n"))
    expect(woken.count()).toBe(0)

    receiveLink(area("watched 2 0\n1000000 0 Z:Foo\n"))
    expect(woken.count()).toBe(1)
    expect(watchResolution()).toEqual([{ name: "Z:Foo", resolved: false }])

    receiveLink(area("watched 3 0\n1000000 1 Z:Foo\n"))
    expect(woken.count()).toBe(2)

    woken.stop()
  })

  it("treats a not-yet-tried ref as no news and no verdict", () => {
    /*
     * State 2, which is what every ref is in when `watch-add` is answered —
     * the mapping goes out before the tick has resolved anything. Under
     * protocol 5 this arrived as absent and produced a warning on each of
     * them, corrected a frame later. It must wake nobody and say nothing.
     */
    hello()
    const woken = listen()

    receiveLink(area("watched 1 0\n1000000 2 Z:Foo\n"))

    expect(woken.count()).toBe(0)
    expect(watchResolution()).toEqual([{ name: "Z:Foo", resolved: null }])

    // And the verdict a tick later is news.
    receiveLink(area("watched 2 0\n1000000 0 Z:Foo\n"))
    expect(woken.count()).toBe(1)

    woken.stop()
  })

  it("stays quiet for a mapping that repeats itself", () => {
    /*
     * The module re-sends the whole map after every `watch-add`, which the
     * app sends whenever a tab opens or a `get:` line is typed. Waking the
     * renderer for those would re-run diagnostics to reach the same answer,
     * so the *contents* decide whether this is news.
     */
    hello()
    receiveLink(area("watched 1 0\n1000000 0 Z:Foo\n"))

    const woken = listen()
    receiveLink(area("watched 2 0\n1000000 0 Z:Foo\n1000001 2 E:ZULU TIME\n"))

    expect(woken.count()).toBe(0)
    woken.stop()
  })

  it("withdraws the verdict on a disconnect rather than freezing it", () => {
    // The module is not saying these refs resolve; it is not saying anything.
    hello()
    receiveLink(area("watched 1 0\n1000000 0 Z:Foo\n"))

    const woken = listen()
    resetLink()

    expect(woken.count()).toBe(1)
    expect(watchResolution()).toBeNull()
    woken.stop()
  })

  it("does not wake a reset that had nothing to withdraw", () => {
    const woken = listen()
    resetLink()
    expect(woken.count()).toBe(0)
    woken.stop()
  })
})

describe("watch commands", () => {
  it("formats watch-add with names one per line", () => {
    expect(
      formatLinkCommand({ name: "watch-add", names: ["Z:Foo", "E:ZULU TIME"] })
    ).toBe("watch-add\nZ:Foo\nE:ZULU TIME")
  })

  it("refuses a name that would smuggle lines or truncate the command", () => {
    expect(
      formatLinkCommand({ name: "watch-add", names: ["Z:Foo\nZ:Bar"] })
    ).toBeNull()
    expect(formatLinkCommand({ name: "watch-add", names: ["Z:\0"] })).toBeNull()
    expect(formatLinkCommand({ name: "watch-add", names: [] })).toBeNull()
  })

  it("packs a large set into chunks that each fit the area", () => {
    const names = Array.from(
      { length: 600 },
      (_, n) => `Z:VAR_${n}_${"x".repeat(20)}`
    )
    const commands = packWatchAdds(names)

    expect(commands.length).toBeGreaterThan(1)
    for (const command of commands) {
      expect(formatLinkCommand(command)).not.toBeNull()
    }
    const carried = commands.flatMap((command) =>
      command.name === "watch-add" ? command.names : []
    )
    expect(carried).toEqual(names)
  })

  it("drops only the name that could never be sent", () => {
    const monster = `Z:${"x".repeat(LINK_AREA_BYTES)}`
    const commands = packWatchAdds(["Z:Foo", monster, "Z:Bar"])

    const carried = commands.flatMap((command) =>
      command.name === "watch-add" ? command.names : []
    )
    expect(carried).toEqual(["Z:Foo", "Z:Bar"])
  })
})

describe("probe", () => {
  it("produces no events, even for lines shaped like values", () => {
    // The area is a broadcast, so the app sees every probe a `link:read`
    // beside it asked for. The guarded case is a payload line opening with
    // two numbers — without an explicit branch it would fall through to the
    // values parser and be recorded as a variable that moved.
    expect(receiveLink(area("probe 1 0\n42 7 looks like a value\n"))).toEqual(
      []
    )
  })

  it("is sendable as a bare command", () => {
    expect(formatLinkCommand({ name: "probe" })).toBe("probe")
  })

  const rejected = [
    ["no token", "not-a-token ok 0"],
    ["a negative token", "-1 ok 0"],
    ["an unknown status", "7 maybe 0"],
    ["nothing at all", ""],
  ] as const

  for (const [why, line] of rejected) {
    it(`drops a reply with ${why}`, () => {
      expect(receiveLink(area(`exec 1 0\n${line}\n`))).toEqual([])
    })
  }
})

describe("formatLinkCommand", () => {
  it("sends a command without an argument as the bare word", () => {
    expect(formatLinkCommand({ name: "start" })).toBe("start")
  })

  it("spells `rescan` distinctly from `enumerate`", () => {
    // The module tells its commands apart with `strncmp` over a fixed length,
    // so two verbs sharing a prefix would be one verb. They are checked
    // longest-first there; this is the other half of that care.
    expect(formatLinkCommand({ name: "rescan" })).toBe("rescan")
    expect(formatLinkCommand({ name: "enumerate" })).toBe("enumerate")
    expect("enumerate".startsWith("rescan")).toBe(false)
  })

  it("puts the token in front of the code, where the module reads it", () => {
    expect(
      formatLinkCommand({ name: "exec", token: 3, code: "1 (>L:Foo)" })
    ).toBe("exec 3 1 (>L:Foo)")
  })

  it("refuses code that would not fit rather than truncating it", () => {
    // Truncated calculator code still parses as *something*, and the sim would
    // run that something. This is the whole reason the function exists.
    const code = "1 ".repeat(LINK_AREA_BYTES)

    expect(formatLinkCommand({ name: "exec", token: 1, code })).toBeNull()
  })

  it("refuses code holding a NUL, which would be cut on the C++ side", () => {
    expect(
      formatLinkCommand({
        name: "exec",
        token: 1,
        code: "1 (>L:Foo)\0 2 (>L:Bar)",
      })
    ).toBeNull()
  })

  it("fills the area right up to the last byte", () => {
    // The bound is the formatted line's, so this asserts where the edge is
    // rather than that there is one somewhere.
    const room = LINK_AREA_BYTES - "exec 1 ".length - 1
    const fits = formatLinkCommand({
      name: "exec",
      token: 1,
      code: "x".repeat(room),
    })
    const over = formatLinkCommand({
      name: "exec",
      token: 1,
      code: "x".repeat(room + 1),
    })

    expect(fits).not.toBeNull()
    expect(over).toBeNull()
  })
})

describe("resetLink", () => {
  it("forgets the module, so a reconnect does not inherit a stale enumeration", () => {
    receiveLink(area("hello 1 0\n0.1.0 1 2\n"))
    receiveLink(area("names 2 0\n0 Something\n"))

    resetLink()

    expect(linkState()).toMatchObject({ present: false, variables: 0 })
    // The id means nothing now, so the value has nowhere to land.
    expect(receiveLink(area("values 3 0\n0 1\n"))).toEqual([])
  })
})
