// OWNER: D3.  Screen 5 — Approvals.
//
// Every quotation currently in the approval chain, at whichever level it is
// sitting.  The chain itself (routing, thresholds, who may act) is D1's
// application logic in lib/approval.ts — this screen only renders the queue.
//
// CONTRACT: matched against the landed GET /api/approvals (D1).  The quotation
// number arrives as `number` (aliased from `qq.number`), NOT `quotation_number`.
// `assigned_to_name` and `acted_by_name` come from LEFT JOINs and are genuinely
// nullable; everything else is INNER-JOINed and always present.
//
// ROLE GATE (updated by D1's RBAC alignment, a9eff6b): reading and acting are
// now different rights.  GET admits sales_rep as well as manager/finance/admin,
// but a rep is scoped in the SQL WHERE clause to quotations they OWN — so a rep
// opening this screen sees a SHORTER queue rather than a 403, and never sees
// another rep's pipeline.  Acting is still manager/finance/admin, on POST
// /api/approvals/[id].
//
// This screen therefore needs no role branch of its own: it renders whatever
// rows the session is entitled to, and the empty state ("nothing waiting on
// you") is the honest answer for a rep with no deals in the chain.
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, Landmark, Undo2 } from 'lucide-react'
import { cn } from 'cn'
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
} from '@/components/data-table'
import { DateValue, Money } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'
import { Skeleton } from '@/components/ui/skeleton'

type ApprovalRow = {
  id: number
  /** approval_level: 'sales_manager' | 'finance' */
  level: string
  /** approval_status: 'pending' | 'approved' | 'returned' | 'rejected' */
  status: string
  seq: number
  quotation_id: number
  quotation_version: number
  /** The QUOTATION's number — aliased as `number` by the API, not `quotation_number`. */
  number: string
  /** quotation_state of the parent quotation. */
  quotation_state: string
  customer_name: string
  tier_name: string
  owner_name: string
  risk_band: string
  risk_score: string | number
  currency_code: string
  grand_total: string | number
  /** LEFT JOINs — genuinely null when unassigned or not yet acted on. */
  assigned_to_name: string | null
  acted_by_name: string | null
  acted_at: string | null
  note: string | null
  created_at: string
}

const col = createDataTableColumns<ApprovalRow>()

const columns: DataTableColumns<ApprovalRow> = col.columns([
  col.accessor('number', {
    header: 'Quotation',
    cell: ({ row }) => (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="font-medium text-foreground">{row.original.number}</span>
        <span className="text-xs text-muted-foreground">
          v{row.original.quotation_version}
        </span>
      </span>
    ),
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    // Tier under the name: it is the reason the discount ceiling this approval
    // exists to police is set where it is, so it belongs next to the customer
    // rather than in a column of its own.
    cell: ({ row }) => (
      <span className="flex flex-col leading-tight">
        <span className="text-foreground">{row.original.customer_name}</span>
        <span className="text-xs text-muted-foreground">{row.original.tier_name}</span>
      </span>
    ),
  }),
  col.accessor('quotation_state', {
    header: 'Stage',
    // The approval's own status is not the quotation's state — a quotation can
    // sit in `negotiation` while an earlier approval step reads `approved`.
    cell: ({ row }) => <StatusBadge status={row.original.quotation_state} />,
  }),
  col.accessor('owner_name', {
    header: 'Owner',
    // Who raised it, as distinct from who has to sign it off.
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.owner_name}</span>
    ),
  }),
  col.accessor('level', {
    header: 'Step',
    cell: ({ row }) => {
      const { level, seq } = row.original
      return (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={level} />
          <span className="text-xs text-muted-foreground tabular-nums">#{seq}</span>
        </span>
      )
    },
  }),
  col.accessor('status', {
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  }),
  col.accessor('risk_band', {
    header: 'Risk',
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5">
        <StatusBadge status={row.original.risk_band} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {Number(row.original.risk_score).toFixed(0)}
        </span>
      </span>
    ),
  }),
  col.accessor('grand_total', {
    header: 'Value',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.grand_total}
        currency={row.original.currency_code}
        className="font-medium"
      />
    ),
  }),
  col.accessor('assigned_to_name', {
    header: 'Approver',
    cell: ({ row }) => {
      // Once acted on, who acted matters more than who it sat with.
      const { acted_by_name, assigned_to_name } = row.original
      const name = acted_by_name ?? assigned_to_name
      if (!name) return <span className="text-muted-foreground">Unassigned</span>
      return (
        <span className={acted_by_name ? undefined : 'text-muted-foreground'}>
          {name}
        </span>
      )
    },
  }),
  col.accessor('created_at', {
    header: 'Requested',
    cell: ({ row }) => (
      <DateValue value={row.original.created_at} className="text-muted-foreground" />
    ),
  }),
  col.accessor('acted_at', {
    header: 'Actioned',
    // The note is the approver's reason. It only exists once someone has acted,
    // and it is the single most useful thing on a returned or rejected row —
    // "why did this come back" is the question the screen has to answer.
    cell: ({ row }) => {
      const { acted_at, note } = row.original
      return (
        <span className="flex flex-col leading-tight">
          <DateValue value={acted_at} className="text-muted-foreground" />
          {note && (
            <span
              className="max-w-[16rem] truncate text-xs text-muted-foreground italic"
              title={note}
            >
              “{note}”
            </span>
          )}
        </span>
      )
    },
  }),
])

