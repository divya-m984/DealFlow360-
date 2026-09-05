// OWNER: D3.  Screen 3 — Quotations.
//
// Two views over ONE fetch: the pipeline board (§B1/§B2) and the table.  The
// view toggle is local UI state and is not persisted; both views read the same
// `rows` from useListData, so switching never costs a request and the two can
// never disagree about what the pipeline contains.
//
// The board is a VIEW, not a workflow editor.  There is no drag-and-drop and no
// state mutation: quotation state changes only through D1's submit/approve
// endpoints, where the governance rules live.
//
// The row shape below is D3's read of the `quotation` table as it is exposed by
// D1's GET /api/quotations.  It is NOT a shared type — lib/types/quotation.ts
// belongs to D1, and a barrel type is a guaranteed cross-lane conflict.  Every
// joined field is optional so that a narrower payload renders "—" rather than
// crashing the list.
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Columns3, Table2 } from 'lucide-react'
import { cn } from 'cn'
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
} from '@/components/data-table'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorState } from '@/components/shared/error-state'
import { DateValue, Money, Num } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'
import { Skeleton } from '@/components/ui/skeleton'

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

/* ── Pipeline definition ──────────────────────────────────────────────────────
 * The five columns the mockup shows.  `quotation_state` has EIGHT values; the
 * three terminal ones (rejected / cancelled / expired) are not pipeline stages
 * and deliberately have no column.  Rows in those states are counted and
 * reported under the board rather than silently dropped — a board that hides
 * rows without saying so is worse than one that shows fewer columns.
 * ------------------------------------------------------------------------- */
const PIPELINE = [
  { state: 'draft', label: 'Draft' },
  { state: 'pending_approval', label: 'Pending Approval' },
  { state: 'approved', label: 'Approved' },
  { state: 'negotiation', label: 'Negotiation' },
  { state: 'confirmed', label: 'Confirmed' },
] as const

/* ── Table view ───────────────────────────────────────────────────────────── */

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

/* ── Board view ───────────────────────────────────────────────────────────── */

function QuotationCard({
  row,
  onOpen,
}: {
  row: QuotationRow
  onOpen: (row: QuotationRow) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen(row)
        }
      }}
      className={cn(
        'cursor-pointer rounded-lg border border-border bg-card p-2.5 text-left transition-colors',
        'hover:border-border hover:bg-accent/60 focus-visible:bg-accent/60',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-medium text-foreground">
          {row.number}
        </span>
        <Money
          value={row.grand_total}
          currency={row.currency_code ?? 'INR'}
          className="shrink-0 text-sm font-medium"
        />
      </div>

      <p className="mt-0.5 truncate text-xs text-muted-foreground">
        {row.customer_name ?? 'Unknown customer'}
      </p>

      {/* The state badge repeats the column it sits in, but a card must be
          readable on its own — and it keeps the board and the table showing
          the same badge for the same quotation. */}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={row.state} />
        {row.risk_band && <StatusBadge status={row.risk_band} />}
        {row.version !== undefined && (
          <span className="text-[0.7rem] text-muted-foreground tabular-nums">
            v{row.version}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/70 pt-1.5 text-[0.7rem] text-muted-foreground">
        <span className="truncate">{row.owner_name ?? 'Unassigned'}</span>
        <DateValue value={row.last_activity_at} className="shrink-0 text-[0.7rem]" />
      </div>
    </div>
  )
}

function PipelineBoard({
  rows,
  loading,
  onOpen,
}: {
  rows: QuotationRow[] | undefined
  loading: boolean
  onOpen: (row: QuotationRow) => void
}) {
  const grouped = React.useMemo(() => {
    const map = new Map<string, QuotationRow[]>(PIPELINE.map((c) => [c.state, []]))
    let excluded = 0
    for (const row of rows ?? []) {
      const bucket = map.get(row.state)
      if (bucket) bucket.push(row)
      else excluded += 1
    }
    return { map, excluded }
  }, [rows])

  if (loading) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-2">
        {PIPELINE.map((column) => (
          <div key={column.state} className="w-72 shrink-0 space-y-2">
            <Skeleton className="h-8 w-full" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 w-full" />
            ))}
          </div>
        ))}
      </div>
    )
  }

  if (rows && rows.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <EmptyState
          title="No quotations yet"
          description="Quotations will appear here once a sales rep creates one."
        />
      </div>
    )
  }

  return (
    <>
      {/* Horizontal scroll keeps every column at a readable width instead of
          compressing five columns into an unusable board on a laptop. */}
      <div className="flex snap-x gap-3 overflow-x-auto pb-2">
        {PIPELINE.map((column) => {
          const cards = grouped.map.get(column.state) ?? []
          return (
            <section
              key={column.state}
              aria-label={column.label}
              className="w-72 shrink-0 snap-start"
            >
              <header className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-2.5 py-1.5">
                <StatusBadge status={column.state} label={column.label} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {cards.length}
                </span>
              </header>

              <div className="space-y-2">
                {cards.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border px-2.5 py-6 text-center text-xs text-muted-foreground">
                    Nothing at this stage
                  </p>
                ) : (
                  cards.map((row) => (
                    <QuotationCard key={row.id} row={row} onOpen={onOpen} />
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>

      <p className="pt-1.5 text-xs text-muted-foreground">
        Click a card to open the quotation.
        {grouped.excluded > 0 && (
          <>
            {' '}
            <Num value={grouped.excluded} /> rejected, cancelled or expired{' '}
            {grouped.excluded === 1 ? 'quotation is' : 'quotations are'} not shown on
            the board — switch to Table view to see every quotation.
          </>
        )}
      </p>
    </>
  )
}

/* ── View switch ──────────────────────────────────────────────────────────── */

type View = 'pipeline' | 'table'

function ViewSwitch({
  view,
  onChange,
}: {
  view: View
  onChange: (view: View) => void
}) {
  const options: Array<{ value: View; label: string; icon: React.ReactNode }> = [
    { value: 'pipeline', label: 'Pipeline', icon: <Columns3 className="size-3.5" /> },
    { value: 'table', label: 'Table', icon: <Table2 className="size-3.5" /> },
  ]

  return (
    <div
      role="group"
      aria-label="Quotation view"
      className="inline-flex items-center gap-0.5 rounded-lg border border-border bg-card p-0.5"
    >
      {options.map((option) => {
        const active = view === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function QuotationsPage() {
  const router = useRouter()
  const [view, setView] = React.useState<View>('pipeline')
  const { rows, loading, error, retry } = useListData<QuotationRow>('/api/quotations')

  const openQuotation = React.useCallback(
    (row: QuotationRow) => router.push(`/quotations/${row.id}`),
    [router],
  )

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Every quotation in the pipeline, across all customers and stages."
        actions={<ViewSwitch view={view} onChange={setView} />}
      />

      {view === 'table' ? (
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          error={error}
          onRetry={retry}
          onRowClick={openQuotation}
          getRowId={(row) => String(row.id)}
          filterPlaceholder="Filter quotations…"
          emptyTitle="No quotations yet"
          emptyDescription="Quotations will appear here once a sales rep creates one."
          footnote="Click a row to open the quotation."
        />
      ) : error ? (
        // The board shows the same real API error the table would — never an
        // empty pipeline standing in for a failed request.
        <div className="rounded-lg border border-border bg-card">
          <ErrorState error={error} onRetry={retry} />
        </div>
      ) : (
        <PipelineBoard rows={rows} loading={loading} onOpen={openQuotation} />
      )}
    </>
  )
}
