import { useEffect, useRef, useState } from "react"

import { Check, Copy, Link2, Loader2, Radio, Users } from "lucide-react"

import { formatCode, parseCode, type RemoteState } from "@shared/remote-connect"

import { PanelHeader } from "@/components/panel-header"
import { RailButton } from "@/components/rail"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

import { CodeInput } from "./code-input"
import { RemoteFileList } from "./file-list"
import { ProfilePicker } from "./profile-picker"

/** The rail's dot, and the footer chip, agree on what a session looks like. */
function isLive(remote: RemoteState): boolean {
  return remote.phase === "hosting" || remote.phase === "connected"
}

/**
 * Remote Connect's entry in the rail, and the live dot that goes with it.
 */
export function RemoteRailButton() {
  const remote = useStore((state) => state.remote)

  return (
    <RailButton
      panel="remote"
      label="Remote Connect"
      active="border-remote-border bg-remote-surface text-remote-foreground"
      tone="remote"
      dot={
        <span
          aria-hidden
          className={cn(
            "size-1.5 shrink-0 rounded-full",
            isLive(remote) ? "bg-remote" : "bg-muted-foreground/40"
          )}
        />
      }
    />
  )
}

/**
 * The footer's session indicator.
 *
 * Absent entirely when there is no session, so an unused feature costs the
 * footer nothing. While hosting it names the code until somebody arrives, then
 * gives that slot to the headcount — by then the code has been shared, and how
 * many people are actually in the session is the fact worth carrying. The code
 * stays in the panel, one click away, since it is reusable.
 */
export function RemoteChip() {
  const remote = useStore((state) => state.remote)
  const setPanel = useStore((state) => state.setPanel)

  if (!isLive(remote)) return null

  const label =
    remote.phase === "hosting"
      ? remote.guests === 0
        ? `Hosting · ${formatCode(remote.code)}`
        : `Hosting · ${remote.guests} ${remote.guests === 1 ? "peer" : "peers"}`
      : "Connected"

  return (
    <button
      onClick={() => setPanel("remote")}
      className="flex h-5 shrink-0 items-center gap-1.5 rounded-sm border border-remote-border bg-remote-surface px-1.5 text-[11px] text-remote-foreground"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-remote" />
      <span className="font-mono text-trim">{label}</span>
    </button>
  )
}

export function RemoteConnectPanel() {
  const remote = useStore((state) => state.remote)
  const hostDraft = useStore((state) => state.hostDraft)

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <PanelHeader title="Remote Connect" />

      <div className="min-h-1" />

      {/*
        The picker sits inside `idle`, because the phases belong to the main
        process and it has not been told anything yet — that is the whole point
        of the step. Waiting for a code is a state of the picker rather than a
        view of its own: it lasts a moment, and swapping the panel out for a
        sentence makes a blink of latency look like somewhere you went.
      */}
      {remote.phase === "idle" &&
        (hostDraft !== null ? (
          <Selecting draft={hostDraft} />
        ) : (
          <Idle error={remote.error} />
        ))}

      {remote.phase === "connecting" && <Connecting code={remote.code} />}
      {remote.phase === "hosting" && <Hosting remote={remote} />}
      {remote.phase === "connected" && <Connected code={remote.code} />}
    </div>
  )
}

function Idle({ error }: { error?: string }) {
  const [joining, setJoining] = useState(false)
  const beginHosting = useStore((state) => state.beginHosting)
  const joinSession = useStore((state) => state.joinSession)

  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center gap-5 px-4 pb-8">
      <div className="space-y-1.5 text-center">
        <Link2 className="mx-auto size-6 text-muted-foreground" />
        <p className="text-[13px] font-medium">Not connected</p>
        <p className="text-xs text-muted-foreground">
          Share your profiles with someone else, allowing them to copy over your changes in real time.
        </p>
      </div>

      {error && (
        <p className="rounded-sm border border-border bg-background px-2 py-1.5 text-center text-xs text-muted-foreground">
          {error}
        </p>
      )}

      {joining ? (
        <div className="flex flex-col items-center gap-2">
          <CodeInput
            onComplete={(code) => {
              const parsed = parseCode(code)
              if (parsed) void joinSession(parsed)
            }}
          />
          <Button variant="quiet" size="sm" onClick={() => setJoining(false)}>
            Back
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button onClick={beginHosting}>Host a session</Button>
          <Button variant="outline" onClick={() => setJoining(true)}>
            Connect with a code
          </Button>
        </div>
      )}
    </div>
  )
}

