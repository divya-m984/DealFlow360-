// OWNER: D2.  Subscriptions and proration (PS §B7, §A5).
//
// ── TWO RULES THIS FILE EXISTS TO ENFORCE ────────────────────────────
//
// 1. proration_event is an IMMUTABLE LEDGER.  Rows are inserted, never updated
//    and never deleted.  days_remaining and days_in_period are stored — not
//    just the resulting money — precisely so that a judge can read one row and
//    check the arithmetic without trusting the code that wrote it.
//
// 2. ALL DATE ARITHMETIC HAPPENS IN POSTGRES.  `date` columns come back from
//    pg as JavaScript Date objects at local midnight, and doing month maths on
//    those in JS is how a billing period silently loses a day either side of a
//    DST boundary.  Postgres also gets month-end right for free: 31 Jan plus
//    one month is 28 Feb, not 3 March.
//
// ── THE PRORATION FORMULA ────────────────────────────────────────────
//
//     delta = (new_rate − old_rate) × days_remaining / days_in_period
//
// This is the same arithmetic Stripe describes as "credit the unused portion
// of the old plan, charge for the remaining days of the new one" — those two
// line items net to exactly this delta.  We store the net figure plus both day
// counts, which is the auditable form.
//
// Every function here takes a PoolClient rather than importing the pool, so it
// can only ever be called from inside tx() in a route handler.  Money and
// subscription state must never be half-written.

import type { PoolClient } from 'pg'

export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

/** Postgres interval for each cycle.  The single place this mapping lives. */
export const CYCLE_INTERVAL: Record<BillingCycle, string> = {
  weekly: '7 days',
  monthly: '1 month',
  quarterly: '3 months',
  yearly: '1 year',
}

function intervalFor(cycle: string): string {
  const i = CYCLE_INTERVAL[cycle as BillingCycle]
  if (!i) throw new Error(`Unknown billing cycle: ${cycle}`)
  return i
}

/**
 * Start a subscription for one recurring order line.
 *
 * The period starts today and runs one cycle.  next_bill_date is the end of
 * the current period — the day the next one is charged.
 */
export async function startSubscription(
  c: PoolClient,
  opts: {
    customerId: number
    planId: number
    sourceOrderLineId: number
    qty: number
  },
): Promise<{ id: number }> {
  const plan = await c.query(`SELECT cycle FROM subscription_plan WHERE id = $1`, [opts.planId])
  if (plan.rowCount === 0) throw new Error(`No subscription plan with id ${opts.planId}`)
  const iv = intervalFor(plan.rows[0].cycle)

  const res = await c.query(
    `INSERT INTO subscription
       (customer_id, plan_id, source_order_line_id, qty, status,
        current_period_start, current_period_end, next_bill_date)
     VALUES ($1, $2, $3, $4, 'active',
             CURRENT_DATE,
             (CURRENT_DATE + $5::interval)::date,
             (CURRENT_DATE + $5::interval)::date)
     RETURNING id`,
    [opts.customerId, opts.planId, opts.sourceOrderLineId, opts.qty, iv],
  )
  return { id: res.rows[0].id }
}

/**
 * Advance a subscription to its next period.  Used when the current period is
 * billed.  Kept separate from invoicing so "what does the next period look
 * like" is answerable without writing money.
 */
export async function rollPeriod(c: PoolClient, subscriptionId: number): Promise<void> {
  const s = await c.query(
    `SELECT s.current_period_end, p.cycle
       FROM subscription s JOIN subscription_plan p ON p.id = s.plan_id
      WHERE s.id = $1 FOR UPDATE`,
    [subscriptionId],
  )
  if (s.rowCount === 0) throw new Error(`No subscription with id ${subscriptionId}`)
  const iv = intervalFor(s.rows[0].cycle)
  await c.query(
    `UPDATE subscription
        SET current_period_start = current_period_end,
            current_period_end   = (current_period_end + $2::interval)::date,
            next_bill_date       = (current_period_end + $2::interval)::date
      WHERE id = $1 AND status = 'active'`,
    [subscriptionId, iv],
  )
}

export type ProrationResult = {
  eventId: number
  deltaAmount: number
  daysRemaining: number
  daysInPeriod: number
  oldRate: number
  newRate: number
  creditNoteId: number | null
}

