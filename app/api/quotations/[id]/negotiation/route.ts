// OWNER: D1.  The rep's side of the negotiation — read the thread, reply to
// it, and accept or decline the customer's counter-offer.
//
// REPLYING WAS ADDED AFTER REVIEW 2 ("chat interface / negotiation between
// seller and buyer").  Before it, the rep's only outbound channel was the
// `note` on an accept/reject, which is written to audit_log — a place the
// customer can never see.  So the customer could talk and the rep could only
// rule.  `action: 'message'` gives the rep a reply that lands in
// negotiation_comment, the same table the customer writes to, and therefore
// the same thread both sides read.
//
// ══════════════════════════════════════════════════════════════════
// THIS IS THE LOOP THE MOCKUP DRAWS IN RED.
// ══════════════════════════════════════════════════════════════════
//
// PS §B8: "If final terms exceed approval thresholds, the quotation
// automatically re-enters the approval flow from B4."
//
// Accepting a counter-discount writes the new discount onto every line and
// then calls recomputeQuotation({ termsChanged: true }) — the SAME call the
// rep's own edits make. There is no portal-specific branch, and that is the
// entire point:
//
//   • the version bumps, so any approval that existed is orphaned
//   • the blended risk is rescored against the new discounts
//   • if the new score needs a signature, a fresh approval chain is raised
//
// Nobody wrote "if this came from the portal, re-check approval". A portal
// counter-offer and a rep edit are the same event — terms changed — so the
// same machinery catches both. A special case here would be a special case
// somebody could forget.
import { z } from 'zod'
import { q, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { INTERNAL_READERS, INTERNAL_WRITERS } from '@/lib/roles'
import { recomputeQuotation, audit } from '@/lib/quotation'
import { createApprovalChain, isApproved } from '@/lib/approval'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// ── GET: what has the customer asked for? ──────────────────────────
export const GET = withAuth<Ctx>([...INTERNAL_READERS], async (_req, _s, ctx) => {
  const id = Number((await ctx.params).id)
  return ok(
    await q(
      // `author_side` is READ FROM THE COLUMN db/seed/00-migrations.sql adds,
      // not derived from the author's current role.  Deriving it re-labels
      // history the first time somebody is promoted (review 2, ask 7) — the
      // side a message was sent from is a fact about the message, fixed when
      // it was written.  db/seed/09-backfill.sql sets it on every seeded row,
      // so a null here means an unattributed message, which the UI renders as
      // such rather than silently crediting it to somebody.
      `SELECT nr.id, nr.counter_discount_pct, nr.requested_delivery_date,
              nr.status, nr.created_at, au.full_name AS requested_by,
              COALESCE(json_agg(json_build_object(
                'id', nc.id, 'quotation_line_id', nc.quotation_line_id,
                'comment', nc.comment, 'created_at', nc.created_at,
                'author_name', cau.full_name,
                'author_side', nc.author_side
              ) ORDER BY nc.id) FILTER (WHERE nc.id IS NOT NULL), '[]') AS comments
         FROM negotiation_request nr
         JOIN app_user au ON au.id = nr.created_by_user_id
         LEFT JOIN negotiation_comment nc ON nc.negotiation_request_id = nr.id
         LEFT JOIN app_user cau ON cau.id = nc.author_user_id
        WHERE nr.quotation_id = $1
        GROUP BY nr.id, au.full_name
        ORDER BY nr.created_at DESC`,
      [id],
    ),
  )
})

// ── POST: reply, accept, or decline ────────────────────────────────
const Act = z.strictObject({
  negotiationRequestId: z.number().int().positive(),
  action: z.enum(['accept', 'reject', 'message']),
  note: z.string().trim().min(1).optional(),
  /** Required for `message`; ignored otherwise. */
  message: z.string().trim().min(1).max(1000).optional(),
})

export const POST = withAuth<Ctx>([...INTERNAL_WRITERS], async (req, session, ctx) => {
  const id = Number((await ctx.params).id)
  const body = await parseBody(req, Act)

  return tx(async (c) => {
    const { rows: qrows } = await c.query<{ state: string; number: string; version: number }>(
      `SELECT state, number, version FROM quotation WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const qq = qrows[0]
    if (!qq) return fail('Quotation not found', 404)

    const { rows: nrows } = await c.query<{
      id: number; status: string; counter_discount_pct: string | null
      requested_delivery_date: string | null
    }>(
      `SELECT id, status, counter_discount_pct, requested_delivery_date
         FROM negotiation_request
        WHERE id = $1 AND quotation_id = $2 FOR UPDATE`,
      [body.negotiationRequestId, id],
    )
    const nr = nrows[0]
    if (!nr) return fail('Negotiation request not found on this quotation', 404)
    if (nr.status !== 'open') return fail(`This request is already ${nr.status}`, 409)

    // ── MESSAGE ───────────────────────────────────────────────────
    // A reply, not a ruling.  It deliberately changes NOTHING about the
    // quotation: no state move, no version bump, no rescore.  Talking is not
    // agreeing, and the moment a message moved the terms the rep could commit
    // the company to a discount by typing a sentence.  The request stays open
    // so the customer can answer it.
    if (body.action === 'message') {
      if (!body.message) return fail('A message is required', 400)

      const { rows: msg } = await c.query<{ id: number }>(
        // author_side is written here, not inferred on read: this handler is
        // reachable only by an internal role, so the message is the seller's.
        `INSERT INTO negotiation_comment
           (negotiation_request_id, quotation_line_id, comment, author_user_id, author_side)
         VALUES ($1, NULL, $2, $3, 'seller') RETURNING id`,
        [nr.id, body.message, session.userId],
      )

      // last_activity_at moves because somebody DID something — this is what
      // sorts the quotation back to the top of the rep's list and what the
      // Deal Health "idle N days" alert measures against.
      await c.query(`UPDATE quotation SET last_activity_at = now() WHERE id = $1`, [id])
      await audit(c, 'quotation', id, 'negotiation_message', session.userId,
        body.message, { negotiation_request_id: nr.id })

      return ok({ negotiationRequestId: nr.id, commentId: msg[0].id, status: nr.status })
    }

    if (body.action === 'reject') {
      await c.query(`UPDATE negotiation_request SET status = 'rejected' WHERE id = $1`, [nr.id])
      await audit(c, 'quotation', id, 'negotiation_rejected', session.userId,
        body.note ?? 'Counter-offer declined')
      // Terms did not change, so nothing is rescored and no version moves.
      const { rows: fresh } = await c.query(`SELECT * FROM quotation WHERE id = $1`, [id])
      return ok({ quotation: fresh[0], accepted: false, reApproval: null })
    }

    // ── ACCEPT ─────────────────────────────────────────────────────
    await c.query(`UPDATE negotiation_request SET status = 'accepted' WHERE id = $1`, [nr.id])

    let linesChanged = 0
    if (nr.counter_discount_pct != null) {
      // Only inputs are written. over_by_pct, net_amount and margin_amount are
      // generated columns and recompute themselves against the new discount.
      const { rowCount } = await c.query(
        `UPDATE quotation_line SET discount_pct = $2 WHERE quotation_id = $1`,
        [id, nr.counter_discount_pct],
      )
      linesChanged = rowCount ?? 0
    }

    await audit(c, 'quotation', id, 'negotiation_accepted', session.userId,
      nr.counter_discount_pct != null
        ? `Accepted the customer's ${nr.counter_discount_pct}% across ${linesChanged} line(s)`
        : (body.note ?? 'Accepted the customer request'),
      { negotiation_request_id: nr.id })

    // The same call a rep edit makes. No portal branch.
    const risk = await recomputeQuotation(c, id, {
      termsChanged: linesChanged > 0,
      actorUserId: session.userId,
    })

    let reApproval: string[] | null = null
    if (risk.requires_manager || risk.requires_finance) {
      // The new terms need a signature. Raise a chain for the NEW version —
      // any approval granted for the old one is already orphaned by the key.
      reApproval = await createApprovalChain(c, id)
      await c.query(
        `UPDATE quotation SET state = 'pending_approval', submitted_at = now() WHERE id = $1`,
        [id],
      )
      await audit(c, 'quotation', id, 'reentered_approval', session.userId,
        `Negotiated terms scored ${risk.risk_score} (${risk.risk_band}) — re-routed to ${reApproval.join(', then ')}`)
    } else {
      // Still inside every limit, so it needs nobody: the customer's terms
      // stand and the quotation is ready for them to confirm.
      await c.query(`UPDATE quotation SET state = 'approved', approved_at = now() WHERE id = $1`, [id])
    }

    const { rows: fresh } = await c.query(`SELECT * FROM quotation WHERE id = $1`, [id])
    return ok({
      quotation: fresh[0],
      accepted: true,
      linesChanged,
      risk,
      reApproval,
      isApproved: await isApproved(c, id),
    })
  })
})
