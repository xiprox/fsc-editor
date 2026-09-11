import { createServer, type Server } from "node:net"
import type { AddressInfo } from "node:net"

import { afterEach, describe, expect, it } from "vitest"

import {
  panelBlockSpec,
  childState,
  panelKey,
  pickRows,
  pickedTexts,
  rowState,
  togglePick,
  type CockpitPanel,
} from "../../shared/panels.ts"
import { closeRefusal } from "./panel-holders.ts"
import { scanPanels } from "./panels.ts"

let server: Server | null = null

afterEach(
  () =>
    new Promise<void>((resolve) => {
      if (!server) return resolve()
      server.close(() => resolve())
      server = null
    })
)

/**
 * The debugger as it actually behaves: it answers `Connection: close`, sends
 * the body, and leaves the socket open.
 */
function debuggerListing(body: string): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket) => {
      socket.on("error", () => {})
      socket.once("data", () =>
        socket.write(
          "HTTP/1.1 200 OK\r\nConnection: close\r\n" +
            "Content-Type: application/json; charset=utf-8\r\n" +
            `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
        )
      )
    })
    server.listen(0, "127.0.0.1", () =>
      resolve((server!.address() as AddressInfo).port)
    )
  })
}

describe("scanPanels", () => {
  it("does not wait for a close the debugger never sends", async () => {
    const port = await debuggerListing(
      JSON.stringify([{ id: 3, title: "Toolbar — é" }])
    )

    const started = Date.now()
    const scan = await scanPanels(port)

    // The list was read; with no cockpit document in it, that is the finding.
    expect(scan).toMatchObject({ ok: false, reason: "no-panels" })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it("says unreachable when nothing is listening", async () => {
    const port = await debuggerListing("[]")
    await new Promise<void>((resolve) => server!.close(() => resolve()))
    server = null

    expect(await scanPanels(port)).toMatchObject({
      ok: false,
      reason: "unreachable",
    })
  })
})

describe("closeRefusal", () => {
  it("says a windowless process cannot be asked, rather than quoting /F", () => {
    const stderr =
      "ERROR: The process with PID 73684 could not be terminated.\r\n" +
      "Reason: This process can only be terminated forcefully (with /F option).\r\n"

    expect(closeRefusal("node.exe", stderr)).toBe(
      "node.exe has no window to ask — end it yourself, then scan again"
    )
  })

  it("passes any other reason on as a lowercase fragment", () => {
    expect(
      closeRefusal("Debugger.exe", "ERROR: x\r\nReason: Access is denied.\r\n")
    ).toBe("access is denied.")
  })
})

describe("panelKey", () => {
  it("is the identifier alone when the url has no query", () => {
    expect(panelKey("GTN750_INT", "Pages/VCockpit/GTN750.html")).toBe(
      "GTN750_INT"
    )
  })

  it("appends the query, as Channel.keyFor does", () => {
    expect(panelKey("DisplayUnits", "a/b.html?config=N324DU")).toBe(
      "DisplayUnits|config=N324DU"
    )
  })
})

describe("the pointer: spec", () => {
  it("inserts the bare identifier, whatever the key says", () => {
    const spec = panelBlockSpec("pointer")!
    expect(
      spec.insert({
        page: 1,
        title: "VCockpit02 - DisplayUnits",
        identifier: "DisplayUnits",
        key: "DisplayUnits|config=Default",
        kind: "html",
        interactive: true,
        width: 1024,
        height: 768,
      })
    ).toBe("DisplayUnits")
  })

  it("has nothing to say about a block that takes no panels", () => {
    expect(panelBlockSpec("include")).toBeNull()
    expect(panelBlockSpec(null)).toBeNull()
  })
})

describe("pickRows", () => {
  const make = (
    identifier: string,
    over: Partial<CockpitPanel> = {}
  ): CockpitPanel => ({
    page: 1,
    title: `VCockpit01 - ${identifier}`,
    identifier,
    key: identifier,
    kind: "html",
    // The list is only panels that take input, so that is what a panel is
    // here unless a test says otherwise.
    interactive: true,
    width: 512,
    height: 512,
    ...over,
  })
  const pointer = panelBlockSpec("pointer")!

  it("collapses panels that write the same item into one row", () => {
    const rows = pickRows(
      pointer,
      [
        make("FCP", { key: "FCP|side=L" }),
        make("FCP", { key: "FCP|side=R" }),
        make("CTP"),
      ],
      []
    )

    expect(rows.map((row) => [row.text, row.panels.length])).toEqual([
      ["CTP", 1],
      ["FCP", 2],
    ])
  })

  it("lists the panels of a shared identifier under it, by full key", () => {
    const [row] = pickRows(
      pointer,
      [
        make("WasmInstrument", { key: "WasmInstrument|wasm_gauge=GTN750" }),
        make("WasmInstrument", { key: "WasmInstrument|wasm_gauge=GTN650" }),
      ],
      ["WasmInstrument|wasm_gauge=GTN750"]
    )

    expect(row?.children.map((child) => [child.text, child.taken])).toEqual([
      ["WasmInstrument|wasm_gauge=GTN650", false],
      ["WasmInstrument|wasm_gauge=GTN750", true],
    ])
  })

  it("gives every panel of a group a line, even two no item can tell apart", () => {
    // The Baron's pair: no url query, so both have the key GNS_DISABLED.
    const rows = pickRows(
      pointer,
      [
        make("GNS_DISABLED", { page: 59, width: 320, height: 234 }),
        make("GNS_DISABLED", { page: 60, width: 350, height: 190 }),
      ],
      []
    )
    const [row] = rows
    const [first, second] = row!.children

    // Two lines, two panels to hover — and one item between them.
    expect(row?.children.map((child) => child.text)).toEqual([
      "GNS_DISABLED",
      "GNS_DISABLED",
    ])
    expect(first?.id).not.toBe(second?.id)
    expect([first?.panel.page, second?.panel.page]).toEqual([59, 60])

    const picked = togglePick(rows, new Set(), "GNS_DISABLED", first!.id)
    expect(childState(row!, second!, picked)).toBe("on")
    expect(rowState(row!, picked)).toBe("on")
    expect(pickedTexts(rows, picked)).toEqual(["GNS_DISABLED"])

    // And they leave together, from either line.
    expect(
      pickedTexts(rows, togglePick(rows, picked, "GNS_DISABLED", second!.id))
    ).toEqual([])
  })

  it("lights every sibling when the one without a key is ticked", () => {
    // One FCP has no query. Its line can only write the identifier, and the
    // identifier takes the other one too — so the list says so.
    const rows = pickRows(
      pointer,
      [make("FCP"), make("FCP", { key: "FCP|side=R" })],
      []
    )
    const [row] = rows
    const bare = row!.children.find((child) => child.text === "FCP")!
    const keyed = row!.children.find((child) => child.text === "FCP|side=R")!

    const picked = togglePick(rows, new Set(), "FCP", bare.id)
    expect(childState(row!, keyed, picked)).toBe("on")
    expect(pickedTexts(rows, picked)).toEqual(["FCP"])

    // The keyed one alone is still its own item.
    expect(
      pickedTexts(rows, togglePick(rows, new Set(), "FCP", keyed.id))
    ).toEqual(["FCP|side=R"])

    // Ticking them all comes to the identifier, without its key as noise.
    expect(pickedTexts(rows, togglePick(rows, new Set(), "FCP"))).toEqual([
      "FCP",
    ])
  })

  it("writes a lone wasm gauge by its key, and a lone html panel by name", () => {
    const rows = pickRows(
      pointer,
      [
        make("WasmInstrument", {
          kind: "wasm",
          key: "WasmInstrument|wasm_gauge=GTN750",
        }),
        // The A220 rule: this query is the livery's, and must not be written.
        make("DisplayUnits", { key: "DisplayUnits|config=N324DU" }),
      ],
      ["WasmInstrument|wasm_gauge=GTN750"]
    )

    expect(rows.map((row) => [row.text, row.taken])).toEqual([
      ["DisplayUnits", false],
      ["WasmInstrument|wasm_gauge=GTN750", true],
    ])
  })

  it("has no children for a panel with its identifier to itself", () => {
    const [row] = pickRows(
      pointer,
      [make("KX155B_1", { key: "KX155B_1|Index=1" })],
      []
    )

    // Alone: "this one" and "all of them" are the same item.
    expect(row?.children).toEqual([])
  })

  it("lines up panels known only by their titles, too", () => {
    const [row] = pickRows(
      pointer,
      [make("Tablet", { unread: true }), make("Tablet", { unread: true })],
      []
    )

    // No key to offer, so each answers to the identifier.
    expect(row?.children.map((child) => child.text)).toEqual([
      "Tablet",
      "Tablet",
    ])
  })

  it("offers no children for ignore:, which only matches identifiers", () => {
    const rows = pickRows(
      panelBlockSpec("ignore")!,
      [
        make("FCP", { key: "FCP|side=L", interactive: true }),
        make("FCP", { key: "FCP|side=R", interactive: true }),
      ],
      []
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]?.children).toEqual([])
  })

  describe("choosing", () => {
    const rows = pickRows(
      pointer,
      [
        make("FCP", { key: "FCP|side=L" }),
        make("FCP", { key: "FCP|side=R" }),
        make("CTP"),
      ],
      []
    )
    /** `"FCP"` is the heading; `"FCP>FCP|side=L"` is a line under it. */
    const pick = (steps: string[]) =>
      steps.reduce<Set<string>>((picked, step) => {
        const [rowText, childText] = step.split(">")
        const child = rows
          .find((row) => row.text === rowText)
          ?.children.find((entry) => entry.text === childText)

        return togglePick(rows, picked, rowText!, child?.id)
      }, new Set())
    const fcp = rows.find((row) => row.text === "FCP")!

    it("ticks every child from the heading, and never writes the identifier", () => {
      const picked = pick(["FCP"])

      // A shared identifier would take in panels that do not exist yet.
      expect(pickedTexts(rows, picked)).toEqual(["FCP|side=L", "FCP|side=R"])
      expect(rowState(fcp, picked)).toBe("on")
      expect(childState(fcp, fcp.children[0]!, picked)).toBe("on")
    })

    it("unticks them all from the heading once they are all ticked", () => {
      expect(pickedTexts(rows, pick(["FCP", "FCP"]))).toEqual([])
    })

    it("finishes a half-ticked group from the heading rather than clearing it", () => {
      expect(pickedTexts(rows, pick(["FCP>FCP|side=R", "FCP"]))).toEqual([
        "FCP|side=L",
        "FCP|side=R",
      ])
    })

    it("writes one key for one child, and shows the row as partly ticked", () => {
      const picked = pick(["FCP>FCP|side=R"])

      expect(pickedTexts(rows, picked)).toEqual(["FCP|side=R"])
      expect(rowState(fcp, picked)).toBe("some")
    })

    it("shows the heading ticked when its children were ticked one by one", () => {
      const picked = pick(["FCP>FCP|side=L", "FCP>FCP|side=R"])

      expect(pickedTexts(rows, picked)).toEqual(["FCP|side=L", "FCP|side=R"])
      // The heading is only ever a summary of what is under it.
      expect(rowState(fcp, picked)).toBe("on")
    })

    it("unticking one child after the heading leaves the others", () => {
      expect(pickedTexts(rows, pick(["FCP", "FCP>FCP|side=L"]))).toEqual([
        "FCP|side=R",
      ])
    })

    it("skips a child the block already lists, and counts it as ticked", () => {
      const listed = pickRows(
        pointer,
        [
          make("FCP", { key: "FCP|side=L" }),
          make("FCP", { key: "FCP|side=R" }),
        ],
        ["FCP|side=L"]
      )
      const picked = togglePick(listed, new Set(), "FCP")

      expect(pickedTexts(listed, picked)).toEqual(["FCP|side=R"])
      expect(rowState(listed[0]!, picked)).toBe("on")
    })

    it("writes in list order, whatever order things were ticked in", () => {
      expect(pickedTexts(rows, pick(["FCP>FCP|side=R", "CTP"]))).toEqual([
        "CTP",
        "FCP|side=R",
      ])
    })

    it("leaves what the block already lists alone", () => {
      const listed = pickRows(pointer, [make("CTP")], ["CTP"])

      expect([...togglePick(listed, new Set(), "CTP")]).toEqual([])
    })
  })

  it("lists dark panels too, after the live ones, for every block", () => {
    const panels = [
      // Swapped out right now, and exactly what a profile needs to name.
      make("AS330", { interactive: false }),
      make("Tablet"),
      // Held by another debugger: nobody could ask, so nobody said no.
      make("Held", { interactive: null, unread: true }),
    ]

    for (const block of ["pointer", "ignore"]) {
      const rows = pickRows(panelBlockSpec(block)!, panels, [])

      expect(rows.map((row) => [row.text, row.rank])).toEqual([
        ["Held", "fits"],
        ["Tablet", "fits"],
        ["AS330", "plain"],
      ])
    }
  })

  it("sorts a group with its live panel, however many of it are dark", () => {
    const [row] = pickRows(
      pointer,
      [
        make("FCP", { key: "FCP|side=L", interactive: false }),
        make("FCP", { key: "FCP|side=R" }),
      ],
      []
    )

    expect(row?.rank).toBe("fits")
  })

  it("puts an invisible helper last, should one ever take input", () => {
    const rows = pickRows(
      pointer,
      [make("WTT1", { width: 10, height: 10 }), make("Tablet")],
      []
    )

    expect(rows.map((row) => row.text)).toEqual(["Tablet", "WTT1"])
    expect(rows.at(-1)?.helper).toBe(true)
  })

  it("does not call a panel it could not measure a helper", () => {
    const [row] = pickRows(
      pointer,
      [make("Tablet", { unread: true, width: 0, height: 0 })],
      []
    )
    expect(row?.helper).toBe(false)
  })

  it("marks what the block already lists", () => {
    const rows = pickRows(pointer, [make("CTP"), make("MKP")], ["MKP"])
    expect(rows.find((row) => row.text === "MKP")?.taken).toBe(true)
    expect(rows.find((row) => row.text === "CTP")?.taken).toBe(false)
  })

  it("keeps WasmInstrument for pointer:, and drops it for ignore:", () => {
    const wasm = make("WasmInstrument", { kind: "wasm", interactive: true })

    expect(pickRows(pointer, [wasm], [])).toHaveLength(1)
    expect(pickRows(panelBlockSpec("ignore")!, [wasm], [])).toHaveLength(0)
  })
})

describe("the ignore: spec", () => {
  const panel = {
    page: 1,
    title: "VCockpit62 - KX155B_1",
    identifier: "KX155B_1",
    key: "KX155B_1|Index=1",
    kind: "html" as const,
    interactive: true,
    width: 800,
    height: 110,
  }
  const spec = panelBlockSpec("ignore")!

  it("takes html panels only — the element-name path has no wasm side", () => {
    // Whether a panel takes input at all is the picker's question, asked of
    // every block before this one; see the `pickRows` test above.
    expect(spec.accepts!(panel)).toBe(true)
    expect(spec.accepts!({ ...panel, kind: "wasm" })).toBe(false)
  })

  it("inserts the identifier, which is what Coordinator matches", () => {
    expect(spec.insert(panel)).toBe("KX155B_1")
  })
})
