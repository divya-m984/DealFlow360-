// OWNER: D3.  Screen 7 — Fulfilment and Stock.
//
// Confirmed orders and how far each one has been allocated across warehouses.
// The allocation engine itself — which warehouse, how many shipments, what
// backorders — is D2's application logic in lib/allocate.ts.  This screen
// renders its output and nothing more; no allocation decision is made here.
//
// PROVISIONAL CONTRACT.  GET /api/fulfilment is still a 501 stub owned by D2
// with no declared response type.  The row shape is derived from `sales_order`
// in db/schema.sql plus the summary fields a list view needs, which D2's query
// has to aggregate from `fulfillment_allocation` and `backorder` (both are
// per-order-line, so a per-order list cannot show them without a rollup).
// Only `id` and `state` are treated as required.
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
  /** order_state: confirmed | split_pending | partially_fulfilled | fulfilled | backorder | cancelled */
  state: string
  number?: string
  quotation_id?: number
  quotation_number?: string
  customer_name?: string
  currency_code?: string
  grand_total?: string | number
  /** Rollups over the order's lines. */
  line_count?: number
  lines_allocated?: number
  qty_backordered?: string | number
  /** Whichever shape D2 sends: a joined string or a real array of codes. */
  warehouses?: string | string[]
  promised_delivery_date?: string
  created_at?: string
}

function Muted() {
  return <span className="text-muted-foreground">—</span>
}

function warehouseList(value: string | string[] | undefined) {
  if (!value) return []
  return Array.isArray(value) ? value : value.split(',').map((s) => s.trim())
}

const col = createDataTableColumns<FulfilmentRow>()

const columns: DataTableColumns<FulfilmentRow> = col.columns([
  col.accessor('number', {
    header: 'Order',
    cell: ({ row }) => {
      const { number, quotation_number } = row.original
      return (
        <span className="flex flex-col leading-tight">
          <span className="font-medium text-foreground">
            {number ?? `#${row.original.id}`}
          </span>
          {quotation_number && (
            <span className="text-xs text-muted-foreground">
              from {quotation_number}
            </span>
          )}
        </span>
      )
    },
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name ?? <Muted />,
  }),
  col.accessor('state', {
    header: 'State',
    cell: ({ row }) => <StatusBadge status={row.original.state} />,
  }),
  col.accessor('lines_allocated', {
    header: 'Allocated',
    meta: { align: 'right' },
    cell: ({ row }) => {
      const { lines_allocated, line_count } = row.original
      if (lines_allocated === undefined || line_count === undefined) return <Muted />
      const complete = lines_allocated >= line_count
      return (
        <span
          className={cnAllocated(complete)}
          title={`${lines_allocated} of ${line_count} order lines allocated`}
        >
          {lines_allocated}/{line_count}
        </span>
      )
    },
  }),
  col.accessor('qty_backordered', {
    header: 'Backordered',
    meta: { align: 'right' },
    cell: ({ row }) => {
      const qty = row.original.qty_backordered
      if (qty === undefined || qty === null || Number(qty) === 0) {
        return <span className="text-muted-foreground">—</span>
      }
      return <Num value={qty} className="font-medium text-red-300" />
    },
  }),
  col.accessor('warehouses', {
    header: 'Warehouses',
    cell: ({ row }) => {
      const list = warehouseList(row.original.warehouses)
      if (list.length === 0) return <Muted />
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {list.map((code) => (
            <span
              key={code}
              className="rounded border border-border bg-muted/60 px-1.5 text-[0.7rem] leading-5 text-muted-foreground"
            >
              {code}
            </span>
          ))}
        </span>
      )
    },
  }),
  col.accessor('promised_delivery_date', {
    header: 'Promised',
    cell: ({ row }) => (
      <DateValue
        value={row.original.promised_delivery_date}
        className="text-muted-foreground"
      />
    ),
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
])

/** A fully allocated order is unremarkable; a partial one is the thing to see. */
function cnAllocated(complete: boolean) {
  return complete
    ? 'tabular-nums text-muted-foreground'
    : 'tabular-nums font-medium text-amber-300'
}

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
