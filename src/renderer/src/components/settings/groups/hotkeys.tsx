import { useEffect, useState } from "react"

import { RotateCcw } from "lucide-react"

import {
  DEFAULT_HOTKEYS,
  MARK_BEFORE_MS,
  type HotkeyAction,
} from "@shared/activity"
import type { Hotkeys as Bindings } from "@shared/types"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const ACTIONS: {
  action: HotkeyAction
  label: string
  description: string
}[] = [
  {
    action: "capture",
    label: "Capture",
    description: `Capture the past ${MARK_BEFORE_MS / 1000} seconds of simulator events.`,
  },
  {
    action: "arm",
    label: "Arm auto-capture",
    description: "Switch auto-capture back on for the next interaction.",
  },
]

/**
 * The Radar hotkeys, bound by pressing them.
 *
 * Typing an accelerator means knowing that Electron spells it
 * `CommandOrControl+Alt+S`, which is a thing nobody should have to learn to
 * change a shortcut. So the control records instead: click it, and it shows
 * the modifiers under your fingers as you hold them — the combination builds
 * on screen the way it builds in your hand — and commits on the first
 * non-modifier key. Esc backs out, and a bare letter is refused with the
 * reason rather than bound, because a global hotkey on `S` alone would fire
 * in the middle of typing anywhere on the machine.
 *
 * Controlled (`hotkeys`/`onChange`) because the Radar panel already owns a
 * copy for its tooltip and empty state; Settings wraps it in
 * `HotkeysSettings`, which owns one of its own.
 */
export function HotkeysGroup({
  hotkeys,
  onChange,
}: {
  hotkeys: Bindings | null
  onChange: (next: Bindings) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      {ACTIONS.map((entry) => (
        <BindingRow
          key={entry.action}
          {...entry}
          binding={hotkeys?.[entry.action]}
          onChange={onChange}
        />
      ))}

      {/*
        The one thing the keys cannot promise, stated rather than discovered:
        `globalShortcut` only sees clashes with other applications'
        `RegisterHotKey` bindings, and MSFS reads its own through raw input.
        08-marks asks for this in as many words.
      */}
      <p className="text-[11px] text-muted-foreground">
        These are global — they work while MSFS has focus, which is the point of
        them. Windows cannot see the simulator&rsquo;s own bindings, so a key
        the simulator uses will do both things.
      </p>
    </div>
  )
}

/** The Settings dialog's copy: same group, owning its own fetch. */
export function HotkeysSettings() {
  const [hotkeys, setHotkeys] = useState<Bindings | null>(null)

  useEffect(() => {
    void window.api.markHotkey().then(setHotkeys)
  }, [])

  return <HotkeysGroup hotkeys={hotkeys} onChange={setHotkeys} />
}

/**
 * The focused container — what the Radar header's keyboard icon opens. Same
 * body as Settings, in a dialog small enough to leave the panel visible.
 */
export function HotkeysDialog({
  open,
  onOpenChange,
  hotkeys,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  hotkeys: Bindings | null
  onChange: (next: Bindings) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Radar hotkeys</DialogTitle>
          <DialogDescription>
            Click a binding and press the combination you want.
          </DialogDescription>
        </DialogHeader>

        <HotkeysGroup hotkeys={hotkeys} onChange={onChange} />
      </DialogContent>
    </Dialog>
  )
}

const MODIFIER_KEYS = ["Control", "Alt", "Shift", "Meta"]

/** `event.key` values whose Electron accelerator spelling differs. */
const KEY_NAMES: Record<string, string> = {
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  " ": "Space",
  "+": "Plus",
}

/** A key safe to bind globally without a modifier: the function keys. */
function standsAlone(key: string): boolean {
  return /^F\d{1,2}$/.test(key)
}

/** The modifiers an event is holding, in the order the caps render. */
function heldModifiers(event: React.KeyboardEvent): string[] {
  return [
    event.ctrlKey || event.metaKey ? "Ctrl" : "",
    event.altKey ? "Alt" : "",
    event.shiftKey ? "Shift" : "",
  ].filter(Boolean)
}

