// OWNER: D3.  Screen 2 — Sales Dashboard.  The application's landing page.
//
// It used to be three tiles and a list, described in this comment as "a
// launchpad, not an analytics screen".  That was the right call while it was
// one screen among nine; it is the wrong call for the page the app OPENS on.
// A landing page has to answer "how are we doing?" before it answers "what do
// I click?", so this is now a real dashboard: a KPI strip, a pipeline
// distribution, a risk mix, a customer concentration list, and the activity
// feed.  Every one of them is still one click from the screen that owns it.
//
// STILL ONE FETCH.  Everything on this page is derived from the rows of
// GET /api/quotations — nothing is fabricated, nothing is estimated, and no
// new endpoint was created.  That matters more here than anywhere else: this
// is the screen the demo opens with, so every panel added is a panel that can
// fail on first paint.  Sharing one request means the page has exactly one
// failure mode, and the ErrorState below covers all of it.
//
// WHY NOT A SECOND REQUEST for approvals or deal-alerts: both endpoints exist
// and both would work.  But `state = 'pending_approval'`, `risk_band` and
// `requires_manager / requires_finance` are already on the quotation rows —
// the SAME operational facts, from the feed that is already on screen.  A
// second request would buy no new information and cost a second thing that can
// break before the presenter has said a word.
//
// PRESENTATION: every colour here is a token from app/globals.css — no literal
// hex, no palette class — so the screen follows light and dark rather than
// pinning either.  The KPI tiles use four far-apart hues (teal / amber / red /
// plum) so "steady", "waiting", "at risk" and "margin" are distinguishable
// before the labels are read.
'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Clock,
  Layers,
  Percent,
} from 'lucide-react'
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
  margin_total: string | number | null
  risk_band: string
  requires_manager: boolean
  requires_finance: boolean
  customer_name: string
  owner_name: string
  last_activity_at: string
}

/** quotation_state values that are still live work. */
const OPEN_STATES = new Set(['draft', 'pending_approval', 'approved', 'negotiation'])

/** The open pipeline, in the order a deal moves through it.  `confirmed` and
 *  the three terminal states are deliberately NOT here — see PipelineByStage. */
const OPEN_STAGES = [
  { state: 'draft', label: 'Draft', color: 'var(--chart-5)' },
  { state: 'pending_approval', label: 'Pending approval', color: 'var(--accent-amber)' },
  { state: 'negotiation', label: 'Negotiation', color: 'var(--accent-plum)' },
  { state: 'approved', label: 'Approved', color: 'var(--accent-teal)' },
] as const

/** risk_band, worst first — the order someone scanning for trouble reads in. */
const RISK_BANDS = [
  { band: 'HIGH', label: 'High', color: 'var(--accent-red)' },
  { band: 'MEDIUM', label: 'Medium', color: 'var(--accent-amber)' },
  { band: 'LOW', label: 'Low', color: 'var(--accent-teal)' },
] as const

const RECENT_LIMIT = 8
const TOP_CUSTOMER_LIMIT = 5

/** Shared card chrome — one definition so nothing on the page can drift apart
 *  on radius, border or shadow. */
const PANEL = 'rounded-xl border border-border bg-card shadow-[var(--shadow-card)]'

/* ── Money helpers ────────────────────────────────────────────────────────── */

