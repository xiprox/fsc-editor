import { useEffect, useState, useSyncExternalStore } from "react"

import type { RawEntry } from "@shared/profile"
import type { Trace, TraceStep } from "@shared/trace"
import { OUTCOME_ID } from "@shared/trace"

import { BottomRailButton } from "@/components/rail"
import { PanelHeader } from "@/components/panel-header"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { caretNow, onDidChangeCaret } from "@/lib/caret"
import { editingEditor } from "@/lib/editor-bridge"
import {
  bindingsFor,
  entryAt,
  traceFor,
  type TracedEntry,
} from "@/lib/entry-trace"
import { existingModel } from "@/lib/monaco-setup"
import { simValue } from "@/lib/sim-values"
import {
  paintDetail,
  scopePaint,
  TERM_DOC,
  TYPE_DOC,
} from "@/lib/trace-paint"
import { cn } from "@/lib/utils"

/**
 * The entry trace: what FS Copilot will do with the entry under the caret.
 *
 * Plan §3, and docs/help/trace-panel.md for the design. Every line here is
 * computed by `@shared/trace` from FS Copilot's own source; none of it is
 * authored per-entry. The panel's whole job is to say which entry, supply two
 * values, and lay the steps out.
 *
 * **Two halves, side by side.** The bottom slot is wide and short, which is
 * the shape this wants: a send side of four or five steps and an apply side
 * of six to nine, neither of which is worth scrolling for on its own. Stacked
 * they would be, and the reader would lose the symmetry — the point of the
 * two columns is that an entry is a thing with two directions.
 *
 * **One binding per column, and that is the point rather than a convenience.**
 * The model takes two. `current` is the value here and belongs over the half
 * about changes here; `value` is the one that arrives. Typing in the right
 * field and watching `builds` change is the panel teaching the binding rather
 * than asserting it.
 *
 * **A step is never removed, only marked.** Typing a value that closes the
 * toggle guard greys the rows below it rather than deleting them, because the
 * field being typed into sits directly above and `docs/ui.md` says a state
 * change may not reflow the row it is in. The model does that part — it
 * returns the whole path and marks what did not happen.
 */
export function TraceRailButton() {
  return <BottomRailButton panel="trace" label="Trace" />
}

/**
 * The entry the caret is in.
 *
 * The caret, not the store's `activeLine` — that one drives the sidebar
 * highlight and follows the viewport once the caret is off screen, so a panel
 * built on it would trace an entry you are not in.
 */
function useTracedEntry(): { traced: TracedEntry | null; path: string | null } {
  const caret = useSyncExternalStore((listener) => {
    const subscription = onDidChangeCaret(listener)
    return () => subscription.dispose()
  }, caretNow)

  const path = caret?.path ?? null

  /*
   * The entry depends on the caret **and on the text**, so both have to be
   * subscribed to.
   *
   * `Caret` is `{ path, line }` and `setCaret` returns early when neither has
   * changed — which is right for what it is, and meant that typing inside an
   * entry moved nothing the panel was listening to. Editing a `set:` line
   * left the trace describing the line as it had been when the caret last
   * crossed a line boundary, and the reader had to nudge the cursor to see
   * their own edit. That is the opposite of what this panel is for: the point
   * of the two fields is to type and watch the path change.
   *
   * The version id rather than the text, because that is what
   * `useSyncExternalStore` wants — a value that is cheap to read and equal to
   * itself until something happens. Re-reading the whole buffer on every
   * render to compare it would cost more than the scan it guards.
   *
   * `entryAt` then runs per keystroke, which is what the effect in `Traced`
   * already assumed: it depends on the five fields rather than on the entry
   * object precisely so that a scan producing an identical entry sends no IPC.
   */
  useSyncExternalStore(
    (listener) => {
      const model = path ? existingModel(path) : null
      if (!model) return () => {}

      const subscription = model.onDidChangeContent(listener)
      return () => subscription.dispose()
    },
    () => (path ? (existingModel(path)?.getVersionId() ?? 0) : 0)
  )

  const model = path ? existingModel(path) : null
  const text = model?.getValue() ?? null

  return { traced: text && caret ? entryAt(text, caret.line) : null, path }
}

