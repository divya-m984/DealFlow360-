// OWNER: D3.  Screen 3 — Quotations.
//
// ONE view over ONE fetch: the pipeline board (§B1/§B2).  The table view was
// removed — the board already carries every field the table showed, and a
// second representation of the same eight rows was a toggle to maintain rather
// than information to read.  Terminal-state quotations, which used to be
// reachable only from the table, now get their own "Closed" lane.
//
// LAYOUT: a fixed FILTER RAIL on the left, an enclosed BOARD PANEL on the
// right.  The lanes used to float loose on the page background with the action
// stranded up in the page header; there was no container, so nothing said where
// the board began or ended.  Now:
//   • the rail is the fixed, scannable part — risk band and owner, each with a
//     count over the WHOLE set (see BASELINE COUNTS below);
//   • the board is the wide, scrolling part, and it scrolls INSIDE its own
//     panel, so the panel border stays put while the lanes move under it;
//   • "New quotation" sits in the board panel's header, next to the thing it
//     adds to, rather than at page level;
//   • a status band closes the panel, the same shape the list screens use.
// Two scroll regions, two responsibilities, one border around each.
//
// FILTERING IS SERVER-SIDE, AND THERE IS EXACTLY ONE SOURCE OF TRUTH FOR IT.
// `QuotationFilterValue` is that source.  The rail's Risk and Owner controls do
// not hold state of their own — they read and write `filters.band` and
// `filters.ownerId`, the same object D2's <QuotationFilters> bar reads and
// writes.  `buildQuotationUrl(filters)` is the URL <useListData> fetches, so
// the URL IS the filter state and nothing can be filtered on screen that the
// server did not filter.  An earlier revision kept a second local risk/owner
// state and filtered the rows again in the browser; the two disagreed the
// moment a server filter narrowed the set, and the counts lied.
//
// BASELINE COUNTS.  The rail shows a count per band and per owner over the
// WHOLE pipeline, not over what is currently on screen.  Deriving those from
// `rows` would be circular — filter to one owner and every other owner drops
// to zero (or vanishes), so you could never get back.  They are therefore
// captured once, from the first UNFILTERED response, exactly as D2's filter bar
// captures its owner/team facets, and are not a second request.
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
import { X } from 'lucide-react'
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
  customer_id: number
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
  /** The rail filters on the ID and labels with the name — GET /api/quotations
   *  takes `ownerId`, so sending a name would land in Number() and match
   *  nothing without raising anything. */
  owner_user_id: number
  owner_name: string
  /** LEFT JOIN on sales_team — null for a rep with no team. */
  team_id: number | null
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


/* ── Currency-safe lane totals ────────────────────────────────────────────── */

/**
 * Sum a lane, or refuse to.  Same rule as the dashboard tiles, for the same
 * reason: `customer.currency_code` is per-customer and the seed handoff gives
 * Siemens EUR and Cipla USD, so adding `grand_total` across a mixed lane adds
 * euros to rupees.  Converting needs the `fx_rate` table and is server-side
 * business logic, not something a lane header reinvents — so a mixed lane
 * shows its COUNT and declines the total.
 */
function laneTotal(cards: QuotationRow[], fallbackCurrency: string) {
  const codes = new Set(cards.map((c) => c.currency_code).filter(Boolean))
  if (codes.size > 1) return { value: null as number | null, currency: '' }
  const value = cards.reduce((sum, c) => {
    const n = Number(c.grand_total)
    return Number.isFinite(n) ? sum + n : sum
  }, 0)
  return { value, currency: [...codes][0] ?? fallbackCurrency }
}

/* ── Filter rail ──────────────────────────────────────────────────────────── */

/** `band` is the value GET /api/quotations takes, and the value stored on
 *  QuotationFilterValue.band.  `undefined` is "no band filter" — the same thing
 *  buildQuotationUrl omits — so "All" is not a magic string that has to be
 *  translated on the way out. */
const RISK_FILTERS: Array<{ band: string | undefined; label: string }> = [
  { band: undefined, label: 'All' },
  { band: 'HIGH', label: 'High' },
  { band: 'MEDIUM', label: 'Medium' },
  { band: 'LOW', label: 'Low' },
]

