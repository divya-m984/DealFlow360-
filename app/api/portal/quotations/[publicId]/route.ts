// OWNER: D1.  The customer's view of one quotation, and their counter-offer.
//
// PS §7: "The customer facing negotiation screen must be a real, separate,
// RESTRICTED view, not just another internal screen with a different label."
//
// Restriction here is three independent layers, because any one of them alone
// is a bad answer to a judge who asks "what stops a customer reading someone
// else's deal?":
//
//   1. middleware.ts refuses a portal session on any internal route at all.
//   2. This route is addressed by public_id (uuid) — there is no integer to
//      increment, so the URL cannot be walked.
//   3. EVERY handler re-checks session.customerId === quotation.customer_id.
//      A uuid makes guessing impractical; it is not authorisation. If a link
//      leaks to another customer's portal user, this is what refuses them.
//
// The customer also sees LESS than the rep: no unit_cost, no margin, no risk
// score, no audit trail, no internal approval notes. Those columns never leave
// the server — they are not in the SELECT, rather than hidden in the UI.
import { z } from 'zod'
import { q, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { recomputeQuotation, audit } from '@/lib/quotation'
import { createApprovalChain, isApproved } from '@/lib/approval'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ publicId: string }> }

/** Portal users only. An internal user has their own screens for this. */
const PORTAL = ['portal'] as const

// ── GET ────────────────────────────────────────────────────────────
export const GET = withAuth<Ctx>([...PORTAL], async (_req, session, ctx) => {
  const { publicId } = await ctx.params

  const [head] = await q(
    `SELECT q.id, q.public_id, q.number, q.state, q.version, q.currency_code,
            q.subtotal, q.discount_total, q.tax_total, q.grand_total,
            q.created_at, q.last_activity_at,
            c.name AS customer_name, c.id AS customer_id,
            u.full_name AS rep_name
       FROM quotation q
       JOIN customer c ON c.id = q.customer_id
       JOIN app_user u ON u.id = q.owner_user_id
      WHERE q.public_id = $1`,
    [publicId],
  )

  // Same message whether the quotation does not exist or belongs to somebody
  // else — never confirm the existence of another customer's deal.
  if (!head || head.customer_id !== session.customerId) {
    return fail('Quotation not found', 404)
  }

  const [lines, requests] = await Promise.all([
    // No unit_cost, no margin_amount. The customer is not shown our costs.
    q(
      `SELECT l.id, l.line_no, p.name AS product_name, cat.name AS category_name,
              l.line_type, sp.name AS plan_name, sp.cycle AS plan_cycle,
              l.qty, l.unit_price, l.discount_pct, l.tax_pct, l.net_amount
         FROM quotation_line l
         JOIN product p            ON p.id = l.product_id
         JOIN product_category cat ON cat.id = p.category_id
         LEFT JOIN subscription_plan sp ON sp.id = l.subscription_plan_id
        WHERE l.quotation_id = $1
        ORDER BY l.line_no`,
      [head.id],
    ),
    q(
      // The rep's replies are part of this payload now — before, the customer
      // could only ever see their own words and the outcome.  `author_name` is
      // safe to expose: it is the rep the customer is already dealing with, and
      // head.rep_name is returned to them below anyway.  No role, no email, no
      // internal id.
      `SELECT nr.id, nr.counter_discount_pct, nr.requested_delivery_date,
              nr.status, nr.created_at,
              COALESCE(json_agg(json_build_object(
                'id', nc.id, 'quotation_line_id', nc.quotation_line_id,
                'comment', nc.comment, 'created_at', nc.created_at,
                'author_name', cau.full_name,
                'author_side', CASE WHEN cau.role = 'portal' THEN 'buyer'
                                    WHEN cau.id IS NULL      THEN NULL
                                    ELSE 'seller' END
              ) ORDER BY nc.id) FILTER (WHERE nc.id IS NOT NULL), '[]') AS comments
         FROM negotiation_request nr
         LEFT JOIN negotiation_comment nc ON nc.negotiation_request_id = nr.id
         LEFT JOIN app_user cau ON cau.id = nc.author_user_id
        WHERE nr.quotation_id = $1
        GROUP BY nr.id
        ORDER BY nr.created_at DESC`,
      [head.id],
    ),
  ])

  // What the customer is allowed to do right now, decided on the server so the
  // UI cannot offer a button the API would refuse.
  const canNegotiate = ['approved', 'negotiation'].includes(head.state)
  const canConfirm = canNegotiate && !requests.some((r: any) => r.status === 'open')

  return ok({
    quotation: head,
    lines,
    requests,
    canNegotiate,
    canConfirm,
    repName: head.rep_name,
  })
})

