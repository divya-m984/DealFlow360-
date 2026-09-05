// ⚠ OWNER: D1 by the map (app/api/portal/** is yours) — WRITTEN BY D2, as a
// NEW FILE so it cannot conflict with anything you have open.  Move, rename
// or rewrite it freely; it is flagged in OWNERSHIP.md.  It exists because
// jury review 2 asked for a buyer↔seller chat, and the buyer half is
// unreachable from my lane: middleware.ts only lets a portal session touch
// /portal and /api/portal, so a customer physically cannot call
// /api/negotiation/[id]/messages.  The seller half is there; this is its
// mirror.
//
// ── THE THREE RESTRICTIONS, SAME SHAPE AS YOUR OTHER PORTAL ROUTES ───
// 1. middleware.ts has already refused any non-portal session before this
//    handler runs, and withAuth(['portal']) refuses again — the edge check
//    is not trusted as the only gate.
// 2. Addressed by public_id (uuid), so there is no integer to increment and
//    the URL cannot be walked to a stranger's negotiation.
// 3. Row scoping is in the WHERE clause, not applied afterwards: the query
//    joins on qq.customer_id = session.customerId, so another customer's
//    thread is not fetched-then-filtered, it is never selected at all.
//
// ── THE ONE THAT MATTERS MOST ────────────────────────────────────────
// `nc.is_internal = false` on the SELECT below.  Staff can mark a message as
// an internal note — "floor is 18%, do not go below" — and this route must
// never return one.  It is a WHERE clause rather than a filter in JavaScript
// for exactly the reason above: a row that is never selected cannot be
// leaked by a later refactor that forgets to filter.  If you rewrite this
// file, keep that predicate in the SQL.

import { z } from 'zod'
import { one, q, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ publicId: string }> }

const PORTAL = ['portal'] as const

/** Resolve the quotation from its uuid AND the caller's own customer id in
 *  one query.  Returns null both when the quotation does not exist and when
 *  it belongs to somebody else — deliberately indistinguishable, so the
 *  endpoint cannot be used to probe which uuids are real. */
async function resolveThread(publicId: string, customerId: number | null) {
  if (!customerId) return null
  return one<{
    negotiation_id: number | null
    quotation_id: number
    quotation_number: string
    status: string | null
  }>(
    `SELECT nr.id  AS negotiation_id,
            qq.id  AS quotation_id,
            qq.number AS quotation_number,
            nr.status
       FROM quotation qq
       LEFT JOIN LATERAL (
         SELECT id, status FROM negotiation_request
          WHERE quotation_id = qq.id AND status <> 'superseded'
          ORDER BY created_at DESC LIMIT 1
       ) nr ON true
      WHERE qq.public_id = $1
        AND qq.customer_id = $2`,
    [publicId, customerId],
  )
}

export const GET = withAuth<Ctx>([...PORTAL], async (_req, session, { params }) => {
  const { publicId } = await params
  const t = await resolveThread(publicId, session.customerId)
  if (!t) return fail('No such quotation.', 404)

  if (!t.negotiation_id) {
    return ok({ thread: null, messages: [], quotationNumber: t.quotation_number })
  }

  const messages = await q(
    `SELECT nc.id, nc.comment, nc.author_side, nc.created_at, nc.quotation_line_id,
            CASE WHEN nc.author_side = 'seller' THEN u.full_name ELSE 'You' END AS author_name
       FROM negotiation_comment nc
       LEFT JOIN app_user u ON u.id = nc.author_user_id
      WHERE nc.negotiation_request_id = $1
        AND nc.is_internal = false
      ORDER BY nc.created_at, nc.id`,
    [t.negotiation_id],
  )

  // Mark the seller's messages as seen by the buyer.  Cheap, and it lets the
  // rep's screen show whether the customer has actually read the counter.
  await tx(async (c) => {
    await c.query(
      `UPDATE negotiation_comment SET read_at = now()
        WHERE negotiation_request_id = $1 AND author_side = 'seller'
          AND is_internal = false AND read_at IS NULL`,
      [t.negotiation_id],
    )
  })

  return ok({
    thread: { id: t.negotiation_id, status: t.status, quotationNumber: t.quotation_number },
    messages,
  })
})

const Body = z.strictObject({
  comment: z.string().min(1).max(4000),
})

export const POST = withAuth<Ctx>([...PORTAL], async (req, session, { params }) => {
  const { publicId } = await params
  const b = await parseBody(req, Body)

  const t = await resolveThread(publicId, session.customerId)
  if (!t) return fail('No such quotation.', 404)
  if (!t.negotiation_id) {
    return fail('There is no open negotiation on this quotation yet.', 409)
  }

  const created = await tx(async (c) => {
    const r = await c.query(
      `INSERT INTO negotiation_comment
         (negotiation_request_id, comment, author_user_id, author_side, is_internal)
       VALUES ($1, $2, $3, 'buyer', false)
       RETURNING id, comment, author_side, created_at`,
      [t.negotiation_id, b.comment, session.userId],
    )
    // A customer message IS activity — this is what stops a live negotiation
    // being flagged as a stalled deal on screen 14.
    await c.query(
      `UPDATE quotation SET last_activity_at = now() WHERE id = $1`,
      [t.quotation_id],
    )
    return r.rows[0]
  })

  return ok(created, 201)
})
