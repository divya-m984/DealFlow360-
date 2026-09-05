// OWNER: D3.  Screen 9 — Subscriptions.
//
// Every recurring plan across every customer.  Proration, cancellation notice
// and refund policy are D2's application logic in lib/billing.ts; this screen
// renders subscription rows and never computes an amount itself.
//
// CONTRACT: matched against the landed GET /api/subscriptions (D2).  The
// recurring amount arrives as `period_amount` — `round(sp.price * s.qty, 2)`,
// computed in SQL — NOT as the `amount` the Phase 2 provisional shape guessed.
// D3 does not multiply price by qty itself; that stays a server calculation.
// `subscription` still has no human-readable number column, so the reference
// column shows the real numeric id rather than inventing a document number.
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

type SubscriptionRow = {
  id: number
  /** sub_status: 'active' | 'paused' | 'cancelled' */
  status: string
  customer_id: number
  customer_name: string
  plan_id: number
  plan_name: string
  /** billing_cycle: weekly | monthly | quarterly | yearly */
  cycle: string
  plan_price: string | number
  currency_code: string
  qty: string | number
  /** round(plan_price * qty, 2), computed in SQL. */
  period_amount: string | number
  current_period_start: string
  current_period_end: string
  /** Schema permits this only while active. */
  next_bill_date: string | null
  source_order_id: number | null
  source_order_number: string | null
  proration_events: number
}

function Muted() {
  return <span className="text-muted-foreground">—</span>
}

const col = createDataTableColumns<SubscriptionRow>()

const columns: DataTableColumns<SubscriptionRow> = col.columns([
  col.accessor('id', {
    header: 'Ref.',
    cell: ({ row }) => (
      <span className="font-medium text-foreground tabular-nums">
        #{row.original.id}
      </span>
    ),
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name,
  }),
  col.accessor('plan_name', {
    header: 'Plan',
    cell: ({ row }) => row.original.plan_name,
  }),
  col.accessor('cycle', {
    header: 'Cadence',
    cell: ({ row }) => <StatusBadge status={row.original.cycle} />,
  }),
  col.accessor('status', {
    header: 'Status',
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
  }),
  col.accessor('qty', {
    header: 'Qty',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Num value={row.original.qty} className="text-muted-foreground" />
    ),
  }),
  col.accessor('period_amount', {
    header: 'Amount',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.period_amount}
        currency={row.original.currency_code}
        className="font-medium"
      />
    ),
  }),
  col.accessor('current_period_end', {
    header: 'Current period',
    cell: ({ row }) => (
      <span className="whitespace-nowrap text-muted-foreground tabular-nums">
        <DateValue value={row.original.current_period_start} /> –{' '}
        <DateValue value={row.original.current_period_end} />
      </span>
    ),
  }),
  col.accessor('next_bill_date', {
    header: 'Next billing',
    cell: ({ row }) =>
      // The schema permits next_bill_date only while active, so a blank cell
      // on a paused or cancelled row is correct rather than missing data.
      row.original.next_bill_date ? (
        <DateValue value={row.original.next_bill_date} />
      ) : (
        <Muted />
      ),
  }),
])

export default function SubscriptionsPage() {
  const router = useRouter()
  const { rows, loading, error, retry } =
    useListData<SubscriptionRow>('/api/subscriptions')

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Every recurring plan across every customer, with its next billing date."
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={retry}
        onRowClick={(row) => router.push(`/subscriptions/${row.id}`)}
        getRowId={(row) => String(row.id)}
        filterPlaceholder="Filter subscriptions…"
        emptyTitle="No subscriptions yet"
        emptyDescription="A subscription is created when an order containing a recurring line is confirmed."
        footnote="Click a row to open the subscription."
      />
    </>
  )
}