function BindingRow({
  action,
  label,
  description,
  binding,
  onChange,
}: {
  action: HotkeyAction
  label: string
  description: string
  binding: { accelerator: string; ok: boolean } | undefined
  onChange: (next: Bindings) => void
}) {
  const [listening, setListening] = useState(false)
  /** Modifiers currently held, mirrored live into the control. */
  const [held, setHeld] = useState<string[]>([])
  /** Why the last press did not bind, shown until the next one. */
  const [hint, setHint] = useState<string | null>(null)

  const refused = binding !== undefined && !binding.ok
  const custom =
    binding !== undefined && binding.accelerator !== DEFAULT_HOTKEYS[action]

  const stop = (): void => {
    setListening(false)
    setHeld([])
  }

  const commit = async (accelerator: string): Promise<void> => {
    stop()
    setHint(null)
    onChange(await window.api.bindMarkHotkey(action, accelerator))
  }

  const keyDown = (event: React.KeyboardEvent): void => {
    if (!listening) return

    event.preventDefault()
    // The dialog must not see this Esc — it is the recorder's cancel, not a
    // request to close anything.
    event.stopPropagation()

    if (event.key === "Escape") {
      stop()
      return
    }

    // A bare modifier is half a combination — mirror it and keep listening.
    if (MODIFIER_KEYS.includes(event.key)) {
      setHeld(heldModifiers(event))
      return
    }

    const key =
      KEY_NAMES[event.key] ??
      (event.key.length === 1 ? event.key.toUpperCase() : event.key)

    const modifiers = [
      event.ctrlKey || event.metaKey ? "CommandOrControl" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
    ].filter(Boolean)

    if (modifiers.length === 0 && !standsAlone(key)) {
      setHint("Hold Ctrl, Alt or Shift with it — a bare key would fire while typing anywhere on this PC.")
      return
    }

    void commit([...modifiers, key].join("+"))
  }

  const keyUp = (event: React.KeyboardEvent): void => {
    if (!listening) return
    setHeld(heldModifiers(event))
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex min-w-0 flex-col">
        <span className="text-xs/relaxed">{label}</span>
        <span className="text-[11px] text-muted-foreground">{description}</span>

        {refused && !listening && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            Windows refused this — another application already holds it.
          </span>
        )}

        {hint && listening && (
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            {hint}
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {/*
          Reset appears only when there is something to reset to, and never
          while recording — two affordances during a capture is one too many.
        */}
        {custom && !listening && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Reset ${label} to default`}
            title={`Reset to default`}
            onClick={() => void commit(DEFAULT_HOTKEYS[action])}
          >
            <RotateCcw />
          </Button>
        )}

        <Button
          variant="outline"
          size="sm"
          className={cn(
            "min-w-44 justify-center",
            listening &&
              "border-radar-border bg-radar-surface text-radar-foreground"
          )}
          onClick={() => (listening ? stop() : setListening(true))}
          onBlur={() => {
            stop()
            setHint(null)
          }}
          onKeyDown={keyDown}
          onKeyUp={keyUp}
        >
          {listening ? (
            held.length > 0 ? (
              <Caps parts={[...held, "…"]} />
            ) : (
              "Press a combination…"
            )
          ) : binding ? (
            <span className={cn(refused && "text-amber-600 dark:text-amber-400")}>
              <Keys accelerator={binding.accelerator} />
            </span>
          ) : (
            "…"
          )}
        </Button>
      </div>
    </div>
  )
}

/**
 * A row of keycaps, for combinations that are still half-pressed — the
 * recorder renders `Ctrl` `Alt` `…`, which no accelerator spells.
 */
function Caps({ parts }: { parts: string[] }) {
  return (
    // `inline-flex`, so the same component can sit inside a sentence in the
    // Radar empty state without ending the line it is in the middle of.
    <span className="inline-flex items-center gap-0.5 align-middle">
      {parts.map((key) => (
        <kbd
          key={key}
          className="rounded-[3px] bg-foreground/10 px-1 py-px font-mono text-[10px] leading-tight"
        >
          {key}
        </kbd>
      ))}
    </span>
  )
}

/**
 * One accelerator as the keys you actually press.
 *
 * A run-together `Ctrl+Alt+S` is read as a word before it is read as a
 * combination. Split into caps, the shape of the thing your hand has to do is
 * visible without parsing anything.
 *
 * Exported because the Radar empty state teaches the same binding, and two
 * renderings of one keystroke is one of them being wrong eventually.
 */
export function Keys({ accelerator }: { accelerator: string }) {
  return <Caps parts={pretty(accelerator).split("+")} />
}

/** `CommandOrControl+Alt+S` is Electron's spelling, not a person's. */
function pretty(accelerator: string): string {
  return accelerator.replace("CommandOrControl", "Ctrl")
}
