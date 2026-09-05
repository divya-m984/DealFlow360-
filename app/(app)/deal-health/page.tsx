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
// ── NUDGE / ESCALATE ARE NOT WIRED YET ──────────────────────────────────────
// BLOCKED ON D1: app/api/deal-alerts/[id]/action/route.ts is still a 501 stub.
// Its POST() takes no arguments and declares no zod schema, so the request
// contract is undefined — only the method, the path and the
// { data } | { error: { message } } envelope are determinable.  D3 will not
// guess a body shape, so the buttons are rendered in a disabled, clearly
// labelled state and send nothing.
//
// D1 MUST SUPPLY, before these can be wired:
//   • the request body — which key carries the action, and its accepted values
//   • whether a note/comment field is expected alongside it
//   • the success payload (returning the updated alert row would let this
//     screen skip a refetch)
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
                <span className="text-amber-300">
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

const ACTION_UNAVAILABLE = 'Awaiting backend support — the action endpoint is not implemented yet.'

/**
 * Rendered disabled and inert until D1 defines the POST contract (see the
 * header of this file).  It deliberately has no onClick: there is no request
 * to send that would not be a guess.
 */
function ActionButton({
  label,
  icon,
}: {
  label: string
  icon: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className={cn(
        'inline-flex h-6 cursor-not-allowed items-center gap-1 rounded-md border border-border px-1.5',
        'text-[0.7rem] font-medium text-muted-foreground opacity-50',
      )}
    >
      {icon}
      {label}
      <span className="sr-only"> — {ACTION_UNAVAILABLE}</span>
    </button>
  )
}

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
    cell: () => (
      // The row navigates to the quotation. stopPropagation stays on the
      // wrapper even while the buttons are inert: the wrapper itself is not
      // disabled, so a click on it would otherwise bubble and navigate.
      <span
        title={ACTION_UNAVAILABLE}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        className="flex items-center gap-1"
      >
        <ActionButton label="Nudge" icon={<BellRing className="size-3" />} />
        <ActionButton label="Escalate" icon={<ChevronsUp className="size-3" />} />
      </span>
    ),
  }),
])

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function DealHealthPage() {
  const router = useRouter()
  const { rows, loading, error, retry } =
    useListData<DealAlertRow>('/api/deal-alerts')

  return (
    <>
      <PageHeader
        title="Deal Health"
        description="Stalled deals, discount anomalies and delivery slippage across the pipeline."
      />

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
        footnote="Click a row to open the quotation the alert was raised against. Nudge and Escalate are awaiting their backend endpoint."
      />
    </>
  )
}
