import {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { VarSearchResult } from "@/lib/var-search"

import { useVirtualizer } from "@tanstack/react-virtual"

import { Plane, RefreshCw, Search, SearchX } from "lucide-react"

import type { VarEntry } from "@shared/types"
import { readOf } from "@shared/vars"

import { PanelHeader } from "@/components/panel-header"
import { RailButton } from "@/components/rail"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import { Toggle } from "@/components/ui/toggle"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { VarChip } from "@/components/var-chip"
import { useRetainedVars } from "@/lib/use-var-value"
import { buildSearchIndex, searchVars, splitPrefix } from "@/lib/var-search"
import { cn } from "@/lib/utils"
import { useStore } from "@/store"

/**
 * A backstop, not a page size.
 *
 * The list is virtualized, so the number of rows no longer costs DOM — what it
 * costs is the sort, which is `O(n log n)` over everything that matched. Twenty
 * thousand of those is a couple of milliseconds and it happens behind
 * `useDeferredValue`, so this exists only so that a future index ten times the
 * size cannot quietly turn typing into work.
 *
 * It used to be 200 and it used to be a render budget. Browsing by filter alone
 * is what made that wrong: `K:` with no query is 1,524 results and every one of
 * them is a real answer.
 */
const LIMIT = 20_000

/**
 * The height of one row, in pixels, fixed.
 *
 * Fixed because measuring is the expensive half of virtualization and this row
 * is one chip — a known font at a known size in a known padding. The row is
 * given this height explicitly rather than allowed to size itself, so the
 * constant cannot drift away from what is drawn.
 */
const ROW_HEIGHT = 22

/**
 * How long scrolling has to stop before the watch set follows the viewport.
 *
 * The app watches **what is on screen**, so the cost of live values is bounded
 * by the size of the panel rather than by the size of the search — thirty-odd
 * names whether the query matched four or four thousand. That is what let the
 * result cap go.
 *
 * The debounce is what makes it affordable. Every change of the watch set
 * re-sends it, and for any `A:` in it main tears down and rebuilds a SimConnect
 * data definition; doing that per scroll tick would be absurd. Doing it once,
 * a third of a second after the scrollbar stops, costs nothing anybody can
 * perceive — you cannot read a number while it is moving past you anyway.
 */
const SETTLE_MS = 300

/**
 * A list of names, once it has stopped changing.
 *
 * Trailing only. A leading edge would fire on the first pixel of every scroll,
 * which is the case this exists to avoid.
 *
 * Compared by content rather than by identity, because the caller rebuilds the
 * array on every render — a scroll that returns to where it started must settle
 * to the same list and do nothing.
 */
function useSettled(names: string[], ms: number): string[] {
  const key = names.join("\n")
  const [settled, setSettled] = useState(key)

  useEffect(() => {
    const timer = setTimeout(() => setSettled(key), ms)
    return () => clearTimeout(timer)
  }, [key, ms])

  return useMemo(() => (settled ? settled.split("\n") : []), [settled])
}

export function VariablesRailButton() {
  return <RailButton panel="variables" label="Variables" />
}

export function VariablesPanel() {
  const vars = useStore((state) => state.vars)
  const busy = useStore((state) => state.busy)
  const refresh = useStore((state) => state.refresh)
  const sim = useStore((state) => state.sim)

  // In the store rather than in state, so closing the panel does not clear the
  // search it was showing. See `variablesView`.
  const { query, thisAircraft } = useStore((state) => state.variablesView)
  const setView = useStore((state) => state.setVariablesView)
  const setQuery = (next: string) => setView({ query: next })
  const setThisAircraft = (next: boolean) => setView({ thisAircraft: next })
  const field = useRef<HTMLInputElement>(null)

  /*
   * The aircraft the filter is about: the one the index was built against, and
   * only while one is still loaded.
   *
   * Two conditions because the two facts have different lifetimes.
   * `vars.aircraft` is what the `aircraft` facets actually describe — reading
   * the live connection instead would label the chip with an aeroplane whose
   * evidence has not been folded in yet. And it outlives the connection,
   * because nothing rebuilds the index when MSFS closes; the facets stay,
   * correctly, and the label would have stayed with them.
   */
  const aircraft = sim.phase === "live" ? (vars?.aircraft ?? null) : null

  // Rebuilt only when the dictionary itself changes — tokenizing twelve
  // thousand names on every keystroke would be the one slow thing here.
  const index = useMemo(
    () => buildSearchIndex(vars?.entries ?? []),
    [vars?.entries]
  )

  /*
   * The namespace is read out of the query, never held beside it. Typing `L:`
   * and pressing the L chip are then one state: the chip lights, and the prefix
   * leaves the text for a pill, whichever way it arrived. That is the lesson
   * the chips are for — they write the same thing you could have typed.
   */
  const { namespace, rest } = splitPrefix(query, index.namespaces)
  const withNamespace = (next: string | null) =>
    setQuery(next ? `${next.toUpperCase()}:${rest}` : rest)

  // Typing stays ahead of the list: the input updates immediately and the
  // results catch up, rather than every keystroke waiting on a full re-rank.
  const deferred = useDeferredValue(query)

  // Turned off with the chip that controls it. A filter still narrowing a list
  // after its control has gone is a list quietly lying about what it contains.
  const filtering = thisAircraft && Boolean(aircraft)

  /*
   * Nothing asked, nothing shown.
   *
   * The panel used to open on the top two hundred by profile count, which is a
   * ranking of the corpus rather than an answer to anything. A prompt is both
   * the quieter start and the honest one — and a filter counts as asking, so
   * the aircraft chip alone is enough to fill the list.
   */
  const searching = Boolean(deferred.trim() || filtering)

  const results = useMemo(() => {
    if (!searching) return []

    // "This aircraft" is the union of both halves of the evidence: it moves
    // here, or this aircraft's own profile names it. Either is a statement
    // about the aeroplane in front of you; neither alone is the whole answer.
    return searchVars(
      index,
      deferred,
      LIMIT,
      filtering ? isThisAircraft : undefined
    )
  }, [index, deferred, searching, filtering])

  const total = vars?.entries.length ?? 0

  // Live values are the list's business — it is the only thing that knows which
  // rows exist. See `VariableList`.

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/*
        The count sits with the title rather than in a footer under the list: it
        answers "how much is there", which is a question about the panel, and a
        footer cost a row of height at the bottom of a list that wants all of
        it. Just the numbers, since the title already says what they count.
      */}
      <PanelHeader
        title="Variables"
        after={
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {searching && results.length < total
              ? `${results.length.toLocaleString()} of ${total.toLocaleString()}`
              : total.toLocaleString()}
          </span>
        }
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Rescan profiles"
          disabled={busy}
          className="-me-1.5"
          onClick={() => void refresh()}
        >
          <RefreshCw className={cn(busy && "animate-spin")} />
        </Button>
      </PanelHeader>

      <div className="px-2 pb-2">
        <SearchInput
          inputRef={field}
          value={rest}
          // Typed text arrives without the pill, so the prefix is put back in
          // front — and text that itself starts with `X:` simply becomes the
          // new prefix on the next read, which is the conversion.
          onValueChange={(next) =>
            setQuery(namespace ? `${namespace.toUpperCase()}:${next}` : next)
          }
          token={
            namespace && (
              <span className="rounded-sm bg-muted px-1 font-mono text-[11px] leading-4 font-bold text-[var(--syntax-prefix)] uppercase">
                {namespace}:
              </span>
            )
          }
          onTokenRemove={() => withNamespace(null)}
          onClear={() => setQuery("")}
          placeholder='e.g. batt "STBY" 2'
          aria-label="Search variables"
        />

        {(index.namespaces.length > 1 || aircraft) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {/*
              First, and wearing the simulator's blue, because it is a different
              kind of filter from the ones beside it: a namespace narrows by
              what a variable *is*, this narrows by what is known about it in
              the aeroplane currently loaded.
            */}
            {aircraft && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Toggle
                      size="xs"
                      tone="sim"
                      pressed={thisAircraft}
                      onPressedChange={setThisAircraft}
                      aria-label="Current aircraft"
                    >
                      <Plane />
                    </Toggle>
                  }
                />
                <TooltipContent side="bottom">Current aircraft</TooltipContent>
              </Tooltip>
            )}

            {index.namespaces.map((option) => (
              <Toggle
                key={option}
                size="xs"
                className="font-mono uppercase"
                pressed={namespace === option}
                onPressedChange={(next) => {
                  withNamespace(next ? option : null)
                  // Back to the field, where the prefix just appeared, so the
                  // next thing typed carries on from it.
                  field.current?.focus()
                }}
              >
                {option}:
              </Toggle>
            ))}
          </div>
        )}
      </div>

      {namespace === "B" && (
        <InputEventsNote
          live={sim.phase === "live"}
          aircraft={aircraft}
          count={vars?.inputEvents?.length ?? 0}
        />
      )}

      {results.length > 0 ? (
        <VariableList results={results} />
      ) : (
        <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-2">
          <VariablesEmpty
            total={total}
            searching={searching}
            busy={busy}
            onRefresh={() => void refresh()}
          />
        </div>
      )}
    </div>
  )
}

