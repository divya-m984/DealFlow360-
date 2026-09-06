// OWNER: D3.  Screen 7 — Fulfilment and Stock.
//
// Confirmed orders and how far each one has been allocated across warehouses.
// The allocation engine itself — which warehouse, how many shipments, what
// backorders — is D2's application logic in lib/allocate.ts.  This screen
// renders its output and nothing more; no allocation decision is made here.
//
// NOT A TABLE, DELIBERATELY.  A fulfilment worklist is not a list of records to
// compare field-by-field; it is a set of jobs at different stages, and the two
// questions asked of it are "what is stuck?" and "how far along is this one?".
// A grid of rows answers neither without reading eleven columns.  So:
//   • orders are GROUPED BY WHAT THEY NEED — attention, in progress, done —
//     rather than sorted into one undifferentiated list;
//   • each order is a CARD with an allocation rail, because planned → reserved
//     → shipped is a progression and a progression should look like one;
//   • three workload blocks above the groups count the whole book of work,
//     one block per section, so the summary and the sections are the same
//     three things and not two different carvings of them.
// Every figure is still exact and still the server's; the graphics are a second
// encoding of numbers that are also printed, never a replacement for them.
//
// TWO FETCHES, and the second one is the point.  The screen has been called
// "Fulfilment and Stock" since Phase 0 while showing no stock whatsoever.
// GET /api/fulfilment/stock (D2) returns per-warehouse on-hand / reserved /
// available with reorder points, which is exactly what "and Stock" promised.
// The cost is a second thing that can fail; it is paid for by scoping the
// failure — a stock error renders inside the stock panel and leaves the order
// groups working, because the two halves share no data.
//
// CONTRACT: matched against the landed GET /api/fulfilment (D2).  The Phase 2
// provisional shape guessed wrong in four places and has been corrected:
//   • there is no `line_count` / `lines_allocated` — the API returns per-status
//     allocation COUNTS (planned_allocations / reserved_allocations /
//     shipped_allocations)
//   • there is no `qty_backordered` — it is `open_backorders`, a COUNT of
//     unresolved backorder rows, not a quantity
//   • there is no warehouse code list — it is `warehouses_used`, an integer
//     count of DISTINCT warehouses on the order
//   • there is no `quotation_id`; only `quotation_number` is joined through
// `is_late` is computed in SQL against CURRENT_DATE, so lateness is the
// server's answer rather than a client clock comparison.
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, PackageCheck, Truck } from 'lucide-react'
import { cn } from 'cn'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorState } from '@/components/shared/error-state'
import { DateValue, Money, formatNumber } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'
import { Skeleton } from '@/components/ui/skeleton'

type FulfilmentRow = {
  id: number
  number: string
  /** order_state: confirmed | split_pending | partially_fulfilled | fulfilled | backorder | cancelled */
  state: string
  customer_id: number
  customer_name: string
  currency_code: string
  grand_total: string | number
  promised_delivery_date: string | null
  created_at: string
  quotation_number: string
  is_late: boolean
  planned_allocations: number
  reserved_allocations: number
  shipped_allocations: number
  warehouses_used: number
  open_backorders: number
  shipping_cost: string | number
}

/** One shelf: a product at a warehouse.  GET /api/fulfilment/stock. */
type StockRow = {
  id: number
  warehouse_id: number
  warehouse_code: string
  warehouse_name: string
  product_id: number
  product_sku: string
  product_name: string
  qty_on_hand: string | number
  qty_reserved: string | number
  qty_available: string | number
  reorder_point: string | number
  reorder_qty: string | number
  below_reorder_point: boolean
  planned_not_reserved: string | number
}

const PANEL = 'rounded-xl border border-border bg-card shadow-[var(--shadow-card)]'

function num(v: string | number | null | undefined) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Sum a bucket, or refuse to.  Same rule as every other total in the app:
 * `customer.currency_code` is per-customer, so adding `grand_total` across a
 * mixed bucket adds euros to rupees.  Converting needs `fx_rate` and is
 * server-side business logic, so a mixed bucket declines the total.
 */
