// OWNER: D2.  CLAIMED.
//
// Resolve the live negotiation thread for a quotation.
//
// Exists so components/negotiation/thread.tsx can be dropped onto ANY screen
// with a single line and no props beyond the quotation id.  D1's quotation
// detail screen does not fetch negotiations and has no role state; requiring
// it to would have turned a two-line mount into a real edit of a file
// another lane is actively working in.  A self-sufficient component is the
// cheaper contract for both of us.
//
// Returns { thread: null } rather than 404 when a quotation simply has no
// negotiation — that is the ordinary case for most quotations, and a 404
// would make every quotation screen render an error box.

import { one } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin', 'viewer'] as const

export const GET = withAuth([...INTERNAL], async (req) => {
  const raw = new URL(req.url).searchParams.get('quotationId')
  const quotationId = Number(raw)
  if (!raw || !Number.isFinite(quotationId)) return fail('quotationId is required', 400)

  // The newest thread that has not been superseded.  A superseded thread
  // belongs to a version of the quotation nobody is discussing any more.
  const thread = await one(
    `SELECT nr.id, nr.status, nr.counter_discount_pct, nr.requested_delivery_date,
            qq.number AS quotation_number, c.name AS customer_name,
            (SELECT count(*) FROM negotiation_comment nc
              WHERE nc.negotiation_request_id = nr.id)::int AS message_count
       FROM negotiation_request nr
       JOIN quotation qq ON qq.id = nr.quotation_id
       JOIN customer c   ON c.id = qq.customer_id
      WHERE nr.quotation_id = $1 AND nr.status <> 'superseded'
      ORDER BY nr.created_at DESC
      LIMIT 1`,
    [quotationId],
  )

  return ok({ thread: thread ?? null })
})
