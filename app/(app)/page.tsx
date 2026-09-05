// OWNER: D3.  Screen 2 — Sales Dashboard.
//
// A LAUNCHPAD, not an analytics screen.  Its job is to be the place the demo
// starts from and to get you into real work in one click, so it is deliberately
// three tiles and a list.
//
// ONE FETCH.  Everything here is derived from GET /api/quotations, which
// already returns `ORDER BY q.last_activity_at DESC` — so the activity list is
// genuinely "most recently touched quotations" rather than an invented
// cross-system feed, and no new endpoint was created for this screen.
//
// Why not approvals or deal-health tiles:
//   • The original reason — /api/approvals 403'd a sales_rep — no longer holds:
//     D1's RBAC alignment (a9eff6b) admits reps, scoped to their own deals.
//     The tile still derives from `state = 'pending_approval'` in the
//     quotations feed, now for the remaining reason: it is the SAME operational
//     fact, and taking it from the feed already on screen costs no second
//     request and adds no second thing that can fail on the screen the demo
//     opens with.
//   • GET /api/deal-alerts landed in D1's merge and is no longer a stub, but a
//     fourth tile would cost a second request and a second failure mode on the
//     screen that has to load first.  Deal Health has its own screen.
//
// PRESENTATION: every colour here is a token from app/globals.css — no literal
// hex, no palette class — so the screen follows light and dark rather than
// pinning either.  The three tiles use the three ACCENT hues (teal / amber /
// red), which are far enough apart that "steady", "waiting" and "at risk" are
// distinguishable before the labels are read.
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, ArrowUpRight, Clock, Layers } from 'lucide-react'
import { cn } from 'cn'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorState } from '@/components/shared/error-state'
import { DateValue, Money, Num } from '@/components/shared/money'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'
import { Skeleton } from '@/components/ui/skeleton'

/** Subset of GET /api/quotations this screen reads. */
type QuotationRow = {
  id: number
  number: string
  state: string
  currency_code: string
  grand_total: string | number
  risk_band: string
  customer_name: string
  owner_name: string
  last_activity_at: string
}

/** quotation_state values that are still live work. */
const OPEN_STATES = new Set(['draft', 'pending_approval', 'approved', 'negotiation'])

const RECENT_LIMIT = 8

/** Shared card chrome — one definition so the tiles and the activity panel
 *  cannot drift apart on radius, border or shadow. */
const PANEL = 'rounded-xl border border-border bg-card shadow-[var(--shadow-card)]'

type Tile = {
  key: string
  label: string
  hint: string
  count: number
  /** null when the bucket spans more than one currency — see `totalOf`. */
  value: number | null
  currency: string
  icon: React.ReactNode
  /** Token names, not colours — see the palette note in app/globals.css. */
  accent: string
  accentSoft: string
}

/**
 * Sum a bucket, or refuse to.
 *
 * MULTI-CURRENCY IS REAL: `customer.currency_code` is per-customer, and D2's
 * seed handoff (db/seed/handoff/01-identity.additive.sql) gives Siemens EUR and
 * Cipla USD so PS §7's multi-currency path is exercised. The moment either has
 * an open quotation, adding `grand_total` across the bucket adds euros to
 * rupees and labels the result with whichever currency happened to sort first.
 *
 * Converting is not an option here: the rates live in `fx_rate` and applying
 * them is server-side business logic, not something a dashboard tile should
 * reinvent from a hardcoded number. So a mixed bucket reports its COUNT and
 * says the total is unavailable, rather than showing a confident wrong figure.
 */
function totalOf(list: QuotationRow[], fallbackCurrency: string) {
  const codes = new Set(list.map((r) => r.currency_code).filter(Boolean))

  if (codes.size > 1) return { value: null, currency: '' }

  const value = list.reduce((sum, r) => {
    const n = Number(r.grand_total)
    return Number.isFinite(n) ? sum + n : sum
  }, 0)

  return { value, currency: [...codes][0] ?? fallbackCurrency }
}

