// OWNER: D2.  Goods receipt — the only way stock enters the system.
//
// The PS's "Consolidate Remaining Backorder" (§B6) is triggered by stock
// ARRIVING mid-fulfilment.  Without a way to receive stock, that prompt could
// only ever be demonstrated by editing the database by hand on stage, which is
// not a demonstration of anything.  So this is a real, minimal goods receipt:
// it raises qty_on_hand, writes an audit row, and nothing else.
//
// It is deliberately NOT a full inbound-logistics feature — no purchase
// orders, no supplier, no put-away.  That belongs in the "what we'd build
// next" note, and saying so is more credible than a half-built version.
import { z } from 'zod'
import { q, tx } from '@/lib/db'
import { ok, parseBody, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

export const GET = withAuth(null, async () => {
  const rows = await q(
    `SELECT s.id, s.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
            s.product_id, p.sku AS product_sku, p.name AS product_name,
            s.variant_id, s.qty_on_hand, s.qty_reserved, s.qty_available,
            s.reorder_point, s.reorder_qty,
            (s.qty_available < s.reorder_point) AS below_reorder_point,
            COALESCE(pl.planned, 0) AS planned_not_reserved
       FROM stock_level s
       JOIN warehouse w ON w.id = s.warehouse_id
       JOIN product p ON p.id = s.product_id
       LEFT JOIN LATERAL (
         SELECT SUM(fa.qty) AS planned
           FROM fulfillment_allocation fa
           JOIN sales_order_line sol ON sol.id = fa.order_line_id
          WHERE fa.status = 'planned'
            AND fa.warehouse_id = s.warehouse_id
            AND sol.product_id = s.product_id
       ) pl ON true
      ORDER BY p.sku, w.shipping_cost_weight, w.code`,
  )
  return ok(rows)
})

const Body = z.strictObject({
  warehouseId: z.number().int().positive(),
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().default(null),
  qty: z.number().positive().max(100000),
  reference: z.string().max(200).nullable().default(null),
})

export const POST = withAuth(['admin', 'sales_manager', 'finance'], async (req, session) => {
  const b = await parseBody(req, Body)

  const result = await tx(async (c) => {
    // The row is locked before it is read, so two receipts for the same shelf
    // cannot both read the old figure and write it back.
    const cur = await c.query(
      `SELECT id, qty_on_hand FROM stock_level
        WHERE warehouse_id = $1 AND product_id = $2
          AND variant_id IS NOT DISTINCT FROM $3
        FOR UPDATE`,
      [b.warehouseId, b.productId, b.variantId],
    )
    if (cur.rowCount === 0) {
      throw new Error('That product is not stocked at that warehouse. Add a stock_level row first.')
    }

    const upd = await c.query(
      `UPDATE stock_level SET qty_on_hand = qty_on_hand + $2
        WHERE id = $1
        RETURNING qty_on_hand, qty_reserved, qty_available`,
      [cur.rows[0].id, b.qty],
    )

    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('stock_level', $1, 'goods_receipt', $2, $3, $4)`,
      [cur.rows[0].id, session.userId,
       `Received ${b.qty} units` + (b.reference ? ` (${b.reference})` : ''),
       JSON.stringify({ ...b, before: cur.rows[0].qty_on_hand, after: upd.rows[0].qty_on_hand })],
    )

    return { stockLevelId: Number(cur.rows[0].id), ...upd.rows[0] }
  })

  return ok(result, 201)
})
