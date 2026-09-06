// OWNER: D3.  Screen 16 — Product Catalog.
//
// Products, their variants and their list price.  Pricelist rules, upsell
// rules and stock movement are D2's; this screen renders catalogue rows.
//
// A CATALOGUE, NOT A LEDGER.  This was a nine-column table, and a table is the
// wrong shape for it: nobody reconciles a catalogue line by line, they browse
// it looking for one product.  Two columns were also pure noise — `Status` said
// "Active" seven times, and `Unit` and `Tax` are identical for every row in the
// seed.  So it is now cards grouped by category, and the columns that never
// varied became either a caption on the card or, in Status's case, a badge that
// only appears when a product is INACTIVE, which is the only time it is news.
//
// TWO FIELDS THE TABLE NEVER SHOWED, both already in the payload:
//   • `margin_pct` — the number the whole app is arguing about.  Quotations
//     report margin, Deal Health flags discounts that eat it, the dashboard
//     tiles blend it; the catalogue was the one screen that had the per-product
//     figure and did not print it.
//   • `category_max_discount_pct` — the discount ceiling for the category.  It
//     is what a rep breaches to trigger an approval, so it belongs on the
//     header of the group it governs.
// `cost` is in the payload too and is deliberately NOT rendered: margin is the
// derived figure a sales screen needs, and the raw buy price is not something
// to put on a browsing screen just because it happens to be in the response.
//
// CONTRACT: matched against the landed GET /api/products (D2).
//
// `qty_available` is COALESCEd to 0 for any product with no `stock_level` rows,
// so a service or subscription product that is not stocked at all comes back as
// 0 — indistinguishable from a stocked product that has sold out.  Reporting
// that as a shortage would invent one, so every stock reading checks
// `is_stock_managed` first and says "Not stocked" instead.
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Search } from 'lucide-react'
import { cn } from 'cn'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorState } from '@/components/shared/error-state'
import { formatNumber, Money, Num } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

type ProductRow = {
  id: number
  sku: string
  name: string
  category_id: number
  category_name: string
  category_max_discount_pct: string | number
  currency_code: string
  base_price: string | number
  cost: string | number
  margin_pct: string | number | null
  unit: string
  tax_pct: string | number
  is_subscription: boolean
  /** billing_cycle, present only when is_subscription is true. */
  recurring_cycle: string | null
  is_active: boolean
  variant_count: number
  /** Summed across warehouses; 0 for anything with no stock_level rows. */
  qty_on_hand: string | number
  qty_available: string | number
  /** False when the product has no stock_level rows at all — see header. */
  is_stock_managed: boolean
}

const PANEL = 'rounded-xl border border-border bg-card shadow-[var(--shadow-card)]'

function num(v: string | number | null | undefined) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : 0
}

/* ── Product card ─────────────────────────────────────────────────────────── */

