/**
 * The picker's connection to the cockpit, for as long as the popup is open.
 *
 * `scanPanels` connects, asks once and hangs up, which is all a list needs.
 * Lighting a panel and hearing a click in one need a connection that stays —
 * and the simulator allows one inspector client per document, so a scan
 * cannot run beside one either. Hence a session: it owns a socket to every
 * cockpit document, and the scan, the outline and inspect mode all go through
 * those.
 *
 * ## It holds the panels, so it must not outlive the popup
 *
 * While a session is open, nobody else can attach a debugger to those panels
 * — the same rule that gives this file a reason to exist, pointed the other
 * way. So it is opened when the popup opens and closed when it closes, and
 * `ipc.ts` also closes it when the window reloads or goes away, which is the
 * only way a renderer can stop without saying so.
 *
 * ## What is in a panel is always what this file last said
 *
 * `apply` sends each document its whole state — lit or not, inspecting or not
 * — rather than a change, so a message lost to a closing socket cannot leave
 * a panel believing something the session does not. The same call is the
 * heartbeat that re-arms the panel's own deadman (`panel-inject.ts`), sent
 * only while something is on: a session with nothing lit sends nothing and
 * has left nothing in any panel.
 *
 * No Electron and no dependencies, so `scripts/probe-panels.ts` can drive it.
 */

import { randomBytes } from "node:crypto"

import type {
  CockpitPanel,
  PanelEvent,
  PanelScan,
} from "../../shared/panels.ts"
import {
  DEADMAN_MS,
  REMOVE_EXPRESSION,
  applyExpression,
  readSignals,
} from "./panel-inject.ts"
import {
  INSPECTOR_HOST,
  INSPECTOR_PORT,
  PAGE_TIMEOUT_MS,
  READ_PANELS,
  cockpitPages,
  fromTitle,
  messageOf,
  panelsIn,
  sortPanels,
  type InspectorPage,
} from "./panels.ts"

/** Well inside the deadman, so one late beat is not a panel going dark. */
const HEARTBEAT_MS = Math.floor(DEADMAN_MS / 2.5)

/**
 * While inspecting, the beat is also how a click is heard — see
 * `panel-inject.ts` on why the panel is asked rather than listened to — so it
 * is as fast as a click should feel. Twenty small evaluates per beat, for the
 * few seconds somebody spends reaching for a display.
 */
const INSPECT_BEAT_MS = 120

interface Reply {
  error?: unknown
  result?: {
    wasThrown?: boolean
    result?: { value?: unknown; description?: string }
  }
}

/** One held inspector connection. */
class PageClient {
  private socket: WebSocket | null = null
  private seq = 0
  private pending = new Map<
    number,
    { resolve: (reply: Reply) => void; reject: (error: Error) => void }
  >()

  /** What the document was last told, so an unchanged "off" is not resent. */
  applied = { lit: false, inspect: false }

  // Spelled out rather than as parameter properties: the probe script runs
  // this file under Node's type stripping, which cannot emit them.
  readonly page: InspectorPage
  private readonly port: number
  private readonly onGone: () => void

  constructor(page: InspectorPage, port: number, onGone: () => void) {
    this.page = page
    this.port = port
    this.onGone = onGone
  }

  get open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(
        `ws://${INSPECTOR_HOST}:${this.port}/devtools/page/${this.page.id}`
      )
      this.socket = socket

      let opened = false
      const timer = setTimeout(() => {
        if (opened) return
        this.drop()
        reject(new Error("timed out"))
      }, PAGE_TIMEOUT_MS)

      socket.onopen = () => {
        opened = true
        clearTimeout(timer)
        resolve()
      }
      socket.onerror = () => {
        if (opened) return
        clearTimeout(timer)
        reject(new Error("the debugger refused the connection"))
      }
      socket.onclose = () => {
        clearTimeout(timer)
        for (const [, waiter] of this.pending)
          waiter.reject(new Error("the debugger closed the connection"))
        this.pending.clear()
        if (this.socket === socket) this.socket = null
        if (opened) this.onGone()
      }
      socket.onmessage = (event) => {
        let message: Reply & { id?: number }
        try {
          message = JSON.parse(String(event.data))
        } catch {
          return
        }
        if (message.id === undefined) return

        const waiter = this.pending.get(message.id)
        if (!waiter) return
        this.pending.delete(message.id)
        waiter.resolve(message)
      }
    })
  }

  private send(method: string, params: object = {}): Promise<Reply> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error("the debugger closed the connection"))

    const id = ++this.seq
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error("timed out"))
      }, PAGE_TIMEOUT_MS)

      this.pending.set(id, {
        resolve: (reply) => {
          clearTimeout(timer)
          resolve(reply)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression: string): Promise<string> {
    const reply = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
    })

    if (reply.error || !reply.result)
      throw new Error(`inspector error: ${JSON.stringify(reply.error)}`)
    if (reply.result.wasThrown)
      throw new Error(`the panel threw: ${reply.result.result?.description}`)

    return String(reply.result.result?.value ?? "")
  }

  drop(): void {
    const socket = this.socket
    this.socket = null
    try {
      socket?.close()
    } catch {
      // already gone
    }
  }
}

