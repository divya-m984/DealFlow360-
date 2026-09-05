// OWNER: D2.  Mid-cycle quantity or plan change → one immutable
// proration_event row (PS §B7).
//
//   delta = (new_rate − old_rate) × days_remaining / days_in_period
//
// Both day counts are stored on the row, not just the money, so the
// arithmetic is checkable after the fact by reading a single row.
import { z } from 'zod'
import { tx } from '@/lib/db'
import { ok, fail, parseBody, withAuth } from '@/lib/api'
import { applyProration } from '@/lib/billing'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const Body = z.strictObject({
  newQty: z.number().positive().optional(),
  newPlanId: z.number().int().positive().optional(),
  effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).refine((b) => b.newQty !== undefined || b.newPlanId !== undefined, {
  message: 'Change the quantity, the plan, or both.',
})

export const POST = withAuth<Ctx>(['sales_manager', 'finance', 'admin'], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid subscription id', 400)
  const body = await parseBody(req, Body)

  const result = await tx(async (c) => {
    const r = await applyProration(c, id, body)
    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('subscription', $1, 'proration', $2, $3, $4)`,
      [id, session.userId,
       `${r.deltaAmount >= 0 ? 'Charge' : 'Credit'} of ${Math.abs(r.deltaAmount).toFixed(2)} — ` +
       `${r.daysRemaining} of ${r.daysInPeriod} days remaining`,
       JSON.stringify(r)],
    )
    return r
  })

  return ok(result, 201)
})
