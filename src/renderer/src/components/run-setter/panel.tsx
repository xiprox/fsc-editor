import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useVarValue } from "@/lib/use-var-value"
import { cn } from "@/lib/utils"
import type { RunnableEntry } from "@/lib/run-entries"
import {
  setterInputs,
  type RunResult,
  type SetterPreview,
} from "@shared/setter"

/**
 * The run popover: type a value, run it, watch the line above.
 *
 * It deliberately does **not** close on Run. The `get:` line's live value sits
 * directly above this panel — that is what the widget's placement guarantees —
 * so running and watching happen without moving your eyes or your hands, and
 * the next attempt is a new number and Enter. Closing would turn a loop into a
 * series of round trips to a button.
 *
 * Two things follow from staying open. Failures have somewhere to land, which
 * they would not if the panel vanished on click; and focus returns to the first
 * field afterwards, so Enter-Enter-Enter is the gesture.
 *
 * ## It shows only what the setter reads
 *
 * `setterInputs` decides, and the effect is that the common case is nearly
 * empty: an `L:` switch with no `set:` is one field and a button, with no
 * preview — because the code a preview would show is `<value> (>L:Foo, Number)`
 * and every part of that is on the line that was clicked. A ternary on
 * `current` gets both fields and the preview. Nothing that is doing work is
 * hidden.
 */

interface Props {
  entry: RunnableEntry
  onClose: () => void
  /** Called after every render that can change the height. See `widget.tsx`. */
  onResize: () => void
}

/** A field's text as the engine should see it — a number when it is one. */
function bind(text: string): number | string {
  const trimmed = text.trim()
  if (!trimmed) return 0

  const asNumber = Number(trimmed)

  return Number.isFinite(asNumber) ? asNumber : trimmed
}

