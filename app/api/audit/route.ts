// OWNER: D2.  CLAIMED — new path.
//
// THE AUDIT TRAIL, READ BACK.
//
// audit_log has been written from almost every write in this application
// since the first day — approvals, config changes, role promotions, invoice
// posting, credit notes, e-way bills, stock receipts. It was readable on
// exactly two screens (D1's quotation and approval details) and invisible
// everywhere else, which means most of it existed only for a `psql` session
// nobody was going to run during a demo.
//
// "Who changed this, and when?" is the first question asked about any
// financial record, and an ERP that cannot answer it on the record's own
// screen has an audit trail in the same sense that an unread logfile is
// monitoring.
//
// Generic on purpose: one endpoint, any entity type. The alternative is an
// audit route per screen, which is four copies of the same query that drift.

import { z } from 'zod'
import { q } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin', 'viewer'] as const

/** Whitelist, not free text. entity_type reaches a WHERE clause, and while
 *  it is parameterised, an open enum invites a caller to fish for tables
 *  they were never meant to read. */
const ENTITY = z.enum([
  'invoice', 'sales_order', 'quotation', 'app_user', 'product',
  'subscription', 'stock_level', 'approval_request', 'config',
])

export const GET = withAuth([...INTERNAL], async (req) => {
  const sp = new URL(req.url).searchParams
  const parsed = ENTITY.safeParse(sp.get('entityType'))
  if (!parsed.success) {
    return fail(`entityType must be one of: ${ENTITY.options.join(', ')}`, 400)
  }
  const entityId = Number(sp.get('entityId'))
  if (!Number.isFinite(entityId)) return fail('entityId is required', 400)
  const limit = Math.min(Number(sp.get('limit') ?? 50) || 50, 200)

  const rows = await q(
    `SELECT a.id, a.action, a.note, a.payload, a.created_at,
            u.full_name AS actor_name, u.email AS actor_email, u.role AS actor_role
       FROM audit_log a
       LEFT JOIN app_user u ON u.id = a.actor_user_id
      WHERE a.entity_type = $1 AND a.entity_id = $2
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $3`,
    [parsed.data, entityId, limit],
  )

  return ok({ entityType: parsed.data, entityId, entries: rows })
})