/**
 * Choosing what to share, before there is anything to share it with.
 *
 * This step exists so that the code and the selection cannot be out of order.
 * Minting a code first would mean a window — however short — in which somebody
 * can join a session whose contents are still being decided, and the only ways
 * to close it are to share everything on the way in or to share nothing, which
 * are the two answers the picker exists to avoid having to guess between.
 */
function Selecting({ draft }: { draft: string[] }) {
  const setHostDraft = useStore((state) => state.setHostDraft)
  const startHosting = useStore((state) => state.startHosting)
  const cancelHosting = useStore((state) => state.cancelHosting)
  const hostError = useStore((state) => state.hostError)
  const opening = useStore((state) => state.hostOpening)

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 pb-4">
      <div className="shrink-0 space-y-1 px-4">
        <p className="text-[13px] font-medium">Choose what to share</p>
        <p className="text-xs text-muted-foreground">
          Only these profiles will be visible to whoever joins.
        </p>
      </div>

      {/*
        A failed Start comes back here, above the selection it failed with, so
        the retry is the same button in the same place with the same ticks.
      */}
      {hostError && (
        <p className="mx-4 shrink-0 rounded-sm border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground">
          {hostError}
        </p>
      )}

      {/*
        Inert while the attempt is in flight, because the list has already been
        handed over: a tick landing now would show as chosen and not be in the
        session that arrives a moment later. Disabled rather than hidden, so the
        thing being opened stays legible while it opens.
      */}
      <ProfilePicker
        selected={draft}
        onChange={setHostDraft}
        disabled={opening}
        className="flex-1"
      />

      <div className="flex shrink-0 flex-col gap-2 px-4 pt-1">
        {/*
          Disabled rather than absent, and disabled rather than allowed to open
          an empty session. Zero is a legal place to arrive at later — you can
          untick everything mid-session — but it is not a legal place to start:
          a code that shares nothing is one somebody reads out, types in, and
          gets an empty list from, with nothing on either screen explaining why.
        */}
        <Button
          disabled={draft.length === 0 || opening}
          onClick={() => void startHosting()}
        >
          {opening && <Loader2 className="animate-spin" />}
          {opening ? "Opening a session…" : "Start sharing"}
        </Button>
        {/*
          One way back out, whichever half of the wait you are in: before Start
          it closes the picker, and during it drops the attempt and leaves the
          picker exactly as it was. Both are "not this, then", which is the only
          reading the word has to carry.
        */}
        <Button variant="quiet" size="sm" onClick={() => void cancelHosting()}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function Connecting({ code }: { code: string }) {
  const leaveSession = useStore((state) => state.leaveSession)

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 pb-8">
      <p className="text-[13px]">
        Connecting to <span className="font-mono">{formatCode(code)}</span>…
      </p>
      <Button variant="outline" onClick={() => void leaveSession()}>
        Cancel
      </Button>
    </div>
  )
}

