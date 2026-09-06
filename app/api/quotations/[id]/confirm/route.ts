// OWNER: D1.  approved → confirmed.  The handover point to D2's lane.
//
// This is the seam between governance and fulfilment, and it is the ONLY door
// through it.  D2's POST /api/orders refuses anything that is not `confirmed`,
// so every order in the system has necessarily passed the check below.
//
// THE CHECK IS THE WHOLE POINT.  Confirming calls isApproved() rather than
// trusting quotation.state, because `state` is a label and the approval rows
// are the fact.  If a rep edits an approved quotation, the version bumps, the
// approval orphans, and isApproved() goes false — and this endpoint must
// refuse even if some path left `state` reading 'approved'.  Without that,
// the version-keyed approval has a bypass and Law 1 is decorative.
//
// Confirming does NOT create the order.  That is D2's `POST /api/orders`,
// which reads this quotation once it is confirmed.  Screen 4's Confirm button
// calls both in sequence; keeping them apart means neither lane owns a piece
// of the other's table.
import { tx } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { INTERNAL_WRITERS } from '@/lib/roles'
import { audit } from '@/lib/quotation'
import { isApproved } from '@/lib/approval'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withAuth<Ctx>([...INTERNAL_WRITERS], async (_req, session, ctx) => {
  const id = Number((await ctx.params).id)

  return tx(async (c) => {
    const { rows } = await c.query<{
      state: string; version: number; number: string
      requires_manager: boolean; requires_finance: boolean
    }>(
      `SELECT state, version, number, requires_manager, requires_finance
         FROM quotation WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const q = rows[0]
    if (!q) return fail('Quotation not found', 404)

    if (q.state === 'confirmed') return fail('This quotation is already confirmed', 409)
    if (['rejected', 'cancelled', 'expired'].includes(q.state)) {
      return fail(`A ${q.state} quotation cannot be confirmed`, 409)
    }
    if (q.state === 'draft' || q.state === 'pending_approval') {
      return fail(
        q.state === 'draft'
          ? 'Submit the quotation before confirming it'
          : 'This quotation is still awaiting approval',
        409,
      )
    }

    // 'approved' and 'negotiation' both reach here — the customer accepting
    // terms mid-negotiation is a confirm, as long as the terms still stand.
    if (!(await isApproved(c, id))) {
      return fail(
        `${q.number} is not approved at its current version (v${q.version}). ` +
          'The terms changed after it was approved, so it has to go back through approval.',
        409,
      )
    }

    await c.query(
      `UPDATE quotation
          SET state = 'confirmed', confirmed_at = now(), last_activity_at = now()
        WHERE id = $1`,
      [id],
    )
    await audit(c, 'quotation', id, 'confirmed', session.userId,
      `Confirmed at version ${q.version}`,
      { requires_manager: q.requires_manager, requires_finance: q.requires_finance })

    const { rows: fresh } = await c.query(`SELECT * FROM quotation WHERE id = $1`, [id])
    return ok({ quotation: fresh[0], nextStep: 'POST /api/orders { quotationId }' })
  })
})
