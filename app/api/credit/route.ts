// OWNER: D2.  CLAIMED — new path.
//
// THE RECEIVABLES BOARD.  Every customer, what they owe, how old it is, and
// how much of their credit line is gone.
//
// ── WHY THIS IS ONE QUERY AND NOT N CALLS TO getCreditProfile ────────
// The per-customer function in lib/credit.ts runs four queries.  Thirty
// customers would be a hundred and twenty round trips to render one table,
// which is the classic N+1 that makes a demo crawl in front of the person
// least likely to forgive it.  The aggregate below does it in one pass, and
// the two are checked against each other in the detail route: opening any
// customer recomputes the same numbers the long way.

import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin', 'viewer'] as const

export const GET = withAuth([...INTERNAL], async () => {
  const rows = await q(
    `WITH ar AS (
       SELECT i.customer_id,
              i.amount_total - COALESCE(p.paid, 0) AS outstanding,
              (CURRENT_DATE - i.due_date)          AS days_overdue
         FROM invoice i
         LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payment GROUP BY invoice_id) p
                ON p.invoice_id = i.id
        WHERE i.status IN ('unpaid','partial') AND i.posted_at IS NOT NULL
     ),
     agg AS (
       SELECT customer_id,
              SUM(outstanding)                                                          AS open_receivable,
              SUM(outstanding) FILTER (WHERE days_overdue <= 0)                         AS b_current,
              SUM(outstanding) FILTER (WHERE days_overdue BETWEEN 1 AND 30)             AS b_1_30,
              SUM(outstanding) FILTER (WHERE days_overdue BETWEEN 31 AND 60)            AS b_31_60,
              SUM(outstanding) FILTER (WHERE days_overdue BETWEEN 61 AND 90)            AS b_61_90,
              SUM(outstanding) FILTER (WHERE days_overdue > 90)                         AS b_90,
              MAX(days_overdue)                                                         AS oldest
         FROM ar WHERE outstanding > 0 GROUP BY customer_id
     ),
     committed AS (
       SELECT o.customer_id,
              SUM(CASE WHEN sol.qty > 0
                       THEN sol.net_amount * (sol.qty - sol.qty_invoiced) / sol.qty
                       ELSE 0 END) AS uninvoiced
         FROM sales_order o
         JOIN sales_order_line sol ON sol.order_id = o.id
        WHERE o.state <> 'cancelled'
        GROUP BY o.customer_id
     ),
     cn AS (
       SELECT customer_id, SUM(amount) AS credit_notes FROM credit_note GROUP BY customer_id
     )
     SELECT c.id, c.name, c.currency_code, c.credit_limit, c.payment_terms_days, c.credit_hold,
            t.name AS tier_name,
            COALESCE(agg.open_receivable, 0)::numeric(14,2) AS open_receivable,
            COALESCE(committed.uninvoiced, 0)::numeric(14,2) AS uninvoiced_commitment,
            COALESCE(cn.credit_notes, 0)::numeric(14,2)      AS credit_notes,
            (COALESCE(agg.open_receivable,0) + COALESCE(committed.uninvoiced,0)
             - COALESCE(cn.credit_notes,0))::numeric(14,2)   AS exposure,
            COALESCE(agg.b_current,0)::numeric(14,2) AS b_current,
            COALESCE(agg.b_1_30,0)::numeric(14,2)    AS b_1_30,
            COALESCE(agg.b_31_60,0)::numeric(14,2)   AS b_31_60,
            COALESCE(agg.b_61_90,0)::numeric(14,2)   AS b_61_90,
            COALESCE(agg.b_90,0)::numeric(14,2)      AS b_90,
            GREATEST(COALESCE(agg.oldest, 0), 0)     AS oldest_overdue_days
       FROM customer c
       JOIN customer_tier t ON t.id = c.tier_id
       LEFT JOIN agg       ON agg.customer_id = c.id
       LEFT JOIN committed ON committed.customer_id = c.id
       LEFT JOIN cn        ON cn.customer_id = c.id
      WHERE c.is_active
      ORDER BY exposure DESC, c.name`,
  )

  // Portfolio totals, computed from the same rows the table shows — so the
  // headline figures can never disagree with what is underneath them.
  const num = (v: unknown) => Number(v ?? 0)
  const totals = rows.reduce(
    (t: any, r: any) => ({
      exposure: t.exposure + num(r.exposure),
      openReceivable: t.openReceivable + num(r.open_receivable),
      current: t.current + num(r.b_current),
      d1_30: t.d1_30 + num(r.b_1_30),
      d31_60: t.d31_60 + num(r.b_31_60),
      d61_90: t.d61_90 + num(r.b_61_90),
      d90_plus: t.d90_plus + num(r.b_90),
    }),
    { exposure: 0, openReceivable: 0, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 },
  )

  const atRisk = rows.filter(
    (r: any) => r.credit_hold || (r.credit_limit !== null && num(r.exposure) > num(r.credit_limit)),
  ).length

  return ok({
    customers: rows,
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, Math.round((v as number) * 100) / 100])),
    atRisk,
  })
})
