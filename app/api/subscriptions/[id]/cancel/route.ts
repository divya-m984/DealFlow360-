// OWNER: D2.  Cancel a subscription (PS §A5).
//
// Two schema rules bite here, both deliberately:
//   • next_bill_only_when_active — next_bill_date must be nulled in the same
//     statement as the status, or Postgres refuses the row.
//   • cancellation_refund = 'prorated' → the unused remainder comes back as a
//     CREDIT NOTE, linked from the proration_event.  A refund is not a
//     negative invoice.
import { z } from 'zod'
import { tx } from '@/lib/db'
import { ok, fail, parseBody, withAuth } from '@/lib/api'
import { cancelSubscription } from '@/lib/billing'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const Body = z.strictObject({
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const POST = withAuth<Ctx>(['sales_manager', 'finance', 'admin'], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid subscription id', 400)
  const body = await parseBody(req, Body)

  const result = await tx(async (c) => {
    const r = await cancelSubscription(c, id, body.effectiveDate)
    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('subscription', $1, 'cancel', $2, $3, $4)`,
      [id, session.userId,
       `Cancelled (${r.refundPolicy}) — ${r.creditNoteId ? `credit note issued for ${Math.abs(r.deltaAmount).toFixed(2)}` : 'no refund due'}`,
       JSON.stringify(r)],
    )
    return r
  })

  return ok(result, 201)
})
