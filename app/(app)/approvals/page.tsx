// OWNER: D3.  Screen 5 — Approvals.
//
// Every quotation currently in the approval chain, at whichever level it is
// sitting.  The chain itself (routing, thresholds, who may act) is D1's
// application logic in lib/approval.ts — this screen only renders the queue.
//
// PROVISIONAL CONTRACT.  GET /api/approvals is still a 501 stub owned by D1
// with no declared response type, so the row shape below is derived from the
// `approval_request` table in db/schema.sql plus the joins a queue screen
// obviously needs (quotation number, customer, the two user names).  Only `id`,
// `level` and `status` are treated as required; everything else renders "—" if
// D1's payload turns out narrower.
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

type ApprovalRow = {
  id: number
  /** approval_level: 'sales_manager' | 'finance' */
  level: string
  /** approval_status: 'pending' | 'approved' | 'returned' | 'rejected' */
  status: string
  seq?: number
  quotation_id?: number
  quotation_number?: string
  quotation_version?: number
  customer_name?: string
  risk_band?: string
  currency_code?: string
  grand_total?: string | number
  assigned_to_name?: string
  acted_by_name?: string
  acted_at?: string
  created_at?: string
}

function Muted() {
  return <span className="text-muted-foreground">—</span>
}

const col = createDataTableColumns<ApprovalRow>()

const columns: DataTableColumns<ApprovalRow> = col.columns([
  col.accessor('quotation_number', {
    header: 'Quotation',
    cell: ({ row }) => {
      const { quotation_number, quotation_version } = row.original
      if (!quotation_number) return <Muted />
      return (
        <span className="inline-flex items-baseline gap-1.5">
          <span className="font-medium text-foreground">{quotation_number}</span>
          {quotation_version !== undefined && (
            <span className="text-xs text-muted-foreground">v{quotation_version}</span>
          )}
        </span>
      )
    },
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name ?? <Muted />,
  }),
  col.accessor('level', {
    header: 'Step',
    cell: ({ row }) => {
      const { level, seq } = row.original
      return (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={level} />
          {seq !== undefined && (
            <span className="text-xs text-muted-foreground tabular-nums">#{seq}</span>
          )}
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
    cell: ({ row }) =>
      row.original.risk_band ? (
        <StatusBadge status={row.original.risk_band} />
      ) : (
        <Muted />
      ),
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
    cell: ({ row }) => (
      <DateValue value={row.original.acted_at} className="text-muted-foreground" />
    ),
  }),
])

export default function ApprovalsPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<ApprovalRow>('/api/approvals')

  return (
    <>
      <PageHeader
        title="Approvals"
        description="Every quotation in the approval chain, with the level it is waiting on."
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={retry}
        onRowClick={(row) => router.push(`/approvals/${row.id}`)}
        getRowId={(row) => String(row.id)}
        filterPlaceholder="Filter approvals…"
        emptyTitle="Nothing awaiting approval"
        emptyDescription="Quotations appear here when a rep submits one that breaches a discount ceiling."
        footnote="Click a row to open the approval."
      />
    </>
  )
}
