// OWNER: D2.  Screen 17 — Product + Pricelist.
//
// Variants are READ-ONLY by design: they are seeded, rendered, and never
// generated.  A combination generator is a rabbit hole with no demo payoff,
// and saying so is a better answer than half-building one.
import { q, one, tx } from '@/lib/db'
import { z } from 'zod'
import { ok, fail, parseBody, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>(null, async (_req, _session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid product id', 400)

  const p = await one(
    `SELECT p.id, p.sku, p.name, p.category_id, pc.name AS category_name,
            pc.max_discount_pct AS category_max_discount_pct,
            p.base_price, p.cost, p.currency_code, p.unit, p.tax_pct, p.description,
            p.is_subscription, p.recurring_cycle, p.is_active,
            round(((p.base_price - p.cost) / NULLIF(p.base_price, 0)) * 100, 2) AS margin_pct
       FROM product p JOIN product_category pc ON pc.id = p.category_id
      WHERE p.id = $1`,
    [id],
  )
  if (!p) return fail('No such product', 404)

  const [variants, pricelists, stock, tiers] = await Promise.all([
    q(`SELECT v.id, v.sku, v.extra_price, v.is_active,
              COALESCE(json_agg(json_build_object('attribute', a.name, 'value', av.value,
                                                  'extra_price', av.extra_price)
                                ORDER BY a.sort_order)
                       FILTER (WHERE a.id IS NOT NULL), '[]') AS options
         FROM product_variant v
         LEFT JOIN variant_option vo ON vo.variant_id = v.id
         LEFT JOIN product_attribute_value av ON av.id = vo.attribute_value_id
         LEFT JOIN product_attribute a ON a.id = av.attribute_id
        WHERE v.product_id = $1
        GROUP BY v.id ORDER BY v.sku`, [id]),

    // The effective price under each tier's pricelist.  Resolved here, in one
    // place, rather than in four screens that would each get it slightly
    // different: a product-specific rule beats a category rule.
    q(`SELECT pl.id AS pricelist_id, pl.name AS pricelist_name, ct.name AS tier_name,
              pl.currency_code,
              COALESCE(pi_prod.rule_type, pi_cat.rule_type, 'no_adjustment') AS rule_type,
              COALESCE(pi_prod.value, pi_cat.value, 0) AS value,
              CASE COALESCE(pi_prod.rule_type, pi_cat.rule_type, 'no_adjustment')
                WHEN 'fixed_price'  THEN COALESCE(pi_prod.value, pi_cat.value)
                WHEN 'discount_pct' THEN round(p.base_price * (1 - COALESCE(pi_prod.value, pi_cat.value) / 100.0), 4)
                ELSE p.base_price
              END AS effective_price
         FROM pricelist pl
         CROSS JOIN product p
         LEFT JOIN customer_tier ct ON ct.id = pl.tier_id
         LEFT JOIN pricelist_item pi_prod ON pi_prod.pricelist_id = pl.id AND pi_prod.product_id = p.id
         LEFT JOIN pricelist_item pi_cat  ON pi_cat.pricelist_id  = pl.id AND pi_cat.category_id = p.category_id
        WHERE p.id = $1 AND pl.is_active
        ORDER BY ct.sort_order NULLS LAST, pl.id`, [id]),

    q(`SELECT s.id, s.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
              s.qty_on_hand, s.qty_reserved, s.qty_available, s.reorder_point, s.reorder_qty,
              (s.qty_available < s.reorder_point) AS below_reorder_point,
              w.shipping_cost_weight
         FROM stock_level s JOIN warehouse w ON w.id = s.warehouse_id
        WHERE s.product_id = $1 ORDER BY w.shipping_cost_weight, w.code`, [id]),

    q(`SELECT id, name, max_discount_pct FROM customer_tier ORDER BY sort_order`),
  ])

  // The effective ceiling for this product at each tier — LEAST(tier,
  // category), the same rule effective_ceiling_pct() applies in the database.
  const ceilings = tiers.map((t: any) => ({
    tier: t.name,
    ceiling: Math.min(Number(t.max_discount_pct), Number((p as any).category_max_discount_pct)),
  }))

  return ok({ ...p, variants, pricelists, stock, ceilings })
})

const Body = z.strictObject({
  base_price: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  tax_pct: z.number().min(0).max(100).optional(),
  unit: z.string().min(1).max(40).optional(),
  description: z.string().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
  is_subscription: z.boolean().optional(),
  recurring_cycle: z.enum(['weekly', 'monthly', 'quarterly', 'yearly']).nullable().optional(),
})

export const PATCH = withAuth<Ctx>(['admin', 'sales_manager'], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid product id', 400)
  const b = await parseBody(req, Body)

  // product.recurring_iff_subscription is a CHECK: is_subscription is true
  // exactly when recurring_cycle is set.  Catching it here gives a sentence
  // the user can act on; letting Postgres catch it gives them 23514.
  if (b.is_subscription !== undefined || b.recurring_cycle !== undefined) {
    const cur = await one<{ is_subscription: boolean; recurring_cycle: string | null }>(
      `SELECT is_subscription, recurring_cycle FROM product WHERE id = $1`, [id],
    )
    if (!cur) return fail('No such product', 404)
    const isSub = b.is_subscription ?? cur.is_subscription
    const cycle = b.recurring_cycle !== undefined ? b.recurring_cycle : cur.recurring_cycle
    if (isSub && !cycle) return fail('A subscription product needs a recurring cycle.', 400)
    if (!isSub && cycle) return fail('A one-off product cannot have a recurring cycle.', 400)
  }

  const fields = Object.entries(b).filter(([, v]) => v !== undefined)
  if (fields.length === 0) return fail('Nothing to update.', 400)

  const result = await tx(async (c) => {
    const before = await c.query(`SELECT * FROM product WHERE id = $1 FOR UPDATE`, [id])
    if (before.rowCount === 0) throw new Error('No such product')

    const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ')
    const upd = await c.query(
      `UPDATE product SET ${sets} WHERE id = $1 RETURNING *`,
      [id, ...fields.map(([, v]) => v)],
    )
    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('product', $1, 'update', $2, $3, $4)`,
      [id, session.userId, `Updated ${fields.map(([k]) => k).join(', ')}`,
       JSON.stringify({ changed: Object.fromEntries(fields) })],
    )
    return upd.rows[0]
  })

  return ok(result)
})
