// OWNER: D2.  Accept the suggested split, or override it by hand (PS §B6).
//
// Both paths land in the same place — fulfillment_allocation rows at status
// 'planned' — so nothing downstream has to care which one was used.  The only
// difference on the row is is_manual_override, and that flag is kept HONEST:
// it is true when and only when a human moved the quantities.  It is what
// makes the audit story credible.
import { z } from 'zod'
import { tx } from '@/lib/db'
import { ok, fail, parseBody, withAuth } from '@/lib/api'
import { loadStockFor, persistPlan, recomputeOrderState } from '../../_stock'
import { planAllocation, validateManualSplit, SHIPMENT_BASE_COST } from '@/lib/allocate'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const Body = z.strictObject({
  /** Omit to accept the engine's suggestion for every line. */
  overrides: z
    .array(
      z.strictObject({
        orderLineId: z.number().int().positive(),
        allocations: z.array(
          z.strictObject({
            warehouseId: z.number().int().positive(),
            qty: z.number().positive(),
          }),
        ).min(1),
      }),
    )
    .default([]),
  promisedShipDate: z.string().nullable().default(null),
})

export const POST = withAuth<Ctx>(null, async (req, session, { params }) => {
  const orderId = Number((await params).id)
  if (!Number.isFinite(orderId)) return fail('Invalid order id', 400)
  const body = await parseBody(req, Body)

  const result = await tx(async (c) => {
    const ord = await c.query(`SELECT id, number, state FROM sales_order WHERE id = $1 FOR UPDATE`, [orderId])
    if (ord.rowCount === 0) throw new Error('No such order')
    if (ord.rows[0].state === 'cancelled') throw new Error('That order is cancelled.')

    const lines = await c.query(
      `SELECT sol.id, sol.product_id, sol.variant_id, sol.qty, p.name AS product_name,
              EXISTS (SELECT 1 FROM stock_level sl WHERE sl.product_id = sol.product_id) AS is_stock_managed
         FROM sales_order_line sol JOIN product p ON p.id = sol.product_id
        WHERE sol.order_id = $1 ORDER BY sol.id`,
      [orderId],
    )

    const overrideBy = new Map(body.overrides.map((o) => [o.orderLineId, o]))
    const applied: { orderLineId: number; product: string; manual: boolean; shipments: number; cost: number; backorder: number }[] = []

    for (const l of lines.rows) {
      if (l.is_stock_managed !== true) continue
      const lineId = Number(l.id)
      // excludeOrderLineId: persistPlan is about to delete this line's own
      // planned rows, so they must not count against it while it re-plans.
      const stock = await loadStockFor(
        c,
        Number(l.product_id),
        l.variant_id === null ? null : Number(l.variant_id),
        { excludeOrderLineId: lineId },
      )
      const ov = overrideBy.get(lineId)

      if (ov) {
        const check = validateManualSplit(Number(l.qty), ov.allocations, stock)
        if (!check.ok) throw new Error(`${l.product_name}: ${check.message}`)

        const allocated = ov.allocations.reduce((t, a) => t + a.qty, 0)
        const plan = {
          allocations: ov.allocations.map((a) => {
            const s = stock.find((x) => x.warehouseId === a.warehouseId)!
            return {
              warehouseId: a.warehouseId,
              warehouseCode: s.warehouseCode,
              warehouseName: s.warehouseName,
              qty: a.qty,
              shippingCost: Math.round(SHIPMENT_BASE_COST * s.shippingCostWeight * 100) / 100,
            }
          }),
          backorderQty: Math.max(0, Number(l.qty) - allocated),
          shipments: ov.allocations.length,
          totalShippingCost: 0,
          strategy: 'min_shipments' as const,
          reason: 'Manual override',
        }
        plan.totalShippingCost = plan.allocations.reduce((t, a) => t + a.shippingCost, 0)
        await persistPlan(c, lineId, plan, { manual: true, promisedShipDate: body.promisedShipDate })
        applied.push({ orderLineId: lineId, product: l.product_name, manual: true, shipments: plan.shipments, cost: plan.totalShippingCost, backorder: plan.backorderQty })
      } else {
        const plan = planAllocation(
          { productId: Number(l.product_id), variantId: l.variant_id, qty: Number(l.qty) },
          stock,
        )
        await persistPlan(c, lineId, plan, { manual: false, promisedShipDate: body.promisedShipDate })
        applied.push({ orderLineId: lineId, product: l.product_name, manual: false, shipments: plan.shipments, cost: plan.totalShippingCost, backorder: plan.backorderQty })
      }
    }

    const state = await recomputeOrderState(c, orderId)

    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('sales_order', $1, $2, $3, $4, $5)`,
      [
        orderId,
        body.overrides.length > 0 ? 'fulfilment_manual_override' : 'fulfilment_accept_plan',
        session.userId,
        body.overrides.length > 0
          ? `Split overridden by hand on ${body.overrides.length} line(s)`
          : `Suggested split accepted on ${applied.length} line(s)`,
        JSON.stringify(applied),
      ],
    )

    return { orderId, state, lines: applied }
  })

  return ok(result)
})