export function TracePanel() {
  const { traced, path } = useTracedEntry()

  if (!path)
    return (
      <Shell>
        <Empty>No file open.</Empty>
      </Shell>
    )

  if (!traced)
    return (
      <Shell>
        <Empty>Put the caret in an entry to trace it.</Empty>
      </Shell>
    )

  const { at } = traced.entry

  /*
   * The entry's identity, and the `key` that resets the two fields.
   *
   * Typing 50 into `value` to see what a throttle does, then moving the caret
   * to a landing light, should not leave 50 sitting in the field: the number
   * was about the entry that is no longer on screen, and the panel would be
   * answering a question nobody asked. Remounting is the reset — it clears the
   * fields and the trace together, so a stale trace cannot be drawn under a
   * fresh locator either.
   *
   * Keyed on the name rather than the line, so that editing text *above* an
   * entry — which moves every line number below it — does not throw away what
   * was typed. The block is in it because one name can appear in both.
   */
  const key = `${path}\n${traced.entry.block}\n${traced.entry.name}`

  return (
    <Shell
      locator={
        <Locator
          block={traced.entry.block}
          from={at.get}
          to={at.end}
          onReveal={() => reveal(at.get, at.end)}
        />
      }
    >
      <Traced key={key} entry={traced.entry} />
    </Shell>
  )
}

/** One entry's two halves, and the two values they are traced with. */
function Traced({ entry }: { entry: RawEntry }) {
  const [typedValue, setTypedValue] = useState("1")
  /** Empty means "follow the simulator", which is the ordinary state. */
  const [typedCurrent, setTypedCurrent] = useState("")
  const [trace, setTrace] = useState<Trace | null>(null)

  /*
   * The five fields the trace depends on, as separate values rather than as
   * the entry object. `entryAt` rebuilds that object on every keystroke in the
   * file, so depending on it would send an IPC per character typed anywhere —
   * including in a comment three entries away.
   */
  const { block, name, units, set, skp } = entry

  const reading = simValue(name)
  const live = reading?.value ?? null

  /*
   * Building the setter is a round trip to main, so an answer can arrive after
   * the question has changed — a fast caret, or a held-down digit. `fresh`
   * drops a stale answer rather than letting it overwrite a newer one.
   *
   * An answer for a *different* entry cannot arrive at all: the caret moving
   * to one remounts this component, so the effect's cleanup has already run.
   */
  useEffect(() => {
    let fresh = true
    void traceFor(
      {
        block,
        name,
        units,
        ...(set !== undefined ? { set } : {}),
        ...(skp ? { skp } : {}),
      },
      bindingsFor(name, typedValue, typedCurrent)
    ).then((next) => {
      if (fresh) setTrace(next)
    })

    return () => {
      fresh = false
    }
  }, [block, name, units, set, skp, typedValue, typedCurrent, live])

  return (
    <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto border-t py-3.5">
      {/*
        The divider is its own 1px column rather than a border on either
        section, so neither half owns it and the two are the same width.
      */}
      <div className="grid grid-cols-[1fr_1px_1fr]">
        <Half
          title="When it changes here"
          binding="current"
          steps={trace?.send}
          typed={typedCurrent}
          onType={setTypedCurrent}
          live={typedCurrent.trim() === "" && live !== null ? live : null}
        />
        <div className="bg-border" />
        <Half
          title="When a value arrives"
          binding="value"
          steps={trace?.apply}
          typed={typedValue}
          onType={setTypedValue}
          live={null}
        />
      </div>
    </div>
  )
}

function Shell({
  children,
  locator,
}: {
  children: React.ReactNode
  locator?: React.ReactNode
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <PanelHeader title="Trace" after={locator} />
      {children}
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
      {children}
    </div>
  )
}

/**
 * Which entry is being traced, and where it is.
 *
 * Wears the title bar's FS Copilot island treatment — filled, no border —
 * because it is the same kind of thing: a quiet label that says which file
 * the app is talking about. The block name keeps its own syntax colour, so
 * `master` here is the same `master` as the one in the file rather than a
 * word that happens to match.
 *
 * It replaces an entry-name row that sat under the header. The name is
 * already the subject of both first steps, and the row cost more than it
 * carried.
 */
