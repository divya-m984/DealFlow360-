// OWNER: D1.  Approve · Return for Revision · Reject — screen 6.
import { z } from 'zod'
import { q, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { actOnApproval, isApproved } from '@/lib/approval'
import { audit } from '@/lib/quotation'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// ── GET /api/approvals/[id] ────────────────────────────────────────
// Screen 6: the risk breakdown, the chain, and the audit trail.
export const GET = withAuth<Ctx>(['sales_manager', 'finance', 'admin'], async (_req, _s, ctx) => {
  const id = Number((await ctx.params).id)

  const [req] = await q(
    `SELECT a.*, qq.id AS q_id, qq.number, qq.version AS current_version,
            qq.risk_score, qq.risk_band, qq.grand_total, qq.margin_total, qq.currency_code,
            qq.requires_manager, qq.requires_finance, qq.state AS quotation_state,
            c.name AS customer_name, t.name AS tier_name, t.max_discount_pct AS tier_ceiling_pct
       FROM approval_request a
       JOIN quotation qq    ON qq.id = a.quotation_id
       JOIN customer c      ON c.id = qq.customer_id
       JOIN customer_tier t ON t.id = c.tier_id
      WHERE a.id = $1`,
    [id],
  )
  if (!req) return fail('Approval request not found', 404)

  // "Why this quote was flagged" — the mockup's own columns.
  const breakdown = await q(
    `SELECT l.line_no, p.name AS product_name, cat.name AS category_name,
            l.qty, l.unit_price, l.discount_pct AS discount_given,
            l.ceiling_pct AS limit_allowed, l.over_by_pct AS over_by,
            l.net_amount, l.margin_amount
       FROM quotation_line l
       JOIN product p            ON p.id = l.product_id
       JOIN product_category cat ON cat.id = p.category_id
      WHERE l.quotation_id = $1
      ORDER BY l.over_by_pct DESC, l.line_no`,
    [req.quotation_id],
  )

  const chain = await q(
    `SELECT a.*, asg.full_name AS assigned_to_name, act.full_name AS acted_by_name
       FROM approval_request a
       LEFT JOIN app_user asg ON asg.id = a.assigned_to_user_id
       LEFT JOIN app_user act ON act.id = a.acted_by_user_id
      WHERE a.quotation_id = $1 AND a.quotation_version = $2
      ORDER BY a.seq`,
    [req.quotation_id, req.current_version],
  )

  const auditTrail = await q(
    `SELECT a.*, u.full_name AS actor_name
       FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_user_id
      WHERE a.entity_type = 'quotation' AND a.entity_id = $1
      ORDER BY a.created_at`,
    [req.quotation_id],
  )

  return ok({
    request: req,
    breakdown,
    chain,
    auditTrail,
    // The request is dead if the quotation moved on beneath it.
    isStale: req.quotation_version !== req.current_version,
  })
})

// ── POST /api/approvals/[id] ───────────────────────────────────────
const Act = z.strictObject({
  status: z.enum(['approved', 'returned', 'rejected']),
  // PS §A3 wants user, timestamp AND REASON. A rejection with no reason is
  // useless to the rep who has to act on it, so it is required for anything
  // that is not a plain approval.
  note: z.string().trim().min(1).optional(),
})

export const POST = withAuth<Ctx>(['sales_manager', 'finance', 'admin'], async (req, session, ctx) => {
  const id = Number((await ctx.params).id)
  const body = await parseBody(req, Act)

  if (body.status !== 'approved' && !body.note) {
    return fail('A reason is required when returning or rejecting', 400)
  }

  return tx(async (c) => {
    // actOnApproval refuses stale versions and enforces manager-before-finance.
    const acted = await actOnApproval(c, {
      approvalRequestId: id,
      actorUserId: session.userId,
      status: body.status,
      note: body.note,
    })

    const qid = acted.quotation_id

    if (body.status === 'rejected') {
      await c.query(`UPDATE quotation SET state = 'rejected' WHERE id = $1`, [qid])
    } else if (body.status === 'returned') {
      // Back to the rep. The version does NOT bump here — the terms have not
      // changed yet. It bumps when the rep actually edits something.
      await c.query(`UPDATE quotation SET state = 'draft' WHERE id = $1`, [qid])
    }

    // Asked ONCE and reused. The verdict cannot change between the branch
    // below and the response — nothing here writes approval_request — so
    // running the query twice was pure waste.
    const approvedNow = body.status === 'approved' ? await isApproved(c, qid) : false

    if (approvedNow) {
      // Every required level has now signed at this version.
      await c.query(
        `UPDATE quotation SET state = 'approved', approved_at = now() WHERE id = $1`,
        [qid],
      )
      await audit(c, 'quotation', qid, 'fully_approved', session.userId,
        'All required approvals granted for the current version')
    }
    // else: manager signed but finance has not — stays pending_approval.

    const { rows: fresh } = await c.query(`SELECT * FROM quotation WHERE id = $1`, [qid])
    return ok({ approval: acted, quotation: fresh[0], isApproved: approvedNow })
  })
})
