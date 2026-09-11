/**
 * The Remote Connect relay.
 *
 * One Durable Object per invite code, holding a host and up to `MAX_GUESTS`
 * guests. It is a router, not a participant: it reads the envelope to decide
 * where a frame goes and never looks inside `message`, never stores one, and
 * never needs to understand a manifest or a profile. That is what lets the app
 * protocol change without redeploying this, and what makes "the relay has your
 * files" untrue rather than merely unlikely.
 *
 * Nothing lives in memory between requests. Each socket carries its own role in
 * `serializeAttachment`, so a hibernation wake rebuilds the whole roster from
 * `getWebSockets()` — which is also why an idle session costs nothing.
 */

import { DurableObject } from "cloudflare:workers"

import {
  CLOSE_INTENTIONAL,
  CLOSE_SESSION_ENDED,
  CODE_ALPHABET,
  CODE_LENGTH,
  HOST_GRACE_MS,
  MAX_GUESTS,
  parseCode,
  type CloseReason,
  type GuestId,
  type RelayFrame,
} from "../../src/shared/remote-connect.ts"

interface Env {
  SESSIONS: DurableObjectNamespace<Session>
  /** Absent under `wrangler dev`, where there is nothing to protect. */
  JOIN_LIMIT?: RateLimit
}

/** How many fresh codes to try before admitting the namespace is busy. */
const CODE_ATTEMPTS = 5

type Attachment =
  | { role: "host" }
  | { role: "guest"; guestId: GuestId }

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH))

  // The alphabet's 30 characters do not divide 256, so taking a byte modulo its
  // length would make the first six characters marginally likelier than the
  // rest. Rejecting the short tail keeps every code equally likely, which is
  // the entire security argument for a six-character code.
  const ceiling = 256 - (256 % CODE_ALPHABET.length)
  let code = ""

  for (const byte of bytes) {
    const usable = byte < ceiling ? byte : crypto.getRandomValues(new Uint8Array(1))[0] % ceiling
    code += CODE_ALPHABET[usable % CODE_ALPHABET.length]
  }

  return code
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket upgrade", { status: 426 })

    const url = new URL(request.url)

    if (url.pathname === "/host") return startHosting(request, url, env)
    if (url.pathname === "/join") return join(request, url, env)

    return new Response("Not found", { status: 404 })
  },
}

/**
 * Opens a session, or resumes one whose host dropped inside the grace window.
 *
 * A resume names the code it already holds; a fresh session lets the relay pick
 * one and retries on the rare collision with a live session.
 */
async function startHosting(
  request: Request,
  url: URL,
  env: Env
): Promise<Response> {
  const resuming = url.searchParams.get("code")

  if (resuming) {
    const code = parseCode(resuming)
    if (!code) return new Response("Malformed code", { status: 400 })
    return sessionFor(env, code).fetch(hostRequest(url, request, code))
  }

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
    const code = randomCode()
    const response = await sessionFor(env, code).fetch(
      hostRequest(url, request, code)
    )

    // 409 means a live session already holds that code. Any other status,
    // including the 101 we want, is this attempt's final answer.
    if (response.status !== 409) return response
  }

  return new Response("Could not allocate a session code", { status: 503 })
}

async function join(request: Request, url: URL, env: Env): Promise<Response> {
  // Shape is checked here, before any Durable Object exists, so a sweep of
  // malformed codes never costs an instantiation.
  const code = parseCode(url.searchParams.get("code") ?? "")
  if (!code) return new Response("Malformed code", { status: 400 })

  if (env.JOIN_LIMIT) {
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown"
    const { success } = await env.JOIN_LIMIT.limit({ key: ip })
    if (!success) return new Response("Too many attempts", { status: 429 })
  }

  return sessionFor(env, code).fetch(request)
}

function sessionFor(env: Env, code: string): DurableObjectStub<Session> {
  return env.SESSIONS.get(env.SESSIONS.idFromName(code))
}

/** Carries the chosen code to the object without losing the upgrade headers. */
function hostRequest(url: URL, request: Request, code: string): Request {
  const target = new URL(url)
  target.searchParams.set("code", code)
  return new Request(target, request)
}