function totalOf(list: FulfilmentRow[], fallbackCurrency: string) {
  const codes = new Set(list.map((r) => r.currency_code).filter(Boolean))
  if (codes.size > 1) return { value: null as number | null, currency: '' }
  return {
    value: list.reduce((sum, r) => sum + num(r.grand_total), 0),
    currency: [...codes][0] ?? fallbackCurrency,
  }
}

/* ── Order card ───────────────────────────────────────────────────────────── */

/** Whole days until the promise, negative once it has passed.  Only ever used
 *  for the "in N days" hint — LATENESS itself comes from the server's
 *  `is_late`, computed in SQL against CURRENT_DATE, so the badge never depends
 *  on the visitor's clock being right. */
function daysToPromise(iso: string | null) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((t - today.getTime()) / 86_400_000)
}

/** Allocation as words, in the order stock moves through the statuses.
 *  NOT AS A BAR.  An order here has one, two or three allocation rows, and a
 *  proportional bar over a total of two is a bar that is always half and half
 *  — it encodes nothing the words do not, and a full-width rail under the
 *  caption "1 planned" is pure decoration.  The chart lower down the page
 *  plots quantities, which actually vary; this plots a count of two. */
function allocationText(row: FulfilmentRow) {
  const parts: string[] = []
  if (row.planned_allocations) parts.push(`${row.planned_allocations} planned`)
  if (row.reserved_allocations) parts.push(`${row.reserved_allocations} reserved`)
  if (row.shipped_allocations) parts.push(`${row.shipped_allocations} shipped`)
  return parts.length ? parts.join(', ') : null
}

/** One label/value line.  A quiet two-column record, which is what an
 *  operations screen actually is — the previous card spent a coloured pill, an
 *  icon, a row of dots and a progress rail saying "1 backorder". */
function Fact({
  label,
  children,
  tone,
}: {
  label: string
  children: React.ReactNode
  tone?: 'warn' | 'bad'
}) {
  return (
    <>
      <dt className="text-[0.7rem] text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-right text-xs tabular-nums',
          tone === 'bad' && 'font-semibold text-[var(--accent-red)]',
          tone === 'warn' && 'font-medium text-[var(--accent-amber)]',
          !tone && 'text-foreground',
        )}
      >
        {children}
      </dd>
    </>
  )
}

function OrderCard({ row, onOpen }: { row: FulfilmentRow; onOpen: () => void }) {
  const days = daysToPromise(row.promised_delivery_date)
  const allocated = allocationText(row)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={cn(
        'flex cursor-pointer flex-col border border-border bg-card text-left transition-colors',
        'hover:border-foreground/25 hover:bg-[var(--row-hover)]',
        'focus-visible:bg-[var(--row-hover)] outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
      )}
    >
      {/* 1 — IDENTITY.  The quotation it came from is on the card because the
          seam between D1's lane and D2's is the thing a demo points at. */}
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
          <span className="text-muted-foreground/70"> · from {row.quotation_number}</span>
        </p>
      </div>

      {/* 2 — THE FACTS, as a plain two-column list.  The StatusBadge stays
          because it is the application's ONE status language and appears
          identically on eight screens; everything that was a bespoke pill or
          glyph is now just a value in the right-hand column. */}
      <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 border-t border-border px-3 py-2">
        <dt className="text-[0.7rem] text-muted-foreground">State</dt>
        <dd className="flex justify-end">
          <StatusBadge status={row.state} />
        </dd>

        <Fact label="Allocation" tone={allocated ? undefined : 'warn'}>
          {allocated ?? 'Not allocated'}
        </Fact>

        <Fact label="Warehouses">
          {row.warehouses_used > 0 ? row.warehouses_used : '—'}
        </Fact>

        <Fact label="Backorders" tone={row.open_backorders > 0 ? 'bad' : undefined}>
          {row.open_backorders > 0 ? row.open_backorders : '—'}
        </Fact>
      </dl>

      {/* 3 — THE PROMISE.  `is_late` is the server's, not a client clock
          comparison; the day count beside it is only a hint. */}
      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-3 py-1.5 text-[0.7rem]">
        <span className="truncate text-muted-foreground">
          Promised{' '}
          <DateValue
            value={row.promised_delivery_date}
            className={cn(
              'text-[0.7rem]',
              row.is_late ? 'font-semibold text-[var(--accent-red)]' : 'text-foreground',
            )}
          />
        </span>
        {days !== null && (
          <span
            className={cn(
              'shrink-0 tabular-nums',
              row.is_late ? 'font-semibold text-[var(--accent-red)]' : 'text-muted-foreground',
            )}
          >
            {days < 0
              ? `${Math.abs(days)}d overdue`
              : days === 0
                ? 'due today'
                : `in ${days}d`}
          </span>
        )}
      </div>
    </div>
  )
}