/** One row in the rail — a label, a live count, and a pressed state. */
function RailOption({
  label,
  count,
  active,
  onSelect,
}: {
  label: string
  count: number
  active: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      // aria-pressed, not aria-selected: these are toggles in a group, not
      // options in a listbox, and there is no listbox role on the container.
      aria-pressed={active}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
        active
          ? 'bg-primary/10 font-semibold text-primary'
          : 'text-foreground/80 hover:bg-[var(--row-hover)]',
        // A filter that would empty the board is still shown — hiding it would
        // hide the fact that nobody matches — but it is dimmed and inert.
        count === 0 && !active && 'text-muted-foreground/60',
      )}
    >
      <span className="truncate">{label}</span>
      <span className="shrink-0 tabular-nums">{count}</span>
    </button>
  )
}

/** Rail section chrome — one definition, so the three blocks cannot drift. */
function RailSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border last:border-b-0">
      <h3 className="px-3 pt-3 pb-1.5 text-[0.7rem] font-bold tracking-[0.1em] text-muted-foreground uppercase">
        {title}
      </h3>
      <div className="px-2 pb-3">{children}</div>
    </section>
  )
}

/* ── Board ────────────────────────────────────────────────────────────────── */

/** The risk bar's fill: the row's own `risk_band`, which is D1's engine
 *  classifying its own score.  Mapping the NUMBER to a colour here would mean
 *  inventing the thresholds the server already applied. */
function riskColor(band: string) {
  switch (band?.toUpperCase()) {
    case 'HIGH':
      return 'var(--accent-red)'
    case 'MEDIUM':
      return 'var(--accent-amber)'
    case 'LOW':
      return 'var(--accent-teal)'
    default:
      return 'var(--muted-foreground)'
  }
}

/** Margin as a percentage of the deal, or null when there is no deal to divide
 *  by.  Both figures come from the SAME row, so they are the same currency —
 *  this is the one ratio on the screen that needs no multi-currency guard. */
function marginPct(row: QuotationRow) {
  const total = Number(row.grand_total)
  const margin = Number(row.margin_total)
  if (!Number.isFinite(total) || !Number.isFinite(margin) || total <= 0) return null
  return (margin / total) * 100
}