function Locator({
  block,
  from,
  to,
  onReveal,
}: {
  block: string
  from: number
  to: number
  onReveal: () => void
}) {
  return (
    <button
      type="button"
      onClick={onReveal}
      className="flex h-5 items-center gap-1 rounded-sm bg-fsc-island px-2 font-editor text-[10.5px] text-fsc-label hover:text-foreground"
    >
      <span {...scopePaint("yaml.block")}>{block}</span>
      <span>· {from === to ? `line ${from}` : `lines ${from}–${to}`}</span>
    </button>
  )
}

/** One direction: its heading, its binding, and its timeline. */
function Half({
  title,
  binding,
  steps,
  typed,
  onType,
  live,
}: {
  title: string
  binding: "value" | "current"
  steps: TraceStep[] | undefined
  typed: string
  onType: (next: string) => void
  /** The simulator's reading, when that is what the field is showing. */
  live: number | null
}) {
  return (
    <section className="min-w-0 px-3.5">
      <header className="flex items-center gap-2 pb-3.5 text-[10.5px] font-medium tracking-[0.06em] text-muted-foreground uppercase">
        {title}
        <span className="ml-auto flex items-center gap-[7px] tracking-normal normal-case">
          {/*
            The label is the binding's name, in the colour those two
            identifiers have inside a `set:` expression — so the field is
            visibly the thing the code refers to.
          */}
          <BindingName binding={binding} />
          <Field
            value={live !== null ? String(live) : typed}
            onChange={onType}
            live={live !== null}
            label={
              binding === "value"
                ? "The value arriving from the other pilot"
                : "The value this entry reads here"
            }
          />
        </span>
      </header>

      <ol className="min-w-0">
        {(steps ?? []).map((step, index, all) => (
          <Row
            key={step.id}
            step={step}
            above={index === 0 ? null : STATE[all[index - 1]!.state].rail}
          />
        ))}
      </ol>
    </section>
  )
}

/**
 * The binding's name, in the colour it has inside a `set:` expression.
 *
 * Its own component only so the paint is applied in one place — `style` and
 * `className` come as a pair and splitting them at a call site is how one of
 * them gets dropped.
 */
function BindingName({ binding }: { binding: string }) {
  const { className, style } = scopePaint("js.injected")

  return (
    <span style={style} className={cn("font-editor text-[11px]", className)}>
      {binding}
    </span>
  )
}

/**
 * A binding's value, live or typed.
 *
 * Wide enough for `16256` and `1013.25`, which the slot has room for. While
 * the simulator is supplying it the text is in `--sim-value` with a lamp of
 * the same colour inside the right edge; typing overrides, the text returns
 * to the foreground and the lamp goes out. Clearing the field goes back to
 * live. That replaces a pair of `now …` / `current unknown` readouts, which
 * said the same thing further away from the value they were about.
 *
 * Not the shared `Input`: that one is 28px tall with its own padding, and
 * this sits inside a 36px-ish heading row where the extra six pixels push the
 * timeline down. Same tokens, one size down.
 */
function Field({
  value,
  onChange,
  live,
  label,
}: {
  value: string
  onChange: (next: string) => void
  live: boolean
  label: string
}) {
  return (
    <span className="relative inline-flex items-center">
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        className={cn(
          "h-[22px] w-28 rounded-sm border control-states border-input bg-input/20 px-[7px] font-editor text-[11px] outline-none dark:bg-input/30",
          live ? "pr-5 text-[var(--sim-value)]" : "text-foreground"
        )}
      />
      {live && (
        <span className="pointer-events-none absolute right-[7px] size-[5px] rounded-full bg-[var(--sim-value)]" />
      )}
    </span>
  )
}

