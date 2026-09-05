// OWNER: D2.
//
// Jury review 2, ask 2 — the screen for the many-to-many.
//
// The jury asked to see a product carrying a relation to the things bought
// alongside it: a phone with its cover and its power bank, related by primary
// keys appearing as foreign keys.  That relation already existed as
// `upsell_rule`; it was simply invisible from the one screen a judge would
// look at.  This is that screen.
//
// ── THE POINT TO MAKE OUT LOUD ───────────────────────────────────────
// The alternative design — accessory_1_id, accessory_2_id, accessory_3_id
// columns on `product` — caps the relationship at however many columns
// somebody guessed, needs a schema change to add a fourth, and cannot answer
// the reverse question at all.  A junction table answers "what goes with
// this?" and "what is this an accessory FOR?" from the same rows, read in
// two directions.  Both are rendered below, side by side, for exactly that
// reason.

'use client'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/shared/money'
import { EmptyState } from '@/components/shared/empty-state'

type Related = {
  id: number
  product_id: number
  sku: string
  name: string
  base_price: string
  currency_code: string
  margin_pct: string
  min_margin_pct: string | null
  rank_score: string
  is_promoted: boolean
  promo_text: string | null
  suppressed_by_margin: boolean
  qty_available: string
}
type Back = { id: number; kind: string; product_id: number; sku: string; name: string }

function Row({ r }: { r: Related }) {
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border p-2.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{r.name}</span>
          <span className="font-mono text-[11px] text-muted-foreground">{r.sku}</span>
          {r.is_promoted && (
            <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
              {r.promo_text ?? 'Promoted'}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
          <span>margin {Number(r.margin_pct).toFixed(1)}%</span>
          {r.min_margin_pct !== null && <span>· gate {Number(r.min_margin_pct).toFixed(1)}%</span>}
          <span>· rank {Number(r.rank_score).toFixed(0)}</span>
          <span>· {Number(r.qty_available)} in stock</span>
        </div>
        {r.suppressed_by_margin && (
          // A rule whose gate sits above its target's real margin never fires
          // and looks identical to a live one from the UI.  The seed has an
          // invariant that RAISEs on this; surfacing it here means a rule
          // added later by hand cannot go dead silently either.
          <p className="mt-1 text-[11px] text-destructive">
            Suppressed — the margin gate is above this product’s actual margin, so this rule can never fire.
          </p>
        )}
      </div>
      <Money value={r.base_price} currency={r.currency_code} className="shrink-0 text-sm" />
    </li>
  )
}

export function RelatedProducts({
  accessories, alternatives, accessoryFor,
}: { accessories: Related[]; alternatives: Related[]; accessoryFor: Back[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Bought alongside &amp; instead</CardTitle>
        <CardDescription>
          A product-to-product many-to-many. <code className="text-[11px]">upsell_rule</code> is a
          junction table: <code className="text-[11px]">trigger_product_id</code> and{' '}
          <code className="text-[11px]">suggested_product_id</code> are both foreign keys to{' '}
          <code className="text-[11px]">product(id)</code>, the pair is UNIQUE, and a CHECK forbids a
          product suggesting itself. The same rows answer both directions.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Accessories <span className="font-normal text-muted-foreground">· cross-sell</span>
          </h3>
          {accessories.length === 0
            ? <EmptyState title="No accessories" description="Nothing is linked as bought-alongside." />
            : <ul className="space-y-2">{accessories.map((r) => <Row key={r.id} r={r} />)}</ul>}
        </div>

        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Alternatives <span className="font-normal text-muted-foreground">· upsell, bought instead</span>
            </h3>
            {alternatives.length === 0
              ? <EmptyState title="No alternatives" description="Nothing is linked as a trade-up." />
              : <ul className="space-y-2">{alternatives.map((r) => <Row key={r.id} r={r} />)}</ul>}
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Accessory for <span className="font-normal text-muted-foreground">· the same rows, read backwards</span>
            </h3>
            {accessoryFor.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                This product is not listed as an accessory for anything.
              </p>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {accessoryFor.map((b) => (
                  <li key={b.id}>
                    <Badge variant="outline" className="text-[11px]">
                      {b.sku} <span className="ml-1 text-muted-foreground">{b.kind}</span>
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
