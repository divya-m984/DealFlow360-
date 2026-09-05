// OWNER: D1.  Submit for approval — PS §9 step 3.
//
// "Confirm the quotation automatically asks for manager approval, WITHOUT the
// rep having to request it manually."  The rep never chooses an approver and
// never picks a level: the score decides, and approval_policy decides what the
// score means.
import { tx } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { recomputeQuotation, audit } from '@/lib/quotation'
import { createApprovalChain } from '@/lib/approval'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin'] as const
type Ctx = { params: Promise<{ id: string }> }

export const POST = withAuth<Ctx>([...INTERNAL], async (_req, session, ctx) => {
  const id = Number((await ctx.params).id)

  return tx(async (c) => {
    const { rows } = await c.query<{ state: string; n_lines: number }>(
      `SELECT q.state,
              (SELECT count(*) FROM quotation_line l WHERE l.quotation_id = q.id)::int AS n_lines
         FROM quotation q WHERE q.id = $1 FOR UPDATE`,
      [id],
    )
    if (!rows[0]) return fail('Quotation not found', 404)
    if (rows[0].n_lines === 0) return fail('Cannot submit a quotation with no lines', 400)
    if (!['draft', 'negotiation'].includes(rows[0].state)) {
      return fail(`A ${rows[0].state} quotation cannot be submitted`, 409)
    }

    // Rescore first — the rep may have edited since the last recompute, and we
    // route on the CURRENT numbers, never on a cached band.
    const risk = await recomputeQuotation(c, id, { termsChanged: false, actorUserId: session.userId })

    // LOW: nothing to approve. Zero approval_request rows get created, and
    // isApproved() still reads true because neither level is required.
    // This is the branch that breaks if you ever test approval by asking
    // whether an approved row exists.
    if (!risk.requires_manager && !risk.requires_finance) {
      await c.query(
        `UPDATE quotation
            SET state = 'confirmed', submitted_at = now(),
                approved_at = now(), confirmed_at = now()
          WHERE id = $1`,
        [id],
      )
      await audit(c, 'quotation', id, 'auto_approved', session.userId,
        `Risk ${risk.risk_band} (${risk.risk_score}) — no approval required`)

      const { rows: fresh } = await c.query(`SELECT * FROM quotation WHERE id = $1`, [id])
      return ok({ quotation: fresh[0], routedTo: [], autoApproved: true, risk })
    }

    const levels = await createApprovalChain(c, id)

    await c.query(
      `UPDATE quotation SET state = 'pending_approval', submitted_at = now() WHERE id = $1`,
      [id],
    )
    await audit(c, 'quotation', id, 'submitted', session.userId,
      `Risk ${risk.risk_band} (${risk.risk_score}) — routed to ${levels.join(', then ')}`)

    const { rows: fresh } = await c.query(`SELECT * FROM quotation WHERE id = $1`, [id])
    return ok({ quotation: fresh[0], routedTo: levels, autoApproved: false, risk })
  })
})