/**
 * How each state draws, and what it deliberately does not draw.
 *
 * **Failure never recolours the detail.** The detail is syntax-coloured, and
 * a destructive red laid over eleven syntax hues fights all of them. The
 * timeline says *where* and the words say *what*, which is also why `failed`
 * is not dimmed — it is the answer the reader came for.
 *
 * **`skipped` mutes its syntax colours too.** A step that did not happen
 * showing a live-looking variable name reads as something that did.
 *
 * **`unknown` reads exactly like `ok`** apart from the hollow node, which is
 * deliberate rather than an oversight. Its steps depend on something the
 * editor cannot see — whether you are the pilot in control, whether a skip
 * counter is standing — and every one of them already says so in words:
 * *only while…*, *unless…*, *never probed*.
 */
const STATE: Record<
  TraceStep["state"],
  { node: string; rail: string; label: string; text?: string }
> = {
  /*
   * **The ordinary node is quieter than the text it sits beside.**
   *
   * It was `bg-muted-foreground` flat — the same value as `--muted-foreground`
   * is for the label, so every ordinary dot was exactly as loud as the words,
   * and a column of eight of them competed with the sentence a reader is
   * there to read. Most rows are `ok`; the ones worth looking at are the
   * failures and the ending, and they can only stand out if the rest stands
   * down. An opacity on the token rather than a new colour, the same way
   * `bg-input/20` does it.
   */
  ok: {
    node: "bg-muted-foreground/70",
    rail: "bg-muted-foreground/25",
    label: "text-muted-foreground",
  },
  failed: {
    /*
     * 2px, not 3. At 3 the ring spanned −0.5 to 12.5 inside a 12px column,
     * so it bled into the label's gutter; at 2 it fits with half a pixel to
     * spare. docs/ui.md wants 2px rings anyway — 3 reads blurry at this
     * density — so the fix and the system agree.
     */
    node: "bg-destructive shadow-[0_0_0_2px_var(--destructive-surface)]",
    rail: "bg-destructive-border",
    label: "text-destructive",
  },
  skipped: {
    /*
     * The faintest of the four, and the whole row agrees with it: muted text
     * and a dashed rail. A step that did not happen should recede.
     */
    node: "border border-muted-foreground/30 bg-sidebar",
    /*
     * Dashed, as a rail that carried nothing — but on the same
     * `--muted-foreground` family as the other three, not on `--border`.
     *
     * `--border` is 10% white in dark, and a dash only paints two fifths of
     * the line, so the coloured segments came to about 4%: not faint, absent.
     * With a transparent segment landing just above the node's top edge the
     * thread appeared to **stop a few pixels short of the circle**, which
     * reads as a broken rail rather than as a dashed one.
     *
     * 40% inside the dash, so the perceived weight is around 16% against the
     * `ok` rail's 25% — still the faintest of the four, which is right for a
     * step that did not happen, but present.
     *
     * **3 on, 2 off — and the rhythm is arithmetic, not taste.** Every
     * position in this gutter is fixed, so the dash's phase against a node is
     * too: a segment above a node starts at the row's top, the 7px node's top
     * edge is at 5.5 and the 11px outcome's at 3.5. At 2 on / 3 off the bands
     * fell 0–2 on, 2–5 off, which put a **3px void against the 7px node's
     * edge** — the thread stopping short of the circle it arrives at, which
     * is what this looked like twice. At 3 on / 2 off they fall 0–3 on, 3–5
     * off, 5–5.5 on: ink touches the 7px node, and the 11px one is left a
     * 0.5px hair. Changing the period would reopen it, so check the
     * arithmetic rather than the look if this is ever tuned.
     */
    rail: "bg-[repeating-linear-gradient(to_bottom,color-mix(in_oklab,var(--muted-foreground)_40%,transparent)_0_3px,transparent_3px_5px)]",
    label: "text-muted-foreground",
    text: "text-muted-foreground [&_*]:font-normal! [&_*]:text-muted-foreground!",
  },
  unknown: {
    /*
     * **Hollow, not dashed.** A 1px dash on a 7px circle is three tick marks
     * at this pixel density and reads as a rendering fault rather than as a
     * state — and it was doing no work either, because `skipped` was also a
     * hollow ring, so the two differed by a dash nobody could resolve.
     *
     * The four are told apart by **weight** now, which survives being small:
     * filled for `ok`, a ring for `unknown`, a fainter ring for `skipped`,
     * and colour for `failed`. Fill against no fill is the most legible
     * distinction there is at seven pixels.
     *
     * **`bg-sidebar`, and it is not decoration.** A ring is transparent, so
     * the rail — drawn first, and by the same row — ran straight through its
     * middle: a hairline across the circle, on every `unknown` and `skipped`
     * node in both columns. A filled node hides the rail by being opaque; a
     * hollow one has to be told to. The fill is the panel's own background,
     * so the node punches the thread rather than painting over it.
     */
    node: "border border-muted-foreground/70 bg-sidebar",
    rail: "bg-muted-foreground/25",
    label: "text-muted-foreground",
  },
}