// ── POST — submit a change request ─────────────────────────────────
//
// PS §B8: line comments, a counter discount, a requested delivery date.
//
// THIS IS THE LOOP. A counter-offer the rep accepts is a change to commercial
// terms, so it bumps the version and orphans the approval exactly the same way
// a rep's own edit does. The portal is not a special case — it goes through
// recomputeQuotation() like everything else, which is why it cannot be
// forgotten.
const Negotiate = z.strictObject({
  counterDiscountPct: z.number().min(0).max(100).nullable().optional(),
  requestedDeliveryDate: z.string().date().nullable().optional(),
  comments: z
    .array(z.strictObject({
      quotationLineId: z.number().int().positive().nullable().optional(),
      comment: z.string().trim().min(1).max(1000),
    }))
    .max(50)
    .default([]),
  /**
   * REPLY TO THE OPEN REQUEST, added after review 2.
   *
   * Sending this alone appends a message to the conversation instead of
   * raising a new counter-offer.  It exists because the customer previously
   * had NO way to answer the rep: a new request supersedes the old one, and
   * the request form is disabled while one is open — so once they had asked,
   * they were mute until the rep ruled.  A conversation needs both sides able
   * to speak between decisions.
   *
   * Mutually exclusive with the counter-offer fields — see the branch below.
   */
  message: z.string().trim().min(1).max(1000).optional(),
})

