// OWNER: D2.  CLAIMED — new path.  The SELLER side of the thread.
// The buyer side is app/api/portal/negotiation/[publicId]/messages.
//
// Jury review 2, ask 1: a chat interface for the buyer↔seller negotiation.
//
// ── WHAT WAS ACTUALLY MISSING ────────────────────────────────────────
// negotiation_request and negotiation_comment already existed, and the
// counter-offer round trip already worked.  But negotiation_comment stored
// only (comment, created_at) — NO AUTHOR.  A thread whose messages have no
// author is not a chat: you cannot render a left/right bubble, you cannot
// show who conceded, and "who agreed to 22%?" has no answer in the data.
// That was the gap, not the CSS.  db/seed/00-migrations.sql adds
// author_user_id, author_side, is_internal and read_at.
//
// ── WHY author_side IS STORED AND NOT DERIVED ────────────────────────
// It looks redundant next to author_user_id — join to app_user, read role,
// done.  That breaks the moment ask 7 is used: promote the rep who ran this
// negotiation to sales_manager, and a derived side would re-render months of
// history from the new role.  Worse, if a portal contact is ever given an
// internal account, their old buyer-side messages would flip to seller.  The
// side a message was sent from is a FACT ABOUT THE MESSAGE, fixed at write
// time, not a fact about the person's current job.
//
// ── INTERNAL NOTES ───────────────────────────────────────────────────
// is_internal marks a message staff can see and the customer never can.
// Odoo draws the same line (a log note versus a message on the chatter).
// Without it, a rep who wants to write "floor is 18%, do not go below" has
// nowhere to put it and will put it somewhere the customer can read.
// The portal route NEVER selects these rows — see the filter there.

import { z } from 'zod'
import { one, q, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin', 'viewer'] as const
/** viewer can READ the thread but must not post into it — a read-only role
 *  that can talk to a customer is not read-only. */
const CAN_POST = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin'] as const

export const GET = withAuth<Ctx>([...INTERNAL], async (_req, _session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid negotiation id', 400)

  const thread = await one(
    `SELECT nr.id, nr.quotation_id, nr.status, nr.counter_discount_pct,
            nr.requested_delivery_date, nr.created_at,
            qq.number AS quotation_number, qq.state AS quotation_state,
            qq.version, c.name AS customer_name
       FROM negotiation_request nr
       JOIN quotation qq ON qq.id = nr.quotation_id
       JOIN customer c   ON c.id = qq.customer_id
      WHERE nr.id = $1`,
    [id],
  )
  if (!thread) return fail('No such negotiation.', 404)

  // Staff see everything, internal notes included.
  const messages = await q(
    `SELECT nc.id, nc.comment, nc.author_side, nc.is_internal, nc.created_at,
            nc.read_at, nc.quotation_line_id,
            u.full_name AS author_name, u.role AS author_role
       FROM negotiation_comment nc
       LEFT JOIN app_user u ON u.id = nc.author_user_id
      WHERE nc.negotiation_request_id = $1
      ORDER BY nc.created_at, nc.id`,
    [id],
  )

  return ok({ thread, messages })
})

const Body = z.strictObject({
  comment: z.string().min(1).max(4000),
  is_internal: z.boolean().optional(),
  quotation_line_id: z.number().int().positive().nullable().optional(),
})

export const POST = withAuth<Ctx>([...CAN_POST], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid negotiation id', 400)
  const b = await parseBody(req, Body)

  const nr = await one<{ id: number; status: string; quotation_id: number }>(
    `SELECT id, status, quotation_id FROM negotiation_request WHERE id = $1`,
    [id],
  )
  if (!nr) return fail('No such negotiation.', 404)

  // A superseded thread belongs to a version of the quotation that no longer
  // exists.  Posting into it would attach a message to terms nobody is
  // discussing any more — the same reason the approvals queue hides
  // superseded rows.
  if (nr.status === 'superseded') {
    return fail('This negotiation was superseded by a newer version of the quotation.', 409)
  }

  const created = await tx(async (c) => {
    const r = await c.query(
      `INSERT INTO negotiation_comment
         (negotiation_request_id, quotation_line_id, comment, author_user_id, author_side, is_internal)
       VALUES ($1, $2, $3, $4, 'seller', $5)
       RETURNING id, comment, author_side, is_internal, created_at, quotation_line_id`,
      [id, b.quotation_line_id ?? null, b.comment, session.userId, b.is_internal ?? false],
    )

    // An internal note is not customer activity and must not make a stalled
    // deal look alive — deal_alert 'stalled' reads last_activity_at.
    if (!(b.is_internal ?? false)) {
      await c.query(
        `UPDATE quotation SET last_activity_at = now() WHERE id = $1`,
        [nr.quotation_id],
      )
    }

    return { ...r.rows[0], author_name: session.fullName, author_role: session.role }
  })

  return ok(created, 201)
})