/**
 * One step: a node on the rail, its label, and its detail.
 *
 * The outcome row is the same row with a larger node and a heavier label —
 * not a separate component, because it has to sit on the same rail and line
 * up on the same grid. It is the last step of its half and the model marks it
 * with `OUTCOME_ID` rather than the panel counting rows.
 */
function Row({
  step,
  above,
}: {
  step: TraceStep
  /** The rail style of the step before this one, or null when it is first. */
  above: string | null
}) {
  const state = STATE[step.state]
  const last = step.id === OUTCOME_ID
  const bad = last && (step.state === "failed" || step.state === "skipped")
  /*
   * An outcome that is `unknown` must not draw as a settled one.
   *
   * The test below used to be `failed || skipped` alone, so the single
   * unknown ending — the calculator-only route, on a `B:`/`H:`/`Z:` name —
   * came out with the solid foreground node, identical to a live-verified
   * result. The row above it hedges with a dashed node and the word *should*,
   * and then the largest, heaviest row on the screen asserted the same thing
   * flatly. The node follows the 7px rule instead: hollow and dashed, which
   * is what `unknown` means everywhere else in this column.
   */
  const unsure = last && step.state === "unknown"

  return (
    <li className="grid grid-cols-[12px_56px_1fr] gap-x-2">
      <div className="relative">
        {/*
          **Two segments, because a rail belongs to a transition rather than
          to a row.** The state table calls this column *rail below* and means
          it: a step's state says how the thread leaves it. The segment
          *above* a node is the previous step's rail still running, and
          painting it with this row's own state was wrong in the way that
          shows — a `skipped` row dashed its own incoming segment, and the
          dash put a 3px void directly above the node, so the thread appeared
          to stop short of the circle it was arriving at.

          That also replaces the old first/last clipping, which special-cased
          what now falls out of the model: the first row has nothing above it
          and the outcome has nothing below.

          **Everything in this column hangs off one number: 9px.** That is the
          optical centre of the detail's first line — 12px text at
          `leading-[1.5]` is an 18px line box — and every node is placed by
          subtracting half its own size from it: 9 − 3.5 for the 7px node,
          9 − 5.5 for the 11px outcome. Both rail ends stop there too, so the
          thread meets the middle of a node rather than its edge and the two
          sizes terminate it at the same y.

          The number cannot be a constant: Tailwind emits a class only when it
          finds the name written out, so an interpolated `top-[${n}px]` is
          never generated and the span silently inherits nothing. Same trap as
          the palette in `trace-paint.ts`.

          The nodes sat at 4px and 2px before, from the mockup, putting the
          7px node's centre at 7.5 — a pixel and a half above the text it
          names. Invisible in isolation, plain in a column of eight.
        */}
        {above && (
          <span
            className={cn(
              "absolute top-0 bottom-[calc(100%-9px)] left-[5.5px] w-px",
              above
            )}
          />
        )}
        {!last && (
          <span
            className={cn(
              "absolute top-[9px] bottom-0 left-[5.5px] w-px",
              state.rail
            )}
          />
        )}
        <span
          className={cn(
            "absolute rounded-full",
            last
              ? "top-[3.5px] left-[0.5px] size-[11px]"
              : "top-[5.5px] left-[2.5px] size-[7px]",
            last
              ? bad
                ? "bg-destructive"
                : unsure
                  ? /*
                     * `border-2`, not 1px. The outcome node is the heaviest
                     * thing in the column and has to stay that way: an 11px
                     * circle with a hairline outline reads *lighter* than the
                     * 7px filled dots above it, which would make the ending
                     * look less important than an ordinary step. At 2px the
                     * ring leaves a 7px hole and carries the same weight as a
                     * filled dot while plainly not being one.
                     */
                    "border-2 border-foreground bg-sidebar"
                  : "bg-foreground"
              : state.node
          )}
        />
      </div>

      <div
        className={cn(
          "pt-px font-editor text-[10.5px]",
          last
            ? bad
              ? "font-semibold text-destructive"
              : "font-semibold text-foreground"
            : state.label
        )}
      >
        {step.label}
      </div>

      <div
        className={cn(
          "min-w-0",
          last ? "text-[12.5px]" : "pb-2 text-[12px]",
          "leading-[1.5]",
          state.text
        )}
      >
        <Detail step={step} />
      </div>
    </li>
  )
}