function summarise(rows: QuotationRow[]): Tile[] {
  const buckets = {
    open: [] as QuotationRow[],
    awaiting: [] as QuotationRow[],
    risk: [] as QuotationRow[],
  }

  for (const row of rows) {
    const live = OPEN_STATES.has(row.state)
    if (live) buckets.open.push(row)
    if (row.state === 'pending_approval') buckets.awaiting.push(row)
    if (live && row.risk_band?.toUpperCase() === 'HIGH') buckets.risk.push(row)
  }

  // Only used when a bucket is empty and so has no currency of its own.
  const fallback = rows[0]?.currency_code ?? 'INR'

  return [
    {
      key: 'open',
      label: 'Open pipeline',
      hint: 'Draft, pending, approved or in negotiation',
      count: buckets.open.length,
      ...totalOf(buckets.open, fallback),
      icon: <Layers className="size-5" />,
      accent: 'var(--accent-teal)',
      accentSoft: 'var(--accent-teal-soft)',
    },
    {
      key: 'awaiting',
      label: 'Awaiting approval',
      hint: 'Submitted and sitting in the approval chain',
      count: buckets.awaiting.length,
      ...totalOf(buckets.awaiting, fallback),
      icon: <Clock className="size-5" />,
      accent: 'var(--accent-amber)',
      accentSoft: 'var(--accent-amber-soft)',
    },
    {
      key: 'risk',
      label: 'High risk',
      hint: 'Open deals scored HIGH by the risk engine',
      count: buckets.risk.length,
      ...totalOf(buckets.risk, fallback),
      icon: <AlertTriangle className="size-5" />,
      accent: 'var(--accent-red)',
      accentSoft: 'var(--accent-red-soft)',
    },
  ]
}

/* ── Page header ──────────────────────────────────────────────────────────── */

// Local rather than the shared <PageHeader>: this is the one screen with an
// eyebrow and a display-size title.  It is one weight heavier and one step
// larger than the list screens so the demo's landing page reads as the top of
// the hierarchy rather than as another list.
function DashboardHeader() {
  return (
    <div className="mb-6">
      <p className="text-[0.7rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        Sales operations
      </p>
      <h1 className="mt-1.5 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
        Sales Dashboard
      </h1>
      <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
        Where the pipeline stands right now, and what needs attention first.
      </p>
    </div>
  )
}

/* ── Summary tiles ────────────────────────────────────────────────────────── */

function SummaryTiles({
  rows,
  loading,
}: {
  rows: QuotationRow[] | undefined
  loading: boolean
}) {
  const tiles = React.useMemo(() => (rows ? summarise(rows) : null), [rows])

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-[10.5rem] w-full rounded-xl" />
        ))}
      </div>
    )
  }

  // No rows means the request did not succeed. A zero here would assert
  // "nothing in the pipeline" when the truth is "not loaded".
  if (!tiles) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href="/quotations"
          className={cn(
            PANEL,
            // One `transition-*` utility: cn() keeps only the last of two, so
            // listing both properties here is what actually animates both.
            'group/tile block p-4 transition-[box-shadow,border-color]',
            'hover:border-border/80 hover:shadow-md',
            'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <span
              aria-hidden
              className="flex size-11 items-center justify-center rounded-xl"
              style={{ backgroundColor: tile.accentSoft, color: tile.accent }}
            >
              {tile.icon}
            </span>
            <ArrowUpRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100" />
          </div>

          <p className="mt-4 text-xs font-bold tracking-wide text-muted-foreground uppercase">
            {tile.label}
          </p>

          <p
            className="mt-1 text-3xl leading-none font-semibold tabular-nums"
            // A zero is not an alarm — it stays neutral rather than taking the
            // tile's accent colour.
            style={tile.count === 0 ? undefined : { color: tile.accent }}
          >
            {tile.count}
          </p>

          <p className="mt-2 text-xs text-muted-foreground">{tile.hint}</p>

          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
            <span className="text-xs text-muted-foreground">Total value</span>
            {tile.value === null ? (
              // Mixed currencies: the count above is still true, so the tile
              // stays useful — it just declines to invent a converted total.
              <span
                className="text-xs font-medium text-muted-foreground"
                title="This group spans more than one currency, so a single total would be meaningless without applying FX rates."
              >
                Mixed currencies
              </span>
            ) : (
              <Money
                value={tile.value}
                currency={tile.currency}
                className="text-sm font-medium text-foreground"
              />
            )}
          </div>
        </Link>
      ))}
    </div>
  )
}

/* ── Recent activity ──────────────────────────────────────────────────────── */

// A real <table>, not a flex list: these are five aligned fields per row, and a
// table is what gives them column headers, a header row a screen reader can
// announce cells against, and honest column separation.  It is NOT the shared
// <DataTable> — that carries filtering, sorting and pagination, none of which
// belong on an eight-row launchpad summary.
const COLUMNS = [
  { key: 'number', label: 'Quotation', align: 'left' },
  { key: 'customer', label: 'Customer', align: 'left' },
  { key: 'status', label: 'Status', align: 'left' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'activity', label: 'Last activity', align: 'right' },
] as const

/** Vertical rules on every cell but the first — the "sectioned" look — kept at
 *  /40 because --border is red-tinted and full strength reads as a grid. */
const CELL = 'px-4 py-3 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-border/40'

