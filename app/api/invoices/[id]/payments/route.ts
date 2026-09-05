// OWNER: D2.  PS §9's eighth and final acceptance step: "record a payment,
// and check that the invoice status updates correctly."
//
// Recording the payment and recomputing the status happen inside one
// transaction, in lib/invoice.ts, which is the only place invoice.status is
// ever written.  Two writers would eventually disagree, and an invoice reading
// "paid" with no payments behind it is the worst bug this app could ship.
//
// Recording money received is a finance action, so the route is restricted.
// A sales rep can SEE the invoice; they cannot mark it paid.
import { z } from 'zod'
import { tx } from '@/lib/db'
import { ok, fail, parseBody, withAuth } from '@/lib/api'
import { applyPayment } from '@/lib/invoice'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const Body = z.strictObject({
  amount: z.number().positive(),
  method: z.enum(['bank', 'cash', 'card']),
  reference: z.string().max(200).nullable().default(null),
})

export const POST = withAuth<Ctx>(['finance', 'admin'], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid invoice id', 400)
  const body = await parseBody(req, Body)

  const result = await tx(async (c) => {
    const r = await applyPayment(c, id, body)
    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('invoice', $1, 'payment_recorded', $2, $3, $4)`,
      [id, session.userId,
       `${body.method} payment of ${body.amount.toFixed(2)} — invoice is now ${r.status}`,
       JSON.stringify(r)],
    )
    return r
  })

  return ok(result, 201)
})