function Hosting({
  remote,
}: {
  remote: Extract<RemoteState, { phase: "hosting" }>
}) {
  const leaveSession = useStore((state) => state.leaveSession)
  const setShared = useStore((state) => state.setShared)

  const shared = remote.shared.length

  /**
   * Null until asked, then whether it worked.
   *
   * Copying happens on the click and not before. Doing it on the way into the
   * session would save a click and cost the explanation: a button you press is
   * a thing you know you did, where a code that was already on the clipboard is
   * something you have to be told about and then believe. The first is legible
   * to someone who has never hosted before; the second only reads as helpful
   * once you already knew it was going to happen.
   */
  const [copied, setCopied] = useState<boolean | null>(null)
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(settle.current), [])

  const copy = () => {
    void navigator.clipboard
      .writeText(remote.code)
      .then(
        () => setCopied(true),
        () => setCopied(false)
      )
      .finally(() => {
        // The confirmation expires rather than standing as a claim about the
        // present: a clipboard is one Ctrl+C in another window away from no
        // longer holding this, and a label still saying so would be lying.
        clearTimeout(settle.current)
        settle.current = setTimeout(() => setCopied(null), 2000)
      })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 pb-4">
      <div className="mx-4 shrink-0 space-y-2 rounded-sm border border-remote-border bg-remote-surface p-3 text-center">
        <p className="text-[11.5px] text-remote-foreground">Share this code</p>

        <div className="flex items-center justify-center gap-2">
          <span className="font-mono text-xl tracking-widest text-foreground select-all">
            {formatCode(remote.code)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            tone="remote"
            onClick={copy}
            aria-label="Copy the invite code"
          >
            {copied ? <Check className="text-remote" /> : <Copy />}
          </Button>
        </div>

        {/*
          A fixed line rather than one that appears, so confirming the copy does
          not shove the rest of the panel down a row on the way in.
        */}
        <p
          aria-live="polite"
          className={cn(
            "text-[11px]",
            copied ? "text-remote" : "text-muted-foreground"
          )}
        >
          {copied === null
            ? "Copy it and send it to whoever is joining"
            : copied
              ? "Copied to your clipboard"
              : "Could not reach the clipboard — select the code and copy it"}
        </p>
      </div>

      {/*
        What is exposed, in words, on screen the whole time. Hosting hands a
        folder to whoever has the code, and that is not something to leave
        implied by the fact that a panel is open.
      */}
      <dl className="mx-4 shrink-0 space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <Radio className="size-3.5 shrink-0 text-muted-foreground" />
          <dt className="text-muted-foreground">Sharing</dt>
          <dd className="ml-auto tabular-nums">
            {shared} {shared === 1 ? "profile" : "profiles"}
          </dd>
        </div>

        <div className="flex items-center gap-2">
          <Users className="size-3.5 shrink-0 text-muted-foreground" />
          <dt className="text-muted-foreground">Connected</dt>
          <dd className="ml-auto tabular-nums">
            {remote.guests} {remote.guests === 1 ? "peer" : "peers"}
          </dd>
        </div>
      </dl>

      {/*
        The same list you chose from, still live.

        Kept rather than closed behind an Edit button because changing what is
        shared is not an exceptional act — "now look at my 747" is most of what
        a session is for — and because a list that is *visible* is the only
        version of this that keeps answering the question it was opened to ask.
        Folded away, "what am I sharing?" becomes a thing you have to go and
        check, which is the state of affairs this whole feature replaces.
      */}
      <ProfilePicker
        selected={remote.shared}
        onChange={(paths) => void setShared(paths)}
        className="flex-1 border-t border-border pt-2"
      />

      <Button
        variant="outline"
        className="mx-4 shrink-0"
        onClick={() => void leaveSession()}
      >
        Stop sharing
      </Button>
    </div>
  )
}

function Connected({ code }: { code: string }) {
  const leaveSession = useStore((state) => state.leaveSession)

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <span
          className="size-1.5 shrink-0 rounded-full bg-remote"
          aria-hidden
        />
        <span className="text-xs text-muted-foreground">
          Connected to <span className="font-mono">{formatCode(code)}</span>
        </span>
        <Button
          variant="quiet"
          size="xs"
          tone="remote"
          className="ml-auto"
          onClick={() => void leaveSession()}
        >
          Disconnect
        </Button>
      </div>

      <RemoteFileList />
    </>
  )
}
