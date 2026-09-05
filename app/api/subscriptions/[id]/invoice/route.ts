// OWNER: D2.  Bill the current period and roll the subscription forward.
//
// Invoicing and rolling the period happen in ONE transaction.  Half of that
// pair — an invoice raised but the period not advanced — would bill the same
// month twice on the next run.
import { tx } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { createSubscriptionInvoice, } from '@/lib/invoice'
import { rollPeriod } from '@/lib/billing'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withAuth<Ctx>(['finance', 'admin'], async (_req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid subscription id', 400)

  const result = await tx(async (c) => {
    const s = await c.query(`SELECT id, status FROM subscription WHERE id = $1 FOR UPDATE`, [id])
    if (s.rowCount === 0) throw new Error(`No subscription with id ${id}`)
    if (s.rows[0].status !== 'active') throw new Error('Only an active subscription can be billed.')

    const inv = await createSubscriptionInvoice(c, id)
    await rollPeriod(c, id)

    const after = await c.query(
      `SELECT current_period_start, current_period_end, next_bill_date
         FROM subscription WHERE id = $1`, [id],
    )
    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('subscription', $1, 'invoice_period', $2, $3, $4)`,
      [id, session.userId, `Invoice ${inv.number} raised for ${inv.amount.toFixed(2)}`,
       JSON.stringify({ invoice: inv, period: after.rows[0] })],
    )
    return { invoice: inv, period: after.rows[0] }
  })

  return ok(result, 201)
})