/**
 * A step's detail, with its code fragments painted as the editor paints them.
 *
 * The model says which fragments are code; this only draws them. See
 * `trace-paint.ts` for why the palette is not repeated here, and `Part` in
 * `@shared/trace` for why the marking cannot be worked out from the finished
 * sentence.
 */
function Detail({ step }: { step: TraceStep }) {
  return (
    <>
      {paintDetail(step.detail).map((span, index) => {
        const { className, style } = scopePaint(span.scope)

        /*
          A CLR type and a glossary word share one affordance and differ in
          one thing. Both take the dotted underline, because in this panel a
          dotted underline means "there is more here" and having two marks for
          that would teach nothing. The type is code, so it keeps the mono
          face and the keyword colour; the term is prose and keeps the
          surrounding face and colour, so it reads as a word in a sentence
          rather than as a fragment lifted out of the file.
        */
        if (span.type || span.term)
          return (
            <Hint
              key={index}
              text={span.text}
              doc={(span.type ? TYPE_DOC : TERM_DOC)[span.text] ?? span.text}
              style={style}
              /*
                The editor face whenever the span has a scope, which is what
                tells a code hint from a prose one: a CLR type is a fragment
                of a language, `calculator` and `manually` are words in a
                sentence. Both take the same dotted underline.
              */
              className={cn(
                span.scope && "font-editor text-[11.5px]",
                className
              )}
            />
          )

        // Prose stays prose: no mono, no colour, no tracking of its own.
        if (!span.scope) return <span key={index}>{span.text}</span>

        return (
          <span
            key={index}
            style={style}
            className={cn("font-editor text-[11.5px]", className)}
          >
            {span.text}
          </span>
        )
      })}
    </>
  )
}

/**
 * An underlined word with a definition behind it.
 *
 * **`border-current`**, so the underline is the word's own colour. Tailwind's
 * default border colour is the interface `--border` at 10% white, which on a
 * coloured word reads as a rendering fault rather than as a hint — that
 * shipped once.
 *
 * **No delay.** It is one word inside a sentence the reader is already
 * reading, and a tooltip that waits is a tooltip that gets given up on:
 * docs/ui.md's snappiness rule applies to a hint as much as to a state
 * change. Set on the trigger rather than on a provider, because this
 * component leaves the delay per trigger.
 */
function Hint({
  text,
  doc,
  style,
  className,
}: {
  text: string
  doc: string
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        delay={0}
        render={
          <span
            style={style}
            className={cn(
              "cursor-help border-b border-dotted border-current",
              className
            )}
          >
            {text}
          </span>
        }
      />
      <TooltipContent className="max-w-64">{doc}</TooltipContent>
    </Tooltip>
  )
}

/** Clicking the locator reveals the entry's lines and puts the caret in them. */
function reveal(from: number, to: number): void {
  const editor = editingEditor()
  if (!editor) return

  editor.setPosition({ lineNumber: from, column: 1 })
  editor.revealLinesInCenterIfOutsideViewport(from, to)
  editor.focus()
}
