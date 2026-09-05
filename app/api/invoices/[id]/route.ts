// OWNER: D2.  Screen 13 — Invoice Detail.
import { q, one } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>(null, async (_req, _session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid invoice id', 400)

  const inv = await one(
    `SELECT i.id, i.number, i.customer_id, cu.name AS customer_name, cu.email AS customer_email,
            i.order_id, o.number AS order_number, o.state AS order_state, i.subscription_id,
            i.kind, i.currency_code, i.amount_total, i.status, i.issue_date, i.due_date, i.created_at,
            COALESCE(p.paid, 0)                    AS amount_paid,
            (i.amount_total - COALESCE(p.paid, 0)) AS amount_due,
            (i.due_date < CURRENT_DATE AND i.status NOT IN ('paid','void')) AS is_overdue,
            sp.name AS plan_name, s.current_period_start, s.current_period_end
       FROM invoice i
       JOIN customer cu ON cu.id = i.customer_id
       LEFT JOIN sales_order o ON o.id = i.order_id
       LEFT JOIN subscription s ON s.id = i.subscription_id
       LEFT JOIN subscription_plan sp ON sp.id = s.plan_id
       LEFT JOIN LATERAL (SELECT SUM(amount) AS paid FROM payment WHERE invoice_id = i.id) p ON true
      WHERE i.id = $1`,
    [id],
  )
  if (!inv) return fail('No such invoice', 404)

  const [lines, payments, creditNotes] = await Promise.all([
    q(`SELECT id, description, qty, unit_price, amount FROM invoice_line WHERE invoice_id = $1 ORDER BY id`, [id]),
    q(`SELECT id, amount, method, reference, paid_at FROM payment WHERE invoice_id = $1 ORDER BY paid_at, id`, [id]),
    q(`SELECT id, number, amount, reason, created_at FROM credit_note WHERE invoice_id = $1 ORDER BY id`, [id]),
  ])

  // The mockup's progress rail, driven from real state on every read.
  const orderId = inv.order_id ? Number(inv.order_id) : null
  let progress = { confirmed: true, shipped: false, invoiced: true, paid: inv.status === 'paid' }
  if (orderId) {
    const s = await one<{ shipped: boolean; all_paid: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM fulfillment_allocation fa
                        JOIN sales_order_line sl ON sl.id = fa.order_line_id
                       WHERE sl.order_id = $1 AND fa.status = 'shipped')             AS shipped,
              NOT EXISTS (SELECT 1 FROM invoice WHERE order_id = $1 AND status <> 'paid') AS all_paid`,
      [orderId],
    )
    progress = { confirmed: true, shipped: !!s?.shipped, invoiced: true, paid: !!s?.all_paid }
  }

  return ok({ ...inv, lines, payments, credit_notes: creditNotes, progress })
})