export class Session extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    return url.pathname === "/host"
      ? this.acceptHost(
          url.searchParams.get("code") ?? "",
          url.searchParams.get("resume") ?? ""
        )
      : this.acceptGuest()
  }

  private async acceptHost(code: string, offered: string): Promise<Response> {
    if (this.socketsFor("host").length > 0)
      return new Response("Session in use", { status: 409 })

    // A session whose host dropped can be reclaimed, but only by that host. The
    // code alone is enough to *join* a session by design; it is deliberately not
    // enough to take one over, which would hand whoever guessed it the guests.
    const token = await this.ctx.storage.get<string>("resume")
    if (token && token !== offered)
      return new Response("Not the host of this session", { status: 403 })

    const resume = token ?? crypto.randomUUID()
    await this.ctx.storage.put("resume", resume)

    // The host is back inside the grace window, so the session is not ending
    // after all.
    await this.ctx.storage.deleteAlarm()

    const { client, server } = this.pair()
    this.ctx.acceptWebSocket(server, ["host"])
    server.serializeAttachment({ role: "host" } satisfies Attachment)

    send(server, { type: "hosting", code, resume })
    return upgraded(client)
  }

  private acceptGuest(): Response {
    if (this.socketsFor("host").length === 0)
      return this.refuse("unknown-code")

    if (this.socketsFor("guest").length >= MAX_GUESTS)
      return this.refuse("session-full")

    const guestId = crypto.randomUUID()
    const { client, server } = this.pair()

    this.ctx.acceptWebSocket(server, ["guest", guestId])
    server.serializeAttachment({ role: "guest", guestId } satisfies Attachment)

    send(server, { type: "joined", guestId })
    for (const host of this.socketsFor("host"))
      send(host, { type: "guest-joined", guestId })

    return upgraded(client)
  }

  /**
   * Turns a refusal into a closed socket rather than an HTTP error, because a
   * WebSocket client cannot read a status code but does get the close frame —
   * so this is the only way the guest learns *why* rather than just "failed".
   */
  private refuse(reason: CloseReason): Response {
    const { client, server } = this.pair()
    server.accept()
    server.close(CLOSE_SESSION_ENDED, reason)
    return upgraded(client)
  }

  webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    if (typeof raw !== "string") return

    const sender = ws.deserializeAttachment() as Attachment | null
    if (!sender) return

    let frame: RelayFrame
    try {
      frame = JSON.parse(raw) as RelayFrame
    } catch {
      return
    }

    if (sender.role === "host") {
      if (frame.type !== "from-host") return

      // No recipient means everyone. A manifest wants that; a file response
      // must not have it, which is the sender's job to get right and the reason
      // `to` is threaded through rather than inferred here.
      const targets = frame.to
        ? this.socketsFor(frame.to)
        : this.socketsFor("guest")

      for (const guest of targets)
        send(guest, { type: "from-host", message: frame.message })

      return
    }

    if (frame.type !== "from-guest") return

    // `from` is stamped here from the socket's own attachment and never read
    // off the wire, so a guest cannot pose as another one.
    for (const host of this.socketsFor("host"))
      send(host, {
        type: "from-guest",
        from: sender.guestId,
        message: frame.message,
      })
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    const leaving = ws.deserializeAttachment() as Attachment | null
    if (!leaving) return

    if (leaving.role === "guest") {
      for (const host of this.socketsFor("host"))
        send(host, { type: "guest-left", guestId: leaving.guestId })
      return
    }

    // Stopping on purpose ends the session now. Anything else might be a tunnel
    // dying mid-sentence, so the session waits to see whether the host returns.
    if (code === CLOSE_INTENTIONAL) {
      await this.endSession("host-stopped")
      return
    }

    await this.ctx.storage.setAlarm(Date.now() + HOST_GRACE_MS)
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws, 0)
  }

  /** The grace window expired. */
  async alarm(): Promise<void> {
    if (this.socketsFor("host").length > 0) return
    await this.endSession("host-left")
  }

  private async endSession(reason: CloseReason): Promise<void> {
    for (const guest of this.socketsFor("guest")) {
      send(guest, { type: "closed", reason })
      guest.close(CLOSE_SESSION_ENDED, reason)
    }

    // Including the resume token: the code is now free for whoever the
    // namespace hands it to next.
    await this.ctx.storage.deleteAll()
  }

  private socketsFor(tag: string): WebSocket[] {
    return this.ctx.getWebSockets(tag)
  }

  private pair(): { client: WebSocket; server: WebSocket } {
    const [client, server] = Object.values(new WebSocketPair())
    return { client, server }
  }
}

function send(ws: WebSocket, frame: RelayFrame): void {
  try {
    ws.send(JSON.stringify(frame))
  } catch {
    // Sending to a socket that has already gone is normal during teardown, and
    // must not stop the rest of the roster from being told.
  }
}

function upgraded(client: WebSocket): Response {
  return new Response(null, { status: 101, webSocket: client })
}
