// OWNER: D2.  Subscription list (PS §A5, §B7).
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

export const GET = withAuth(null, async (req) => {
  const url = new URL(req.url)
  const status = url.searchParams.get('status')

  const rows = await q(
    `SELECT s.id, s.customer_id, cu.name AS customer_name,
            s.plan_id, sp.name AS plan_name, sp.cycle, sp.price AS plan_price,
            sp.currency_code, s.qty, s.status,
            s.current_period_start, s.current_period_end, s.next_bill_date,
            round(sp.price * s.qty, 2) AS period_amount,
            o.id AS source_order_id, o.number AS source_order_number,
            (SELECT count(*)::int FROM proration_event pe WHERE pe.subscription_id = s.id) AS proration_events
       FROM subscription s
       JOIN customer cu ON cu.id = s.customer_id
       JOIN subscription_plan sp ON sp.id = s.plan_id
       LEFT JOIN sales_order_line sl ON sl.id = s.source_order_line_id
       LEFT JOIN sales_order o ON o.id = sl.order_id
      WHERE ($1::text IS NULL OR s.status::text = $1)
      ORDER BY s.next_bill_date NULLS LAST, s.id`,
    [status],
  )
  return ok(rows)
})