export class PanelSession {
  private readonly token = randomBytes(6).toString("hex")
  private clients = new Map<number, PageClient>()
  private lit = new Set<number>()
  /** What each panel's outline calls it. Absent: its own identifier. */
  private labels = new Map<number, string>()
  private inspecting = false
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private beatEvery = 0
  private beating = false
  private closed = false

  private readonly emit: (event: PanelEvent) => void
  private readonly port: number

  constructor(emit: (event: PanelEvent) => void, port = INSPECTOR_PORT) {
    this.emit = emit
    this.port = port
  }

  /**
   * Reads the cockpit, connecting to whatever is not connected yet.
   *
   * Opening and rescanning are the same act: list the documents, let go of
   * the ones that are gone, try the ones not held — new, or refused last time
   * because another debugger had them — and ask every one that answers.
   */
  async scan(): Promise<PanelScan> {
    const pages = await cockpitPages(this.port)
    if (!Array.isArray(pages)) return pages
    if (this.closed) return { ok: false, reason: "failed", detail: "closed" }

    const listed = new Set(pages.map((page) => page.id))
    for (const [id, client] of this.clients)
      if (!listed.has(id) || !client.open) this.forget(id)

    const panels: CockpitPanel[] = []
    const skipped: { page: number; title: string; detail: string }[] = []

    await Promise.all(
      pages.map(async (page) => {
        try {
          let client = this.clients.get(page.id)
          if (!client) {
            client = new PageClient(page, this.port, () => this.forget(page.id))
            await client.connect()
            // Closed while connecting: this socket is nobody's, so it goes.
            if (this.closed) return client.drop()
            this.clients.set(page.id, client)
          }

          panels.push(...panelsIn(page, await client.evaluate(READ_PANELS)))
        } catch (error) {
          skipped.push({
            page: page.id,
            title: page.title,
            detail: messageOf(error),
          })
          panels.push(...fromTitle(page))
        }
      })
    )

    if (!panels.length)
      return {
        ok: false,
        reason: "failed",
        detail: skipped[0]?.detail ?? "no instrument in any cockpit panel",
      }

    return { ok: true, panels: sortPanels(panels), skipped, holders: [] }
  }

  /** The panels to outline. An empty list puts every outline out. */
  async highlight(pages: number[]): Promise<void> {
    this.lit = new Set(pages.filter((page) => this.clients.has(page)))
    await this.apply()
  }

  /**
   * What each panel is to be called in its outline, by page.
   *
   * Told ahead rather than with each highlight, because inspect mode lights a
   * panel from inside it, under the pointer, with nobody to ask.
   */
  async label(labels: Record<number, string>): Promise<void> {
    this.labels = new Map(
      Object.entries(labels).map(([page, text]) => [Number(page), text])
    )
    if (this.inspecting || this.lit.size > 0) await this.apply()
  }

  async inspect(on: boolean): Promise<void> {
    if (this.inspecting === on) return

    this.inspecting = on
    this.emit({ type: "inspect", on })
    await this.apply()
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null

    // Told to leave rather than left to the deadman: five seconds of a lit
    // panel after the popup has gone is five seconds of looking broken.
    const clients = [...this.clients.values()]
    this.clients.clear()
    await Promise.all(
      clients.map(async (client) => {
        const touched = client.applied.lit || client.applied.inspect
        if (touched && client.open)
          await client.evaluate(REMOVE_EXPRESSION).catch(() => {})
        client.drop()
      })
    )
  }

  // ---- inside ------------------------------------------------------------

  private forget(page: number): void {
    this.clients.get(page)?.drop()
    this.clients.delete(page)
    this.lit.delete(page)
  }

  private heard(page: number, answer: string): void {
    if (this.closed) return

    for (const signal of readSignals(answer)) {
      this.emit({ type: signal, page })

      // One pick ends inspect mode everywhere. The panel that was clicked has
      // already stopped taking input on its own; this tells the other nineteen.
      if (signal === "pick") void this.inspect(false)
    }
  }

  private async apply(): Promise<void> {
    if (this.closed) return

    await Promise.all(
      [...this.clients.values()].map(async (client) => {
        const next = {
          lit: this.lit.has(client.page.id),
          inspect: this.inspecting,
        }
        const wasOn = client.applied.lit || client.applied.inspect
        // Off, and already off: nothing of ours is in there to tell.
        if (!next.lit && !next.inspect && !wasOn) return

        client.applied = next
        await client
          .evaluate(
            applyExpression(this.token, {
              ...next,
              label: this.labels.get(client.page.id),
            })
          )
          .then((answer) => this.heard(client.page.id, answer))
          .catch(() => {})
      })
    )

    this.pace()
  }

  /** The beat that fits what is on: fast, slow, or none at all. */
  private pace(): void {
    const every = this.inspecting
      ? INSPECT_BEAT_MS
      : this.lit.size > 0
        ? HEARTBEAT_MS
        : 0
    if (every === this.beatEvery) return

    if (this.heartbeat) clearInterval(this.heartbeat)
    this.beatEvery = every
    this.heartbeat = every ? setInterval(() => void this.beat(), every) : null
  }

  /** One beat at a time: a slow panel must not stack evaluates behind itself. */
  private async beat(): Promise<void> {
    if (this.beating) return

    this.beating = true
    try {
      await this.apply()
    } finally {
      this.beating = false
    }
  }
}
