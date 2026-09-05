// OWNER: D1.  Screen 2 — the Sales Dashboard's numbers, in one round trip.
//
// The mockup's three tiles plus Recent Activity. Building this as one endpoint
// rather than having the page fan out to /quotations, /approvals and
// /deal-alerts and count client-side: the counts are aggregates, and shipping
// three full lists to the browser so it can call .length on them is the wrong
// shape — it also makes the tiles disagree the moment the lists are paginated.
//
// Everything here is scoped by role the same way the underlying screens are:
// a Sales Rep sees their own pipeline, everyone else sees all of it.
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin'] as const

export const GET = withAuth([...INTERNAL], async (_req, session) => {
  const isRep = session.role === 'sales_rep'
  const mine = isRep ? session.userId : null

  const [tiles, activity] = await Promise.all([
    q(
      `SELECT
         -- Awaiting a signature at the CURRENT version. A superseded approval
         -- is not pending — it is dead — so it must not be counted here.
         (SELECT count(*) FROM approval_request a
            JOIN quotation qq ON qq.id = a.quotation_id
           WHERE a.status = 'pending'
             AND a.quotation_version = qq.version
             AND ($1::bigint IS NULL OR qq.owner_user_id = $1))::int
           AS pending_approvals,

         (SELECT count(*) FROM quotation qq
           WHERE qq.state IN ('draft','pending_approval','approved','negotiation')
             AND ($1::bigint IS NULL OR qq.owner_user_id = $1))::int
           AS open_quotations,

         (SELECT count(DISTINCT d.quotation_id) FROM deal_alert d
            JOIN quotation qq ON qq.id = d.quotation_id
           WHERE d.resolved_at IS NULL
             AND ($1::bigint IS NULL OR qq.owner_user_id = $1))::int
           AS at_risk_deals,

         (SELECT COALESCE(SUM(qq.grand_total), 0) FROM quotation qq
           WHERE qq.state IN ('draft','pending_approval','approved','negotiation')
             AND ($1::bigint IS NULL OR qq.owner_user_id = $1))
           AS open_value,

         (SELECT currency_code FROM quotation ORDER BY id LIMIT 1) AS currency_code`,
      [mine],
    ),
    // Recent Activity is the audit log, which is the only place that records
    // WHO did WHAT and WHY (PS §A3). Joined back to the quotation so a row can
    // be clicked through to the deal it belongs to.
    q(
      `SELECT al.id, al.action, al.note, al.created_at,
              u.full_name AS actor_name,
              qq.id AS quotation_id, qq.number, c.name AS customer_name
         FROM audit_log al
         JOIN quotation qq ON qq.id = al.entity_id AND al.entity_type = 'quotation'
         JOIN customer c   ON c.id = qq.customer_id
         LEFT JOIN app_user u ON u.id = al.actor_user_id
        WHERE ($1::bigint IS NULL OR qq.owner_user_id = $1)
        ORDER BY al.created_at DESC
        LIMIT 8`,
      [mine],
    ),
  ])

  return ok({ ...tiles[0], activity, scopedToMe: isRep })
})