/**
 * Change quantity and/or plan mid-cycle, and write the ledger row.
 *
 * `effectiveDate` defaults to today.  It is clamped into the current period —
 * a proration for a day outside the period being prorated is meaningless and
 * days_remaining would go negative, which the schema's CHECK forbids anyway.
 */
export async function applyProration(
  c: PoolClient,
  subscriptionId: number,
  change: { newQty?: number; newPlanId?: number; effectiveDate?: string },
): Promise<ProrationResult> {
  const cur = await c.query(
    `SELECT s.id, s.customer_id, s.qty, s.plan_id, s.status,
            s.current_period_start, s.current_period_end,
            p.price AS plan_price, p.proration_enabled
       FROM subscription s
       JOIN subscription_plan p ON p.id = s.plan_id
      WHERE s.id = $1
      FOR UPDATE OF s`,
    [subscriptionId],
  )
  if (cur.rowCount === 0) throw new Error(`No subscription with id ${subscriptionId}`)
  const s = cur.rows[0]
  if (s.status !== 'active') throw new Error('Only an active subscription can be changed.')

  const newPlanId = change.newPlanId ?? Number(s.plan_id)
  const newQty = change.newQty ?? Number(s.qty)
  if (!(newQty > 0)) throw new Error('Quantity must be greater than zero.')

  const np = await c.query(
    `SELECT price, cycle, proration_enabled FROM subscription_plan WHERE id = $1`,
    [newPlanId],
  )
  if (np.rowCount === 0) throw new Error(`No subscription plan with id ${newPlanId}`)

  const eventType = change.newPlanId && change.newPlanId !== Number(s.plan_id) ? 'plan_change' : 'qty_change'

  // Both day counts come from Postgres.  date − date is an integer number of
  // days, so this is exact and needs no timezone reasoning.
  const days = await c.query(
    `SELECT (($2::date) - ($1::date))                              AS days_in_period,
            GREATEST(0, ($2::date) - GREATEST($1::date, LEAST($2::date, COALESCE($3::date, CURRENT_DATE)))) AS days_remaining,
            GREATEST($1::date, LEAST($2::date, COALESCE($3::date, CURRENT_DATE)))                            AS effective_date`,
    [s.current_period_start, s.current_period_end, change.effectiveDate ?? null],
  )
  const daysInPeriod: number = days.rows[0].days_in_period
  const daysRemaining: number = days.rows[0].days_remaining
  const effectiveDate: Date = days.rows[0].effective_date

  const oldRate = round2(Number(s.plan_price) * Number(s.qty))
  const newRate = round2(Number(np.rows[0].price) * newQty)

  // proration_enabled = false means the change takes effect but no money moves
  // until the next period.  The event is still recorded — the ledger is the
  // history of what happened, not only of what was charged.
  const prorates = s.proration_enabled && np.rows[0].proration_enabled
  const delta = prorates
    ? round2((newRate - oldRate) * (daysRemaining / daysInPeriod))
    : 0

  // A negative delta is money owed BACK to the customer, which is a credit
  // note, not a negative invoice.
  let creditNoteId: number | null = null
  if (delta < 0) {
    creditNoteId = await issueCreditNote(c, {
      customerId: Number(s.customer_id),
      amount: Math.abs(delta),
      reason:
        `Proration on subscription ${subscriptionId}: ` +
        `${eventType === 'plan_change' ? 'plan change' : 'quantity change'} ` +
        `with ${daysRemaining} of ${daysInPeriod} days remaining`,
    })
  }

  const ev = await c.query(
    `INSERT INTO proration_event
       (subscription_id, event_type, effective_date, old_qty, new_qty,
        old_plan_id, new_plan_id, days_remaining, days_in_period,
        delta_amount, credit_note_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      subscriptionId, eventType, effectiveDate,
      s.qty, newQty,
      s.plan_id, newPlanId,
      daysRemaining, daysInPeriod, delta, creditNoteId,
    ],
  )

  await c.query(`UPDATE subscription SET qty = $2, plan_id = $3 WHERE id = $1`,
    [subscriptionId, newQty, newPlanId])

  return {
    eventId: ev.rows[0].id,
    deltaAmount: delta,
    daysRemaining,
    daysInPeriod,
    oldRate,
    newRate,
    creditNoteId,
  }
}

/**
 * Cancel a subscription.
 *
 * Two schema rules bite here and both are deliberate:
 *   • next_bill_only_when_active — a cancelled subscription may not carry a
 *     next_bill_date, so it is nulled in the same statement as the status.
 *   • cancellation_refund = 'prorated' → the unused remainder of the period
 *     comes back as a credit note, linked from the proration_event row.
 */
export async function cancelSubscription(
  c: PoolClient,
  subscriptionId: number,
  effectiveDate?: string,
): Promise<ProrationResult & { refundPolicy: string; noticeDays: number }> {
  const cur = await c.query(
    `SELECT s.id, s.customer_id, s.qty, s.plan_id, s.status,
            s.current_period_start, s.current_period_end,
            p.price AS plan_price, p.cancellation_refund, p.cancellation_notice_days
       FROM subscription s
       JOIN subscription_plan p ON p.id = s.plan_id
      WHERE s.id = $1
      FOR UPDATE OF s`,
    [subscriptionId],
  )
  if (cur.rowCount === 0) throw new Error(`No subscription with id ${subscriptionId}`)
  const s = cur.rows[0]
  if (s.status === 'cancelled') throw new Error('That subscription is already cancelled.')

  const days = await c.query(
    `SELECT (($2::date) - ($1::date))                              AS days_in_period,
            GREATEST(0, ($2::date) - GREATEST($1::date, LEAST($2::date, COALESCE($3::date, CURRENT_DATE)))) AS days_remaining,
            GREATEST($1::date, LEAST($2::date, COALESCE($3::date, CURRENT_DATE)))                            AS effective_date`,
    [s.current_period_start, s.current_period_end, effectiveDate ?? null],
  )
  const daysInPeriod: number = days.rows[0].days_in_period
  const daysRemaining: number = days.rows[0].days_remaining
  const effDate: Date = days.rows[0].effective_date

  const oldRate = round2(Number(s.plan_price) * Number(s.qty))
  // Cancelling is the new rate going to zero for the rest of the period.
  const delta =
    s.cancellation_refund === 'prorated'
      ? round2((0 - oldRate) * (daysRemaining / daysInPeriod))
      : s.cancellation_refund === 'full'
        ? round2(-oldRate)
        : 0

  let creditNoteId: number | null = null
  if (delta < 0) {
    creditNoteId = await issueCreditNote(c, {
      customerId: Number(s.customer_id),
      amount: Math.abs(delta),
      reason:
        `Cancellation refund on subscription ${subscriptionId} ` +
        `(${s.cancellation_refund}, ${daysRemaining} of ${daysInPeriod} days unused)`,
    })
  }

  const ev = await c.query(
    `INSERT INTO proration_event
       (subscription_id, event_type, effective_date, old_qty, new_qty,
        old_plan_id, new_plan_id, days_remaining, days_in_period,
        delta_amount, credit_note_id)
     VALUES ($1, 'cancel', $2, $3, $3, $4, $4, $5, $6, $7, $8)
     RETURNING id`,
    [subscriptionId, effDate, s.qty, s.plan_id, daysRemaining, daysInPeriod, delta, creditNoteId],
  )

  // next_bill_date MUST be nulled in the same statement — the schema's
  // next_bill_only_when_active CHECK rejects the row otherwise.
  await c.query(
    `UPDATE subscription
        SET status = 'cancelled', cancelled_at = now(), next_bill_date = NULL
      WHERE id = $1`,
    [subscriptionId],
  )

  return {
    eventId: ev.rows[0].id,
    deltaAmount: delta,
    daysRemaining,
    daysInPeriod,
    oldRate,
    newRate: 0,
    creditNoteId,
    refundPolicy: s.cancellation_refund,
    noticeDays: s.cancellation_notice_days,
  }
}

export async function issueCreditNote(
  c: PoolClient,
  opts: { customerId: number; amount: number; reason: string; invoiceId?: number | null },
): Promise<number> {
  const res = await c.query(
    `INSERT INTO credit_note (number, customer_id, invoice_id, amount, reason)
     VALUES ('CN-' || to_char(now(), 'YYYY') || '-' ||
             lpad(((SELECT count(*) FROM credit_note) + 1)::text, 4, '0'),
             $1, $2, $3, $4)
     RETURNING id`,
    [opts.customerId, opts.invoiceId ?? null, opts.amount, opts.reason],
  )
  return res.rows[0].id
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