function RecentActivity({
  rows,
  loading,
  onOpen,
}: {
  rows: QuotationRow[] | undefined
  loading: boolean
  onOpen: (row: QuotationRow) => void
}) {
  // `rows === undefined` and not loading means the request failed; the screen
  // above already renders the error, so the table renders nothing at all.
  if (!rows && !loading) return null

  const visible = rows?.slice(0, RECENT_LIMIT) ?? []

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/60">
            {COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  CELL,
                  'py-2.5 text-xs font-bold tracking-wide text-muted-foreground uppercase',
                  column.align === 'right' ? 'text-right' : 'text-left',
                  // The date column is the first to go on a narrow viewport;
                  // the other four carry the row on their own.
                  column.key === 'activity' && 'hidden md:table-cell',
                  column.key === 'status' && 'hidden sm:table-cell',
                )}
              >
                {column.label}
              </th>
            ))}
          </tr>
        </thead>

        <tbody className="divide-y divide-border">
          {loading &&
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i}>
                <td className={CELL} colSpan={COLUMNS.length}>
                  <Skeleton className="h-4 w-full" />
                </td>
              </tr>
            ))}

          {!loading && visible.length === 0 && (
            <tr>
              <td colSpan={COLUMNS.length}>
                <EmptyState
                  title="No quotation activity yet"
                  description="Activity appears here as soon as a sales rep creates a quotation."
                />
              </td>
            </tr>
          )}

          {!loading &&
            visible.map((row) => (
              // ACCESSIBILITY: deliberately NOT role="button".  Putting a
              // button role on a <tr> discards the row semantics a screen
              // reader uses to read each cell against its column header — the
              // headers added above would stop being announced.  Tab reaches
              // the row, Enter/Space opens it, and focus-visible mirrors hover.
              <tr
                key={row.id}
                tabIndex={0}
                onClick={() => onOpen(row)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onOpen(row)
                  }
                }}
                className={cn(
                  'cursor-pointer transition-colors outline-none',
                  'hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)]',
                )}
              >
                <td
                  className={cn(CELL, 'font-semibold tracking-tight whitespace-nowrap')}
                >
                  {row.number}
                </td>
                {/* w-full + max-w-0 is the table equivalent of flex-1 min-w-0:
                    the cell absorbs the slack, and a long customer name
                    truncates instead of widening the row past the card. */}
                <td className={cn(CELL, 'w-full max-w-0 truncate text-foreground/80')}>
                  {row.customer_name}
                </td>
                <td className={cn(CELL, 'hidden sm:table-cell')}>
                  <StatusBadge status={row.state} />
                </td>
                <td className={cn(CELL, 'text-right whitespace-nowrap')}>
                  <Money
                    value={row.grand_total}
                    currency={row.currency_code}
                    className="font-medium text-foreground"
                  />
                </td>
                <td
                  className={cn(
                    CELL,
                    'hidden text-right text-xs whitespace-nowrap text-muted-foreground md:table-cell',
                  )}
                >
                  <DateValue value={row.last_activity_at} />
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function DashboardPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<QuotationRow>('/api/quotations')

  const openQuotation = React.useCallback(
    (row: QuotationRow) => router.push(`/quotations/${row.id}`),
    [router],
  )

  return (
    <>
      <DashboardHeader />

      {error ? (
        // One failed request means neither the tiles nor the list can be
        // trusted, so the screen reports the failure once instead of showing
        // three zeroes above an empty list.
        <div className={PANEL}>
          <ErrorState error={error} onRetry={retry} />
        </div>
      ) : (
        <>
          <SummaryTiles rows={rows} loading={loading} />

          <section className="mt-8">
            <div className={cn(PANEL, 'overflow-hidden')}>
              <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-foreground">
                    Recent activity
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Most recently updated quotations
                  </p>
                </div>
                {/* The header band carries the action; the count moved to the
                    status band below so it is stated once, in the same place
                    the list screens state it. */}
                <Link
                  href="/quotations"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium text-primary transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  All quotations
                  <ArrowRight className="size-3" />
                </Link>
              </header>

              <RecentActivity rows={rows} loading={loading} onOpen={openQuotation} />

              {/* Status band, inside the panel and ruled off — the same shape
                  the list screens use, so the dashboard's table and a real list
                  are recognisably the same component. */}
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2">
                <p className="text-xs text-muted-foreground">
                  {rows && (
                    <span className="font-medium text-foreground tabular-nums">
                      {rows.length} {rows.length === 1 ? 'record' : 'records'}
                    </span>
                  )}
                  {rows ? ' · ' : null}
                  Click a row to open the quotation.
                </p>
                {rows && rows.length > RECENT_LIMIT && (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    Showing <Num value={RECENT_LIMIT} /> of <Num value={rows.length} />
                  </span>
                )}
              </div>
            </div>
          </section>
        </>
      )}
    </>
  )
}