/* ── Queue summary ────────────────────────────────────────────────────────── */

/**
 * Sum a bucket, or refuse to.  Same rule as the dashboard and the quotations
 * lanes: `customer.currency_code` is per-customer and the seed handoff gives
 * Siemens EUR and Cipla USD, so adding `grand_total` across a mixed bucket adds
 * euros to rupees.  Converting needs `fx_rate` and is server-side business
 * logic, so a mixed bucket reports its COUNT and declines the total.
 */
function totalOf(list: ApprovalRow[], fallbackCurrency: string) {
  const codes = new Set(list.map((r) => r.currency_code).filter(Boolean))
  if (codes.size > 1) return { value: null as number | null, currency: '' }
  const value = list.reduce((sum, r) => {
    const n = Number(r.grand_total)
    return Number.isFinite(n) ? sum + n : sum
  }, 0)
  return { value, currency: [...codes][0] ?? fallbackCurrency }
}

/** Whole days a row has been waiting, or null when the date is unusable.
 *  Rendered only inside a client component after the fetch resolves, so there
 *  is no server render for `Date.now()` to disagree with. */
function daysWaiting(iso: string) {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

function oldestWait(list: ApprovalRow[]) {
  let worst: number | null = null
  for (const row of list) {
    const d = daysWaiting(row.created_at)
    if (d !== null && (worst === null || d > worst)) worst = d
  }
  return worst
}

const PANEL = 'rounded-xl border border-border bg-card shadow-[var(--shadow-card)]'

function SummaryTile({
  label,
  hint,
  count,
  footLabel,
  foot,
  icon,
  accent,
  accentSoft,
}: {
  label: string
  hint: string
  count: number
  footLabel: string
  foot: React.ReactNode
  icon: React.ReactNode
  accent: string
  accentSoft: string
}) {
  return (
    <div className={cn(PANEL, 'p-4')}>
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-lg"
        style={{ backgroundColor: accentSoft, color: accent }}
      >
        {icon}
      </span>
      <p className="mt-3 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className="mt-1 text-2xl leading-none font-semibold tabular-nums"
        // A zero is not an alarm — it stays neutral rather than taking the
        // tile's accent colour.
        style={count === 0 ? undefined : { color: accent }}
      >
        {count}
      </p>
      <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>
      <div className="mt-3 flex items-baseline justify-between gap-2 border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">{footLabel}</span>
        {foot}
      </div>
    </div>
  )
}

/** The queue at a glance, above the table.
 *
 *  It is four counts over the rows ALREADY fetched — no second request, and
 *  nothing here that the table below does not also contain.  The reason it
 *  earns its space is that the table is sorted by urgency but paginated, so
 *  "how many are still pending, and how long has the oldest been waiting"
 *  cannot be read off it without scrolling. */
function QueueSummary({
  rows,
  loading,
}: {
  rows: ApprovalRow[] | undefined
  loading: boolean
}) {
  const model = React.useMemo(() => {
    if (!rows) return null
    const pending = rows.filter((r) => r.status === 'pending')
    return {
      pending,
      manager: pending.filter((r) => r.level === 'sales_manager'),
      finance: pending.filter((r) => r.level === 'finance'),
      // `returned` goes back to the rep to fix; `rejected` kills the version.
      // Both are "the chain said no", which is the thing a queue screen must
      // not bury underneath the pending rows.
      refused: rows.filter((r) => r.status === 'returned' || r.status === 'rejected'),
      fallback: rows[0]?.currency_code ?? 'INR',
    }
  }, [rows])

  if (loading) {
    return (
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[9.5rem] w-full rounded-xl" />
        ))}
      </div>
    )
  }

  // No rows means the request did not succeed; the table below reports it.
  if (!model) return null

  const value = totalOf(model.pending, model.fallback)
  const managerWait = oldestWait(model.manager)
  const financeWait = oldestWait(model.finance)

  const waiting = (days: number | null) =>
    days === null ? (
      <span className="text-xs text-muted-foreground">—</span>
    ) : (
      <span className="text-sm font-medium text-foreground tabular-nums">
        {days} {days === 1 ? 'day' : 'days'}
      </span>
    )

  return (
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryTile
        label="Pending"
        hint="Steps still waiting on a decision"
        count={model.pending.length}
        footLabel="Deal value"
        foot={
          value.value === null ? (
            <span
              className="text-xs font-medium text-muted-foreground"
              title="These approvals span more than one currency, so a single total would be meaningless without applying FX rates."
            >
              Mixed currencies
            </span>
          ) : (
            <Money
              value={value.value}
              currency={value.currency}
              className="text-sm font-medium text-foreground"
            />
          )
        }
        icon={<Clock className="size-4" />}
        accent="var(--accent-amber)"
        accentSoft="var(--accent-amber-soft)"
      />
      <SummaryTile
        label="With the manager"
        hint="Pending at the sales_manager step"
        count={model.manager.length}
        footLabel="Longest wait"
        foot={waiting(managerWait)}
        icon={<CheckCircle2 className="size-4" />}
        accent="var(--accent-teal)"
        accentSoft="var(--accent-teal-soft)"
      />
      <SummaryTile
        label="With finance"
        hint="Pending at the finance step"
        count={model.finance.length}
        footLabel="Longest wait"
        foot={waiting(financeWait)}
        icon={<Landmark className="size-4" />}
        accent="var(--accent-plum)"
        accentSoft="var(--accent-plum-soft)"
      />
      <SummaryTile
        label="Sent back"
        hint="Returned to the rep or rejected outright"
        count={model.refused.length}
        footLabel="Needs rework"
        foot={
          <span className="text-sm font-medium text-foreground tabular-nums">
            {model.refused.filter((r) => r.status === 'returned').length}
          </span>
        }
        icon={<Undo2 className="size-4" />}
        accent="var(--accent-red)"
        accentSoft="var(--accent-red-soft)"
      />
    </div>
  )
}

