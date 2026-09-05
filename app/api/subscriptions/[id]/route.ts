// OWNER: D2.  One subscription, with its full proration ledger.
//
// proration_event rows are shown with days_remaining and days_in_period
// alongside the money, because that is what makes the arithmetic checkable by
// someone who does not trust the code that wrote it.
import { q, one } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>(null, async (_req, _session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid subscription id', 400)

  const sub = await one(
    `SELECT s.id, s.customer_id, cu.name AS customer_name,
            s.plan_id, sp.name AS plan_name, sp.cycle, sp.price AS plan_price,
            sp.currency_code, sp.proration_enabled, sp.cancellation_notice_days,
            sp.cancellation_refund,
            s.qty, s.status, s.current_period_start, s.current_period_end,
            s.next_bill_date, s.started_at, s.cancelled_at,
            round(sp.price * s.qty, 2) AS period_amount,
            o.id AS source_order_id, o.number AS source_order_number,
            (s.current_period_end - s.current_period_start)                    AS days_in_period,
            GREATEST(0, s.current_period_end - CURRENT_DATE)                   AS days_remaining
       FROM subscription s
       JOIN customer cu ON cu.id = s.customer_id
       JOIN subscription_plan sp ON sp.id = s.plan_id
       LEFT JOIN sales_order_line sl ON sl.id = s.source_order_line_id
       LEFT JOIN sales_order o ON o.id = sl.order_id
      WHERE s.id = $1`,
    [id],
  )
  if (!sub) return fail('No such subscription', 404)

  const [events, invoices, plans] = await Promise.all([
    q(`SELECT pe.id, pe.event_type, pe.effective_date, pe.old_qty, pe.new_qty,
              op.name AS old_plan_name, np.name AS new_plan_name,
              pe.days_remaining, pe.days_in_period, pe.delta_amount,
              pe.credit_note_id, cn.number AS credit_note_number, pe.created_at
         FROM proration_event pe
         LEFT JOIN subscription_plan op ON op.id = pe.old_plan_id
         LEFT JOIN subscription_plan np ON np.id = pe.new_plan_id
         LEFT JOIN credit_note cn ON cn.id = pe.credit_note_id
        WHERE pe.subscription_id = $1 ORDER BY pe.id`, [id]),
    q(`SELECT i.id, i.number, i.kind, i.amount_total, i.status, i.issue_date, i.due_date,
              COALESCE((SELECT SUM(amount) FROM payment WHERE invoice_id = i.id), 0) AS amount_paid
         FROM invoice i WHERE i.subscription_id = $1 ORDER BY i.id`, [id]),
    q(`SELECT id, name, cycle, price, currency_code FROM subscription_plan
        WHERE is_active ORDER BY id`),
  ])

  return ok({ ...sub, events, invoices, available_plans: plans })
})
