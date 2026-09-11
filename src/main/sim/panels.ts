/**
 * The cockpit's panels, read out of the simulator's own debugger.
 *
 * MSFS hosts a WebKit Web Inspector backend on `127.0.0.1:19999`, with or
 * without developer mode:
 *
 *   GET /pagelist.json                     every inspectable document
 *   ws://127.0.0.1:19999/devtools/page/N   the inspector protocol for one
 *
 * A cockpit document is titled `VCockpitNN - <identifier>` by `VCockpit.js`,
 * but the title is not enough: FS Copilot's key also carries the query of the
 * instrument's `url` attribute, which only the document knows. So each one is
 * asked, with a single `Runtime.evaluate`.
 *
 * ## Read-only, and it stays that way here
 *
 * `READ_PANELS` reads properties and one bounding rect. It adds nothing to the
 * page and leaves nothing behind. Anything that does put something in a panel
 * — an outline, a listener — is a different module with a different burden
 * (fail open, remove itself), and does not belong beside a scan that is safe
 * to run at any moment.
 *
 * ## The evaluated source is Chrome 49
 *
 * Coherent GT is `Chrome/49.0.2623`, and its traps are syntax-level: one `?.`
 * and the whole expression fails to parse. `READ_PANELS` is written in ES5 on
 * purpose, and returns a JSON string rather than an object so that nothing
 * depends on how this inspector serialises a value.
 *
 * No dependencies, and nothing from Electron: `scripts/probe-panels.ts` runs
 * this file under plain Node.
 */

import { createConnection } from "node:net"

import {
  panelKey,
  type CockpitPanel,
  type PanelScan,
  type SkippedPage,
} from "../../shared/panels.ts"

export const INSPECTOR_HOST = "127.0.0.1"
const HOST = INSPECTOR_HOST
export const INSPECTOR_PORT = 19999

/** A listening sim answers the list at once; a dead port refuses at once. */
const LIST_TIMEOUT_MS = 3000

/** Per document. They are asked together, so this is also the scan's ceiling. */
export const PAGE_TIMEOUT_MS = 4000

const COCKPIT_TITLE = /^VCockpit\d+/

export interface InspectorPage {
  id: number
  title: string
}

/**
 * Every instrument in the document, as
 * `[{ identifier, url, interactive, width, height }]`.
 *
 * An instrument is a custom element — hence the hyphen — whose class gives it
 * an `instrumentIdentifier`. Multi-instrument documents exist, so this is a
 * list. The url attribute is spelled both ways across aircraft, which is why
 * the bridge reads both and so does this.
 */
export const READ_PANELS = `(function () {
  var out = []
  var all = document.getElementsByTagName("*")
  for (var i = 0; i < all.length; i++) {
    var el = all[i]
    if (el.tagName.indexOf("-") < 0) continue
    var id
    try { id = el.instrumentIdentifier } catch (e) { continue }
    if (typeof id !== "string" || !id) continue
    var rect = el.getBoundingClientRect()
    out.push({
      identifier: id,
      url: el.getAttribute("url") || el.getAttribute("Url") || "",
      interactive: !!el.isInteractive,
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    })
  }
  return JSON.stringify(out)
})()`

/**
 * Minimal HTTP GET, finished by `Content-Length` rather than by the close.
 *
 * The backend answers `Connection: close` and then does not close: the body
 * arrives in three milliseconds and the socket stays open for as long as
 * anybody waits. Waiting for the close would make every scan cost the whole
 * timeout, so the body is counted instead — in bytes, since titles are UTF-8.
 */
function httpGet(path: string, port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let raw = Buffer.alloc(0)
    const socket = createConnection({ host: HOST, port })
    socket.setTimeout(LIST_TIMEOUT_MS)
    socket.on("connect", () =>
      socket.write(
        `GET ${path} HTTP/1.1\r\nHost: ${HOST}:${port}\r\nConnection: close\r\n\r\n`
      )
    )
    socket.on("data", (chunk) => {
      raw = Buffer.concat([raw, chunk])
      const at = raw.indexOf("\r\n\r\n")
      if (at === -1) return

      const head = raw.subarray(0, at).toString("latin1")
      if (!/^HTTP\/1\.\d 200\b/.test(head)) {
        socket.destroy()
        return reject(new Error(`${path} answered ${head.split("\r\n")[0]}`))
      }
      const length = Number(/^content-length:\s*(\d+)/im.exec(head)?.[1])
      const body = raw.subarray(at + 4)
      if (Number.isNaN(length) || body.length < length) return

      socket.destroy()
      resolve(body.subarray(0, length).toString("utf8"))
    })
    socket.on("timeout", () => socket.destroy(new Error("timed out")))
    socket.on("error", reject)
    socket.on("close", () => reject(new Error(`no response to ${path}`)))
  })
}

