// The internal negotiation inbox — every quotation with a live conversation.
//
// ── WHY THIS LIVES UNDER /api/negotiation ────────────────────────────
// It arrived as POST-review-2 work at /api/negotiations, one letter away from
// D2's /api/negotiation, which resolves the thread for a single quotation.
// Two top-level routes distinguished only by a plural is a naming trap, not a
// design: the next person to write `fetch('/api/negotiation…')` gets whichever
// one their fingers picked.  They are not duplicates — this is the LIST, that
// is the RESOLVER — so the fix is one namespace with a named sub-resource,
// not deleting a query nothing else performs.
//
// ── WHY A NEW ENDPOINT AND NOT MORE COLUMNS ON /api/quotations ───────
// The portal's inbox reuses GET /api/portal, because a customer has a handful
// of quotations and that endpoint already returns exactly one row per one.
// The internal list is different: GET /api/quotations feeds the dashboard AND
// the pipeline board, both of which fetch it on every visit and neither of
// which needs message text.  Adding five columns and two LATERAL joins to the
// hottest read in the application to serve one screen is the wrong trade, so
// the inbox gets its own query and the pipeline feed stays lean.
//
// ── SCOPE ────────────────────────────────────────────────────────────
// Not scoped per rep, deliberately — it matches GET /api/quotations, which
// shows every rep the whole pipeline.  This is a view over that same pipeline,
// so scoping it would make the inbox disagree with the board it came from.
// (GET /api/approvals does scope reps, because an approval queue is a worklist
// of things assigned to you.  A conversation list is not.)
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

// The same list every other internal negotiation read uses.  'viewer' is
// included because reading a conversation changes nothing, and 'super_admin'
// because lib/api.ts only auto-grants it what 'admin' holds.
const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin', 'viewer'] as const

export const GET = withAuth([...INTERNAL], async () => {
  return ok(
    await q(
      // `awaiting_us` is the whole point of the screen: an open request whose
      // last word came from the customer is a deal waiting on THIS side.  It is
      // computed in SQL so the ordering below can use it — a client-side sort
      // could not put those rows first without fetching everything anyway.
      //
      // `author_side` is READ FROM THE COLUMN, not derived from the author's
      // current role.  db/seed/00-migrations.sql stores it at write time and
      // db/seed/09-backfill.sql guarantees it non-null, precisely because a
      // derivation breaks the moment ask 7 is used: promote the rep who ran a
      // negotiation and `au.role = 'portal'` would re-label months of history.
      // The side a message was sent from is a fact about the message.
      `SELECT qq.id, qq.number, qq.state, qq.currency_code, qq.grand_total,
              qq.last_activity_at,
              c.name   AS customer_name,
              own.full_name AS owner_name,
              n.message_count,
              n.open_requests,
              n.open_counter_pct,
              lm.comment     AS last_message,
              lm.created_at  AS last_message_at,
              lm.author_name AS last_message_author,
              lm.author_side AS last_message_side,
              (n.open_requests > 0 AND lm.author_side = 'buyer') AS awaiting_us
         FROM quotation qq
         JOIN customer c   ON c.id = qq.customer_id
         JOIN app_user own ON own.id = qq.owner_user_id
         JOIN LATERAL (
           SELECT count(nc.id)::int                                        AS message_count,
                  count(DISTINCT nr.id) FILTER (WHERE nr.status = 'open')::int AS open_requests,
                  max(nr.counter_discount_pct) FILTER (WHERE nr.status = 'open') AS open_counter_pct
             FROM negotiation_request nr
             LEFT JOIN negotiation_comment nc ON nc.negotiation_request_id = nr.id
            WHERE nr.quotation_id = qq.id
         ) n ON true
         LEFT JOIN LATERAL (
           SELECT nc.comment, nc.created_at, nc.author_side,
                  au.full_name AS author_name
             FROM negotiation_comment nc
             JOIN negotiation_request nr ON nr.id = nc.negotiation_request_id
             LEFT JOIN app_user au ON au.id = nc.author_user_id
            WHERE nr.quotation_id = qq.id
            ORDER BY nc.created_at DESC, nc.id DESC
            LIMIT 1
         ) lm ON true
        -- A quotation nobody has negotiated is not an empty conversation, it
        -- is not a conversation.  The INNER JOIN LATERAL above keeps every
        -- quotation; this is what makes the list a list of threads.
        WHERE n.message_count > 0 OR n.open_requests > 0
        -- Waiting on us first, then whatever moved most recently.
        ORDER BY (n.open_requests > 0 AND lm.author_side = 'buyer') DESC,
                 n.open_requests DESC,
                 COALESCE(lm.created_at, qq.last_activity_at) DESC`,
    ),
  )
})
