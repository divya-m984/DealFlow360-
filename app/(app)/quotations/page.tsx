// OWNER: D3.  Screen 3 — Quotations.
//
// ONE view over ONE fetch: the pipeline board (§B1/§B2).  The table view was
// removed — the board already carries every field the table showed, and a
// second representation of the same eight rows was a toggle to maintain rather
// than information to read.  Terminal-state quotations, which used to be
// reachable only from the table, now get their own "Closed" lane.
//
// The board is a VIEW, not a workflow editor.  There is no drag-and-drop and no
// state mutation: quotation state changes only through D1's submit/approve
// endpoints, where the governance rules live.
//
// CONTRACT: matched against the landed GET /api/quotations (D1).  Every field
// the Phase 1 provisional shape guessed turned out to exist under the same
// name, so nothing had to be remapped; the optional markers are simply gone now
// that the joins are known to be INNER.  The type stays local rather than
// shared — lib/types/quotation.ts belongs to D1, and a barrel type is a
// guaranteed cross-lane conflict.
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { cn } from 'cn'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorState } from '@/components/shared/error-state'
import { DateValue, Money } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'
// ⚠ Cross-lane, flagged in OWNERSHIP.md: D2 added the filter bar. The API has
// accepted seven filter params since it was written and this screen sent
// none. Self-contained — delete these two additions to remove it.
import {
  QuotationFilters, buildQuotationUrl, type QuotationFilterValue,
} from '@/components/filters/quotation-filters'
import { Skeleton } from '@/components/ui/skeleton'
import { NewQuotationButton } from '@/components/quotation/new-quotation-button'

type QuotationRow = {
  id: number
  public_id: string
  number: string
  state: string
  version: number
  risk_score: string | number
  risk_band: string
  requires_manager: boolean
  requires_finance: boolean
  grand_total: string | number
  margin_total: string | number
  currency_code: string
  created_at: string
  last_activity_at: string
  customer_name: string
  tier_name: string
  owner_name: string
  /** LEFT JOIN on sales_team — null for a rep with no team. */
  team_name: string | null
}

/* ── Pipeline definition ──────────────────────────────────────────────────────
 * The five columns the mockup shows.  `quotation_state` has EIGHT values; the
 * three terminal ones (rejected / cancelled / expired) are not pipeline stages
 * and get no lane of their own here.  They are not dropped either — they
 * collect in the "Closed" lane the board appends when any exist.  A board that
 * hides rows without saying so is worse than one with an extra column.
 * ------------------------------------------------------------------------- */
