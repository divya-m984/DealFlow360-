// OWNER: D2.  The fulfilment worklist — every order that still has something
// to do, plus the ones that are done, so the list screen can filter.
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

export const GET = withAuth(null, async (req) => {
  const url = new URL(req.url)
  const state = url.searchParams.get('state')

  const rows = await q(
    `SELECT o.id, o.number, o.state, o.customer_id, cu.name AS customer_name,
            o.currency_code, o.grand_total, o.promised_delivery_date, o.created_at,
            qt.number AS quotation_number,
            (o.promised_delivery_date IS NOT NULL
             AND o.promised_delivery_date < CURRENT_DATE
             AND o.state <> 'fulfilled')                        AS is_late,
            COALESCE(a.planned, 0)   AS planned_allocations,
            COALESCE(a.reserved, 0)  AS reserved_allocations,
            COALESCE(a.shipped, 0)   AS shipped_allocations,
            COALESCE(a.warehouses, 0) AS warehouses_used,
            COALESCE(b.open_backorders, 0) AS open_backorders,
            COALESCE(a.shipping_cost, 0)   AS shipping_cost
       FROM sales_order o
       JOIN customer cu ON cu.id = o.customer_id
       JOIN quotation qt ON qt.id = o.quotation_id
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE fa.status = 'planned')::int  AS planned,
                count(*) FILTER (WHERE fa.status = 'reserved')::int AS reserved,
                count(*) FILTER (WHERE fa.status = 'shipped')::int  AS shipped,
                count(DISTINCT fa.warehouse_id)::int                AS warehouses,
                COALESCE(SUM(fa.shipping_cost), 0)                  AS shipping_cost
           FROM fulfillment_allocation fa
           JOIN sales_order_line sl ON sl.id = fa.order_line_id
          WHERE sl.order_id = o.id
       ) a ON true
       LEFT JOIN LATERAL (
         SELECT count(*)::int AS open_backorders
           FROM backorder bo
           JOIN sales_order_line sl ON sl.id = bo.order_line_id
          WHERE sl.order_id = o.id AND bo.resolved_at IS NULL
       ) b ON true
      WHERE ($1::text IS NULL OR o.state::text = $1)
      ORDER BY o.promised_delivery_date NULLS LAST, o.id`,
    [state],
  )
  return ok(rows)
})