/** One named step of the approval chain. */
function ApprovalChip({ label }: { label: string }) {
  return (
    <span className="inline-flex h-4 items-center rounded-sm border border-border bg-card px-1.5 text-[0.65rem] font-semibold text-foreground/80">
      {label}
    </span>
  )
}

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
        'cursor-pointer overflow-hidden rounded-md border border-border bg-card text-left transition-colors',
        'hover:border-foreground/20 hover:bg-[var(--row-hover)]',
        'focus-visible:bg-[var(--row-hover)] outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
    >
      {/* FOUR RULED COMPARTMENTS, not one padded block: identity, assessment,
          money, ownership.  They were previously separated by margin alone,
          which reads as one long run of small text.  A rule per compartment
          costs nothing and lets the eye jump to the band it wants.

          Every value below is a column GET /api/quotations already returns, or
          a ratio of two of them.  Nothing here is estimated and nothing is a
          second request. */}

      {/* 1 — WHAT IT IS.  Identifier and money on one baseline, both at full
          contrast: they are what the eye lands on first.  Tier sits with the
          customer because it is what picked the pricelist the number came
          from, so it explains the figure above it. */}
      <div className="px-3 pt-2.5 pb-2">
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
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {row.customer_name}
          <span className="text-muted-foreground/70"> · {row.tier_name}</span>
        </p>
      </div>

      {/* 2 — WHAT THE ENGINE SAYS.  Tinted, so the governance band is visibly
          a different kind of information from the identity above it.  The
          state badge repeats the lane it sits in, but a card must be readable
          on its own, and it is what tells a Closed-lane card apart from its
          neighbours. */}
      <div className="border-y border-border bg-muted/50 px-3 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={row.state} />
          <StatusBadge status={row.risk_band} />
          <span className="ml-auto shrink-0 text-[0.7rem] text-muted-foreground tabular-nums">
            v{row.version}
          </span>
        </div>

        {/* THE RISK SCORE, given a bar of its own.  It was a bare number
            wedged between two badges, where nothing said whether 17 was a lot.
            The band it is scored against is right beside it and the track runs
            0-100 — the scale D1's engine writes on — so the bar says "17 out
            of 100" without a legend.  The fill takes the row's own band
            colour, which is the SERVER's judgement of that number, not a
            threshold invented here. */}
        <div className="mt-2 flex items-center gap-2">
          <span className="shrink-0 text-[0.7rem] text-muted-foreground">Risk</span>
          <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.min(100, Math.max(0, Number(row.risk_score) || 0))}%`,
                backgroundColor: riskColor(row.risk_band),
              }}
            />
          </span>
          <span className="w-6 shrink-0 text-right text-[0.7rem] font-medium text-foreground tabular-nums">
            {Number(row.risk_score).toFixed(0)}
          </span>
        </div>

        {/* THE APPROVAL CHAIN, spelled out.  "Needs M+F" was a private
            abbreviation that needed a tooltip to decode, and a tooltip is not
            available to a touch user at all.  Two named chips say the same
            thing at a glance, in the order the chain is walked — and the
            absence of both now says something too, rather than leaving a gap
            that could equally mean "not loaded". */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[0.7rem]">
          <span className="shrink-0 text-muted-foreground">Approval</span>
          {row.requires_manager || row.requires_finance ? (
            <>
              {row.requires_manager && <ApprovalChip label="Manager" />}
              {row.requires_finance && <ApprovalChip label="Finance" />}
            </>
          ) : (
            <span className="text-muted-foreground/70">Not required</span>
          )}
        </div>
      </div>

      {/* 3 — WHAT IT EARNS.  `margin_total` is the SERVER's figure; the
          percentage beside it is that figure over `grand_total`, both from the
          same row and therefore the same currency, so the ratio is safe where
          a cross-row sum would not be.  The bar is deliberately UNJUDGED — it
          is the app's own violet, not a red/green verdict, because "what
          counts as a thin margin" is a business threshold that lives on the
          server and is not mine to invent on a card. */}
      <div className="px-3 py-2">
        <div className="flex items-baseline justify-between gap-2 text-[0.7rem]">
          <span className="text-muted-foreground">
            Margin{' '}
            <Money
              value={row.margin_total}
              currency={row.currency_code}
              className="text-[0.7rem] font-medium text-foreground"
            />
          </span>
          <span className="shrink-0 font-medium text-foreground tabular-nums">
            {marginPct(row) === null ? '—' : `${marginPct(row)!.toFixed(1)}%`}
          </span>
        </div>
        <span aria-hidden className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-border">
          <span
            className="block h-full rounded-full bg-[var(--chart-1)]"
            style={{ width: `${Math.min(100, Math.max(0, marginPct(row) ?? 0))}%` }}
          />
        </span>
      </div>

      {/* 4 — WHOSE IT IS, AND SINCE WHEN.  Both dates, not just the last one:
          a quotation opened three weeks ago and touched today is a different
          animal from one opened today, and the board could not tell them apart
          while it showed only `last_activity_at`.  `created_at` was already on
          every row and was going unread.
          team_name is a LEFT JOIN and is null for a rep with no team. */}
      <div className="border-t border-border px-3 py-1.5 text-[0.7rem] text-muted-foreground">
        <p className="truncate">
          {row.owner_name}
          {row.team_name && (
            <span className="text-muted-foreground/70"> · {row.team_name}</span>
          )}
        </p>
        <p className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate">
            Opened <DateValue value={row.created_at} className="text-[0.7rem]" />
          </span>
          <span className="shrink-0 truncate">
            Updated <DateValue value={row.last_activity_at} className="text-[0.7rem]" />
          </span>
        </p>
      </div>
    </div>
  )
}

type Lane = { key: string; label: string; cards: QuotationRow[] }

/** Split rows into the five pipeline lanes plus a Closed lane when non-empty.
 *
 *  `quotation_state` has EIGHT values; the three terminal ones (rejected /
 *  cancelled / expired) are not pipeline stages and get no lane of their own.
 *  They are not dropped either — they collect in "Closed", which is why the
 *  board can be the only view on this screen.  A board that hides rows without
 *  saying so is worse than one with an extra column. */
function toLanes(rows: QuotationRow[]): Lane[] {
  const map = new Map<string, QuotationRow[]>(PIPELINE.map((c) => [c.state, []]))
  const closed: QuotationRow[] = []

  for (const row of rows) {
    const bucket = map.get(row.state)
    if (bucket) bucket.push(row)
    else closed.push(row)
  }

  const lanes: Lane[] = PIPELINE.map((c) => ({
    key: c.state,
    label: c.label,
    cards: map.get(c.state) ?? [],
  }))

  return closed.length > 0
    ? [...lanes, { key: '__closed__', label: 'Closed', cards: closed }]
    : lanes
}

function BoardLanes({
  lanes,
  fallbackCurrency,
  onOpen,
}: {
  lanes: Lane[]
  fallbackCurrency: string
  onOpen: (row: QuotationRow) => void
}) {
  return (
    // The lanes scroll INSIDE the panel now rather than against the page, so
    // the panel's own border stays put while the board moves under it — the
    // whole point of enclosing it.  No mx-auto centring: with the rail beside
    // it the board is no longer the width of the screen, and a centred row in
    // a narrower box just puts the first lane somewhere unpredictable.
    <div className="overflow-x-auto p-3">
      {/* min-h ON THE ROW, with items-stretch, so EVERY lane is as tall as the
          board rather than as tall as its own contents.  A board whose lanes
          each stopped at their last card had a ragged bottom edge and gave an
          empty stage a two-line box next to a six-card column, which reads as
          a rendering fault rather than as "nothing is at this stage".  The
          floor is a fixed rem value, not a vh: the panel sits under a header
          and a rail, and tying it to the viewport makes it jump between
          screens for no gain. */}
      <div className="flex min-h-[36rem] w-max snap-x items-stretch gap-3">
        {lanes.map((lane) => {
          const total = laneTotal(lane.cards, fallbackCurrency)
          return (
            <section
              key={lane.key}
              aria-label={lane.label}
              className="flex w-[17rem] shrink-0 snap-start flex-col rounded-lg border border-border bg-muted/50"
            >
              {/* The lane header now carries VALUE as well as count — the
                  question a board is actually asked is "how much is sitting
                  in pending approval", and the answer used to require adding
                  the cards up by eye.  Plain type, not a StatusBadge: the
                  badge duplicated the one on every card below it. */}
              <header className="border-b border-border px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="truncate text-xs font-bold tracking-wide text-foreground uppercase">
                    {lane.label}
                  </h3>
                  <span className="shrink-0 rounded-sm border border-border bg-card px-1.5 text-[0.7rem] font-semibold text-muted-foreground tabular-nums">
                    {lane.cards.length}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">
                  {total.value === null ? (
                    <span title="This lane spans more than one currency, so a single total would be meaningless without applying FX rates.">
                      Mixed currencies
                    </span>
                  ) : (
                    <Money value={total.value} currency={total.currency} />
                  )}
                </p>
              </header>

              <div className="flex flex-1 flex-col gap-2 p-2">
                {lane.cards.length === 0 ? (
                  // flex-1 + grid place-items-center: the placeholder now fills
                  // the lane it is standing in for, so an empty stage reads as
                  // an empty COLUMN rather than as a small box at the top of a
                  // tall one.
                  <div className="grid flex-1 place-items-center rounded-md border border-dashed border-border px-2.5 py-6 text-center text-xs text-muted-foreground">
                    Nothing at this stage
                  </div>
                ) : (
                  lane.cards.map((row) => (
                    <QuotationCard key={row.id} row={row} onOpen={onOpen} />
                  ))
                )}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function QuotationsPage() {
  const router = useRouter()

  // THE one filter state.  The rail below and D2's <QuotationFilters> bar are
  // two views onto this object, not two filter systems.
  const [filters, setFilters] = React.useState<QuotationFilterValue>({})

  // useListData refetches when the url changes, and the url IS the filter
  // state — so there is no second source of truth to keep in step.
  const url = React.useMemo(() => buildQuotationUrl(filters), [filters])
  const { rows, loading, error, retry } = useListData<QuotationRow>(url)

  const filtering = React.useMemo(
    () => Object.values(filters).some((v) => v !== undefined && String(v).trim() !== ''),
    [filters],
  )

  const openQuotation = React.useCallback(
    (row: QuotationRow) => router.push(`/quotations/${row.id}`),
    [router],
  )

  /** Set one field of the shared filter value.  `undefined` clears it, which is
   *  what buildQuotationUrl omits from the querystring. */
  const setField = React.useCallback(
    (key: keyof QuotationFilterValue, value: string | undefined) =>
      setFilters((prev) => ({ ...prev, [key]: value })),
    [],
  )

  // BASELINE — see the file header.  Captured from the first response that
  // arrived with NO filters applied, so the rail's counts and its owner list
  // describe the whole pipeline rather than the slice currently on screen.
  // A ref, not state: writing it must not schedule a render, and it is read
  // during the same render that fills it.
  const baseline = React.useRef<{
    total: number
    byBand: Map<string, number>
    owners: Array<{ id: string; name: string; count: number }>
  } | null>(null)

  if (rows && !filtering && baseline.current === null) {
    const byBand = new Map<string, number>()
    const byOwner = new Map<string, { name: string; count: number }>()
    for (const row of rows) {
      const band = row.risk_band?.toUpperCase() ?? ''
      byBand.set(band, (byBand.get(band) ?? 0) + 1)
      if (row.owner_user_id != null) {
        const id = String(row.owner_user_id)
        const seen = byOwner.get(id)
        if (seen) seen.count += 1
        else byOwner.set(id, { name: row.owner_name, count: 1 })
      }
    }
    baseline.current = {
      total: rows.length,
      byBand,
      owners: [...byOwner.entries()]
        .map(([id, o]) => ({ id, name: o.name, count: o.count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    }
  }
  const facets = baseline.current

  const lanes = React.useMemo(() => toLanes(rows ?? []), [rows])
  const fallbackCurrency = rows?.[0]?.currency_code ?? 'INR'

  if (error) {
    return (
      <>
        <PageHeader
          title="Quotations"
          description="Every quotation in the pipeline, across all customers and stages."
        />
        {/* The board shows the same real API error a table would — never an
            empty pipeline standing in for a failed request. */}
        <div className="rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
          <ErrorState error={error} onRetry={retry} />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Every quotation in the pipeline, across all customers and stages."
      />

      {/* RAIL LEFT, BOARD RIGHT.  The rail is the fixed, scannable part and the
          board is the wide, scrolling part, so the two do not belong in the
          same scroll region.  Below `lg` the rail stacks above the board rather
          than squeezing — a 12rem column of filters is not usable on a phone. */}
      {/* 10rem, down from 13.  The rail's job is done by the time you have read
          "High 3" — it holds one short label and one count per row, and 13rem
          was three rem of empty gutter between them.  Every rem it gives back
          is a rem of lane, and the board is the part with something to say.
          The gap is 3, not 4, for the same reason. */}
      <div className="grid gap-3 lg:grid-cols-[10rem_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          {/* One <nav>-less group with a name: the rail is a set of filter
              controls, and a screen reader landing in it should be told what
              the controls do before it reads four numbers. */}
          <div
            role="group"
            aria-label="Filter the pipeline"
            className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]"
          >
            <RailSection title="Risk band">
              {loading ? (
                <div className="space-y-1.5">
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-md" />
                  ))}
                </div>
              ) : (
                <div className="space-y-0.5">
                  {RISK_FILTERS.map((f) => (
                    <RailOption
                      key={f.band ?? 'all'}
                      label={f.label}
                      // Baseline counts, not counts of `rows`: `rows` is
                      // already the server's filtered answer, so counting it
                      // would make every unselected band read 0.
                      count={
                        f.band === undefined
                          ? (facets?.total ?? 0)
                          : (facets?.byBand.get(f.band) ?? 0)
                      }
                      active={(filters.band ?? undefined) === f.band}
                      onSelect={() => setField('band', f.band)}
                    />
                  ))}
                </div>
              )}
            </RailSection>

            <RailSection title="Owner">
              {loading ? (
                <div className="space-y-1.5">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-7 w-full rounded-md" />
                  ))}
                </div>
              ) : (
                <div className="space-y-0.5">
                  <RailOption
                    label="Everyone"
                    count={facets?.total ?? 0}
                    active={filters.ownerId === undefined}
                    onSelect={() => setField('ownerId', undefined)}
                  />
                  {(facets?.owners ?? []).map((o) => (
                    <RailOption
                      key={o.id}
                      label={o.name}
                      count={o.count}
                      // ownerId is the ID the API filters on; the name is only
                      // the label.
                      active={filters.ownerId === o.id}
                      onSelect={() => setField('ownerId', o.id)}
                    />
                  ))}
                </div>
              )}
            </RailSection>

            {/* Only rendered while something is filtered: a permanently
                visible "Clear" that does nothing most of the time trains
                people to stop reading the rail.  It clears the WHOLE filter
                value, including the stage/search/date filters set in the bar —
                there is one filter object, so there is one clear. */}
            {filtering && (
              <div className="border-t border-border p-2">
                <button
                  type="button"
                  onClick={() => setFilters({})}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-[var(--row-hover)] focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
                >
                  <X className="size-3" />
                  Clear filters
                </button>
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
          <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-foreground">Pipeline board</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Stage by stage, newest activity first
              </p>
            </div>
            {/* The action sits in the board panel's header, next to the thing
                it adds to, rather than at page level.  The button is D2's: it
                picks a customer from the real GET /api/customers, so a customer
                with no quotation yet is reachable. */}
            <NewQuotationButton onCreated={retry} />
          </header>

          {/* The rest of D2's filter contract — search, stage, team and the
              created-date range.  It writes to the SAME `filters` object the
              rail does, so its band and owner controls and the rail's stay in
              step by construction rather than by being kept in step.  It is not
              in the rail because the rail is a two-axis glance and these are
              typed and ranged inputs; it is not deleted because the API accepts
              them and no other control on this screen sends them. */}
          <div className="border-b border-border px-4 pt-3">
            <QuotationFilters
              value={filters}
              onChange={setFilters}
              rows={rows}
              total={rows?.length}
            />
          </div>

          {loading ? (
            <div className="overflow-x-auto p-3">
              <div className="flex min-h-[36rem] w-max gap-3">
                {PIPELINE.map((column) => (
                  <div key={column.state} className="w-[17rem] shrink-0 space-y-2">
                    <Skeleton className="h-12 w-full rounded-lg" />
                    {Array.from({ length: 3 }).map((_, i) => (
                      // Matches the real card height so the board does not jump
                      // when the data lands — the card is four bands now.
                      <Skeleton key={i} className="h-[13.5rem] w-full rounded-md" />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ) : rows && rows.length === 0 && !filtering ? (
            <EmptyState
              title="No quotations yet"
              description="Quotations will appear here once a sales rep creates one."
            />
          ) : rows && rows.length === 0 ? (
            // A filtered-to-nothing board is NOT the same as an empty pipeline,
            // and saying so is the difference between "there is no work" and
            // "you have hidden all of it".  The server returned nothing for
            // these filters — this is not a client-side hide.
            <EmptyState
              title="No quotations match these filters"
              description="Clear the risk band or owner in the rail, or the stage and search above the board, to see the full pipeline."
            />
          ) : (
            <BoardLanes
              lanes={lanes}
              fallbackCurrency={fallbackCurrency}
              onOpen={openQuotation}
            />
          )}

          {/* Status band — the same shape the list screens use, so this board
              and a real table are recognisably the same component. */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-4 py-2">
            <p className="text-xs text-muted-foreground">
              {rows && (
                <span className="font-medium text-foreground tabular-nums">
                  {/* "N of M" only once M is known and actually differs — the
                      baseline is the unfiltered total, so quoting it while
                      unfiltered would just print the same number twice. */}
                  {filtering && facets ? `${rows.length} of ${facets.total}` : `${rows.length}`}{' '}
                  {rows.length === 1 ? 'quotation' : 'quotations'}
                </span>
              )}
              {rows ? ' · ' : null}
              Click a card to open the quotation.
            </p>
            <span className="text-xs text-muted-foreground">
              Each lane header shows that lane&rsquo;s total value.
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