function ProductCard({ row, onOpen }: { row: ProductRow; onOpen: () => void }) {
  const margin = row.margin_pct === null ? null : num(row.margin_pct)
  const onHand = num(row.qty_on_hand)
  const available = num(row.qty_available)

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
        // An inactive product is still sold on old quotations, so it is shown
        // rather than hidden — but it is visibly retired.
        !row.is_active && 'opacity-70',
      )}
    >
      {/* 1 — WHAT IT IS.  SKU in mono because it is an identifier people type
          into a filter box, not prose. */}
      <div className="px-3 pt-2.5 pb-2">
        <div className="flex items-start justify-between gap-2">
          <span className="truncate text-sm font-semibold tracking-tight text-foreground">
            {row.name}
          </span>
          {/* ONLY when inactive.  "Active" on every card is a column of yes,
              which carries no information and costs a colour. */}
          {!row.is_active && <StatusBadge status="inactive" />}
        </div>
        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
          {row.sku}
        </p>
      </div>

      {/* 2 — WHAT IT COSTS.  Price leads at full size; the billing shape and the
          tax rate are captions on it rather than columns of their own. */}
      <div className="border-t border-border px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <Money
            value={row.base_price}
            currency={row.currency_code}
            className="text-base font-semibold text-foreground"
          />
          <span className="shrink-0 text-[0.7rem] text-muted-foreground">
            per {row.unit}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.7rem] text-muted-foreground">
          {row.is_subscription ? (
            <span className="capitalize">
              Recurring{row.recurring_cycle ? ` · ${row.recurring_cycle}` : ''}
            </span>
          ) : (
            <span>One-time</span>
          )}
          <span aria-hidden>·</span>
          <span className="tabular-nums">
            <Num value={row.tax_pct} suffix="%" /> tax
          </span>
          {row.variant_count > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                <Num value={row.variant_count} />{' '}
                {row.variant_count === 1 ? 'variant' : 'variants'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* 3 — WHAT IT EARNS.  The bar runs 0–100%, the scale margin is actually
          quoted on, so two products are comparable at a glance.  It is
          deliberately UNJUDGED — the app's own violet, not a red/green verdict
          — because "what counts as a thin margin" is a policy that lives on the
          server, in the approval thresholds, not on a catalogue card. */}
      {margin !== null && (
        <div className="border-t border-border px-3 py-2">
          <div className="flex items-baseline justify-between gap-2 text-[0.7rem]">
            <span className="text-muted-foreground">Margin</span>
            <span className="font-semibold text-foreground tabular-nums">
              {margin.toFixed(1)}%
            </span>
          </div>
          <span
            aria-hidden
            className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"
          >
            <span
              className="block h-full rounded-full bg-[var(--chart-1)]"
              style={{ width: `${Math.min(100, Math.max(0, margin))}%` }}
            />
          </span>
        </div>
      )}

      {/* 4 — WHETHER YOU CAN SHIP IT.  Not stocked at all is not the same as
          sold out — see the file header. */}
      <div className="mt-auto border-t border-border px-3 py-2 text-[0.7rem]">
        {!row.is_stock_managed ? (
          <span className="text-muted-foreground">
            Not stocked — nothing to allocate
          </span>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-muted-foreground">Available</span>
              <span
                className={cn(
                  'font-semibold tabular-nums',
                  available <= 0 ? 'text-[var(--accent-red)]' : 'text-foreground',
                )}
              >
                {formatNumber(available)} of {formatNumber(onHand)}
              </span>
            </div>
            {/* Available as a share of on hand — the gap IS the reserved
                stock, so a nearly-empty bar on a full shelf reads as
                "committed", which is exactly Laptop Pro 14's situation. */}
            <span
              aria-hidden
              className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-muted"
            >
              <span
                className={cn(
                  'block h-full rounded-full',
                  available <= 0 ? 'bg-[var(--accent-red)]' : 'bg-[var(--accent-teal)]',
                )}
                style={{
                  width: `${onHand > 0 ? Math.min(100, (available / onHand) * 100) : 0}%`,
                }}
              />
            </span>
          </>
        )}
      </div>
    </div>
  )
}

/* ── Screen ───────────────────────────────────────────────────────────────── */

