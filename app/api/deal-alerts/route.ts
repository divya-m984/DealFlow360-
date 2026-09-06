// OWNER: D1.  Deal Health — the alert list behind screen 14 (PS §B9).
//
// Alerts are RENDERED, not derived. This endpoint reads `deal_alert` rows; it
// does not infer staleness from quotation columns at request time. A 9-day-old
// last_activity_at is not an alert on its own — something has to have flagged
// it, and that flagging is seeded (see db/seed/05-quotations.sql for stalled
// and discount_anomaly, 06-orders.sql for delivery_slippage).
//
// Response shape matches D3's DealAlertRow in app/(app)/deal-health/page.tsx.
// They wrote it against the schema while this was a 501; the columns below are
// that contract, so do not rename a field without telling them.
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'
import { INTERNAL_READERS } from '@/lib/roles'

export const runtime = 'nodejs'


export const GET = withAuth([...INTERNAL_READERS], async (req) => {
  const p = new URL(req.url).searchParams
  const where: string[] = []
  const args: unknown[] = []
  const bind = (v: unknown) => `$${args.push(v)}`

  // Open alerts by default. The partial unique index one_open_alert_per_kind
  // guarantees at most one unresolved alert of each kind per quotation, so
  // this list never repeats itself.
  if (p.get('includeResolved') !== 'true') where.push('a.resolved_at IS NULL')
  if (p.get('kind')) where.push(`a.kind = ${bind(p.get('kind'))}::alert_type`)
  if (p.get('quotationId')) where.push(`a.quotation_id = ${bind(Number(p.get('quotationId')))}`)

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''

  return ok(
    await q(
      `SELECT a.id, a.kind, a.detail, a.flagged_at,
              a.last_action, a.last_action_at, a.resolved_at,
              a.quotation_id,
              qq.number       AS quotation_number,
              qq.risk_band,
              qq.currency_code,
              qq.grand_total,
              qq.state        AS quotation_state,
              c.name          AS customer_name,
              own.full_name   AS owner_name,
              act.full_name   AS last_action_by_name
         FROM deal_alert a
         JOIN quotation qq ON qq.id = a.quotation_id
         JOIN customer c   ON c.id = qq.customer_id
         JOIN app_user own ON own.id = qq.owner_user_id
         LEFT JOIN app_user act ON act.id = a.last_action_by_user_id
         ${clause}
        ORDER BY a.flagged_at DESC, a.id DESC`,
      args,
    ),
  )
})
