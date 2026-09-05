// OWNER: D1.  Read and patch one quotation.
import { z } from 'zod'
import { q, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { recomputeQuotation, audit } from '@/lib/quotation'
import { isApproved, IS_APPROVED_SQL } from '@/lib/approval'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin'] as const
type Ctx = { params: Promise<{ id: string }> }

// ── GET /api/quotations/[id] ───────────────────────────────────────
// Screen-shaped: the builder needs the quotation, its lines, the approval
// chain for the CURRENT version, and the audit trail.
//
// This is the most-clicked endpoint in the app, so it is deliberately built to
// touch the database as little as possible:
//
//   • the approval VERDICT rides along on the head query via IS_APPROVED_SQL,
//     rather than being a second question about the same table.  Asking for
//     the chain and then separately asking "is it approved" is two reads of
//     approval_request for one screen.
//   • the head query runs first (it is the 404 gate); the three independent
//     reads then run CONCURRENTLY rather than one after another.
//   • nothing checks out a pool client.  isApproved() accepts the pool, so a
//     read-only handler never holds a connection it does not need.
export const GET = withAuth<Ctx>([...INTERNAL], async (_req, _session, ctx) => {
  const id = Number((await ctx.params).id)

  const [head] = await q(
    `SELECT q.*, c.name AS customer_name, c.tier_id, t.name AS tier_name,
            t.max_discount_pct AS tier_ceiling_pct, u.full_name AS owner_name,
            ${IS_APPROVED_SQL} AS is_approved
       FROM quotation q
       JOIN customer c      ON c.id = q.customer_id
       JOIN customer_tier t ON t.id = c.tier_id
       JOIN app_user u      ON u.id = q.owner_user_id
      WHERE q.id = $1`,
    [id],
  )
  if (!head) return fail('Quotation not found', 404)

  const [lines, approvals, auditTrail] = await Promise.all([
    q(
      `SELECT l.*, p.name AS product_name, p.sku, cat.name AS category_name,
            v.sku AS variant_sku, sp.name AS plan_name, sp.cycle AS plan_cycle
       FROM quotation_line l
       JOIN product p            ON p.id = l.product_id
       JOIN product_category cat ON cat.id = p.category_id
       LEFT JOIN product_variant v   ON v.id = l.variant_id
       LEFT JOIN subscription_plan sp ON sp.id = l.subscription_plan_id
      WHERE l.quotation_id = $1
      ORDER BY l.line_no`,
      [id],
    ),

    // Only the CURRENT version's chain. Superseded rows still exist in the
    // table — they are history, not state.
    q(
      `SELECT a.*, u.full_name AS assigned_to_name, ac.full_name AS acted_by_name
       FROM approval_request a
       JOIN quotation qq ON qq.id = a.quotation_id
       LEFT JOIN app_user u  ON u.id = a.assigned_to_user_id
       LEFT JOIN app_user ac ON ac.id = a.acted_by_user_id
      WHERE a.quotation_id = $1 AND a.quotation_version = qq.version
      ORDER BY a.seq`,
      [id],
    ),

    q(
      `SELECT a.*, u.full_name AS actor_name
       FROM audit_log a LEFT JOIN app_user u ON u.id = a.actor_user_id
      WHERE a.entity_type = 'quotation' AND a.entity_id = $1
      ORDER BY a.created_at DESC`,
      [id],
    ),
  ])

  return ok({
    quotation: head,
    lines,
    approvals,
    auditTrail,
    // Came back on the head query — no second read of approval_request.
    isApproved: head.is_approved,
  })
})

// ── PATCH /api/quotations/[id] ─────────────────────────────────────
const Patch = z.strictObject({
  customerId: z.number().int().positive().optional(),
  pricelistId: z.number().int().positive().nullable().optional(),
})

export const PATCH = withAuth<Ctx>([...INTERNAL], async (req, session, ctx) => {
  const id = Number((await ctx.params).id)
  const body = await parseBody(req, Patch)

  // Customer and pricelist are COMMERCIAL TERMS — both move every price on
  // the quotation, so either one bumps the version and orphans any approval.
  const termsChanged = body.customerId !== undefined || body.pricelistId !== undefined
  if (!termsChanged) return fail('Nothing to update', 400)

  return tx(async (c) => {
    const { rows } = await c.query<{ state: string }>(
      `SELECT state FROM quotation WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (!rows[0]) return fail('Quotation not found', 404)
    if (['confirmed', 'rejected', 'cancelled', 'expired'].includes(rows[0].state)) {
      return fail(`A ${rows[0].state} quotation cannot be edited`, 409)
    }

    if (body.customerId !== undefined) {
      await c.query(`UPDATE quotation SET customer_id = $2 WHERE id = $1`, [id, body.customerId])
      // The ceiling is LEAST(tier, category) and the tier just changed, so
      // every line's snapshot is now stale. Re-snapshot them all.
      await c.query(
        `UPDATE quotation_line l
            SET ceiling_pct = effective_ceiling_pct(cu.tier_id, p.category_id)
           FROM quotation qq, customer cu, product p
          WHERE l.quotation_id = $1 AND qq.id = l.quotation_id
            AND cu.id = qq.customer_id AND p.id = l.product_id`,
        [id],
      )
    }
    if (body.pricelistId !== undefined) {
      await c.query(`UPDATE quotation SET pricelist_id = $2 WHERE id = $1`, [id, body.pricelistId])
    }

    await audit(c, 'quotation', id, 'edited', session.userId, 'Commercial terms changed')
    const result = await recomputeQuotation(c, id, { termsChanged: true, actorUserId: session.userId })

    // The edit may have invalidated an approval that already existed.
    if (!(await isApproved(c, id))) {
      await c.query(
        `UPDATE quotation SET state = 'draft'
          WHERE id = $1 AND state IN ('approved','pending_approval','negotiation')`,
        [id],
      )
    }

    const { rows: fresh } = await c.query(`SELECT * FROM quotation WHERE id = $1`, [id])
    return ok({ ...fresh[0], recompute: result })
  })
})
