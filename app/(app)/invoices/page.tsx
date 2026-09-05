// OWNER: D3.  Screen 12 — Invoices.
//
// One-time and recurring invoices in one list.  Payment recording, proration
// and credit notes are D2's application logic; this screen renders invoice rows.
//
// PROVISIONAL CONTRACT.  GET /api/invoices is still a 501 stub owned by D2
// with no declared response type.  The row shape is derived from `invoice` in
// db/schema.sql.  `amount_total`, `status`, `issue_date` and `due_date` are
// real columns; `amount_paid` / `amount_outstanding` are rollups D2 must
// aggregate from `payment` (there is no stored paid-to-date column), so both
// are optional here and the outstanding figure falls back to a local
// subtraction only when the API supplies paid but not outstanding.
// Only `id` and `status` are treated as required.
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
  number?: string
  customer_name?: string
  /** line_type: 'one_time' | 'recurring' */
  kind?: string
  currency_code?: string
  amount_total?: string | number
  amount_paid?: string | number
  amount_outstanding?: string | number
  issue_date?: string
  due_date?: string
}

function Muted() {
  return <span className="text-muted-foreground">—</span>
}

/** Prefer the API's own figure; derive only when it sent paid but not outstanding. */
function outstandingOf(row: InvoiceRow) {
  if (row.amount_outstanding !== undefined && row.amount_outstanding !== null) {
    return row.amount_outstanding
  }
  if (row.amount_total === undefined || row.amount_paid === undefined) return undefined
  const total = Number(row.amount_total)
  const paid = Number(row.amount_paid)
  return Number.isFinite(total) && Number.isFinite(paid) ? total - paid : undefined
}

/** Past the due date and still owing — the only row state worth colouring. */
function isOverdue(row: InvoiceRow) {
  if (!row.due_date) return false
  if (row.status === 'paid' || row.status === 'void') return false
  const due = new Date(row.due_date)
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now()
}

const col = createDataTableColumns<InvoiceRow>()

const columns: DataTableColumns<InvoiceRow> = col.columns([
  col.accessor('number', {
    header: 'Invoice',
    cell: ({ row }) => (
      <span className="font-medium text-foreground">
        {row.original.number ?? `#${row.original.id}`}
      </span>
    ),
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name ?? <Muted />,
  }),
  col.accessor('kind', {
    header: 'Kind',
    cell: ({ row }) =>
      row.original.kind ? <StatusBadge status={row.original.kind} /> : <Muted />,
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
        currency={row.original.currency_code ?? 'INR'}
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
        currency={row.original.currency_code ?? 'INR'}
        className="text-muted-foreground"
      />
    ),
  }),
  col.display({
    id: 'outstanding',
    header: 'Outstanding',
    meta: { align: 'right' },
    cell: ({ row }) => {
      const value = outstandingOf(row.original)
      if (value === undefined) return <Muted />
      const owed = Number(value) > 0
      return (
        <Money
          value={value}
          currency={row.original.currency_code ?? 'INR'}
          className={owed ? 'font-medium' : 'text-muted-foreground'}
        />
      )
    },
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
          isOverdue(row.original) ? 'font-medium text-red-300' : 'text-muted-foreground'
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
