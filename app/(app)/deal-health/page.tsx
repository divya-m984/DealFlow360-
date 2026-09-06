// OWNER: D3.  Screen 14 — Deal Health.
//
// Three summary tiles over the alert table, plus the per-row Nudge and Escalate
// controls (§B9).  The tiles are derived from the SAME rows the table renders —
// there is one fetch and no second endpoint — so a count can never disagree
// with the list beneath it.
//
// Alerts are RENDERED, not derived: the screen does not infer staleness from
// quotation columns, so unresolved `deal_alert` rows must exist in the seed or
// this list is legitimately empty.
//
// ── NUDGE / ESCALATE — WIRED (contract supplied by D1) ──────────────────────
// D3 correctly refused to guess a request shape while the endpoint was a 501
// stub. It is now real, and the contract is:
//
//   POST /api/deal-alerts/[id]/action
//   body   { action: 'nudge' | 'escalate' | 'resolve', note?: string }
//   200    { data: <the updated deal_alert row> }
//
// The handler writes last_action / last_action_at / last_action_by_user_id and,
// for nudge and escalate, also bumps quotation.last_activity_at — otherwise
// nudging a stalled deal would leave it looking exactly as stalled as before.
// 'resolve' additionally sets resolved_at, which drops the row out of this
// list on the next load.
//
// The response IS the updated row, but this screen refetches anyway: the three
// tiles above are derived from the same rows, so patching one row locally
// would leave the counts stale until something else reloaded them.
// The write itself stays D1's: that endpoint owns deal_alert.last_action,
// .last_action_at and .last_action_by_user_id.  D3 never writes SQL, never
// fakes a success, and never patches last_action locally.
// ────────────────────────────────────────────────────────────────────────────
//
// PROVISIONAL CONTRACT.  GET /api/deal-alerts is still a 501 stub owned by D1
// with no declared response type.  The row shape is derived from `deal_alert`
// in db/schema.sql plus the quotation/customer joins the screen needs.
// Only `id` and `kind` are treated as required.
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { BellRing, ChevronsUp } from 'lucide-react'
import { cn } from 'cn'
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
} from '@/components/data-table'
import { DateValue, Money, Num } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'
// ⚠ Cross-lane, flagged in OWNERSHIP.md: D2 added live alert detection.
// Until now every alert on this screen was a seed fixture -- the only
// INSERTs into deal_alert in the repo were in db/seed/. Self-contained;
// deleting these two additions removes it cleanly.
import { AlertScan } from '@/components/admin/alert-scan'
import { Skeleton } from '@/components/ui/skeleton'

type DealAlertRow = {
  id: number
  /** alert_type: 'stalled' | 'discount_anomaly' | 'delivery_slippage' */
  kind: string
  /** Free text, e.g. 'Idle 9 days' or 'Discount 22% vs avg 8%'. */
  detail?: string
  quotation_id?: number
  quotation_number?: string
  customer_name?: string
  risk_band?: string
  currency_code?: string
  grand_total?: string | number
  flagged_at?: string
  last_action?: string
  last_action_at?: string
  last_action_by_name?: string
  resolved_at?: string
}

function Muted() {
  return <span className="text-muted-foreground">—</span>
}

/* ── Summary tiles ────────────────────────────────────────────────────────── */

const TILES = [
  { kind: 'stalled', label: 'Stalled Deals' },
  { kind: 'discount_anomaly', label: 'Discount Anomalies' },
  { kind: 'delivery_slippage', label: 'Delivery Slippage' },
] as const

