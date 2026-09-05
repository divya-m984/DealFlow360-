// OWNER: D2.  Product catalogue (screen 16 list, screen 4 product picker).
//
// BOTH D3 (screen 16) and D1 (the quotation builder's picker) read this — it is
// the only products endpoint, by the ownership map.  If you need a field that
// is not here, ask for it rather than adding a second endpoint.
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

export const GET = withAuth(null, async (req) => {
  const url = new URL(req.url)
  const search = url.searchParams.get('q')

  const rows = await q(
    `SELECT p.id, p.sku, p.name, p.category_id, pc.name AS category_name,
            pc.max_discount_pct AS category_max_discount_pct,
            p.base_price, p.cost, p.currency_code, p.unit, p.tax_pct,
            p.is_subscription, p.recurring_cycle, p.is_active,
            round(((p.base_price - p.cost) / NULLIF(p.base_price, 0)) * 100, 2) AS margin_pct,
            COALESCE(st.on_hand, 0)   AS qty_on_hand,
            COALESCE(st.available, 0) AS qty_available,
            (st.product_id IS NOT NULL) AS is_stock_managed,
            (SELECT count(*)::int FROM product_variant v WHERE v.product_id = p.id) AS variant_count
       FROM product p
       JOIN product_category pc ON pc.id = p.category_id
       LEFT JOIN LATERAL (
         SELECT s.product_id, SUM(s.qty_on_hand) AS on_hand, SUM(s.qty_available) AS available
           FROM stock_level s WHERE s.product_id = p.id GROUP BY s.product_id
       ) st ON true
      WHERE ($1::text IS NULL
             OR p.name ILIKE '%' || $1 || '%'
             OR p.sku  ILIKE '%' || $1 || '%')
      ORDER BY pc.name, p.name`,
    [search],
  )
  return ok(rows)
})
