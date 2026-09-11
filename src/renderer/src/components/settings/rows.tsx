import { cn } from "@/lib/utils"

/**
 * The two shapes everything in Settings is laid out with.
 *
 * A *section* is a titled group of related settings; a *row* is one setting —
 * label and explanation on the left, the control on the right. Groups
 * (`./groups/*`) know nothing about either container they can appear in: the
 * Settings dialog composes them under sections, and a focused dialog (the sim
 * chip's, the Radar header's) wraps the same body in its own chrome.
 */
export function SettingsSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3 border-t border-border pt-5 first:border-t-0 first:pt-0">
      <h3 className="text-xs font-medium">{title}</h3>
      {children}
    </section>
  )
}

export function SettingsRow({
  label,
  description,
  className,
  children,
}: {
  label: string
  description?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col">
        <span className="text-xs/relaxed">{label}</span>
        {description && (
          <span className="text-[11px] text-muted-foreground">
            {description}
          </span>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
