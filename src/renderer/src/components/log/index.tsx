import { useEffect, useMemo, useRef, useState } from "react"

import type { LogLevel, LogSource } from "@shared/log"

import { Eraser } from "lucide-react"

import { BottomRailButton } from "@/components/rail"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Toggle } from "@/components/ui/toggle"
import {
  countBySource,
  filterLog,
  LOG_LEVELS,
  LOG_SOURCES,
  type LogFilter,
  type LogRow,
} from "@/lib/log-filter"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

/**
 * How many filtered rows actually reach the DOM.
 *
 * The buffer holds five thousand and the interesting one is always the newest,
 * so the oldest are cut rather than virtualized — a windowing library is a
 * dependency and a scroll-restoration problem, in exchange for reaching rows
 * nobody scrolls back to. The count of what was dropped is shown, so this is
 * visible rather than mysterious.
 */
const RENDER_MAX = 1_000

/**
 * The same rail button as Radar's, launched from the status bar instead — so
 * the label runs across rather than down. Nothing else about it changes.
 */
export function LogFooterButton() {
  return <BottomRailButton panel="log" label="Log" orientation="horizontal" />
}

const SOURCE_STYLE: Record<LogSource, string> = {
  sim: "text-sky-600 dark:text-sky-400",
  remote: "text-remote-foreground",
  files: "text-emerald-600 dark:text-emerald-400",
  app: "text-amber-600 dark:text-amber-400",
  ui: "text-muted-foreground",
}

const LEVEL_STYLE: Record<LogLevel, string> = {
  debug: "",
  info: "",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-destructive",
}

/** `13:04:24.812` — a live feed is read by when, and seconds are not enough. */
function stamp(t: number): string {
  const at = new Date(t)
  return `${at.toTimeString().slice(0, 8)}.${String(at.getMilliseconds()).padStart(3, "0")}`
}