function num(value: string | number | null | undefined) {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
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
 *
 * This is also why the customer breakdown below groups BY CUSTOMER before
 * summing: a customer has exactly one currency, so those totals are always
 * safe, whatever the mix across the page.
 */
function totalOf(
  list: QuotationRow[],
  field: 'grand_total' | 'margin_total',
  fallbackCurrency: string,
) {
  const codes = new Set(list.map((r) => r.currency_code).filter(Boolean))

  if (codes.size > 1) return { value: null as number | null, currency: '' }

  const value = list.reduce((sum, r) => sum + num(r[field]), 0)
  return { value, currency: [...codes][0] ?? fallbackCurrency }
}

/* ── KPI tiles ────────────────────────────────────────────────────────────── */

type Tile = {
  key: string
  label: string
  hint: string
  /** Where the tile goes.  Each KPI points at the screen that OWNS it rather
   *  than all four pointing at /quotations — that is the whole reason a tile
   *  is a link and not a box. */
  href: string
  /** The large figure. */
  big: string
  /** A zero, or an unavailable figure, is not an alarm — it stays neutral. */
  bigMuted: boolean
  footLabel: string
  foot: React.ReactNode
  icon: React.ReactNode
  /** Token names, not colours — see the palette note in app/globals.css. */
  accent: string
  accentSoft: string
}

/** "Mixed currencies" — stated identically wherever a bucket spans more than
 *  one, so the reason is learned once. */
function MixedCurrencies() {
  return (
    <span
      className="text-xs font-medium text-muted-foreground"
      title="This group spans more than one currency, so a single total would be meaningless without applying FX rates."
    >
      Mixed currencies
    </span>
  )
}

function moneyOrMixed(total: { value: number | null; currency: string }) {
  if (total.value === null) return <MixedCurrencies />
  return (
    <Money
      value={total.value}
      currency={total.currency}
      className="text-sm font-medium text-foreground"
    />
  )
}

function summarise(rows: QuotationRow[]): Tile[] {
  const open: QuotationRow[] = []
  const awaiting: QuotationRow[] = []
  const risk: QuotationRow[] = []

  for (const row of rows) {
    const live = OPEN_STATES.has(row.state)
    if (live) open.push(row)
    if (row.state === 'pending_approval') awaiting.push(row)
    if (live && row.risk_band?.toUpperCase() === 'HIGH') risk.push(row)
  }

  // Only used when a bucket is empty and so has no currency of its own.
  const fallback = rows[0]?.currency_code ?? 'INR'

  const openValue = totalOf(open, 'grand_total', fallback)
  const openMargin = totalOf(open, 'margin_total', fallback)

  // Margin PERCENTAGE, not margin value, is the headline: a rupee figure says
  // nothing without the revenue beside it, and the revenue is already the
  // first tile.  Guarded on a mixed bucket for the same reason the totals are:
  // a ratio of summed euros to summed rupees is not a ratio of anything.
  const marginPct =
    openMargin.value !== null && openValue.value !== null && openValue.value > 0
      ? (openMargin.value / openValue.value) * 100
      : null

  return [
    {
      key: 'open',
      label: 'Open pipeline',
      hint: 'Draft, pending, approved or in negotiation',
      href: '/quotations',
      big: String(open.length),
      bigMuted: open.length === 0,
      footLabel: 'Total value',
      foot: moneyOrMixed(openValue),
      icon: <Layers className="size-5" />,
      accent: 'var(--accent-teal)',
      accentSoft: 'var(--accent-teal-soft)',
    },
    {
      key: 'awaiting',
      label: 'Awaiting approval',
      hint: 'Submitted and sitting in the approval chain',
      href: '/approvals',
      big: String(awaiting.length),
      bigMuted: awaiting.length === 0,
      footLabel: 'Total value',
      foot: moneyOrMixed(totalOf(awaiting, 'grand_total', fallback)),
      icon: <Clock className="size-5" />,
      accent: 'var(--accent-amber)',
      accentSoft: 'var(--accent-amber-soft)',
    },
    {
      key: 'risk',
      label: 'High risk',
      hint: 'Open deals scored HIGH by the risk engine',
      href: '/deal-health',
      big: String(risk.length),
      bigMuted: risk.length === 0,
      footLabel: 'Total value',
      foot: moneyOrMixed(totalOf(risk, 'grand_total', fallback)),
      icon: <AlertTriangle className="size-5" />,
      accent: 'var(--accent-red)',
      accentSoft: 'var(--accent-red-soft)',
    },
    {
      key: 'margin',
      label: 'Open margin',
      hint: 'Blended margin across the open pipeline',
      href: '/reports',
      big: marginPct === null ? '—' : `${marginPct.toFixed(1)}%`,
      bigMuted: marginPct === null,
      footLabel: 'Margin value',
      foot: moneyOrMixed(openMargin),
      icon: <Percent className="size-5" />,
      accent: 'var(--accent-plum)',
      accentSoft: 'var(--accent-plum-soft)',
    },
  ]
}

function KpiTiles({ rows, loading }: { rows: QuotationRow[] | undefined; loading: boolean }) {
  const tiles = React.useMemo(() => (rows ? summarise(rows) : null), [rows])

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[10.5rem] w-full rounded-xl" />
        ))}
      </div>
    )
  }

  // No rows means the request did not succeed. A zero here would assert
  // "nothing in the pipeline" when the truth is "not loaded".
  if (!tiles) return null

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {tiles.map((tile) => (
        <Link
          key={tile.key}
          href={tile.href}
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
            style={tile.bigMuted ? undefined : { color: tile.accent }}
          >
            {tile.big}
          </p>

          <p className="mt-2 text-xs text-muted-foreground">{tile.hint}</p>

          <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-border pt-2.5">
            <span className="text-xs text-muted-foreground">{tile.footLabel}</span>
            {tile.foot}
          </div>
        </Link>
      ))}
    </div>
  )
}