/* ── Categories ───────────────────────────────────────────────────────────── */

// GROUPED BY WHAT THE ORDER NEEDS, not by its state enum.  `backorder` and
// `confirmed` are different states but the same job when one of them is three
// days overdue, and a screen whose first section is "the ones that are wrong"
// answers the question the worklist is opened to ask.
const GROUPS = [
  {
    key: 'attention',
    label: 'Needs attention',
    hint: 'Overdue, or waiting on stock that is not there',
    accent: 'var(--accent-red)',
    accentSoft: 'var(--accent-red-soft)',
    icon: <AlertTriangle className="size-4" />,
    empty: 'Nothing is overdue and nothing is on backorder.',
    match: (r: FulfilmentRow) => r.is_late || r.open_backorders > 0,
  },
  {
    key: 'progress',
    label: 'In progress',
    hint: 'Allocated or awaiting allocation, still inside the promise',
    accent: 'var(--accent-amber)',
    accentSoft: 'var(--accent-amber-soft)',
    icon: <Truck className="size-4" />,
    empty: 'No orders are mid-fulfilment.',
    match: (r: FulfilmentRow) => r.state !== 'fulfilled' && r.state !== 'cancelled',
  },
  {
    key: 'done',
    label: 'Completed',
    hint: 'Shipped in full, or cancelled',
    accent: 'var(--accent-teal)',
    accentSoft: 'var(--accent-teal-soft)',
    icon: <PackageCheck className="size-4" />,
    empty: 'Nothing has shipped yet.',
    match: (r: FulfilmentRow) => r.state === 'fulfilled' || r.state === 'cancelled',
  },
] as const

/** Assign each order to the FIRST group that claims it, so an overdue
 *  backordered order appears once — under attention — rather than twice. */
function groupOrders(rows: FulfilmentRow[]) {
  const buckets = new Map<string, FulfilmentRow[]>(GROUPS.map((g) => [g.key, []]))
  for (const row of rows) {
    const group = GROUPS.find((g) => g.match(row))
    if (group) buckets.get(group.key)!.push(row)
  }
  return buckets
}

/* ── Workload ─────────────────────────────────────────────────────────────── */

