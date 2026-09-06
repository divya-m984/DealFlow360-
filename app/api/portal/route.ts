// OWNER: D1.  The customer's own quotations — the portal's landing list.
//
// Scoped to session.customerId in the WHERE clause, not filtered afterwards.
// A portal user cannot ask for anyone else's rows because the query never
// selects them.
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

export const GET = withAuth(['portal'], async (_req, session) => {
  return ok(
    await q(
      // The last message and the message count were added for /portal/messages,
      // the inbox the portal shell has always linked to and never had.  They
      // come from a LATERAL rather than a second round trip because the inbox
      // needs one row per quotation and this endpoint already produces exactly
      // that — a separate messages endpoint would return the same quotations
      // again under a different name.
      //
      // `last_message_side` is READ FROM THE COLUMN that
      // db/seed/00-migrations.sql adds and db/seed/09-backfill.sql guarantees
      // non-null — not derived from the author's current role.  Deriving it
      // would re-label months of history the first time somebody is promoted
      // (review 2, ask 7); the side a message was sent from is a fact about
      // the message, fixed when it was written.
      //
      // BOTH lateral joins exclude `is_internal` messages.  A staff-only note
      // ("floor is 18%, do not go below") must never surface in the customer's
      // shell — not as the latest message, and not in the count that tells
      // them how many messages a thread has.  The thread endpoint
      // (app/api/portal/negotiation/[publicId]/messages) already filters them;
      // this preview is the other way into the same rows.
      `SELECT q.public_id, q.number, q.state, q.currency_code, q.grand_total,
              q.created_at, q.last_activity_at,
              u.full_name AS rep_name,
              EXISTS (SELECT 1 FROM negotiation_request nr
                       WHERE nr.quotation_id = q.id AND nr.status = 'open') AS has_open_request,
              COALESCE(m.message_count, 0) AS message_count,
              lm.comment      AS last_message,
              lm.created_at   AS last_message_at,
              lm.author_name  AS last_message_author,
              lm.author_side  AS last_message_side
         FROM quotation q
         JOIN app_user u ON u.id = q.owner_user_id
         LEFT JOIN LATERAL (
           SELECT count(*)::int AS message_count
             FROM negotiation_comment nc
             JOIN negotiation_request nr ON nr.id = nc.negotiation_request_id
            WHERE nr.quotation_id = q.id
              AND nc.is_internal = false
         ) m ON true
         LEFT JOIN LATERAL (
           SELECT nc.comment, nc.created_at, nc.author_side,
                  au.full_name AS author_name
             FROM negotiation_comment nc
             JOIN negotiation_request nr ON nr.id = nc.negotiation_request_id
             LEFT JOIN app_user au ON au.id = nc.author_user_id
            WHERE nr.quotation_id = q.id
              AND nc.is_internal = false
            ORDER BY nc.created_at DESC, nc.id DESC
            LIMIT 1
         ) lm ON true
        WHERE q.customer_id = $1
          -- Drafts are not the customer's business until a rep sends them.
          AND q.state IN ('approved','negotiation','confirmed')
        ORDER BY q.last_activity_at DESC`,
      [session.customerId],
    ),
  )
})
