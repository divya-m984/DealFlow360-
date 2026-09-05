// OWNER: D2.  One order, everything hanging off it — the payload behind
// screen 8 (warehouse split) and screen 10 (hybrid billing).
import { q, one } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>(null, async (_req, _session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid order id', 400)

  const order = await one(
    `SELECT o.id, o.number, o.quotation_id, qt.number AS quotation_number,
            o.customer_id, cu.name AS customer_name, cu.email AS customer_email,
            ct.name AS customer_tier, o.currency_code, o.state,
            o.promised_delivery_date, o.grand_total, o.created_at,
            (o.promised_delivery_date IS NOT NULL
             AND o.promised_delivery_date < CURRENT_DATE
             AND o.state <> 'fulfilled') AS is_late
       FROM sales_order o
       JOIN customer cu ON cu.id = o.customer_id
       JOIN customer_tier ct ON ct.id = cu.tier_id
       JOIN quotation qt ON qt.id = o.quotation_id
      WHERE o.id = $1`,
    [id],
  )
  if (!order) return fail('No such order', 404)

  const lines = await q(
    `SELECT sol.id, sol.quotation_line_id, sol.product_id, p.sku AS product_sku,
            p.name AS product_name, sol.variant_id, pv.sku AS variant_sku,
            ql.line_type, ql.subscription_plan_id, sp.name AS plan_name, sp.cycle,
            sol.qty, sol.unit_price, sol.net_amount,
            EXISTS (SELECT 1 FROM stock_level sl WHERE sl.product_id = sol.product_id) AS is_stock_managed
       FROM sales_order_line sol
       JOIN product p ON p.id = sol.product_id
       JOIN quotation_line ql ON ql.id = sol.quotation_line_id
       LEFT JOIN product_variant pv ON pv.id = sol.variant_id
       LEFT JOIN subscription_plan sp ON sp.id = ql.subscription_plan_id
      WHERE sol.order_id = $1
      ORDER BY sol.id`,
    [id],
  )

  const [allocations, backorders, invoices, subscriptions] = await Promise.all([
    q(`SELECT fa.id, fa.order_line_id, fa.warehouse_id, w.code AS warehouse_code,
              w.name AS warehouse_name, fa.qty, fa.status, fa.shipping_cost,
              fa.is_manual_override, fa.promised_ship_date, fa.shipped_at
         FROM fulfillment_allocation fa
         JOIN warehouse w ON w.id = fa.warehouse_id
         JOIN sales_order_line sol ON sol.id = fa.order_line_id
        WHERE sol.order_id = $1 ORDER BY fa.order_line_id, fa.id`, [id]),
    q(`SELECT b.id, b.order_line_id, b.qty_outstanding, b.created_at, b.resolved_at
         FROM backorder b JOIN sales_order_line sol ON sol.id = b.order_line_id
        WHERE sol.order_id = $1 ORDER BY b.id`, [id]),
    q(`SELECT i.id, i.number, i.kind, i.currency_code, i.amount_total, i.status,
              i.issue_date, i.due_date, i.subscription_id,
              COALESCE((SELECT SUM(amount) FROM payment WHERE invoice_id = i.id), 0) AS amount_paid
         FROM invoice i
        WHERE i.order_id = $1
           OR i.subscription_id IN (SELECT s.id FROM subscription s
                                      JOIN sales_order_line sl ON sl.id = s.source_order_line_id
                                     WHERE sl.order_id = $1)
        ORDER BY i.id`, [id]),
    q(`SELECT s.id, s.plan_id, sp.name AS plan_name, sp.cycle, sp.price AS plan_price,
              s.qty, s.status, s.current_period_start, s.current_period_end,
              s.next_bill_date, s.source_order_line_id
         FROM subscription s
         JOIN subscription_plan sp ON sp.id = s.plan_id
         JOIN sales_order_line sl ON sl.id = s.source_order_line_id
        WHERE sl.order_id = $1 ORDER BY s.id`, [id]),
  ])

  // The mockup's progress rail: Order Confirmed → Shipped → Invoiced → Paid.
  // Every step is read from real state, never from a stored "step" column —
  // one source of truth, and it cannot drift.
  const shippedAllocs = allocations.filter((a: any) => a.status === 'shipped')
  const progress = {
    confirmed: true,
    shipped: shippedAllocs.length > 0,
    invoiced: invoices.length > 0,
    paid: invoices.length > 0 && invoices.every((i: any) => i.status === 'paid'),
  }

  const byLine = <T extends { order_line_id: number }>(rows: T[], lineId: number) =>
    rows.filter((r) => Number(r.order_line_id) === lineId)

  return ok({
    ...order,
    progress,
    lines: lines.map((l: any) => ({
      ...l,
      allocations: byLine(allocations as any, Number(l.id)),
      backorders: byLine(backorders as any, Number(l.id)),
    })),
    allocations,
    backorders,
    invoices,
    subscriptions,
  })
})