// THREE SEPARATE BLOCKS, not one card with a stacked bar across the top.  The
// bar was decoration: it encoded three numbers that were already printed an
// inch below it, at the cost of gluing three unrelated figures into a single
// object.  Three bordered blocks say the same thing and match the three
// sections underneath them, which is what the eye is actually being asked to
// map onto.
function Workload({
  rows,
  loading,
}: {
  rows: FulfilmentRow[] | undefined
  loading: boolean
}) {
  const model = React.useMemo(() => {
    if (!rows) return null
    const buckets = groupOrders(rows)
    const fallback = rows[0]?.currency_code ?? 'INR'
    return GROUPS.map((g) => {
      const list = buckets.get(g.key)!
      return { ...g, count: list.length, total: totalOf(list, fallback) }
    })
  }, [rows])

  if (loading) {
    return (
      <Skeleton className="h-[7.5rem] w-full rounded-none" />
    )
  }
  if (!model) return null

  return (
    // ONE STRIP, not three cards.  Sharp corners, no gaps, a single outer
    // border and hairline dividers between the blocks — so the three read as
    // three compartments of one bar rather than as three floating objects.
    // The colour moved from a left edge to the FILL: an edge is a decoration
    // on a white box, a fill is the block itself, and at this size the fill is
    // what makes each compartment findable from across the room.
    <div className="grid grid-cols-1 overflow-hidden border border-border sm:grid-cols-3">
      {model.map((g, i) => (
        <section
          key={g.key}
          className={cn(
            'p-4',
            // Divider between compartments, on the axis they are stacked on.
            i > 0 && 'border-t border-border sm:border-t-0 sm:border-l',
          )}
          // MOSTLY GREY, faintly hued.  The -soft tokens are sized for a
          // 36px icon chip; spread across a third of the screen the same
          // saturation reads as three sticky notes.  14% of the accent mixed
          // into --muted keeps the hue — you can still tell red from teal at a
          // glance — while the block itself stays a neutral surface in the
          // same family as every other band in the app.
          //
          // Mixed against --muted rather than lightened, so it follows the
          // theme: in dark mode the same expression resolves to a dark grey
          // with the same faint tint, with no second set of values to keep
          // in sync.
          //
          // A group with nothing in it is not tinted at all: an empty "Needs
          // attention" block glowing red would report an alarm that is not
          // happening.
          style={
            g.count > 0
              ? { backgroundColor: `color-mix(in oklab, ${g.accent} 14%, var(--muted))` }
              : undefined
          }
        >
          <div className="flex items-start justify-between gap-3">
            <p
              className="text-xs font-bold tracking-wide uppercase"
              style={{ color: g.count > 0 ? g.accent : 'var(--muted-foreground)' }}
            >
              {g.label}
            </p>
            <span
              className="shrink-0 text-2xl leading-none font-semibold tabular-nums"
              style={g.count > 0 ? { color: g.accent } : undefined}
            >
              {g.count}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{g.hint}</p>
          <div
            className="mt-3 flex items-baseline justify-between gap-2 border-t pt-2"
            // The rule inside a tinted block borrows the block's own hue at low
            // alpha; --border is tuned for white and disappears on the fill.
            style={{
              borderColor:
                g.count > 0
                  ? `color-mix(in oklab, ${g.accent} 28%, transparent)`
                  : 'var(--border)',
            }}
          >
            <span className="text-xs text-muted-foreground">Order value</span>
            {g.total.value === null ? (
              <span
                className="text-xs font-medium text-muted-foreground"
                title="These orders span more than one currency, so a single total would be meaningless without applying FX rates."
              >
                Mixed currencies
              </span>
            ) : (
              <Money
                value={g.total.value}
                currency={g.total.currency}
                className="text-sm font-semibold text-foreground"
              />
            )}
          </div>
        </section>
      ))}
    </div>
  )
}

/* ── Stock chart ──────────────────────────────────────────────────────────── */

// A REAL BAR CHART, grouped by product.  The previous version drew one bar per
// shelf with its own legend underneath, which meant the words "0 reserved · 12
// available" appeared six times and the bars shared no visible axis — six
// unrelated meters rather than one chart.  Grouping by PRODUCT is what makes it
// a chart: the question stock is looked at for is "where is this SKU, and is
// there enough", and that is a comparison ACROSS warehouses, which is exactly
// what putting MAIN and EAST on adjacent bars under one scale shows.

/** Round tick values for the axis — 0, then even steps up to at least `max`. */
function axisTicks(max: number) {
  if (max <= 0) return { top: 1, ticks: [0, 1] }
  const rough = max / 4
  const mag = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((v) => v >= rough) ?? mag * 10
  const top = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v)
  return { top, ticks }
}

/** One warehouse's bar for one product: reserved then available, stacked, with
 *  a tick where that shelf's reorder point sits. */
