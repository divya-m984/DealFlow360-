// OWNER: D3.  Screen 7 — Fulfilment and Stock.
//
// Confirmed orders and how far each one has been allocated across warehouses.
// The allocation engine itself — which warehouse, how many shipments, what
// backorders — is D2's application logic in lib/allocate.ts.  This screen
// renders its output and nothing more; no allocation decision is made here.
//
// CONTRACT: matched against the landed GET /api/fulfilment (D2).  The Phase 2
// provisional shape guessed wrong in four places and has been corrected:
//   • there is no `line_count` / `lines_allocated` — the API returns per-status
//     allocation COUNTS (planned_allocations / reserved_allocations /
//     shipped_allocations)
//   • there is no `qty_backordered` — it is `open_backorders`, a COUNT of
//     unresolved backorder rows, not a quantity
//   • there is no warehouse code list — it is `warehouses_used`, an integer
//     count of DISTINCT warehouses on the order
//   • there is no `quotation_id`; only `quotation_number` is joined through
// `is_late` is computed in SQL against CURRENT_DATE, so lateness is the
// server's answer rather than a client clock comparison.
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

type FulfilmentRow = {
  id: number
  number: string
  /** order_state: confirmed | split_pending | partially_fulfilled | fulfilled | backorder | cancelled */
  state: string
  customer_id: number
  customer_name: string
  currency_code: string
  grand_total: string | number
  promised_delivery_date: string | null
  created_at: string
  quotation_number: string
  is_late: boolean
  planned_allocations: number
  reserved_allocations: number
  shipped_allocations: number
  warehouses_used: number
  open_backorders: number
  shipping_cost: string | number
}

/** Allocation rows by status — nothing at all is the operationally notable case. */
function AllocationSummary({ row }: { row: FulfilmentRow }) {
  const parts: string[] = []
  if (row.planned_allocations) parts.push(`${row.planned_allocations} planned`)
  if (row.reserved_allocations) parts.push(`${row.reserved_allocations} reserved`)
  if (row.shipped_allocations) parts.push(`${row.shipped_allocations} shipped`)

  if (parts.length === 0) {
    return <span className="font-medium text-[var(--accent-amber)]">Not allocated</span>
  }
  return (
    <span className="whitespace-nowrap text-muted-foreground tabular-nums">
      {parts.join(' · ')}
    </span>
  )
}

const col = createDataTableColumns<FulfilmentRow>()

const columns: DataTableColumns<FulfilmentRow> = col.columns([
  col.accessor('number', {
    header: 'Order',
    cell: ({ row }) => (
      <span className="flex flex-col leading-tight">
        <span className="font-medium text-foreground">{row.original.number}</span>
        <span className="text-xs text-muted-foreground">
          from {row.original.quotation_number}
        </span>
      </span>
    ),
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name,
  }),
  col.accessor('state', {
    header: 'State',
    cell: ({ row }) => <StatusBadge status={row.original.state} />,
  }),
  col.display({
    id: 'allocations',
    header: 'Allocation',
    cell: ({ row }) => <AllocationSummary row={row.original} />,
  }),
  col.accessor('warehouses_used', {
    header: 'WH',
    meta: { align: 'right', headerClassName: 'w-12' },
    // Zero renders as an em dash, matching Backorders below — a column of
    // literal zeroes reads as data when it means "nothing here yet".
    cell: ({ row }) =>
      row.original.warehouses_used > 0 ? (
        <Num value={row.original.warehouses_used} className="text-muted-foreground" />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  }),
  col.accessor('open_backorders', {
    header: 'Backorders',
    meta: { align: 'right' },
    cell: ({ row }) =>
      row.original.open_backorders > 0 ? (
        <Num value={row.original.open_backorders} className="font-medium text-destructive" />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  }),
  col.accessor('promised_delivery_date', {
    header: 'Promised',
    cell: ({ row }) => (
      <DateValue
        value={row.original.promised_delivery_date}
        className={
          row.original.is_late ? 'font-medium text-destructive' : 'text-muted-foreground'
        }
      />
    ),
  }),
  col.accessor('grand_total', {
    header: 'Total',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.grand_total}
        currency={row.original.currency_code}
        className="font-medium"
      />
    ),
  }),
])

export default function FulfilmentPage() {
  const router = useRouter()
  const { rows, loading, error, retry } =
    useListData<FulfilmentRow>('/api/fulfilment')

  return (
    <>
      <PageHeader
        title="Fulfilment and Stock"
        description="Confirmed orders awaiting fulfilment, with live allocation across warehouses."
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={retry}
        onRowClick={(row) => router.push(`/fulfilment/${row.id}`)}
        getRowId={(row) => String(row.id)}
        filterPlaceholder="Filter orders…"
        emptyTitle="No orders to fulfil"
        emptyDescription="Orders appear here once a confirmed quotation is turned into a sales order."
        footnote="Click a row to open the allocation plan."
      />
    </>
  )
}
