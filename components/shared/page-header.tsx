// OWNER: D3.  Title, subtitle, actions.  The mockup has one on every screen,
// so every screen gets exactly this one — spacing included.
import { cn } from 'cn'

export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  /** Right-aligned controls: primary action last, per the mockup. */
  actions?: React.ReactNode
  className?: string
}) {
  return (
    // A ruled band, not floating text: the hairline is what separates "which
    // screen am I on" from "what is on it", the way a CRM's title bar does.
    <div
      className={cn(
        'mb-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-border pb-4',
        className,
      )}
    >
      <div className="min-w-0">
        {/* Bold rather than semibold, and a step larger: on the light palette
            the old weight sat too close to the body text to anchor the page. */}
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="mt-1.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}
