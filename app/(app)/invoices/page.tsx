// OWNER: D3.  Screen 12 — Invoices.
//
// One-time and recurring invoices in one list.  Payment recording, proration
// and credit notes are D2's application logic; this screen renders invoice rows.
//
// CONTRACT: matched against the landed GET /api/invoices (D2).  Two Phase 2
// guesses were wrong and have been corrected:
//   • the outstanding figure is `amount_due`, not `amount_outstanding`, and it
//     is computed in SQL as (amount_total - COALESCE(paid, 0))
//   • `is_overdue` is computed in SQL against CURRENT_DATE, so the screen no
//     longer compares dates against the browser clock
// `amount_paid` is SUMmed from `payment` and never stored — see lib/invoice.ts.
// D3 performs no money arithmetic of its own here.
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

type InvoiceRow = {
  id: number
  /** invoice_status: 'unpaid' | 'partial' | 'paid' | 'void' */
  status: string
  number: string
  customer_id: number
  customer_name: string
  order_id: number | null
  order_number: string | null
  subscription_id: number | null
  /** line_type: 'one_time' | 'recurring' */
  kind: string
  currency_code: string
  amount_total: string | number
  /** SUM over `payment`, never stored. */
  amount_paid: string | number
  /** amount_total - amount_paid, computed in SQL. */
  amount_due: string | number
  is_overdue: boolean
  issue_date: string
  due_date: string
}

const col = createDataTableColumns<InvoiceRow>()

const columns: DataTableColumns<InvoiceRow> = col.columns([
  col.accessor('number', {
    header: 'Invoice',
    cell: ({ row }) => (
      <span className="flex flex-col leading-tight">
        <span className="font-medium text-foreground">{row.original.number}</span>
        {row.original.order_number && (
          <span className="text-xs text-muted-foreground">
            from {row.original.order_number}
          </span>
        )}
      </span>
    ),
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name,
  }),
  col.accessor('kind', {
    header: 'Kind',
    cell: ({ row }) => <StatusBadge status={row.original.kind} />,
  }),
  col.accessor('status', {
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  }),
  col.accessor('amount_total', {
    header: 'Total',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.amount_total}
        currency={row.original.currency_code}
        className="font-medium"
      />
    ),
  }),
  col.accessor('amount_paid', {
    header: 'Paid',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.amount_paid}
        currency={row.original.currency_code}
        className="text-muted-foreground"
      />
    ),
  }),
  col.accessor('amount_due', {
    header: 'Outstanding',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.amount_due}
        currency={row.original.currency_code}
        className={
          Number(row.original.amount_due) > 0 ? 'font-medium' : 'text-muted-foreground'
        }
      />
    ),
  }),
  col.accessor('issue_date', {
    header: 'Issued',
    cell: ({ row }) => (
      <DateValue value={row.original.issue_date} className="text-muted-foreground" />
    ),
  }),
  col.accessor('due_date', {
    header: 'Due',
    cell: ({ row }) => (
      <DateValue
        value={row.original.due_date}
        className={
          row.original.is_overdue
            ? 'font-medium text-destructive'
            : 'text-muted-foreground'
        }
      />
    ),
  }),
])

export default function InvoicesPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<InvoiceRow>('/api/invoices')

  return (
    <>
      <PageHeader
        title="Invoices"
        description="One-time and recurring invoices, with what is still outstanding on each."
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={retry}
        onRowClick={(row) => router.push(`/invoices/${row.id}`)}
        getRowId={(row) => String(row.id)}
        filterPlaceholder="Filter invoices…"
        emptyTitle="No invoices yet"
        emptyDescription="Invoices are raised from confirmed orders and from each subscription billing run."
        footnote="Click a row to open the invoice."
      />
    </>
  )
}