export function RunSetterPanel({ entry, onClose, onResize }: Props) {
  const live = useVarValue(entry.entry.name)
  const inputs = useMemo(() => setterInputs(entry.entry), [entry.entry])

  const [value, setValue] = useState("")
  /*
   * `current` follows the simulator until somebody types, and then it is
   * theirs.
   *
   * Derived rather than stored so there is no effect writing state: while it is
   * untouched the field simply *is* the live value, which is what a run should
   * bind if nobody said otherwise. The moment it is typed into, it freezes — a
   * typed `current` is a deliberate answer to a divergence between our raw read
   * and FS Copilot's converted one, and the aircraft moving underneath it must
   * not undo that.
   */
  const [typed, setTyped] = useState<string | null>(null)
  const current = typed ?? String(live ?? 0)

  const [preview, setPreview] = useState<SetterPreview | null>(null)
  const [picks, setPicks] = useState<number[] | null>(null)
  /**
   * False once this variable has proved to have too many values to list.
   *
   * `picksIn` answers null above its threshold, and a variable that is
   * continuous stays continuous — so that answer is taken as final rather than
   * asked again every time the number moves, which for a gauge is fifteen times
   * a second.
   */
  const [listable, setListable] = useState(true)
  const [result, setResult] = useState<RunResult | null>(null)
  const [running, setRunning] = useState(false)

  /** Whichever control comes first — what opening this focuses, and Run returns to. */
  const first = useRef<HTMLElement | null>(null)
  const field = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    // After the paint that placed the widget: the click that opened it is still
    // settling, and Monaco takes its focus back if this races it.
    const frame = requestAnimationFrame(() => first.current?.focus())

    return () => cancelAnimationFrame(frame)
  }, [])

  /**
   * The picks follow the variable, rather than being read once and kept.
   *
   * The loop this panel exists for is: run it, watch the value move. So the
   * first thing anybody does is give the variable a value it has never had —
   * and a list of "values seen" that cannot show the one you just set is a list
   * that goes stale exactly when it is being used. It refreshes whether the
   * value moved because of a run or because somebody flipped the switch in the
   * cockpit; both are the same fact.
   *
   * Asked again only when `live` lands on a number this list does not already
   * hold, and never once `listable` has gone false, so a moving variable costs
   * one round trip rather than fifteen a second. The ring buffer behind
   * `setterPicks` is fed by the same stream as `live`, so by the time the value
   * reaches here it is already in the answer.
   */
  const askedFor = useRef<number | undefined>(undefined)
  const asked = useRef(false)

  useEffect(() => {
    if (!inputs.value || !listable) return
    if (asked.current && askedFor.current === live) return

    asked.current = true
    askedFor.current = live

    let showing = true
    void window.api.setterPicks(entry.entry.name).then((found) => {
      if (!showing) return

      setPicks(found)
      if (found === null) setListable(false)
    })

    return () => {
      showing = false
    }
  }, [entry.entry.name, inputs.value, listable, live])

  // The preview follows every keystroke. It costs one IPC round trip and no
  // simulator at all, and where it is shown it is the only thing standing
  // between a click and an arbitrary calculator expression — which is why there
  // is no confirmation step anywhere in this feature.
  useEffect(() => {
    let showing = true
    const bindings = { value: bind(value), current: bind(current) }

    void window.api.previewSetter(entry.entry, bindings).then((next) => {
      if (showing) setPreview(next)
    })

    return () => {
      showing = false
    }
  }, [entry.entry, value, current])

  // Anything that changes what is drawn can change how tall it is, and the
  // widget has to know: it reserved room in the editor for a given height.
  useEffect(onResize, [onResize, preview, picks, result, running])

  /**
   * `override` is for the pick buttons, which set the field and run in the same
   * gesture. A double-click cannot wait for `setValue` to come back round as a
   * render — the state this closure can see is still the old one — so the value
   * that was clicked is passed down rather than read back out.
   */
  const run = useCallback(
    async (override?: string) => {
      if (running) return

      setRunning(true)
      setResult(null)

      const bindings = {
        value: bind(override ?? value),
        current: bind(current),
      }
      const outcome = await window.api.runSetter(entry.entry, bindings)

      setRunning(false)
      setResult(outcome)
      // Straight back to where the typing happens, because the next thing
      // anybody does here is try another number.
      first.current?.focus()
    },
    [current, entry.entry, running, value]
  )

  const onEnter = (event: React.KeyboardEvent): void => {
    if (event.key === "Enter") void run()
  }

  const failed = preview?.ok === false ? preview.reason : null
  const code = preview?.ok ? preview.code : null
  const refused = result?.ok === false ? result.reason : null
  const revert = result?.ok ? result.revert : null

  // Shown when it was asked for, and always when resolving failed: a setter
  // that will not resolve has to be able to say so even where the code itself
  // was not worth showing.
  const showPreview = inputs.preview || failed !== null

  return (
    <div
      className="w-96 rounded-lg bg-popover p-4 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      {/* The app's dialog treatment — `font-heading` title over a relaxed
          muted line — because this is the same kind of surface and two of them
          drifting apart is what reads as sloppiness. */}
      <header className="flex flex-col gap-1">
        <h2 className="font-heading text-sm font-medium">Run setter</h2>
        <p className="text-xs/relaxed text-muted-foreground">
          Enter a value and test your setter function live in the sim.
        </p>
      </header>

      {/* One grid for every row, so the labels form a column and the controls
          line up under each other whichever rows this setter happens to need.
          Picks and the code block take the control column on a row of their
          own rather than crowding the field they belong to. */}
      <div className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
        {inputs.value && (
          <>
            <label
              className="text-xs text-muted-foreground"
              htmlFor="run-value"
            >
              value
            </label>
            <Input
              id="run-value"
              ref={(node) => {
                field.current = node
                first.current = node
              }}
              className="w-28 font-mono"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={onEnter}
            />

            {/* The `get:` variable's observed values, not the write target's:
                `value` is the input to the expression, and a transforming
                setter writes something else entirely. Absent for anything
                continuous — see `picksIn`. */}
            {picks && (
              <div className="col-start-2 flex flex-wrap gap-1">
                {picks.map((pick) => (
                  <Button
                    key={pick}
                    size="sm"
                    variant="outline"
                    tone="sim"
                    className="font-mono"
                    onClick={() => {
                      setValue(String(pick))
                      field.current?.focus()
                    }}
                    /* Fill it in and run it, in one gesture. The single click
                       has already happened by the time this fires, so the
                       field is filled either way; what the second click adds
                       is the Run. The value goes to `run` directly rather
                       than through the field — see the note on `override`. */
                    onDoubleClick={() => {
                      setValue(String(pick))
                      void run(String(pick))
                    }}
                  >
                    {pick}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}

        {inputs.current && (
          <>
            <label
              className="text-xs text-muted-foreground"
              htmlFor="run-current"
            >
              current
            </label>
            <Input
              id="run-current"
              ref={(node) => {
                if (!inputs.value) first.current = node
              }}
              className="w-28 font-mono"
              value={current}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={onEnter}
            />
          </>
        )}

        {showPreview && (
          <>
            <span className="self-start pt-1 text-xs text-muted-foreground">
              code
            </span>
            {/* Load-bearing, not decoration: this is the whole of the
                mitigation for running arbitrary calculator code, and it catches
                a wrong multiplier or a typo'd target without touching the
                simulator. `scrollbar-overlay` is the app's own scrollbar — a
                Windows system bar inside a popover looks like a bug. */}
            <pre
              className={cn(
                "scrollbar-overlay overflow-x-auto rounded-md bg-muted/50 px-2 py-1 font-mono text-xs",
                failed && "text-destructive"
              )}
            >
              {failed ?? code ?? " "}
            </pre>
          </>
        )}
      </div>

      {/* Nothing to say most of the time. The value being watched is on the
          line above, which needs no caption — only the two things the editor
          cannot show get a line here. */}
      {(refused || revert) && (
        <p className="mt-4 text-xs/relaxed">
          {refused ? (
            <span className="text-destructive">Failed — {refused}</span>
          ) : (
            /* The one thing the live value above cannot tell you: it went, and
               the aircraft put it back. Binding this variable will desync. */
            <span className="text-[color:var(--tone-foreground)] tone-warning">
              Reverted to {revert?.back} after {revert?.afterMs} ms — the
              aircraft owns this variable and will fight a binding.
            </span>
          )}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          ref={(node) => {
            if (!inputs.value && !inputs.current) first.current = node
          }}
          tone="sim"
          disabled={running || preview?.ok !== true}
          onClick={() => void run()}
        >
          {running ? "Running…" : "Run"}
        </Button>
      </div>
    </div>
  )
}
