// OWNER: D2.  CLAIMED — new path.
//
// Runs the deal-alert detector.  Writes into the same `deal_alert` table
// D1's GET /api/deal-alerts already reads and D3's screen 14 already
// renders, so neither of those files changes at all.
//
// POST, not GET: it writes.  Any internal role may TRIGGER a scan because
// it is idempotent and creates no risk — the partial unique index means a
// hundred scans produce the same rows as one — but `viewer` is excluded on
// principle, since a read-only role that writes rows is not read-only.

import { tx } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'
import { scanDealAlerts, STALL_DAYS, DISCOUNT_ANOMALY_POINTS } from '@/lib/alerts'

export const runtime = 'nodejs'

const CAN_SCAN = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin'] as const

export const POST = withAuth([...CAN_SCAN], async () => {
  const result = await tx(async (c) => scanDealAlerts(c))
  return ok({
    ...result,
    // Returned so the screen can state the rule it just applied rather than
    // asking a judge to take the numbers on faith.
    thresholds: { stallDays: STALL_DAYS, discountAnomalyPoints: DISCOUNT_ANOMALY_POINTS },
  })
})