/** One expression in one document, and the socket closed whatever happens. */
function evaluateIn(
  page: number,
  expression: string,
  port: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${HOST}:${port}/devtools/page/${page}`)

    // Once. Closing a socket that is erroring raises the error again, and a
    // `finish` that answers it by closing never returns.
    let settled = false
    const finish = (settle: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // already gone
      }
      settle()
    }
    const timer = setTimeout(
      () => finish(() => reject(new Error("timed out"))),
      PAGE_TIMEOUT_MS
    )

    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, returnByValue: true },
        })
      )
    socket.onerror = () =>
      finish(() => reject(new Error("the debugger refused the connection")))
    socket.onclose = () =>
      finish(() => reject(new Error("the debugger closed the connection")))
    socket.onmessage = (event) => {
      let message: {
        id?: number
        error?: unknown
        result?: {
          wasThrown?: boolean
          result?: { value?: unknown; description?: string }
        }
      }
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (message.id !== 1) return

      const result = message.result
      if (message.error || !result)
        return finish(() =>
          reject(new Error(`inspector error: ${JSON.stringify(message.error)}`))
        )
      if (result.wasThrown)
        return finish(() =>
          reject(new Error(`the panel threw: ${result.result?.description}`))
        )
      finish(() => resolve(String(result.result?.value ?? "")))
    }
  })
}

async function readPage(
  page: InspectorPage,
  port: number
): Promise<CockpitPanel[]> {
  return panelsIn(page, await evaluateIn(page.id, READ_PANELS, port))
}

/** `READ_PANELS`' answer for one document, as panels. */
export function panelsIn(page: InspectorPage, raw: string): CockpitPanel[] {
  const found = JSON.parse(raw) as {
    identifier: string
    url: string
    interactive: boolean
    width: number
    height: number
  }[]

  return found.map((entry) => ({
    page: page.id,
    title: page.title,
    identifier: entry.identifier,
    key: panelKey(entry.identifier, entry.url),
    kind: entry.identifier === "WasmInstrument" ? "wasm" : "html",
    interactive: entry.interactive,
    width: entry.width,
    height: entry.height,
  }))
}

/**
 * What a document that would not be read still says about itself.
 *
 * The sim allows one inspector client per document: a second connection is
 * refused, and the first is left alone. So a panel the user has open in the
 * Coherent GT debugger cannot be asked anything — but `VCockpit.js` appends
 * ` - <identifier>` to the title for every instrument it creates, and the
 * identifier is the whole of what an item needs. The row is kept, with
 * everything the document would have added left unknown.
 */
export function fromTitle(page: InspectorPage): CockpitPanel[] {
  return page.title
    .split(" - ")
    .slice(1)
    .filter((identifier) => identifier && identifier !== "undefined")
    .map((identifier) => ({
      page: page.id,
      title: page.title,
      identifier,
      key: identifier,
      kind: identifier === "WasmInstrument" ? "wasm" : "html",
      interactive: null,
      width: 0,
      height: 0,
      unread: true,
    }))
}

/** The cockpit's documents, or the failure that stands in for them. */
export async function cockpitPages(
  port = INSPECTOR_PORT
): Promise<InspectorPage[] | Extract<PanelScan, { ok: false }>> {
  let pages: InspectorPage[]
  try {
    pages = JSON.parse(await httpGet("/pagelist.json", port)) as InspectorPage[]
  } catch (error) {
    return { ok: false, reason: "unreachable", detail: messageOf(error) }
  }

  const cockpit = pages.filter((page) => COCKPIT_TITLE.test(page.title ?? ""))
  if (!cockpit.length)
    return {
      ok: false,
      reason: "no-panels",
      detail: `${pages.length} documents, none of them a cockpit panel`,
    }

  return cockpit
}

/** Every panel sorted the one way, so a rescan does not reshuffle a list. */
export function sortPanels(panels: CockpitPanel[]): CockpitPanel[] {
  return panels.sort(
    (a, b) => a.key.localeCompare(b.key) || a.title.localeCompare(b.title)
  )
}

export async function scanPanels(port = INSPECTOR_PORT): Promise<PanelScan> {
  const cockpit = await cockpitPages(port)
  if (!Array.isArray(cockpit)) return cockpit

  const read = await Promise.allSettled(
    cockpit.map((page) => readPage(page, port))
  )

  const panels: CockpitPanel[] = []
  const skipped: SkippedPage[] = []
  read.forEach((outcome, index) => {
    const page = cockpit[index]!
    if (outcome.status === "fulfilled") return panels.push(...outcome.value)

    skipped.push({
      page: page.id,
      title: page.title,
      detail: messageOf(outcome.reason),
    })
    panels.push(...fromTitle(page))
  })

  // Nothing read and nothing to be made of the titles either.
  if (!panels.length)
    return {
      ok: false,
      reason: "failed",
      detail: skipped[0]?.detail ?? "no instrument in any cockpit panel",
    }

  sortPanels(panels)
  // `holders` is filled in by whoever can ask Windows; see panel-holders.ts.
  return { ok: true, panels, skipped, holders: [] }
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
