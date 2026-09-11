/**
 * The title strip at the top of a side panel.
 *
 * Shared rather than written twice so the two panels cannot drift apart: they
 * sit at opposite edges of the same window, and a two-pixel difference in height
 * between them is the kind of thing that reads as sloppiness long before anyone
 * works out what they are looking at.
 */
export function PanelHeader({
  title,
  after,
  children,
}: {
  title: string
  /**
   * A label belonging to the title, next to it rather than across the row.
   *
   * The Trace panel's locator: it says *which* entry the panel is about, so
   * it reads as part of the title and would be a separate question sitting
   * over by the controls.
   */
  after?: React.ReactNode
  /** Controls belonging to the panel, aligned to the trailing edge. */
  children?: React.ReactNode
}) {
  return (
    <header className="flex h-9 shrink-0 items-center gap-2 px-3">
      <span className="shrink-0 text-[12.5px] font-medium">{title}</span>
      {after}
      {children && (
        <div className="ml-auto flex items-center gap-1">{children}</div>
      )}
    </header>
  )
}