/**
 * What the `B:` list is, in one line above it.
 *
 * Not an empty state, which is why it is not a case in `VariablesEmpty`: the
 * shipped catalogue always supplies some `B:` names, so that list is never
 * empty and the explanation would never be reached. The thing needing saying
 * is about the names that are *missing* from a full-looking list.
 *
 * Two facts, and it says whichever one is true:
 *
 * - **No aeroplane, so no input events.** The enumeration is per aircraft and
 *   there is nothing to enumerate.
 * - **These are IDs.** `AIRLINER_FCU_CHRONO_2` is what the sim lists; the
 *   reference that works is `AIRLINER_FCU_CHRONO_2_Push`, and the preset half
 *   is never in the enumeration. Saying so here is cheaper than the diagnostic
 *   that catches it afterwards.
 *
 * Silent while the simulator is not running. 04-connection's rule for that
 * state is to say nothing louder — the status chip already reads `Sim
 * offline`, and an instruction the panel cannot make good on is worse than no
 * line at all.
 */
function InputEventsNote({
  live,
  aircraft,
  count,
}: {
  live: boolean
  aircraft: string | null
  count: number
}) {
  if (!live) return null

  return (
    <p className="px-2 pb-2 text-[11px]/relaxed text-muted-foreground">
      {aircraft && count > 0 ? (
        <>
          {count.toLocaleString()} on {aircraft}. These are IDs — writing one
          needs an action, as in{" "}
          <span className="font-mono">NAME_Toggle</span>.
        </>
      ) : (
        "Load an aircraft to list the input events it registers."
      )}
    </p>
  )
}

