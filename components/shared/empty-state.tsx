// OWNER: D3.  Every list will hit this.  An unstyled empty table is the fastest
// way to look unfinished, and the demo will hit at least one empty list.
import { Inbox } from 'lucide-react'
import { cn } from 'cn'

export function EmptyState({
  title = 'Nothing here yet',
  description,
  icon,
  action,
  className,
}: {
  title?: React.ReactNode
  description?: React.ReactNode
  /** Defaults to an inbox glyph; pass a lucide icon element to override. */
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
        {icon ?? <Inbox className="size-4" />}
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
