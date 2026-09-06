// OWNER: D1.  The approvals queue — screen 5.
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'
import { INTERNAL_READERS } from '@/lib/roles'

export const runtime = 'nodejs'

// ── GET /api/approvals ─────────────────────────────────────────────
// Only rows belonging to each quotation's CURRENT version are listed.
// A superseded approval is not "pending" — it is dead, and showing it in a
// manager's queue would invite someone to approve terms that no longer exist.
//
// RBAC: reading and acting are DIFFERENT rights here.
//
// PS §3 gives the Sales Rep "tracks approval status and fulfillment progress",
// so a rep must be able to see this screen — they need to know whether their
// own deal is stuck, and with whom. What they cannot do is ACT: POST on
// /api/approvals/[id] stays manager/finance/admin.
//
// A rep is scoped to quotations they OWN, in the WHERE clause rather than by
// filtering afterwards, so another rep's pipeline is never selected at all.
export const GET = withAuth([...INTERNAL_READERS], async (req, session) => {
  const p = new URL(req.url).searchParams
  const where: string[] = ['a.quotation_version = qq.version']
  const args: unknown[] = []
  const bind = (v: unknown) => `$${args.push(v)}`

  if (session.role === 'sales_rep') where.push(`qq.owner_user_id = ${bind(session.userId)}`)

  if (p.get('status')) where.push(`a.status = ${bind(p.get('status'))}::approval_status`)
  if (p.get('mine') === 'true') where.push(`a.assigned_to_user_id = ${bind(session.userId)}`)
  // A finance user's queue should not be full of manager steps, and vice versa.
  if (p.get('forMyRole') === 'true' && session.role !== 'admin') {
    where.push(`a.level = ${bind(session.role === 'finance' ? 'finance' : 'sales_manager')}::approval_level`)
  }

  return ok(
    await q(
      `SELECT a.id, a.quotation_id, a.quotation_version, a.level, a.seq, a.status,
              a.acted_at, a.note, a.created_at,
              qq.number, qq.risk_score, qq.risk_band, qq.grand_total, qq.currency_code,
              qq.state AS quotation_state,
              c.name AS customer_name, t.name AS tier_name,
              own.full_name AS owner_name,
              asg.full_name AS assigned_to_name,
              act.full_name AS acted_by_name
         FROM approval_request a
         JOIN quotation qq     ON qq.id = a.quotation_id
         JOIN customer c       ON c.id = qq.customer_id
         JOIN customer_tier t  ON t.id = c.tier_id
         JOIN app_user own     ON own.id = qq.owner_user_id
         LEFT JOIN app_user asg ON asg.id = a.assigned_to_user_id
         LEFT JOIN app_user act ON act.id = a.acted_by_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY (a.status = 'pending') DESC, qq.risk_score DESC, a.created_at DESC`,
      args,
    ),
  )
})