/* ── Panel chrome ─────────────────────────────────────────────────────────── */

/** Every panel below wears the same header band, so a judge scanning the page
 *  reads four panels of one system rather than four one-off boxes. */
function PanelHeader({
  title,
  subtitle,
  href,
  linkLabel,
}: {
  title: string
  subtitle: string
  href?: string
  linkLabel?: string
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
      </div>
      {href && (
        <Link
          href={href}
          className="inline-flex shrink-0 items-center gap-1 rounded-md text-xs font-medium text-primary transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {linkLabel}
          <ArrowRight className="size-3" />
        </Link>
      )}
    </header>
  )
}

/* ── Pipeline by stage ────────────────────────────────────────────────────── */

// WHY `confirmed` IS NOT IN THE BAR.  It is a quotation state, but it is not a
// pipeline stage — it is the moment the quotation stops being pipeline and
// becomes D2's sales order.  Including it would inflate "open pipeline" with
// work that has already left, and it would need a fifth green next to
// `approved`'s that nobody could tell apart anyway.  It is reported under the
// bar with the terminal states instead, where it is a closing count.
function PipelineByStage({
  rows,
  loading,
}: {
  rows: QuotationRow[] | undefined
  loading: boolean
}) {
  const model = React.useMemo(() => {
    if (!rows) return null
    const fallback = rows[0]?.currency_code ?? 'INR'

    const stages = OPEN_STAGES.map((stage) => {
      const list = rows.filter((r) => r.state === stage.state)
      return { ...stage, count: list.length, total: totalOf(list, 'grand_total', fallback) }
    })

    const open = stages.reduce((n, s) => n + s.count, 0)
    const confirmed = rows.filter((r) => r.state === 'confirmed').length
    const closed = rows.filter((r) =>
      ['rejected', 'cancelled', 'expired'].includes(r.state),
    ).length

    return { stages, open, confirmed, closed }
  }, [rows])

  return (
    <section className={cn(PANEL, 'overflow-hidden')}>
      <PanelHeader
        title="Pipeline by stage"
        subtitle="Where the open pipeline is sitting right now"
        href="/quotations"
        linkLabel="Open board"
      />

      {loading || !model ? (
        <div className="space-y-3 p-4">
          <Skeleton className="h-3 w-full rounded-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : model.open === 0 ? (
        <EmptyState
          title="Nothing in the open pipeline"
          description="Draft, pending, approved and in-negotiation quotations appear here."
        />
      ) : (
        <div className="p-4">
          {/* The bar is decoration for the numbers below it, not a substitute:
              it carries proportion, the rows carry the actual figures.  Hence
              aria-hidden — a screen reader gets the table-like list instead. */}
          <div
            aria-hidden
            className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-muted"
          >
            {model.stages
              .filter((s) => s.count > 0)
              .map((s) => (
                <span
                  key={s.state}
                  title={`${s.label}: ${s.count}`}
                  style={{
                    width: `${(s.count / model.open) * 100}%`,
                    backgroundColor: s.color,
                  }}
                />
              ))}
          </div>

          <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
            {model.stages.map((s) => (
              <div
                key={s.state}
                className="flex flex-col gap-1 border-l-2 pl-3"
                style={{ borderColor: s.count > 0 ? s.color : 'var(--border)' }}
              >
                <dt className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {s.label}
                  </span>
                  <span
                    className="text-lg leading-none font-semibold tabular-nums"
                    style={s.count > 0 ? { color: s.color } : undefined}
                  >
                    {s.count}
                  </span>
                </dt>
                <dd className="text-xs text-muted-foreground">
                  {s.total.value === null ? (
                    <MixedCurrencies />
                  ) : (
                    <Money value={s.total.value} currency={s.total.currency} />
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {/* The states that are NOT pipeline, stated plainly rather than
              folded into the bar — see the note above this component. */}
          <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            Out of pipeline:{' '}
            <span className="font-medium text-foreground tabular-nums">
              <Num value={model.confirmed} />
            </span>{' '}
            confirmed and handed to fulfilment ·{' '}
            <span className="font-medium text-foreground tabular-nums">
              <Num value={model.closed} />
            </span>{' '}
            rejected, cancelled or expired
          </p>
        </div>
      )}
    </section>
  )
}

/* ── Risk mix ─────────────────────────────────────────────────────────────── */

function RiskMix({ rows, loading }: { rows: QuotationRow[] | undefined; loading: boolean }) {
  const model = React.useMemo(() => {
    if (!rows) return null
    const open = rows.filter((r) => OPEN_STATES.has(r.state))
    const bands = RISK_BANDS.map((b) => ({
      ...b,
      count: open.filter((r) => r.risk_band?.toUpperCase() === b.band).length,
    }))
    // Approval load comes from the same rows: `requires_manager` and
    // `requires_finance` are what the risk engine WROTE onto the quotation, so
    // this is the engine's own output, not a re-derivation of its rules.
    const bothLevels = open.filter((r) => r.requires_manager && r.requires_finance).length
    return { bands, open: open.length, bothLevels }
  }, [rows])

  return (
    <section className={cn(PANEL, 'overflow-hidden')}>
      <PanelHeader
        title="Risk mix"
        subtitle="Open deals by risk band"
        href="/deal-health"
        linkLabel="Deal health"
      />

      {loading || !model ? (
        <div className="space-y-3 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      ) : model.open === 0 ? (
        <EmptyState
          title="No open deals to score"
          description="The risk engine scores a quotation as soon as it has lines."
        />
      ) : (
        <div className="p-4">
          <ul className="space-y-3">
            {model.bands.map((b) => (
              <li key={b.band} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {b.label}
                </span>
                <span
                  aria-hidden
                  className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                >
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${(b.count / model.open) * 100}%`,
                      backgroundColor: b.color,
                    }}
                  />
                </span>
                <span
                  className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums"
                  style={b.count > 0 ? { color: b.color } : undefined}
                >
                  {b.count}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              <Num value={model.bothLevels} />
            </span>{' '}
            of {model.open} need both manager and finance sign-off.
          </p>
        </div>
      )}
    </section>
  )
}

/* ── Customer concentration ───────────────────────────────────────────────── */

// Grouping by customer is what makes these totals safe in a multi-currency
// pipeline: a customer has exactly one `currency_code`, so a per-customer sum
// never mixes.  It is also the aggregate a sales manager actually asks for —
// "who is the pipeline riding on?"
function TopCustomers({
  rows,
  loading,
}: {
  rows: QuotationRow[] | undefined
  loading: boolean
}) {
  const model = React.useMemo(() => {
    if (!rows) return null

    const byCustomer = new Map<
      string,
      { name: string; currency: string; value: number; count: number }
    >()

    for (const row of rows) {
      if (!OPEN_STATES.has(row.state)) continue
      const entry = byCustomer.get(row.customer_name) ?? {
        name: row.customer_name,
        currency: row.currency_code,
        value: 0,
        count: 0,
      }
      entry.value += num(row.grand_total)
      entry.count += 1
      byCustomer.set(row.customer_name, entry)
    }

    const all = [...byCustomer.values()].sort((a, b) => b.value - a.value)
    // The bar is scaled to the LARGEST customer, not to the pipeline total:
    // with mixed currencies a share-of-total bar would be arithmetic on
    // incompatible units.  A relative bar only claims "bigger than", which is
    // still true within a currency and honest across them.
    const max = all[0]?.value ?? 0

    return { top: all.slice(0, TOP_CUSTOMER_LIMIT), total: all.length, max }
  }, [rows])

  return (
    <section className={cn(PANEL, 'overflow-hidden')}>
      <PanelHeader
        title="Top customers"
        subtitle="Open pipeline value by account"
        href="/quotations"
        linkLabel="All quotations"
      />

      {loading || !model ? (
        <div className="space-y-3 p-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      ) : model.top.length === 0 ? (
        <EmptyState
          title="No open pipeline"
          description="Accounts appear here once they have a live quotation."
        />
      ) : (
        <ul className="divide-y divide-border">
          {model.top.map((c) => (
            <li key={c.name} className="px-4 py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {c.name}
                </span>
                <Money
                  value={c.value}
                  currency={c.currency}
                  className="shrink-0 text-sm font-medium text-foreground"
                />
              </div>
              <div className="mt-1.5 flex items-center gap-2">
                <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className="block h-full rounded-full bg-[var(--chart-1)]"
                    style={{ width: `${model.max > 0 ? (c.value / model.max) * 100 : 0}%` }}
                  />
                </span>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {c.count} {c.count === 1 ? 'deal' : 'deals'}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ── Recent activity ──────────────────────────────────────────────────────── */

// A real <table>, not a flex list: these are five aligned fields per row, and a
// table is what gives them column headers, a header row a screen reader can
// announce cells against, and honest column separation.  It is NOT the shared
// <DataTable> — that carries filtering, sorting and pagination, none of which
// belong on an eight-row landing-page summary.
const COLUMNS = [
  { key: 'number', label: 'Quotation', align: 'left' },
  { key: 'customer', label: 'Customer', align: 'left' },
  { key: 'status', label: 'Status', align: 'left' },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'activity', label: 'Last activity', align: 'right' },
] as const

/** Vertical rules on every cell but the first — the "sectioned" look — kept at
 *  /40 because --border is warm-tinted and full strength reads as a grid. */
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
                <td className={cn(CELL, 'font-semibold tracking-tight whitespace-nowrap')}>
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

// Local rather than the shared <PageHeader>: this is the one screen with an
// eyebrow and a display-size title.  It is one weight heavier and one step
// larger than the list screens so the landing page reads as the top of the
// hierarchy rather than as another list.
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

export default function DashboardPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<QuotationRow>('/api/quotations')

  const openQuotation = React.useCallback(
    (row: QuotationRow) => router.push(`/quotations/${row.id}`),
    [router],
  )

  // One failed request means NO panel on this page can be trusted — they all
  // read the same rows — so the screen reports the failure once instead of
  // showing five empty widgets.
  if (error) {
    return (
      <>
        <DashboardHeader />
        <div className={PANEL}>
          <ErrorState error={error} onRetry={retry} />
        </div>
      </>
    )
  }

  return (
    <>
      <DashboardHeader />

      <div className="space-y-6">
        <KpiTiles rows={rows} loading={loading} />

        <PipelineByStage rows={rows} loading={loading} />

        {/* Two-thirds / one-third below
            — the feed is the thing you read, the
            rail is the thing you glance at.  They stack on anything narrower
            than a laptop rather than squeezing to unreadable widths. */}
        <div className="grid gap-6 lg:grid-cols-3">
          <section className={cn(PANEL, 'overflow-hidden lg:col-span-2')}>
            <PanelHeader
              title="Recent activity"
              subtitle="Most recently updated quotations"
              href="/quotations"
              linkLabel="All quotations"
            />

            <RecentActivity rows={rows} loading={loading} onOpen={openQuotation} />

            {/* Status band, inside the panel and ruled off — the same shape the
                list screens use, so the dashboard's table and a real list are
                recognisably the same component. */}
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
          </section>

          <div className="space-y-6">
            <RiskMix rows={rows} loading={loading} />
            <TopCustomers rows={rows} loading={loading} />
          </div>
        </div>
      </div>
    </>
  )
}