export default function ProductsPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<ProductRow>('/api/products')

  const [query, setQuery] = React.useState('')
  const [category, setCategory] = React.useState<number | 'all'>('all')

  // Category order follows the API's own ordering, so the groups match the way
  // the catalogue is organised on the server rather than being re-sorted here.
  const categories = React.useMemo(() => {
    const byId = new Map<number, { id: number; name: string; maxDiscount: number; count: number }>()
    for (const row of rows ?? []) {
      const entry = byId.get(row.category_id) ?? {
        id: row.category_id,
        name: row.category_name,
        maxDiscount: num(row.category_max_discount_pct),
        count: 0,
      }
      entry.count += 1
      byId.set(row.category_id, entry)
    }
    return [...byId.values()]
  }, [rows])

  // CLIENT-SIDE, over rows already fetched — the same call the other screens
  // make.  The chip counts describe the WHOLE catalogue rather than the
  // filtered slice, which is only possible with every row in hand.
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return (rows ?? []).filter(
      (row) =>
        (category === 'all' || row.category_id === category) &&
        (q === '' ||
          row.name.toLowerCase().includes(q) ||
          row.sku.toLowerCase().includes(q) ||
          row.category_name.toLowerCase().includes(q)),
    )
  }, [rows, query, category])

  const groups = React.useMemo(
    () =>
      categories
        .map((c) => ({ ...c, items: filtered.filter((r) => r.category_id === c.id) }))
        .filter((c) => c.items.length > 0),
    [categories, filtered],
  )

  if (error) {
    return (
      <>
        <PageHeader
          title="Product Catalog"
          description="Products, variants and list prices, with stock available across all warehouses."
        />
        <div className={PANEL}>
          <ErrorState error={error} onRetry={retry} />
        </div>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Product Catalog"
        description="Products, variants and list prices, with stock available across all warehouses."
      />

      <div className="space-y-4">
        {/* Control strip.  The table's filter box came free with <DataTable>;
            dropping the table means providing it, and a catalogue is the screen
            people search rather than scroll. */}
        <div className={cn(PANEL, 'flex flex-wrap items-center gap-2 p-2.5')}>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Filter by name, SKU or category…"
              aria-label="Filter by name, SKU or category"
              className="pl-8"
            />
          </div>

          {rows && rows.length > 0 && (
            <div className="ml-auto flex flex-wrap items-center gap-1">
              {[{ id: 'all' as const, name: 'All', count: rows.length }, ...categories].map(
                (c) => {
                  const active = category === c.id
                  return (
                    <button
                      key={String(c.id)}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setCategory(c.id)}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-xs transition-colors',
                        'outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                        active
                          ? 'border-primary/30 bg-primary/10 font-semibold text-primary'
                          : 'border-border text-foreground/80 hover:bg-[var(--row-hover)]',
                      )}
                    >
                      {c.name}
                      <span className="tabular-nums">{c.count}</span>
                    </button>
                  )
                },
              )}
            </div>
          )}
        </div>

        {loading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Skeleton key={i} className="h-[14rem] w-full" />
            ))}
          </div>
        ) : rows && rows.length === 0 ? (
          <div className={PANEL}>
            <EmptyState
              title="No products in the catalogue"
              description="Seed the catalogue with db/reset.sh, or add a product from the admin screens."
            />
          </div>
        ) : groups.length === 0 ? (
          <div className={PANEL}>
            <EmptyState
              icon={<Search className="size-4" />}
              title="No matching products"
              description="Nothing in the catalogue matches that filter."
            />
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.id} className={cn(PANEL, 'overflow-hidden')}>
              <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
                <h2 className="text-sm font-bold text-foreground">
                  {group.name}
                  <span className="ml-1.5 font-semibold text-muted-foreground tabular-nums">
                    {group.items.length}
                  </span>
                </h2>
                {/* THE CEILING THAT DRIVES APPROVALS, on the group it governs.
                    A rep discounting past this is what routes a quotation to a
                    manager, and it was previously only visible on D1's
                    approval-policy screen. */}
                <span className="shrink-0 text-xs text-muted-foreground">
                  Max discount{' '}
                  <span className="font-semibold text-foreground tabular-nums">
                    <Num value={group.maxDiscount} suffix="%" />
                  </span>
                </span>
              </header>

              <div className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {group.items.map((row) => (
                  <ProductCard
                    key={row.id}
                    row={row}
                    onOpen={() => router.push(`/products/${row.id}`)}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        <p className="text-xs text-muted-foreground">
          {filtered.length === (rows?.length ?? 0) ? (
            <>
              <span className="font-medium text-foreground tabular-nums">
                {rows?.length ?? 0}
              </span>{' '}
              products
            </>
          ) : (
            <>
              <span className="font-medium text-foreground tabular-nums">
                {filtered.length} of {rows?.length ?? 0}
              </span>{' '}
              products
            </>
          )}{' '}
          · Click a card to open the product.
        </p>
      </div>
    </>
  )
}