function StockBar({ row, top }: { row: StockRow; top: number }) {
  const reserved = num(row.qty_reserved)
  const available = num(row.qty_available)
  const reorder = num(row.reorder_point)
  const pct = (n: number) => (top > 0 ? Math.min(100, (n / top) * 100) : 0)

  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'w-11 shrink-0 text-[0.7rem] font-semibold tracking-wide uppercase',
          row.below_reorder_point ? 'text-[var(--accent-red)]' : 'text-muted-foreground',
        )}
      >
        {row.warehouse_code}
      </span>

      <div className="relative h-4 flex-1">
        <div aria-hidden className="absolute inset-0 flex">
          <span
            className="h-full bg-[var(--accent-plum)]"
            style={{ width: `${pct(reserved)}%` }}
          />
          <span
            className="h-full bg-[var(--accent-teal)]"
            style={{ width: `${pct(available)}%` }}
          />
        </div>
        {/* The reorder point, on the same scale as the bar.  It is the number
            a buyer acts on: a bar that stops short of its own tick is the
            definition of "reorder this".  Rendered ON TOP of the fill so it
            stays visible when the shelf is above the line. */}
        {reorder > 0 && (
          <span
            aria-hidden
            className="absolute inset-y-[-2px] w-0.5 bg-foreground/55"
            style={{ left: `${pct(reorder)}%` }}
            title={`Reorder point ${formatNumber(reorder)}`}
          />
        )}
      </div>

      {/* The exact figures the bar encodes, printed — the chart is a second
          reading of the numbers, never the only one. */}
      <span className="w-24 shrink-0 text-right text-[0.7rem] tabular-nums">
        <span className="font-semibold text-foreground">{formatNumber(num(row.qty_on_hand))}</span>
        <span className="text-muted-foreground">
          {' '}
          ({formatNumber(available)} free)
        </span>
      </span>
    </div>
  )
}

function LegendKey({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden className="size-2 shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[0.7rem] text-muted-foreground">{label}</span>
    </span>
  )
}