const PIPELINE = [
  { state: 'draft', label: 'Draft' },
  { state: 'pending_approval', label: 'Pending Approval' },
  { state: 'approved', label: 'Approved' },
  { state: 'negotiation', label: 'Negotiation' },
  { state: 'confirmed', label: 'Confirmed' },
] as const

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
        'cursor-pointer rounded-md border border-border bg-card p-3 text-left transition-colors',
        'hover:border-foreground/20 hover:bg-[var(--row-hover)]',
        'focus-visible:bg-[var(--row-hover)] outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
    >
      {/* Identifier and money on one baseline, both at full contrast: they are
          what the eye lands on first, and everything below them is support. */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold tracking-tight text-foreground">
          {row.number}
        </span>
        <Money
          value={row.grand_total}
          currency={row.currency_code}
          className="shrink-0 text-sm font-semibold text-foreground"
        />
      </div>

      {/* Tier sits with the customer: it is what picked the pricelist this
          quotation was built from, so it explains the number above it. */}
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {row.customer_name}
        <span className="text-muted-foreground/70"> · {row.tier_name}</span>
      </p>

      {/* The state badge repeats the lane it sits in, but a card must be
          readable on its own, and it is what tells a Closed-lane card apart
          from its neighbours.  The risk SCORE next to the band is the number
          the approval thresholds actually key off. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <StatusBadge status={row.state} />
        <StatusBadge status={row.risk_band} />
        <span className="text-[0.7rem] text-muted-foreground tabular-nums">
          {Number(row.risk_score).toFixed(0)}
        </span>
        <span className="ml-auto shrink-0 text-[0.7rem] text-muted-foreground tabular-nums">
          v{row.version}
        </span>
      </div>

      {/* Margin is the server's figure, not a ratio computed here — the reason
          a discount matters is that it eats this number.  The approval chain
          beside it says what the deal will still have to clear. */}
      <div className="mt-2 flex items-center justify-between gap-2 text-[0.7rem]">
        <span className="truncate text-muted-foreground">
          Margin{' '}
          <Money
            value={row.margin_total}
            currency={row.currency_code}
            className="text-[0.7rem] font-medium text-foreground"
          />
        </span>
        {(row.requires_manager || row.requires_finance) && (
          <span
            className="shrink-0 font-medium text-muted-foreground"
            title={`Approval required: ${[
              row.requires_manager && 'sales manager',
              row.requires_finance && 'finance',
            ]
              .filter(Boolean)
              .join(' then ')}`}
          >
            Needs{' '}
            {[row.requires_manager && 'M', row.requires_finance && 'F']
              .filter(Boolean)
              .join('+')}
          </span>
        )}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-border pt-2 text-[0.7rem] text-muted-foreground">
        {/* team_name is a LEFT JOIN and is null for a rep with no team. */}
        <span className="truncate">
          {row.owner_name}
          {row.team_name && (
            <span className="text-muted-foreground/70"> · {row.team_name}</span>
          )}
        </span>
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
  // The five pipeline stages, plus a sixth "Closed" lane that only exists when
  // something is actually in it.  That lane is why the board can be the only
  // view: rejected / cancelled / expired quotations used to be reachable only
  // by switching to the table, so dropping the table without it would have
  // made those rows unreachable from this screen.
  const columns = React.useMemo(() => {
    const map = new Map<string, QuotationRow[]>(PIPELINE.map((c) => [c.state, []]))
    const closed: QuotationRow[] = []

    for (const row of rows ?? []) {
      const bucket = map.get(row.state)
      if (bucket) bucket.push(row)
      else closed.push(row)
    }

    const lanes = PIPELINE.map((c) => ({
      key: c.state,
      label: c.label,
      cards: map.get(c.state) ?? [],
    }))

    return closed.length > 0
      ? [...lanes, { key: '__closed__', label: 'Closed', cards: closed }]
      : lanes
  }, [rows])

  if (loading) {
    return (
      <div className="flex gap-4 overflow-x-auto pb-2">
        {PIPELINE.map((column) => (
          <div key={column.state} className="w-72 shrink-0 space-y-2">
            <Skeleton className="h-10 w-full rounded-lg" />
            {Array.from({ length: 3 }).map((_, i) => (
              // Matches the real card height so the board does not jump when
              // the data lands — cards grew with the margin/approval row.
              <Skeleton key={i} className="h-[8.5rem] w-full rounded-md" />
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
      {/* CENTRING A SCROLLABLE ROW.  `justify-center` on the scroll container
          itself would put the overflow beyond the LEFT edge, where it cannot be
          scrolled back to.  An inner `mx-auto w-max` centres the lanes while
          they fit and becomes a no-op once they do not, so the board is centred
          on a wide screen and still fully scrollable on a narrow one. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="mx-auto flex w-max snap-x items-stretch gap-4">
          {columns.map((column) => (
            <section
              key={column.key}
              aria-label={column.label}
              className="flex w-72 shrink-0 snap-start flex-col rounded-lg border border-border bg-muted/60"
            >
              {/* Plain type, not a StatusBadge: the badge duplicated the one on
                  every card below it, so the header was spending colour to say
                  what the cards already said. */}
              <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
                <h3 className="truncate text-xs font-bold tracking-wide text-foreground uppercase">
                  {column.label}
                </h3>
                <span className="shrink-0 rounded-sm border border-border bg-card px-1.5 text-[0.7rem] font-semibold text-muted-foreground tabular-nums">
                  {column.cards.length}
                </span>
              </header>

              <div className="flex-1 space-y-2 p-2">
                {column.cards.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-2.5 py-6 text-center text-xs text-muted-foreground">
                    Nothing at this stage
                  </p>
                ) : (
                  column.cards.map((row) => (
                    <QuotationCard key={row.id} row={row} onOpen={onOpen} />
                  ))
                )}
              </div>
            </section>
          ))}
        </div>
      </div>

      <p className="pt-2 text-center text-xs text-muted-foreground">
        Click a card to open the quotation.
      </p>
    </>
  )
}

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function QuotationsPage() {
  const router = useRouter()
  const [filters, setFilters] = React.useState<QuotationFilterValue>({})
  // useListData refetches when the url changes, and the url IS the filter
  // state — so there is no second source of truth to keep in step.
  const url = React.useMemo(() => buildQuotationUrl(filters), [filters])
  const { rows, loading, error, retry } = useListData<QuotationRow>(url)

  const openQuotation = React.useCallback(
    (row: QuotationRow) => router.push(`/quotations/${row.id}`),
    [router],
  )

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Every quotation in the pipeline, across all customers and stages."
        // The mockup puts "+ New Quotation" on this screen and the dashboard.
        // Until now the app had no way to start one at all — POST
        // /api/quotations existed, but nothing called it, so PS §9 step 2
        // ("create a quotation") could not be performed from the UI.
        actions={<NewQuotationButton onCreated={retry} />}
      />

      <QuotationFilters
        value={filters}
        onChange={setFilters}
        rows={rows}
        total={rows?.length}
      />

      {error ? (
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
