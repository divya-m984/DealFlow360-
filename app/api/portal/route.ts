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
      `SELECT q.public_id, q.number, q.state, q.currency_code, q.grand_total,
              q.created_at, q.last_activity_at,
              u.full_name AS rep_name,
              EXISTS (SELECT 1 FROM negotiation_request nr
                       WHERE nr.quotation_id = q.id AND nr.status = 'open') AS has_open_request
         FROM quotation q
         JOIN app_user u ON u.id = q.owner_user_id
        WHERE q.customer_id = $1
          -- Drafts are not the customer's business until a rep sends them.
          AND q.state IN ('approved','negotiation','confirmed')
        ORDER BY q.last_activity_at DESC`,
      [session.customerId],
    ),
  )
})
