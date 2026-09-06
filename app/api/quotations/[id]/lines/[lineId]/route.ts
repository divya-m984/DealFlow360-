// OWNER: D1.  Edit or remove one line.
//
// This is THE screen-4 endpoint. The rep drags a discount from 12% to 25%
// here, and the approval that was granted at 12% orphans itself.
import { z } from 'zod'
import type { PoolClient } from 'pg'
import { tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { INTERNAL_WRITERS } from '@/lib/roles'
import { recomputeQuotation, audit } from '@/lib/quotation'
import { isApproved } from '@/lib/approval'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string; lineId: string }> }

const PatchLine = z.strictObject({
  qty: z.number().positive().optional(),
  discountPct: z.number().min(0).max(100).optional(),
})

/** Both endpoints below end the same way, so it lives in one place. */
async function settle(c: PoolClient, id: number, userId: number) {
  const recompute = await recomputeQuotation(c, id, { termsChanged: true, actorUserId: userId })
  const stillApproved = await isApproved(c, id)
  if (!stillApproved) {
    await c.query(
      `UPDATE quotation SET state = 'draft'
        WHERE id = $1 AND state IN ('approved','pending_approval','negotiation')`,
      [id],
    )
  }
  const { rows } = await c.query(`SELECT * FROM quotation WHERE id = $1`, [id])
  return { recompute, isApproved: stillApproved, quotation: rows[0] }
}

async function guard(c: PoolClient, id: number, lineId: number) {
  const { rows } = await c.query<{ state: string }>(
    `SELECT state FROM quotation WHERE id = $1 FOR UPDATE`,
    [id],
  )
  if (!rows[0]) return 'Quotation not found'
  if (['confirmed', 'rejected', 'cancelled', 'expired'].includes(rows[0].state)) {
    return `A ${rows[0].state} quotation cannot be edited`
  }
  const { rows: line } = await c.query(
    `SELECT id FROM quotation_line WHERE id = $1 AND quotation_id = $2`,
    [lineId, id],
  )
  if (!line[0]) return 'Line not found on this quotation'
  return null
}

export const PATCH = withAuth<Ctx>([...INTERNAL_WRITERS], async (req, session, ctx) => {
  const { id: idRaw, lineId: lineRaw } = await ctx.params
  const id = Number(idRaw)
  const lineId = Number(lineRaw)
  const body = await parseBody(req, PatchLine)
  if (body.qty === undefined && body.discountPct === undefined) {
    return fail('Nothing to update', 400)
  }

  return tx(async (c) => {
    const problem = await guard(c, id, lineId)
    if (problem) return fail(problem, problem.includes('not found') ? 404 : 409)

    // Only inputs are written. over_by_pct, net_amount and margin_amount are
    // generated — Postgres rejects any attempt to write them.
    const sets: string[] = []
    const args: unknown[] = [lineId]
    if (body.qty !== undefined) sets.push(`qty = $${args.push(body.qty)}`)
    if (body.discountPct !== undefined) sets.push(`discount_pct = $${args.push(body.discountPct)}`)

    const { rows: updated } = await c.query(
      `UPDATE quotation_line SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
      args,
    )

    await audit(c, 'quotation', id, 'line_edited', session.userId,
      body.discountPct !== undefined
        ? `Line ${updated[0].line_no} discount set to ${body.discountPct}%`
        : `Line ${updated[0].line_no} quantity set to ${body.qty}`)

    return ok({ line: updated[0], ...(await settle(c, id, session.userId)) })
  })
})

export const DELETE = withAuth<Ctx>([...INTERNAL_WRITERS], async (_req, session, ctx) => {
  const { id: idRaw, lineId: lineRaw } = await ctx.params
  const id = Number(idRaw)
  const lineId = Number(lineRaw)

  return tx(async (c) => {
    const problem = await guard(c, id, lineId)
    if (problem) return fail(problem, problem.includes('not found') ? 404 : 409)

    const { rows: gone } = await c.query(
      `DELETE FROM quotation_line WHERE id = $1 RETURNING line_no`,
      [lineId],
    )
    await audit(c, 'quotation', id, 'line_removed', session.userId, `Line ${gone[0].line_no} removed`)

    return ok(await settle(c, id, session.userId))
  })
})