/**
 * The three ways this list can be empty, which are not the same thing.
 *
 * Nothing scanned is a workspace problem, nothing typed is an invitation, and
 * nothing matching is a dead end — and the one that used to be a single line of
 * grey text was the invitation, which is the only one of the three that is
 * supposed to be the ordinary state of the panel.
 */
function VariablesEmpty({
  total,
  searching,
  busy,
  onRefresh,
}: {
  total: number
  searching: boolean
  busy: boolean
  onRefresh: () => void
}) {
  if (!total) {
    return (
      <Empty className="h-full gap-3 p-4">
        <EmptyHeader className="gap-1.5">
          <EmptyMedia variant="icon">
            <RefreshCw className={cn(busy && "animate-spin")} />
          </EmptyMedia>
          <EmptyTitle className="text-[13px]">No variables yet</EmptyTitle>
          <EmptyDescription className="text-[11.5px]/relaxed">
            Nothing has been read from the profiles in this folder yet.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={onRefresh}
          >
            Rescan profiles
          </Button>
        </EmptyContent>
      </Empty>
    )
  }

  if (searching) {
    return (
      <Empty className="h-full gap-3 p-4">
        <EmptyHeader className="gap-1.5">
          <EmptyMedia variant="icon">
            <SearchX />
          </EmptyMedia>
          <EmptyTitle className="text-[13px]">Nothing matches</EmptyTitle>
          <EmptyDescription className="text-[11.5px]/relaxed">
            Try fewer words, or clear a filter.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <Empty className="h-full gap-3 p-4">
      <EmptyHeader className="gap-1.5">
        <EmptyMedia variant="icon">
          <Search />
        </EmptyMedia>
        <EmptyTitle className="text-[13px]">Find a variable</EmptyTitle>
        <EmptyDescription className="text-[11.5px]/relaxed">
          Every known variable from other profiles, the sim, and the MSFS SDK.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

/**
 * The scrolling list, and the only thing in this panel that knows about pixels.
 *
 * ## Why it is a component rather than part of the panel
 *
 * `useVirtualizer` returns functions, and the React Compiler will not memoize a
 * component that calls it — it says so, as a lint warning. The panel above does
 * the expensive work: tokenizing twenty thousand names into a search index and
 * re-ranking them on each keystroke. Losing compilation *there* to gain a
 * virtualized list here would be a poor trade, so the incompatibility is
 * confined to the component that actually needs it.
 *
 * ## The gutter belongs here, not to each row
 *
 * A row is a chip and nothing else — see `VariableRow` — so the padding that
 * lines the chips up under the search field is the list's.
 */
function VariableList({ results }: { results: VarSearchResult[] }) {
  const scroller = useRef<HTMLDivElement>(null)

  /*
   * Only the rows in view reach the DOM — and, below, only they are watched.
   *
   * Tying the watch set to the viewport is what removed the cap on how many
   * results may carry a live value: the cost stops scaling with the search and
   * starts scaling with the panel, which is a constant. What makes it safe is
   * the settle below, because every change of the watch set re-sends it and
   * rebuilds the SimConnect data definition behind any `A:` in it.
   */
  const rows = useVirtualizer({
    count: results.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    // Where the list was when the panel closed, so the first rows built are
    // the ones about to be on screen rather than the top of the list.
    initialOffset: () => useStore.getState().variablesScroll,
  })

  // And the element itself put back there before the first paint, so the list
  // does not show its top for a frame and then jump.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element) element.scrollTop = useStore.getState().variablesScroll
  }, [])

  const items = rows.getVirtualItems()

  /*
   * The watch set is the viewport, plus whatever the overscan has already
   * built. Only the namespaces that can answer: a `K:` key event is fired
   * rather than read, and 1,524 of them are in this list.
   *
   * A scroll that ends where it began settles to the same list and does no
   * work at all, because `useSettled` compares by content.
   */
  const visible = items
    .map((row) => results[row.index]!.entry.name)
    .filter(readable)

  useRetainedVars(useSettled(visible, SETTLE_MS))

  return (
    <div
      ref={scroller}
      onScroll={(event) =>
        useStore.setState({ variablesScroll: event.currentTarget.scrollTop })
      }
      className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto px-2"
    >
      <div className="relative w-full" style={{ height: rows.getTotalSize() }}>
        {items.map((row) => {
          const entry = results[row.index]!.entry

          return (
            <div
              // Keyed on the name alone. It used to be `name|units`, which was
              // the identity the old index had — one row per way a variable was
              // read — and that is exactly what stopped being true: `L:Foo`
              // read as `Number` in one profile and `Bool` in another is one
              // variable, and was two rows.
              key={entry.name}
              className="absolute top-0 left-0 w-full"
              style={{
                height: row.size,
                transform: `translateY(${row.start}px)`,
              }}
            >
              <VariableRow entry={entry} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

function VariableRow({ entry }: { entry: VarEntry }) {
  return (
    <Popover>
      {/*
        A row is its chip and nothing else — no rule under it, no highlight
        behind it, no padding holding it away from the edge. The chip already
        has a border, a background and a hover state of its own, and stacking a
        second set of all three around it drew a box inside a box.

        Fixed height, because the list is virtualized on this exact number.

        The detail moved out of the row and into a popover: an expanding row is
        a variable-height row, and variable heights are the expensive half of
        virtualizing anything.
      */}
      <PopoverTrigger
        render={
          <button
            className="flex w-full items-center text-left"
            style={{ height: ROW_HEIGHT }}
          />
        }
      >
        <VarChip
          name={entry.name}
          live={readable(entry.name)}
          retain={false}
          doc={entry.sdk?.doc?.description}
          className="min-w-0"
        />
      </PopoverTrigger>

      <PopoverContent>
        <VariableDetail entry={entry} />
      </PopoverContent>
    </Popover>
  )
}

/**
 * Everything every source knows about one variable, in the order it is useful.
 *
 * The SDK's description first where there is one, because for most of this list
 * it is the only thing there is; then what the profiles do with it, which is
 * more specific but exists for a minority; then the simulator's own evidence,
 * which is the part that says whether any of it applies to the aeroplane you
 * are actually flying.
 *
 * Every block is conditional and the component renders whatever a row happens
 * to have. That is the facet design paying out: a source added later appears
 * here as another block and disturbs none of these.
 */
function VariableDetail({ entry }: { entry: VarEntry }) {
  const { corpus, sdk, sim, aircraft } = entry
  const doc = sdk?.doc

  return (
    <div className="space-y-2 p-3 text-[11px]">
      {doc?.deprecated && (
        <p className="font-medium text-[var(--remote-changed)]">Deprecated</p>
      )}

      {(corpus?.doc || doc?.description) && (
        <p className="text-foreground/80">{corpus?.doc ?? doc?.description}</p>
      )}

      {doc && (
        <p className="text-muted-foreground">
          {[
            doc.category,
            doc.settable === true && "settable",
            doc.settable === false && "read-only",
            doc.index && `index: ${doc.index}`,
            doc.parameters && `parameters: ${doc.parameters}`,
            doc.eventId,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {/*
        The two evidence lines, and the reason they are separate: one is about
        the simulator installation and the other is about this aeroplane. A
        variable the sim has enumerated but that has never moved here is a very
        different candidate from one that moved four thousand times.
      */}
      {(sim || aircraft) && (
        <p className="text-[var(--sim-foreground)]">
          {[
            sim && "in sim",
            aircraft?.changes &&
              `moved ${aircraft.changes.toLocaleString()}× in ${aircraft.key}`,
            aircraft?.inProfile && `named in ${aircraft.key}'s profile`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}

      {corpus && (
        <p className="text-muted-foreground">
          {corpus.count} {corpus.count === 1 ? "entry" : "entries"} in{" "}
          {corpus.fileCount} {corpus.fileCount === 1 ? "profile" : "profiles"}
          {corpus.sharedCount > 0 && corpus.masterCount > 0 && (
            <>
              {" "}
              · {corpus.sharedCount} shared, {corpus.masterCount} master
            </>
          )}
          {corpus.units.length > 1 && <> · read as {corpus.units.join(", ")}</>}
          {corpus.indices.length > 0 && (
            <> · indices {corpus.indices.join(", ")}</>
          )}
        </p>
      )}

      {!corpus && !doc && sdk?.uses && (
        <p className="text-muted-foreground">
          Used {sdk.uses}× by the SDK&apos;s own templates
          {sdk.usedUnits?.length ? ` as ${sdk.usedUnits.join(", ")}` : ""}
        </p>
      )}

      {corpus?.samples.some((sample) => sample.set) && (
        <div className="space-y-1">
          {corpus.samples
            .filter((sample) => sample.set)
            .map((sample, at) => (
              <div key={at} className="space-y-0.5">
                <pre className="scrollbar-overlay overflow-x-auto rounded-sm bg-background/60 px-1.5 py-1 font-mono text-[10.5px] whitespace-pre">
                  {sample.set}
                </pre>
                <p className="truncate text-[10px] text-muted-foreground">
                  {sample.heading ? `${sample.heading} · ` : ""}
                  {sample.file}
                </p>
              </div>
            ))}
        </div>
      )}

      {corpus && corpus.files.length > 0 && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {corpus.files.slice(0, 6).join(", ")}
          {corpus.fileCount > 6 && ` and ${corpus.fileCount - 6} more`}
        </p>
      )}
    </div>
  )
}

/**
 * Whether asking the simulator for this name could ever produce a number.
 *
 * The descriptor table's answer: `A:` reads through SimConnect and `L:`
 * streams from the module. The rest cannot — a `K:` key event is *fired*,
 * not read, and there are now 1,524 of them in this list; a screenful would
 * put fifty names into the watch set that the simulator has no way to
 * answer, rebuilt on every keystroke. Unlike the `startsWith` pair this
 * replaces, the table also keeps `L:1:` out — a per-simobject name the `L:`
 * stream can never match, which used to sit here claiming it was readable.
 */
function readable(name: string): boolean {
  return readOf(name) !== null
}

/** Known in the aeroplane currently loaded, by either kind of evidence. */
function isThisAircraft(entry: VarEntry): boolean {
  return Boolean(
    entry.aircraft?.changes ||
      entry.aircraft?.inProfile ||
      // The strongest of the three: the aeroplane registered it as an input
      // event. It has neither moved nor been bound yet, which is exactly the
      // state a switch is in while somebody is looking for it.
      entry.aircraft?.inputEvent
  )
}