export function LogPanel() {
  const log = useStore((state) => state.log)
  const clear = useStore((state) => state.clearLog)

  const [sources, setSources] = useState<Set<LogSource>>(new Set())
  const [level, setLevel] = useState<LogLevel>("debug")
  const [search, setSearch] = useState("")
  const [collapse, setCollapse] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)

  /*
   * The expanded row's detail, fetched rather than carried.
   *
   * Entries cross the bridge without their detail — at the `L:` stream's rate,
   * serializing one for every row to show it for at most one was the single
   * most expensive thing the log did. So the click pays for it instead.
   *
   * Kept with the id it belongs to, so a reply that arrives after the reader
   * has moved on cannot be painted under a different row. That pairing is also
   * what makes collapsing a row cheap — the last answer is simply left where it
   * is, and stops matching.
   */
  const [detail, setDetail] = useState<{ id: number; value: unknown } | null>(null)

  useEffect(() => {
    if (selected === null) return

    let live = true
    void window.api.logDetail(selected).then((value) => {
      if (live) setDetail({ id: selected, value })
    })

    return () => {
      live = false
    }
  }, [selected])

  const filter = useMemo<LogFilter>(
    () => ({ sources, level, search, collapse }),
    [sources, level, search, collapse]
  )

  const rows = useMemo(() => filterLog(log, filter), [log, filter])
  const counts = useMemo(() => countBySource(log), [log])

  const shown = rows.length > RENDER_MAX ? rows.slice(-RENDER_MAX) : rows
  const hidden = rows.length - shown.length

  const toggleSource = (source: LogSource) =>
    setSources((current) => {
      const next = new Set(current)
      if (!next.delete(source)) next.add(source)
      return next
    })

  return (
    <div className="flex h-full min-h-0 flex-col bg-sidebar">
      <header className="flex h-9 shrink-0 items-center gap-2 px-3">
        <span className="text-[12.5px] font-medium text-trim">Log</span>
        <span className="text-[11px] text-muted-foreground">
          {rows.length === log.length
            ? `${log.length}`
            : `${rows.length} of ${log.length}`}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Clear the log"
            onClick={() => void clear()}
          >
            <Eraser />
          </Button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2 text-[11px]">
        {LOG_SOURCES.map((source) => {
          const on = sources.has(source)
          return (
            <Toggle
              key={source}
              size="sm"
              pressed={on}
              onPressedChange={() => toggleSource(source)}
              aria-label={`Show ${source}`}
              // An unticked set is not a filter, so nothing dims until
              // something is actually being hidden.
              className={cn("font-mono", !on && sources.size > 0 && "opacity-50")}
            >
              {source}
              <span className="opacity-60">{counts[source]}</span>
            </Toggle>
          )
        })}

        <Select value={level} onValueChange={(next) => setLevel(next as LogLevel)}>
          <SelectTrigger size="sm" className="w-24 font-mono" aria-label="Minimum level">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOG_LEVELS.map((option) => (
              <SelectItem key={option} value={option} className="font-mono">
                {option}+
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter…"
          aria-label="Filter by text"
          className="h-6 min-w-24 flex-1 text-[11px]"
        />

        <label className="flex items-center gap-1.5 text-muted-foreground">
          <Checkbox
            checked={collapse}
            onCheckedChange={(next) => setCollapse(next === true)}
          />
          Collapse repeats
        </label>
      </div>

      <Feed
        rows={shown}
        hidden={hidden}
        selected={selected}
        detail={detail?.id === selected ? detail.value : undefined}
        onSelect={setSelected}
      />
    </div>
  )
}

function Feed({
  rows,
  hidden,
  selected,
  detail,
  onSelect,
}: {
  rows: LogRow[]
  hidden: number
  selected: number | null
  /** The selected row's detail, once it has arrived. */
  detail: unknown
  onSelect: (id: number | null) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // Follow the tail, but only while the reader is already there. Yanking the
  // view back down while someone is reading history is the single most annoying
  // thing a live log can do.
  useEffect(() => {
    const element = box.current
    if (element && pinned.current) element.scrollTop = element.scrollHeight
  }, [rows])

  const onScroll = () => {
    const element = box.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    pinned.current = distance < 24
  }

  if (!rows.length) {
    return (
      <div className="flex flex-1 items-center justify-center text-[11.5px] text-muted-foreground">
        Nothing to show.
      </div>
    )
  }

  return (
    <div
      ref={box}
      onScroll={onScroll}
      className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto border-t border-border font-mono text-[11px]"
    >
      {hidden > 0 && (
        <div className="px-3 py-1 text-muted-foreground/70">
          {hidden} older {hidden === 1 ? "row" : "rows"} not shown
        </div>
      )}

      {rows.map(({ entry, count, burst, spanMs }) => (
        <div key={entry.id}>
          <button
            onClick={() => onSelect(selected === entry.id ? null : entry.id)}
            className={cn(
              "flex w-full items-baseline gap-2 px-3 py-0.5 text-left hover:bg-accent/50",
              selected === entry.id && "bg-accent"
            )}
          >
            <span className="shrink-0 text-muted-foreground/70">{stamp(entry.t)}</span>
            <span className={cn("w-12 shrink-0", SOURCE_STYLE[entry.source])}>
              {entry.source}
            </span>
            <span className="w-28 shrink-0 truncate text-muted-foreground">
              {entry.kind}
            </span>
            <span
              className={cn(
                "truncate",
                burst ? "text-muted-foreground italic" : LEVEL_STYLE[entry.level]
              )}
            >
              {/*
                A burst row stands for entries that are all different, so
                showing one of their messages would name an arbitrary member of
                the group as if it were the group. It says what happened
                instead, and the entries are still in the capture for anyone who
                needs them.
              */}
              {burst
                ? `${count} events at once — a state snapshot, not an interaction`
                : entry.message}
            </span>
            {(burst || count > 1) && (
              <span className="ml-auto shrink-0 rounded-sm bg-muted px-1 text-muted-foreground">
                {/*
                  `×318` means "this happened 318 times", which is true of an
                  identical run and false of a burst. A burst reports how long
                  it took, which is the thing that makes it obviously a machine.
                */}
                {burst ? `${spanMs ?? 0} ms` : `×${count}`}
              </span>
            )}
          </button>

          {/*
            Nothing is drawn until the detail has been fetched, and nothing is
            drawn if it cannot be — a row can be expanded after main's ring has
            dropped what it stood for, and an empty pane is the honest answer to
            that rather than a spinner that never resolves.
          */}
          {selected === entry.id && entry.hasDetail && detail !== undefined && (
            <pre className="scrollbar-overlay overflow-x-auto border-y border-border bg-background/50 px-3 py-1.5 text-[10.5px] text-muted-foreground">
              {JSON.stringify(detail, null, 2)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}
