// OWNER: D2.  Screen 8 — Warehouse Split.
//
// Returns, for one order: every stock-managed line, the split currently saved
// against it, live availability per warehouse, and what lib/allocate.ts would
// suggest RIGHT NOW.  The last of those is what makes "Recompute" and the
// consolidate prompt honest — both are derived on read, from current stock.
import { tx } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { loadStockFor } from '../_stock'
import { planAllocation } from '@/lib/allocate'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>(null, async (_req, _session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid order id', 400)

  // Read inside a transaction so every line on the screen sees the SAME stock
  // position.  Two lines competing for the same product would otherwise be
  // costed against two different snapshots.
  const payload = await tx(async (c) => {
    const ord = await c.query(
      `SELECT o.id, o.number, o.state, o.currency_code, o.grand_total,
              o.promised_delivery_date, o.created_at,
              o.customer_id, cu.name AS customer_name,
              qt.number AS quotation_number,
              (o.promised_delivery_date IS NOT NULL
               AND o.promised_delivery_date < CURRENT_DATE
               AND o.state <> 'fulfilled') AS is_late
         FROM sales_order o
         JOIN customer cu ON cu.id = o.customer_id
         JOIN quotation qt ON qt.id = o.quotation_id
        WHERE o.id = $1`,
      [id],
    )
    if (ord.rowCount === 0) return null

    const lines = await c.query(
      `SELECT sol.id, sol.product_id, p.sku AS product_sku, p.name AS product_name,
              sol.variant_id, pv.sku AS variant_sku, ql.line_type,
              sol.qty, sol.unit_price, sol.net_amount,
              EXISTS (SELECT 1 FROM stock_level sl WHERE sl.product_id = sol.product_id) AS is_stock_managed
         FROM sales_order_line sol
         JOIN product p ON p.id = sol.product_id
         JOIN quotation_line ql ON ql.id = sol.quotation_line_id
         LEFT JOIN product_variant pv ON pv.id = sol.variant_id
        WHERE sol.order_id = $1
        ORDER BY sol.id`,
      [id],
    )

    // Annotated, not inferred: main's tsconfig sets noImplicitAny:false, which
    // turns off TypeScript's evolving-array inference — a bare [] is never[].
    const out: any[] = []
    for (const l of lines.rows) {
      const lineId = Number(l.id)
      const [allocs, backs] = await Promise.all([
        c.query(
          `SELECT fa.id, fa.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
                  fa.qty, fa.status, fa.shipping_cost, fa.is_manual_override,
                  fa.promised_ship_date, fa.shipped_at
             FROM fulfillment_allocation fa JOIN warehouse w ON w.id = fa.warehouse_id
            WHERE fa.order_line_id = $1 ORDER BY fa.id`,
          [lineId],
        ),
        c.query(
          `SELECT id, qty_outstanding, created_at, resolved_at
             FROM backorder WHERE order_line_id = $1 ORDER BY id`,
          [lineId],
        ),
      ])

      const stockManaged = l.is_stock_managed === true
      const stock = stockManaged
        ? await loadStockFor(
            c,
            Number(l.product_id),
            l.variant_id === null ? null : Number(l.variant_id),
            // Same view the Recompute button will get, so what the screen
            // shows and what accepting would do can never disagree.
            { excludeOrderLineId: lineId },
          )
        : []

      const suggested = stockManaged
        ? planAllocation(
            { productId: Number(l.product_id), variantId: l.variant_id, qty: Number(l.qty) },
            stock,
          )
        : null

      // "Consolidate Remaining Backorder" (PS §B6).  We have no stock-arrival
      // event source, so this is RECOMPUTED ON READ: can each open backorder
      // be filled from stock as it stands right now?  If asked, say exactly
      // that — do not claim a background watcher we do not have.
      const openBackorder = backs.rows.find((b) => b.resolved_at === null)
      // The backorder is what is left over AFTER this line's existing plan, so
      // it is costed WITHOUT the exclusion above — those units are spoken for.
      // Same view consolidateBackorders() takes, so the prompt never offers
      // stock the action cannot actually deliver.
      const backorderStock = openBackorder && stockManaged
        ? await loadStockFor(c, Number(l.product_id), l.variant_id === null ? null : Number(l.variant_id))
        : []
      const consolidatable = openBackorder
        ? planAllocation(
            { productId: Number(l.product_id), variantId: l.variant_id, qty: Number(openBackorder.qty_outstanding) },
            backorderStock,
          )
        : null

      out.push({
        ...l,
        is_stock_managed: stockManaged,
        allocations: allocs.rows,
        backorders: backs.rows,
        stock,
        suggested,
        consolidate: consolidatable && consolidatable.allocations.length > 0
          ? {
              fillable_qty: consolidatable.allocations.reduce((t, a) => t + a.qty, 0),
              still_short: consolidatable.backorderQty,
              plan: consolidatable,
            }
          : null,
      })
    }

    return { ...ord.rows[0], lines: out }
  })

  if (!payload) return fail('No such order', 404)
  return ok(payload)
})
