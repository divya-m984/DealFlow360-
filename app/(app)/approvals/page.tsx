// OWNER: D3.  Screen 5 — Approvals.
//
// Every quotation currently in the approval chain, at whichever level it is
// sitting.  The chain itself (routing, thresholds, who may act) is D1's
// application logic in lib/approval.ts — this screen only renders the queue.
//
// CONTRACT: matched against the landed GET /api/approvals (D1).  The quotation
// number arrives as `number` (aliased from `qq.number`), NOT `quotation_number`.
// `assigned_to_name` and `acted_by_name` come from LEFT JOINs and are genuinely
// nullable; everything else is INNER-JOINed and always present.
//
// ROLE GATE (updated by D1's RBAC alignment, a9eff6b): reading and acting are
// now different rights.  GET admits sales_rep as well as manager/finance/admin,
// but a rep is scoped in the SQL WHERE clause to quotations they OWN — so a rep
// opening this screen sees a SHORTER queue rather than a 403, and never sees
// another rep's pipeline.  Acting is still manager/finance/admin, on POST
// /api/approvals/[id].
//
// This screen therefore needs no role branch of its own: it renders whatever
// rows the session is entitled to, and the empty state ("nothing waiting on
// you") is the honest answer for a rep with no deals in the chain.
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
  seq: number
  quotation_id: number
  quotation_version: number
  /** The QUOTATION's number — aliased as `number` by the API, not `quotation_number`. */
  number: string
  /** quotation_state of the parent quotation. */
  quotation_state: string
  customer_name: string
  tier_name: string
  owner_name: string
  risk_band: string
  risk_score: string | number
  currency_code: string
  grand_total: string | number
  /** LEFT JOINs — genuinely null when unassigned or not yet acted on. */
  assigned_to_name: string | null
  acted_by_name: string | null
  acted_at: string | null
  note: string | null
  created_at: string
}

const col = createDataTableColumns<ApprovalRow>()

const columns: DataTableColumns<ApprovalRow> = col.columns([
  col.accessor('number', {
    header: 'Quotation',
    cell: ({ row }) => (
      <span className="inline-flex items-baseline gap-1.5">
        <span className="font-medium text-foreground">{row.original.number}</span>
        <span className="text-xs text-muted-foreground">
          v{row.original.quotation_version}
        </span>
      </span>
    ),
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    // Tier under the name: it is the reason the discount ceiling this approval
    // exists to police is set where it is, so it belongs next to the customer
    // rather than in a column of its own.
    cell: ({ row }) => (
      <span className="flex flex-col leading-tight">
        <span className="text-foreground">{row.original.customer_name}</span>
        <span className="text-xs text-muted-foreground">{row.original.tier_name}</span>
      </span>
    ),
  }),
  col.accessor('quotation_state', {
    header: 'Stage',
    // The approval's own status is not the quotation's state — a quotation can
    // sit in `negotiation` while an earlier approval step reads `approved`.
    cell: ({ row }) => <StatusBadge status={row.original.quotation_state} />,
  }),
  col.accessor('owner_name', {
    header: 'Owner',
    // Who raised it, as distinct from who has to sign it off.
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.owner_name}</span>
    ),
  }),
  col.accessor('level', {
    header: 'Step',
    cell: ({ row }) => {
      const { level, seq } = row.original
      return (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={level} />
          <span className="text-xs text-muted-foreground tabular-nums">#{seq}</span>
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
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-1.5">
        <StatusBadge status={row.original.risk_band} />
        <span className="text-xs text-muted-foreground tabular-nums">
          {Number(row.original.risk_score).toFixed(0)}
        </span>
      </span>
    ),
  }),
  col.accessor('grand_total', {
    header: 'Value',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.grand_total}
        currency={row.original.currency_code}
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
    // The note is the approver's reason. It only exists once someone has acted,
    // and it is the single most useful thing on a returned or rejected row —
    // "why did this come back" is the question the screen has to answer.
    cell: ({ row }) => {
      const { acted_at, note } = row.original
      return (
        <span className="flex flex-col leading-tight">
          <DateValue value={acted_at} className="text-muted-foreground" />
          {note && (
            <span
              className="max-w-[16rem] truncate text-xs text-muted-foreground italic"
              title={note}
            >
              “{note}”
            </span>
          )}
        </span>
      )
    },
  }),
])

export default function ApprovalsPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<ApprovalRow>('/api/approvals')

  return (
    <>
      <PageHeader
        title="Approvals"
        // "you can see" is doing real work now that reps are admitted: a rep's
        // queue is scoped to their own deals, so this screen is genuinely a
        // different list per role rather than one shared queue.
        description="Every quotation in the approval chain you can see, with the level it is waiting on."
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
