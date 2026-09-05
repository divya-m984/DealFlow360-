// OWNER: D3.  Screen 3 — Quotations.
//
// PHASE 1/2: the table view only.  This screen is the template the other seven
// list screens are cloned from, so it is deliberately thin: columns,
// useListData, <DataTable>, row click.
//
// NOT YET BUILT (Phase 3): the kanban pipeline view (Draft / Pending Approval /
// Approved / Negotiation / Confirmed) and the "Switch to Table View" toggle.
//
// The row shape below is D3's read of the `quotation` table as it is exposed by
// D1's GET /api/quotations.  It is NOT a shared type — lib/types/quotation.ts
// belongs to D1, and a barrel type is a guaranteed cross-lane conflict.  Every
// joined field is optional so that a narrower payload renders "—" rather than
// crashing the list.
'use client'

import { useRouter } from 'next/navigation'
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
} from '@/components/data-table'
import { DateValue, Money, Num } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'

type QuotationRow = {
  id: number
  number: string
  state: string
  currency_code?: string
  grand_total?: string | number
  risk_band?: string
  risk_score?: string | number
  version?: number
  customer_name?: string
  owner_name?: string
  last_activity_at?: string
  created_at?: string
}

function Muted() {
  return <span className="text-muted-foreground">—</span>
}

// Module scope: v9 re-derives column state whenever this array's identity
// changes, so it must not be rebuilt on every render.
const col = createDataTableColumns<QuotationRow>()

const columns: DataTableColumns<QuotationRow> = col.columns([
  col.accessor('number', {
    header: 'Quotation',
    cell: ({ row }) => (
      <span className="font-medium text-foreground">{row.original.number}</span>
    ),
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name ?? <Muted />,
  }),
  col.accessor('state', {
    header: 'Stage',
    cell: ({ row }) => <StatusBadge status={row.original.state} />,
  }),
  col.accessor('risk_band', {
    header: 'Risk',
    cell: ({ row }) => {
      const { risk_band, risk_score } = row.original
      if (!risk_band) return <Muted />
      return (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={risk_band} />
          {risk_score !== undefined && risk_score !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {Number(risk_score).toFixed(0)}
            </span>
          )}
        </span>
      )
    },
  }),
  col.accessor('grand_total', {
    header: 'Total',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.grand_total}
        currency={row.original.currency_code ?? 'INR'}
        className="font-medium"
      />
    ),
  }),
  col.accessor('owner_name', {
    header: 'Owner',
    cell: ({ row }) => row.original.owner_name ?? <Muted />,
  }),
  col.accessor('version', {
    header: 'Ver.',
    meta: { align: 'right' },
    cell: ({ row }) =>
      row.original.version ? (
        <Num value={row.original.version} className="text-muted-foreground" />
      ) : (
        <Muted />
      ),
  }),
  col.accessor('last_activity_at', {
    header: 'Last activity',
    cell: ({ row }) => (
      <DateValue
        value={row.original.last_activity_at}
        className="text-muted-foreground"
      />
    ),
  }),
])

export default function QuotationsPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<QuotationRow>('/api/quotations')

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Every quotation in the pipeline, across all customers and stages."
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={retry}
        onRowClick={(row) => router.push(`/quotations/${row.id}`)}
        getRowId={(row) => String(row.id)}
        filterPlaceholder="Filter quotations…"
        emptyTitle="No quotations yet"
        emptyDescription="Quotations will appear here once a sales rep creates one."
        footnote="Click a row to open the quotation."
      />
    </>
  )
}
