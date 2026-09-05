// OWNER: D2.  Invoice list.  amount_paid is SUMmed from payments, never
// stored — see lib/invoice.ts for why status has exactly one writer.
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

export const GET = withAuth(null, async (req) => {
  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const kind = url.searchParams.get('kind')

  const rows = await q(
    `SELECT i.id, i.number, i.customer_id, cu.name AS customer_name,
            i.order_id, o.number AS order_number, i.subscription_id,
            i.kind, i.currency_code, i.amount_total, i.status,
            i.issue_date, i.due_date,
            COALESCE(p.paid, 0)                       AS amount_paid,
            (i.amount_total - COALESCE(p.paid, 0))    AS amount_due,
            (i.due_date < CURRENT_DATE AND i.status <> 'paid' AND i.status <> 'void') AS is_overdue
       FROM invoice i
       JOIN customer cu ON cu.id = i.customer_id
       LEFT JOIN sales_order o ON o.id = i.order_id
       LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payment WHERE invoice_id = i.id) p ON true
      WHERE ($1::text IS NULL OR i.status::text = $1)
        AND ($2::text IS NULL OR i.kind::text = $2)
      ORDER BY i.due_date, i.id`,
    [status, kind],
  )
  return ok(rows)
})
