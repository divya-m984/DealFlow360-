// OWNER: D1.
//
// recomputeQuotation() — the single function every mutating path ends with.
//
// It does four things, always together, always in one transaction:
//   1. bumps `version` if commercial terms changed  → orphans every approval
//   2. rolls the line totals up onto the quotation
//   3. rescores the blended risk (lib/risk.ts)
//   4. writes the band and the routing flags
//
// If any of those four can happen without the others, a screen somewhere shows
// a total that disagrees with its own lines.

import type { PoolClient } from 'pg'
import { scoreQuotation } from './risk'
import type { Quotation, RiskAssessment } from './types/quotation'

// ══════════════════════════════════════════════════════════════════
// WHAT COUNTS AS A COMMERCIAL TERM
// ══════════════════════════════════════════════════════════════════
// Changing any of these re-opens the commercial negotiation, so an approval
// granted before the change must not survive it:
//
//   • adding, removing or reordering a line
//   • qty, unit_price, discount_pct, product/variant on any line
//   • line_type or subscription_plan_id
//   • the customer, or the pricelist (both move every price)
//
// These do NOT bump the version — they change nothing anyone approved:
//
//   • internal notes, the quotation's own name
//   • requested delivery date
//   • state transitions that do not touch terms (e.g. sending to the portal)
//
// `termsChanged` is a REQUIRED argument rather than an optional flag, on
// purpose.  An optional one defaults to something, and whatever it defaults to
// is what somebody forgets at hour 19.  Making it required forces the decision
// to be made — and to be visible in review — at every single call site.
export type RecomputeOpts = {
  termsChanged: boolean
  /** Who caused this.  Written to quotation.last_activity_at bookkeeping. */
  actorUserId?: number
}

export type RecomputeResult = RiskAssessment & {
  version: number
  versionBumped: boolean
}

export async function recomputeQuotation(
  c: PoolClient,
  quotationId: number,
  opts: RecomputeOpts,
): Promise<RecomputeResult> {
  // Lock the row for the duration.  Two concurrent line edits must not both
  // read version 3 and both write version 4.
  const { rows: locked } = await c.query<Pick<Quotation, 'id' | 'version'>>(
    `SELECT id, version FROM quotation WHERE id = $1 FOR UPDATE`,
    [quotationId],
  )
  if (locked.length === 0) throw new Error(`Quotation ${quotationId} not found`)

  const nextVersion = opts.termsChanged ? locked[0].version + 1 : locked[0].version

  // Score AFTER the lines are already written by the caller, but inside the
  // same transaction — so nobody can observe new lines with an old score.
  const risk = await scoreQuotation(c, quotationId)

  // The ROLLUP stays in SQL.  Per-line money is computed by Postgres
  // (generated columns, Law 2); summing it here in JavaScript would be the app
  // computing money, which is the thing Law 2 forbids.
  await c.query(
    `WITH agg AS (
       SELECT SUM(qty * unit_price)                     AS subtotal,
              SUM(qty * unit_price) - SUM(net_amount)   AS discount_total,
              ROUND(SUM(net_amount * tax_pct / 100.0), 2) AS tax_total,
              SUM(net_amount)                           AS net_total,
              SUM(margin_amount)                        AS margin_total
         FROM quotation_line WHERE quotation_id = $1
     )
     UPDATE quotation q
        SET subtotal         = COALESCE((SELECT subtotal       FROM agg), 0),
            discount_total   = COALESCE((SELECT discount_total FROM agg), 0),
            tax_total        = COALESCE((SELECT tax_total      FROM agg), 0),
            grand_total      = COALESCE((SELECT net_total      FROM agg), 0)
                             + COALESCE((SELECT tax_total      FROM agg), 0),
            margin_total     = COALESCE((SELECT margin_total   FROM agg), 0),
            risk_score       = $2,
            risk_band        = $3,
            requires_manager = $4,
            requires_finance = $5,
            version          = $6,
            last_activity_at = now()
      WHERE q.id = $1`,
    [
      quotationId,
      risk.risk_score,
      risk.risk_band,
      risk.requires_manager,
      risk.requires_finance,
      nextVersion,
    ],
  )

  return { ...risk, version: nextVersion, versionBumped: opts.termsChanged }
}

/**
 * The effective ceiling for a line: LEAST(tier ceiling, category ceiling).
 * PS §A3 — a Gold customer (15%) buying Services (10%) is capped at 10%.
 *
 * SNAPSHOT the result onto quotation_line.ceiling_pct when the line is created
 * or its product changes.  Never look it up at read time: if an admin edits a
 * tier ceiling tomorrow, an already-approved quotation must not silently
 * change its own risk score.
 */
export async function effectiveCeiling(
  c: PoolClient,
  customerId: number,
  productId: number,
): Promise<string> {
  const { rows } = await c.query<{ ceiling: string }>(
    `SELECT effective_ceiling_pct(cu.tier_id, p.category_id) AS ceiling
       FROM customer cu, product p
      WHERE cu.id = $1 AND p.id = $2`,
    [customerId, productId],
  )
  if (rows.length === 0) throw new Error('Unknown customer or product')
  return rows[0].ceiling
}

/** Append-only. PS §A3 wants user, timestamp AND reason on every action. */
export async function audit(
  c: PoolClient,
  entityType: string,
  entityId: number,
  action: string,
  actorUserId: number | null,
  note?: string,
  payload?: unknown,
): Promise<void> {
  await c.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entityType, entityId, action, actorUserId, note ?? null, payload ? JSON.stringify(payload) : null],
  )
}