function StockPanel() {
  const { rows, loading, error, retry } = useListData<StockRow>('/api/fulfilment/stock')

  const model = React.useMemo(() => {
    if (!rows) return null

    const byProduct = new Map<number, { sku: string; name: string; shelves: StockRow[] }>()
    for (const row of rows) {
      const entry = byProduct.get(row.product_id) ?? {
        sku: row.product_sku,
        name: row.product_name,
        shelves: [],
      }
      entry.shelves.push(row)
      byProduct.set(row.product_id, entry)
    }

    // ONE SCALE for every bar, so a laptop shelf and a mouse shelf are
    // comparable.  The axis top is rounded up past the largest shelf rather
    // than set to it, so the longest bar is not pinned to the frame.
    const max = Math.max(0, ...rows.map((r) => num(r.qty_on_hand)))
    const { top, ticks } = axisTicks(max)

    const products = [...byProduct.values()]
      .map((p) => ({
        ...p,
        shelves: p.shelves.sort((a, b) => a.warehouse_code.localeCompare(b.warehouse_code)),
        onHand: p.shelves.reduce((n, sh) => n + num(sh.qty_on_hand), 0),
      }))
      // Biggest holding first — a chart sorted by its own value is readable
      // without the labels, and SKU order is arbitrary.
      .sort((a, b) => b.onHand - a.onHand)

    return { products, top, ticks, low: rows.filter((r) => r.below_reorder_point).length }
  }, [rows])

  return (
    <section className={cn(PANEL, 'overflow-hidden')}>
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-foreground">Stock on hand</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every shelf on one scale, so warehouses can be compared per product
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <LegendKey color="var(--accent-plum)" label="Reserved" />
          <LegendKey color="var(--accent-teal)" label="Available" />
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-0.5 shrink-0 bg-foreground/55" />
            <span className="text-[0.7rem] text-muted-foreground">Reorder point</span>
          </span>
        </div>
      </header>

      {error ? (
        // SCOPED FAILURE: the stock feed is a separate request from the orders
        // feed and shares no data with it, so its error stays inside this panel
        // instead of taking the worklist down with it.
        <ErrorState error={error} onRetry={retry} />
      ) : loading || !model ? (
        <div className="space-y-4 p-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : model.products.length === 0 ? (
        <EmptyState
          title="No stock records"
          description="Products held in no warehouse are services — they need no allocation."
        />
      ) : (
        <div className="p-4">
          <div className="space-y-4">
            {model.products.map((product) => (
              <div key={product.sku}>
                <h3 className="mb-1.5 truncate text-xs font-bold text-foreground">
                  {product.sku}
                  <span className="ml-1.5 font-normal text-muted-foreground">
                    {product.name}
                  </span>
                </h3>
                <div className="space-y-1">
                  {product.shelves.map((shelf) => (
                    <StockBar key={shelf.id} row={shelf} top={model.top} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* The axis, once, under all of it — the thing that turns a stack of
              meters into a chart.  Its gutters match the bar row's exactly
              (w-11 label + gap, w-24 value + gap) so the ticks land where the
              bars actually start and end. */}
          <div aria-hidden className="mt-3 flex items-start gap-2">
            <span className="w-11 shrink-0" />
            <div className="relative h-4 flex-1 border-t border-border">
              {model.ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-0 -translate-x-1/2"
                  style={{ left: `${(t / model.top) * 100}%` }}
                >
                  <span className="mx-auto block h-1 w-px bg-border" />
                  <span className="block text-[0.65rem] text-muted-foreground tabular-nums">
                    {formatNumber(t)}
                  </span>
                </span>
              ))}
            </div>
            <span className="w-24 shrink-0" />
          </div>
        </div>
      )}

      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {model && model.low > 0 ? (
          <>
            <span className="font-semibold text-[var(--accent-red)] tabular-nums">
              {model.low}
            </span>{' '}
            {model.low === 1 ? 'shelf is' : 'shelves are'} below their reorder point.{' '}
          </>
        ) : null}
        Stock enters the system through D2&rsquo;s goods receipt, never from this
        screen.
      </p>
    </section>
  )
}

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function FulfilmentPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<FulfilmentRow>('/api/fulfilment')

  const buckets = React.useMemo(() => (rows ? groupOrders(rows) : null), [rows])

  return (
    <>
      <PageHeader
        title="Fulfilment and Stock"
        description="Confirmed orders awaiting fulfilment, with live allocation across warehouses."
      />

      {error ? (
        <div className={PANEL}>
          <ErrorState error={error} onRetry={retry} />
        </div>
      ) : (
        <div className="space-y-6">
          <Workload rows={rows} loading={loading} />

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-[11rem] w-full rounded-lg" />
              ))}
            </div>
          ) : rows && rows.length === 0 ? (
            <div className={PANEL}>
              <EmptyState
                title="No orders to fulfil"
                description="Orders appear here once a confirmed quotation is turned into a sales order."
              />
            </div>
          ) : (
            buckets &&
            GROUPS.map((group) => {
              const list = buckets.get(group.key)!
              return (
                <section key={group.key} className={cn(PANEL, 'overflow-hidden')}>
                  <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      <span
                        aria-hidden
                        className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: group.accentSoft, color: group.accent }}
                      >
                        {group.icon}
                      </span>
                      <div className="min-w-0">
                        <h2 className="text-sm font-bold text-foreground">
                          {group.label}
                          <span className="ml-1.5 font-semibold text-muted-foreground tabular-nums">
                            {list.length}
                          </span>
                        </h2>
                        <p className="mt-0.5 text-xs text-muted-foreground">{group.hint}</p>
                      </div>
                    </div>
                  </header>

                  {list.length === 0 ? (
                    // An empty CATEGORY is information — "nothing is overdue"
                    // is the best news on the screen — so the section stays and
                    // says so rather than disappearing.
                    <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                      {group.empty}
                    </p>
                  ) : (
                    <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
                      {list.map((row) => (
                        <OrderCard
                          key={row.id}
                          row={row}
                          onOpen={() => router.push(`/fulfilment/${row.id}`)}
                        />
                      ))}
                    </div>
                  )}
                </section>
              )
            })
          )}

          <StockPanel />
        </div>
      )}
    </>
  )
}
