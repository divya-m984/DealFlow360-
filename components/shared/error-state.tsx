// OWNER: D3.  Renders { error: { message } } — the only error shape the API
// returns (lib/api.ts `fail`).  Screens pass that object straight through; they
// never reformat a message, so an unimplemented route, a 403 from the portal
// guard, and a Postgres CHECK violation all surface identically.
import { AlertTriangle } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'

/** Exactly the payload under `error` in a failed API response. */
export type ApiError = { message: string }

export function ErrorState({
  error,
  title = 'Could not load this data',
  onRetry,
  className,
}: {
  error: ApiError | string | null | undefined
  title?: React.ReactNode
  onRetry?: () => void
  className?: string
}) {
  const message =
    typeof error === 'string' ? error : (error?.message ?? 'Something went wrong.')

  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center px-6 py-14 text-center',
        className,
      )}
    >
      <div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-destructive/25 bg-destructive/12 text-destructive">
        <AlertTriangle className="size-4" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-lg text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}