function SummaryTiles({
  rows,
  loading,
}: {
  rows: DealAlertRow[] | undefined
  loading: boolean
}) {
  // Counts come from the rows already on screen. Nothing is hardcoded, and a
  // tile can never claim a number the table below does not contain.
  const summary = React.useMemo(() => {
    const byKind = new Map<string, { count: number; value: number; unactioned: number }>(
      TILES.map((t) => [t.kind, { count: 0, value: 0, unactioned: 0 }]),
    )
    for (const row of rows ?? []) {
      const entry = byKind.get(row.kind)
      if (!entry) continue
      entry.count += 1
      const amount = Number(row.grand_total)
      if (Number.isFinite(amount)) entry.value += amount
      if (!row.last_action) entry.unactioned += 1
    }
    return byKind
  }, [rows])

  if (loading) {
    return (
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((tile) => (
          <Skeleton key={tile.kind} className="h-[4.75rem] w-full" />
        ))}
      </div>
    )
  }

  // With no rows there is nothing true to summarise. Rendering three zeroes
  // would assert "no alerts" when the real answer is "not loaded".
  if (!rows) return null

  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {TILES.map((tile) => {
        const entry = summary.get(tile.kind)!
        const currency =
          rows.find((r) => r.kind === tile.kind)?.currency_code ?? 'INR'
        return (
          <div
            key={tile.kind}
            className="rounded-lg border border-border bg-card px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-2">
              {/* The badge, not a plain label: the tile then carries the same
                  tone as that alert's rows in the table below it. */}
              <StatusBadge status={tile.kind} label={tile.label} />
              <span
                className={cn(
                  'text-xl leading-none font-semibold tabular-nums',
                  entry.count === 0 ? 'text-muted-foreground' : 'text-foreground',
                )}
              >
                {entry.count}
              </span>
            </div>
            <div className="mt-2 flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
              <span>
                <Money value={entry.value} currency={currency} /> at risk
              </span>
              {entry.unactioned > 0 && (
                <span className="text-[var(--accent-amber)]">
                  <Num value={entry.unactioned} /> unactioned
                </span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ── Row actions ──────────────────────────────────────────────────────────── */

/**
 * One alert action. Stops the click reaching the row (the row opens the
 * quotation), posts, then asks the page to refetch so the tiles move with the
 * table.
 */
function ActionButton({
  label,
  icon,
  alertId,
  action,
  onDone,
}: {
  label: string
  icon: React.ReactNode
  alertId: number
  action: 'nudge' | 'escalate' | 'resolve'
  onDone: (message: string) => void
}) {
  const [busy, setBusy] = React.useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async (e) => {
        // The row itself navigates to the quotation — this must not.
        e.stopPropagation()
        setBusy(true)
        const res = await fetch(`/api/deal-alerts/${alertId}/action`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action }),
        })
        const body = await res.json().catch(() => null)
        setBusy(false)
        onDone(
          res.ok
            ? `${body?.data?.last_action ?? label} — recorded.`
            : (body?.error?.message ?? 'That did not work'),
        )
      }}
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md border border-border px-1.5',
        'text-[0.7rem] font-medium transition-colors',
        busy
          ? 'cursor-not-allowed text-muted-foreground opacity-50'
          : 'cursor-pointer text-foreground hover:bg-muted',
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/**
 * `columns` lives at module scope so its identity never changes (see below), so
 * it cannot close over the page's refetch. The page writes its handler here on
 * mount instead — one mutable slot, rather than rebuilding the column array on
 * every render and re-deriving all of TanStack's row models with it.
 */
const actionSink: { onDone: (message: string) => void } = { onDone: () => {} }

/* ── Columns ──────────────────────────────────────────────────────────────── */

// Module scope: v9 re-derives column state whenever this array's identity
// changes, so it must not be rebuilt on every render.
const col = createDataTableColumns<DealAlertRow>()

const columns: DataTableColumns<DealAlertRow> = col.columns([
  col.accessor('kind', {
    header: 'Alert',
    cell: ({ row }) => <StatusBadge status={row.original.kind} />,
  }),
  col.accessor('quotation_number', {
    header: 'Quotation',
    cell: ({ row }) =>
      row.original.quotation_number ? (
        <span className="font-medium text-foreground">
          {row.original.quotation_number}
        </span>
      ) : (
        <Muted />
      ),
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name ?? <Muted />,
  }),
  col.accessor('risk_band', {
    header: 'Risk',
    cell: ({ row }) =>
      row.original.risk_band ? (
        <StatusBadge status={row.original.risk_band} />
      ) : (
        <Muted />
      ),
  }),
  col.accessor('detail', {
    header: 'Reason',
    // Free text is the one column allowed to wrap rather than widen the table.
    meta: { className: 'whitespace-normal max-w-xs' },
    cell: ({ row }) => row.original.detail ?? <Muted />,
  }),
  col.accessor('grand_total', {
    header: 'Value',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.grand_total}
        currency={row.original.currency_code ?? 'INR'}
        className="font-medium"
      />
    ),
  }),
  col.accessor('flagged_at', {
    header: 'Flagged',
    cell: ({ row }) => (
      <DateValue value={row.original.flagged_at} className="text-muted-foreground" />
    ),
  }),
  col.accessor('last_action', {
    header: 'Last action',
    cell: ({ row }) => {
      const { last_action, last_action_at, last_action_by_name } = row.original
      if (!last_action) {
        return <span className="text-muted-foreground">No action yet</span>
      }
      return (
        <span className="flex flex-col leading-tight">
          <span>{last_action}</span>
          {(last_action_at || last_action_by_name) && (
            <span className="text-xs text-muted-foreground">
              {last_action_by_name}
              {last_action_by_name && last_action_at ? ' · ' : ''}
              {last_action_at ? <DateValue value={last_action_at} /> : null}
            </span>
          )}
        </span>
      )
    },
  }),
  col.display({
    id: 'actions',
    header: 'Actions',
    cell: ({ row }) => (
      // The row navigates to the quotation, so every click in this cell is
      // stopped at the wrapper as well as on the buttons themselves.
      <span
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="flex items-center gap-1"
      >
        <ActionButton
          label="Nudge"
          icon={<BellRing className="size-3" />}
          alertId={row.original.id}
          action="nudge"
          onDone={(m) => actionSink.onDone(m)}
        />
        <ActionButton
          label="Escalate"
          icon={<ChevronsUp className="size-3" />}
          alertId={row.original.id}
          action="escalate"
          onDone={(m) => actionSink.onDone(m)}
        />
      </span>
    ),
  }),
])

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function DealHealthPage() {
  const router = useRouter()
  const { rows, loading, error, retry } =
    useListData<DealAlertRow>('/api/deal-alerts')

  const [notice, setNotice] = React.useState<string | null>(null)

  // Refetch rather than patching one row: the tiles above are derived from the
  // same rows, so a local patch would leave the counts disagreeing with the
  // table until something else reloaded.
  actionSink.onDone = (message) => {
    setNotice(message)
    retry()
  }

  return (
    <>
      <PageHeader
        title="Deal Health"
        description="Stalled deals, discount anomalies and delivery slippage across the pipeline."
      />

      {/* Alerts are now DERIVED, not seeded. retry() refetches the rows and
          the tiles above them from the same source. */}
      <div className="mb-3">
        <AlertScan onDone={retry} />
      </div>

      {notice && (
        <p className="mb-3 rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">
          {notice}
        </p>
      )}

      {/* Tiles are hidden entirely on error — the table's ErrorState is the
          single, honest report of a failed load. */}
      {!error && <SummaryTiles rows={rows} loading={loading} />}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={retry}
        // §B9: an alert opens the quotation it was raised against.  Guarded
        // because the row is only navigable if D1's payload carries the id.
        onRowClick={(row) => {
          if (row.quotation_id) router.push(`/quotations/${row.quotation_id}`)
        }}
        getRowId={(row) => String(row.id)}
        filterPlaceholder="Filter alerts…"
        emptyTitle="No open alerts"
        emptyDescription="Every deal in the pipeline is moving, priced within policy and delivering on time."
        footnote="Click a row to open the quotation the alert was raised against. Nudge records a follow-up; Escalate raises it to the manager."
      />
    </>
  )
}
