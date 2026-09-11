import { cn } from "@/lib/utils"
import { useStore, type BottomPanel, type Panel } from "@/store"

/**
 * The feature palettes an open rail button can wear. Spelled out whole so
 * Tailwind finds each class — a `tone-${tone}` template would never be emitted.
 * `Button` and `Toggle` carry the same map in their variants, without `issues`.
 */
export type RailTone = "remote" | "radar" | "issues" | "sim" | "warning"

const TONE: Record<RailTone, string> = {
  remote: "tone-remote",
  radar: "tone-radar",
  issues: "tone-issues",
  sim: "tone-sim",
  warning: "tone-warning",
}

/**
 * The strip of panel buttons down the trailing edge.
 *
 * Vertical text rather than icons alone: an icon has to be learned, and there is
 * a whole column of height going spare. The label is rotated as a unit rather
 * than stacked letter by letter, so it stays a word.
 *
 * Each button is only as tall as its own label, and whatever is left over is
 * empty — the rail is a list of names, not a set of tabs dividing a fixed
 * height between them.
 *
 * Two groups, per 15-ui-surfaces: side panels at the top, the panels that toggle
 * the *bottom* slot pushed to the bottom. The rail is full height, which is what
 * makes that alignment mean anything — it points at where the panel appears.
 *
 * The split reads as a pair of subjects as well as a pair of places. The top is
 * finding the variable behind a control — Remote Connect, Variables, Radar. The
 * bottom is diagnostics: what is wrong with the file, and what the app is
 * doing. A button moves groups when its panel moves, not before.
 */
export function Rail({
  children,
  bottom,
}: {
  children: React.ReactNode
  bottom?: React.ReactNode
}) {
  return (
    <div className="flex w-7 shrink-0 flex-col items-stretch border-l border-border bg-sidebar">
      {children}
      {bottom && <div className="mt-auto flex flex-col items-stretch">{bottom}</div>}
    </div>
  )
}

/**
 * Which way the label runs. Vertical is the rail; horizontal is the status bar,
 * where a rotated word would need more height than the bar has.
 */
export type RailOrientation = "vertical" | "horizontal"

/**
 * The button itself, knowing nothing about which slot it drives.
 *
 * Split from the two wrappers below rather than written twice: the buttons sit
 * in one strip, and a couple of pixels of difference between them reads as
 * sloppiness long before anyone works out what they are looking at. The same
 * argument carries the horizontal case — a panel button that changes character
 * when it moves to the footer is a second control to learn.
 */
function RailToggle({
  label,
  open,
  onToggle,
  dot,
  active,
  tone,
  orientation = "vertical",
}: {
  label: string
  open: boolean
  onToggle: () => void
  dot?: React.ReactNode
  active?: string
  tone?: RailTone
  orientation?: RailOrientation
}) {
  const vertical = orientation === "vertical"

  return (
    <button
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "flex shrink-0 items-center gap-2",
        // Across the rail's width or down the footer's height: either way the
        // open state's fill reaches both edges of the strip it sits in.
        vertical ? "flex-col py-2" : "self-stretch px-2",
        open
          ? (active ?? "bg-accent text-accent-foreground")
          : "text-muted-foreground hover:text-foreground",
        /*
         * The open state's bar, on the side facing where the panel appears —
         * toward the editor on the rail, up toward the bottom slot in the
         * footer. A fill alone carried the state in dark mode and all but
         * vanished in light, where a surface sits a small step off the sidebar.
         *
         * An inset shadow rather than a border, so opening a panel never
         * changes the button's box. `--tone-edge` rather than the saturated
         * value, so an untoned button's bar is the ring grey, not near-black.
         */
        open && tone && TONE[tone],
        open &&
          (vertical
            ? "shadow-[inset_2px_0_0_var(--tone-edge)]"
            : "shadow-[inset_0_2px_0_var(--tone-edge)]")
      )}
    >
      {dot}
      <span
        className="text-[11.5px] tracking-wide"
        style={vertical ? { writingMode: "vertical-rl" } : undefined}
      >
        {label}
      </span>
    </button>
  )
}

export function RailButton({
  panel,
  label,
  /** A state dot above the label, when the panel has one worth showing. */
  dot,
  active,
  tone,
}: {
  panel: Panel
  label: string
  dot?: React.ReactNode
  /** Styling for a panel that owns its own palette, as Remote Connect does. */
  active?: string
  /** The palette the open state's bar is drawn in; neutral when absent. */
  tone?: RailTone
}) {
  const open = useStore((state) => state.panel) === panel
  const setPanel = useStore((state) => state.setPanel)

  return (
    <RailToggle
      label={label}
      open={open}
      onToggle={() => setPanel(open ? null : panel)}
      dot={dot}
      active={active}
      tone={tone}
    />
  )
}

/**
 * A panel that is its own toggle rather than one of a set sharing a slot.
 *
 * Radar is the only one. It stacks under whichever side panel is open instead
 * of replacing it, so its open state is a boolean and its rail button says
 * nothing about what the buttons above it are doing.
 */
export function ToggleRailButton({
  open,
  onToggle,
  label,
  dot,
  active,
  tone,
}: {
  open: boolean
  onToggle: () => void
  label: string
  dot?: React.ReactNode
  /** The open state's own colours, for a panel that has a palette. */
  active?: string
  /** The palette the open state's bar is drawn in; neutral when absent. */
  tone?: RailTone
}) {
  return (
    <RailToggle
      label={label}
      open={open}
      onToggle={onToggle}
      dot={dot}
      active={active}
      tone={tone}
    />
  )
}

/**
 * Drives the bottom slot, where Log and Issues replace each other.
 *
 * Not all of them are on the rail — Log is launched from the status bar — but
 * they are the same button doing the same job, so they share this one.
 */
export function BottomRailButton({
  panel,
  label,
  dot,
  active,
  tone,
  orientation,
}: {
  panel: BottomPanel
  label: string
  dot?: React.ReactNode
  /** The open state's own colours, for a panel that has a palette. */
  active?: string
  /** The palette the open state's bar is drawn in; neutral when absent. */
  tone?: RailTone
  orientation?: RailOrientation
}) {
  const open = useStore((state) => state.bottom) === panel
  const setBottom = useStore((state) => state.setBottom)

  return (
    <RailToggle
      label={label}
      open={open}
      onToggle={() => setBottom(open ? null : panel)}
      dot={dot}
      active={active}
      tone={tone}
      orientation={orientation}
    />
  )
}