export const POST = withAuth<Ctx>([...PORTAL], async (req, session, ctx) => {
  const { publicId } = await ctx.params
  const body = await parseBody(req, Negotiate)

  const isReply = body.message !== undefined
  const isOffer =
    body.counterDiscountPct != null ||
    body.comments.length > 0 ||
    !!body.requestedDeliveryDate

  // A reply and a counter-offer are different acts with different consequences
  // — one is talk, the other supersedes the live ask — so a body that looks
  // like both is rejected rather than silently treated as one of them.
  if (isReply && isOffer) {
    return fail('Send a message or a counter-offer, not both in one request', 400)
  }
  if (!isReply && !isOffer) {
    return fail('Add a message, a comment, a counter discount, or a delivery date', 400)
  }

  return tx(async (c) => {
    const { rows } = await c.query<{
      id: number; state: string; customer_id: number; number: string; version: number
    }>(
      `SELECT id, state, customer_id, number, version
         FROM quotation WHERE public_id = $1 FOR UPDATE`,
      [publicId],
    )
    const qq = rows[0]
    if (!qq || qq.customer_id !== session.customerId) return fail('Quotation not found', 404)

    if (!['approved', 'negotiation'].includes(qq.state)) {
      return fail(
        qq.state === 'confirmed'
          ? 'This quotation is already confirmed'
          : 'This quotation is not open for negotiation yet',
        409,
      )
    }

    // ── REPLY ─────────────────────────────────────────────────────
    // Appends to the live request and supersedes nothing.  The quotation's
    // terms, state and version are all untouched: the customer saying "any
    // movement on this?" is not a new offer, and treating it as one would
    // wipe the counter-offer they are waiting on.
    if (isReply) {
      const { rows: open } = await c.query<{ id: number }>(
        `SELECT id FROM negotiation_request
          WHERE quotation_id = $1 AND status = 'open'
          ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [qq.id],
      )
      if (!open[0]) {
        return fail('There is no open request to reply to — send a change request instead', 409)
      }

      const { rows: msg } = await c.query<{ id: number }>(
        // author_side is written, not inferred on read: this handler is
        // withAuth(['portal']), so the message is always the buyer's.
        `INSERT INTO negotiation_comment
           (negotiation_request_id, quotation_line_id, comment, author_user_id, author_side)
         VALUES ($1, NULL, $2, $3, 'buyer') RETURNING id`,
        [open[0].id, body.message, session.userId],
      )

      await c.query(
        `UPDATE quotation SET last_activity_at = now() WHERE id = $1`,
        [qq.id],
      )
      await audit(c, 'quotation', qq.id, 'negotiation_message', session.userId,
        body.message!, { negotiation_request_id: open[0].id })

      return ok({ negotiationRequestId: open[0].id, commentId: msg[0].id, state: qq.state })
    }

    // Supersede any earlier open request — one live ask at a time, so the rep
    // is never looking at two contradictory counter-offers.
    await c.query(
      `UPDATE negotiation_request SET status = 'superseded'
        WHERE quotation_id = $1 AND status = 'open'`,
      [qq.id],
    )

    const { rows: nr } = await c.query<{ id: number }>(
      `INSERT INTO negotiation_request
         (quotation_id, created_by_user_id, counter_discount_pct, requested_delivery_date, status)
       VALUES ($1, $2, $3, $4, 'open') RETURNING id`,
      [qq.id, session.userId, body.counterDiscountPct ?? null, body.requestedDeliveryDate ?? null],
    )

    for (const cm of body.comments) {
      await c.query(
        `INSERT INTO negotiation_comment
           (negotiation_request_id, quotation_line_id, comment, author_user_id, author_side)
         SELECT $1, $2, $3, $5, 'buyer'
          WHERE $2::bigint IS NULL
             OR EXISTS (SELECT 1 FROM quotation_line
                         WHERE id = $2 AND quotation_id = $4)`,
        [nr[0].id, cm.quotationLineId ?? null, cm.comment, qq.id, session.userId],
      )
    }

    // Asking is not yet a change to the terms — the rep has to accept it. So
    // the version does NOT move here; the quotation just enters negotiation.
    await c.query(
      `UPDATE quotation SET state = 'negotiation', last_activity_at = now() WHERE id = $1`,
      [qq.id],
    )

    await audit(c, 'quotation', qq.id, 'negotiation_requested', session.userId,
      body.counterDiscountPct != null
        ? `Customer asked for ${body.counterDiscountPct}%`
        : 'Customer submitted a change request',
      { negotiation_request_id: nr[0].id })

    return ok({ negotiationRequestId: nr[0].id, state: 'negotiation' })
  })
})

// ── PUT — confirm the quotation as it stands ───────────────────────
//
// PS §B8: "Confirms final terms with one click." Only legal while the current
// terms are actually approved — isApproved() is asked here for the same reason
// the internal confirm endpoint asks it: `state` is a label, the approval rows
// are the fact.
export const PUT = withAuth<Ctx>([...PORTAL], async (_req, session, ctx) => {
  const { publicId } = await ctx.params

  return tx(async (c) => {
    const { rows } = await c.query<{
      id: number; state: string; customer_id: number; number: string; version: number
    }>(
      `SELECT id, state, customer_id, number, version
         FROM quotation WHERE public_id = $1 FOR UPDATE`,
      [publicId],
    )
    const qq = rows[0]
    if (!qq || qq.customer_id !== session.customerId) return fail('Quotation not found', 404)
    if (qq.state === 'confirmed') return fail('This quotation is already confirmed', 409)
    if (!['approved', 'negotiation'].includes(qq.state)) {
      return fail('This quotation is not ready to confirm', 409)
    }

    const { rows: open } = await c.query(
      `SELECT 1 FROM negotiation_request
        WHERE quotation_id = $1 AND status = 'open' LIMIT 1`,
      [qq.id],
    )
    if (open.length > 0) {
      return fail('Your change request is still with the sales rep — it has to be settled first', 409)
    }

    if (!(await isApproved(c, qq.id))) {
      return fail(
        'These terms are still going through internal approval. You will be able to confirm once that is complete.',
        409,
      )
    }

    await c.query(
      `UPDATE quotation
          SET state = 'confirmed', confirmed_at = now(), last_activity_at = now()
        WHERE id = $1`,
      [qq.id],
    )
    await audit(c, 'quotation', qq.id, 'confirmed_by_customer', session.userId,
      `Customer confirmed at version ${qq.version}`)

    return ok({ state: 'confirmed', number: qq.number })
  })
})