/* ── Status filter ────────────────────────────────────────────────────────── */

const STATUS_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'returned', label: 'Returned' },
  { key: 'rejected', label: 'Rejected' },
] as const

type StatusFilter = (typeof STATUS_FILTERS)[number]['key']

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function ApprovalsPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<ApprovalRow>('/api/approvals')
  const [status, setStatus] = React.useState<StatusFilter>('all')

  // CLIENT-SIDE, like the quotations rail.  GET /api/approvals accepts
  // `?status=` and would filter server-side, but every row the session is
  // entitled to is already here — a request per chip would flash a loading
  // state and would make the chip COUNTS (which describe the whole queue, not
  // the filtered slice) impossible to show.
  const counts = React.useMemo(() => {
    const map = new Map<string, number>()
    for (const row of rows ?? []) map.set(row.status, (map.get(row.status) ?? 0) + 1)
    return map
  }, [rows])

  const filtered = React.useMemo(
    () => (status === 'all' ? rows : rows?.filter((r) => r.status === status)),
    [rows, status],
  )

  const toolbar =
    rows && rows.length > 0 ? (
      <div className="flex flex-wrap items-center gap-1">
        {STATUS_FILTERS.map((f) => {
          const count = f.key === 'all' ? rows.length : (counts.get(f.key) ?? 0)
          const active = status === f.key
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={active}
              onClick={() => setStatus(f.key)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                active
                  ? 'border-primary/30 bg-primary/10 font-semibold text-primary'
                  : 'border-border text-foreground/80 hover:bg-[var(--row-hover)]',
                count === 0 && !active && 'text-muted-foreground/60',
              )}
            >
              {f.label}
              <span className="tabular-nums">{count}</span>
            </button>
          )
        })}
      </div>
    ) : null

  return (
    <>
      <PageHeader
        title="Approvals"
        // "you can see" is doing real work now that reps are admitted: a rep's
        // queue is scoped to their own deals, so this screen is genuinely a
        // different list per role rather than one shared queue.
        description="Every quotation in the approval chain you can see, with the level it is waiting on."
      />

      <QueueSummary rows={rows} loading={loading} />

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        error={error}
        onRetry={retry}
        onRowClick={(row) => router.push(`/approvals/${row.id}`)}
        getRowId={(row) => String(row.id)}
        filterPlaceholder="Filter approvals…"
        toolbar={toolbar}
        // TWO different empty states, because they mean two different things.
        emptyTitle={
          rows && rows.length > 0
            ? 'No approvals with that status'
            : 'Nothing awaiting your approval'
        }
        // The old copy said approvals appear "when a rep submits one that
        // breaches a discount ceiling", which reads as "the chain is empty".
        // It usually is not: GET /api/approvals scopes a sales_rep to
        // quotations they OWN, so an empty queue most often means the live
        // approvals belong to someone else — not that none exist.  Saying so is
        // the difference between a working screen and a broken-looking one.
        emptyDescription={
          rows && rows.length > 0
            ? 'Every approval in your queue has a different status. Clear the filter above to see them all.'
            : 'This queue is scoped to what your role can act on — a sales rep sees only approvals for quotations they own. Switch identity in the header to see another role’s queue.'
        }
        footnote="Click a row to open the approval."
      />
    </>
  )
}
