// OWNER: D3.  Screen 14 — Deal Health.
//
// PHASE 2: the alert table only.
// NOT YET BUILT (Phase 3): the three summary tiles (Stalled Deals / Discount
// Anomalies / Delivery Slippage) and the per-row Nudge and Escalate actions.
// Those actions write deal_alert.last_action / last_action_at /
// last_action_by_user_id through D1's POST /api/deal-alerts/[id]/action — D3
// never writes that SQL, and the endpoint is still a stub.
//
// Alerts are RENDERED, not derived: the screen does not infer staleness from
// quotation columns, so unresolved `deal_alert` rows must exist in the seed or
// this list is legitimately empty.
//
// PROVISIONAL CONTRACT.  GET /api/deal-alerts is still a 501 stub owned by D1
// with no declared response type.  The row shape is derived from `deal_alert`
// in db/schema.sql plus the quotation/customer joins the screen needs.
// Only `id` and `kind` are treated as required.
'use client'

import { useRouter } from 'next/navigation'
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
} from '@/components/data-table'
import { DateValue, Money } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'

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
])

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
        footnote="Click a row to open the quotation the alert was raised against."
      />
    </>
  )
}
