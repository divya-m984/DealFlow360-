// OWNER: D3.  ONE component for every status enum in the application:
// quotation_state, approval_status, invoice_status, order_state, alloc_status,
// sub_status, risk_band, alert_type, line_type, billing_cycle, user_role.
//
// Consistent colours everywhere is a cheap, very visible win — but only if
// there is exactly one map.  Add new values HERE, never inline in a screen.
//
// The map is intentionally flat.  Values that appear in more than one enum
// ('approved', 'confirmed', 'cancelled', 'rejected') mean the same thing
// wherever they appear, so a flat map cannot disagree with itself.
import { cn } from 'cn'

/**
 * Semantic tones, not colours.  Screens choose a status; this file chooses how
 * a status looks.  Six tones is deliberately few — more and the palette stops
 * carrying meaning.
 */
type Tone = 'neutral' | 'info' | 'progress' | 'positive' | 'negative' | 'muted'

const TONE: Record<Tone, string> = {
  neutral: 'border-border bg-muted/70 text-foreground/85',
  info: 'border-sky-400/25 bg-sky-400/12 text-sky-300',
  progress: 'border-amber-400/25 bg-amber-400/12 text-amber-300',
  positive: 'border-emerald-400/25 bg-emerald-400/12 text-emerald-300',
  negative: 'border-red-400/25 bg-red-400/12 text-red-300',
  muted: 'border-border bg-transparent text-muted-foreground',
}

type Entry = { label: string; tone: Tone }

const STATUS: Record<string, Entry> = {
  // quotation_state
  draft: { label: 'Draft', tone: 'neutral' },
  pending_approval: { label: 'Pending approval', tone: 'progress' },
  approved: { label: 'Approved', tone: 'positive' },
  negotiation: { label: 'Negotiation', tone: 'info' },
  confirmed: { label: 'Confirmed', tone: 'positive' },
  rejected: { label: 'Rejected', tone: 'negative' },
  cancelled: { label: 'Cancelled', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },

  // approval_status  (approved / rejected shared with quotation_state)
  pending: { label: 'Pending', tone: 'progress' },
  returned: { label: 'Returned', tone: 'progress' },

  // approval_level / user_role
  sales_rep: { label: 'Sales rep', tone: 'neutral' },
  sales_manager: { label: 'Sales manager', tone: 'info' },
  finance: { label: 'Finance', tone: 'info' },
  admin: { label: 'Admin', tone: 'neutral' },
  portal: { label: 'Portal', tone: 'muted' },

  // invoice_status
  unpaid: { label: 'Unpaid', tone: 'negative' },
  partial: { label: 'Partially paid', tone: 'progress' },
  paid: { label: 'Paid', tone: 'positive' },
  void: { label: 'Void', tone: 'muted' },

  // order_state  (confirmed / cancelled shared)
  split_pending: { label: 'Split pending', tone: 'progress' },
  partially_fulfilled: { label: 'Partially fulfilled', tone: 'progress' },
  fulfilled: { label: 'Fulfilled', tone: 'positive' },
  backorder: { label: 'Backorder', tone: 'negative' },

  // alloc_status
  planned: { label: 'Planned', tone: 'neutral' },
  reserved: { label: 'Reserved', tone: 'info' },
  shipped: { label: 'Shipped', tone: 'positive' },

  // sub_status
  active: { label: 'Active', tone: 'positive' },
  paused: { label: 'Paused', tone: 'progress' },

  // Not database enums: the catalogue and warehouse screens render
  // `is_active` / `resolved_at` booleans through this same component so that a
  // derived state never invents its own colour.
  inactive: { label: 'Inactive', tone: 'muted' },
  archived: { label: 'Archived', tone: 'muted' },
  open: { label: 'Open', tone: 'progress' },
  resolved: { label: 'Resolved', tone: 'positive' },

  // risk_band — uppercase in the database, matched case-insensitively below
  low: { label: 'Low', tone: 'positive' },
  medium: { label: 'Medium', tone: 'progress' },
  high: { label: 'High', tone: 'negative' },

  // alert_type
  stalled: { label: 'Stalled', tone: 'progress' },
  discount_anomaly: { label: 'Discount anomaly', tone: 'negative' },
  delivery_slippage: { label: 'Delivery slippage', tone: 'negative' },

  // line_type
  one_time: { label: 'One-time', tone: 'neutral' },
  recurring: { label: 'Recurring', tone: 'info' },

  // billing_cycle
  weekly: { label: 'Weekly', tone: 'neutral' },
  monthly: { label: 'Monthly', tone: 'neutral' },
  quarterly: { label: 'Quarterly', tone: 'neutral' },
  yearly: { label: 'Yearly', tone: 'neutral' },
}

/** snake_case -> "Sentence case", for a value the map has not seen yet. */
function humanize(value: string) {
  const words = value.replace(/_/g, ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: string | null | undefined
  /** Override the mapped label; the tone still comes from `status`. */
  label?: string
  className?: string
}) {
  if (!status) {
    return <span className={cn('text-muted-foreground', className)}>—</span>
  }

  const entry = STATUS[status.toLowerCase()]
  const tone: Tone = entry?.tone ?? 'neutral'

  return (
    <span
      data-status={status}
      /* The tone is exposed so a light surface can restate these six palettes
         in one place (see `.theme-warm [data-tone=…]` in app/globals.css)
         instead of every screen overriding badge colours inline. */
      data-tone={tone}
      className={cn(
        // Square, not pill: sharp corners plus the concrete grain applied in
        // app/globals.css read as a stamped label rather than a rounded chip.
        'inline-flex h-5 w-fit shrink-0 items-center whitespace-nowrap rounded-none border px-2 text-[0.7rem] font-semibold',
        TONE[tone],
        className,
      )}
    >
      {label ?? entry?.label ?? humanize(status)}
    </span>
  )
}
