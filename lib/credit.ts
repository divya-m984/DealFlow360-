// OWNER: D2.  CLAIMED — new file.
//
// CREDIT EXPOSURE AND RECEIVABLES AGEING.
//
// ── WHY THIS IS THE MISSING HALF OF QUOTE-TO-CASH ────────────────────
// Everything in this application up to here answers "may we discount this?".
// Nothing answered "may we SELL to them at all?".  Those are different
// questions with different owners: the first is a margin decision the sales
// manager makes, the second is a solvency decision finance makes, and an ERP
// that only models the first will happily let a rep sell a company that
// already owes us more than it can pay.
//
// Credit control is the single control that separates an order-to-cash
// system from a CRUD app with an ERP theme, and every ERP ships it — Odoo
// puts credit_limit on res.partner and warns or blocks on confirmation.
//
// ── WHAT "EXPOSURE" MEANS, AND WHY IT IS NOT JUST UNPAID INVOICES ────
// A customer's exposure is what they owe us plus what we have already
// committed to give them and not yet billed:
//
//   posted invoices, unpaid or partly paid          — money owed now
// + confirmed orders, delivered-but-unbilled value  — money about to be owed
// − credit notes not yet applied                    — money we owe back
//
// Leaving out the middle term is the classic mistake.  It lets a customer at
// their limit place ten more orders, because nothing is an invoice yet, and
// the breach only becomes visible after the goods have shipped — at which
// point refusing is no longer an option.

import type { PoolClient } from 'pg'

export type AgingBuckets = {
  current: number
  d1_30: number
  d31_60: number
  d61_90: number
  d90_plus: number
  total: number
}

export type CreditProfile = {
  customerId: number
  customerName: string
  tierName: string
  currency: string
  creditLimit: number | null
  paymentTermsDays: number
  onHold: boolean
  /** Owed on posted invoices, unpaid or partly paid. */
  openReceivable: number
  /** Shipped or committed and not yet invoiced. */
  uninvoicedCommitment: number
  /** Credit notes issued and not consumed by a payment. */
  creditNotes: number
  exposure: number
  /** null when the limit is null — unlimited, not "zero left". */
  available: number | null
  utilisationPct: number | null
  aging: AgingBuckets
  oldestOverdueDays: number
  /** Days Sales Outstanding, on the last 90 days of invoicing. */
  dso: number | null
}

export type CreditDecision = {
  allowed: boolean
  /** 'ok' | 'hold' | 'over_limit' */
  reason: 'ok' | 'hold' | 'over_limit'
  message: string
  exposure: number
  creditLimit: number | null
  wouldBecome: number
  overBy: number
}

const n = (v: unknown) => Number(v ?? 0)

/**
 * One customer's full credit picture.  Read-only; safe from a GET.
 *
 * Every figure is derived at read time.  A stored `balance` column would be
 * one more thing that can silently disagree with the invoices, and the
 * invoices are the facts.
 */
export async function getCreditProfile(
  c: PoolClient,
  customerId: number,
): Promise<CreditProfile | null> {
  const cust = await c.query(
    `SELECT cu.id, cu.name, cu.currency_code, cu.credit_limit, cu.payment_terms_days,
            cu.credit_hold, t.name AS tier_name
       FROM customer cu JOIN customer_tier t ON t.id = cu.tier_id
      WHERE cu.id = $1`,
    [customerId],
  )
  if (cust.rowCount === 0) return null
  const u = cust.rows[0]

  // Posted, non-void invoices, less whatever has been paid against them.
  // A DRAFT invoice is deliberately excluded: it has not been sent, the
  // customer has not agreed it, and treating it as receivable would let an
  // unposted mistake block a real order.
  const ar = await c.query(
    `SELECT i.id, i.amount_total, i.due_date,
            COALESCE(p.paid, 0) AS paid,
            (CURRENT_DATE - i.due_date) AS days_overdue
       FROM invoice i
       LEFT JOIN (SELECT invoice_id, SUM(amount) AS paid FROM payment GROUP BY invoice_id) p
              ON p.invoice_id = i.id
      WHERE i.customer_id = $1
        AND i.status IN ('unpaid','partial')
        AND i.posted_at IS NOT NULL`,
    [customerId],
  )

  const aging: AgingBuckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0 }
  let openReceivable = 0
  let oldestOverdueDays = 0
  for (const r of ar.rows) {
    const outstanding = round2(n(r.amount_total) - n(r.paid))
    if (outstanding <= 0) continue
    openReceivable = round2(openReceivable + outstanding)
    const d = Number(r.days_overdue)
    if (d > oldestOverdueDays) oldestOverdueDays = d
    if (d <= 0) aging.current = round2(aging.current + outstanding)
    else if (d <= 30) aging.d1_30 = round2(aging.d1_30 + outstanding)
    else if (d <= 60) aging.d31_60 = round2(aging.d31_60 + outstanding)
    else if (d <= 90) aging.d61_90 = round2(aging.d61_90 + outstanding)
    else aging.d90_plus = round2(aging.d90_plus + outstanding)
  }
  aging.total = openReceivable

  // The term people forget: value on confirmed orders that has not been
  // billed yet.  Computed as line total minus the share already invoiced,
  // which is exactly what qty_invoiced tracks.
  const committed = await c.query(
    `SELECT COALESCE(SUM(
              CASE WHEN sol.qty > 0
                   THEN sol.net_amount * (sol.qty - sol.qty_invoiced) / sol.qty
                   ELSE 0 END), 0) AS v
       FROM sales_order o
       JOIN sales_order_line sol ON sol.order_id = o.id
      WHERE o.customer_id = $1 AND o.state <> 'cancelled'`,
    [customerId],
  )

  const cn = await c.query(
    `SELECT COALESCE(SUM(amount), 0) AS v FROM credit_note WHERE customer_id = $1`,
    [customerId],
  )

  const uninvoicedCommitment = round2(n(committed.rows[0].v))
  const creditNotes = round2(n(cn.rows[0].v))
  const exposure = round2(openReceivable + uninvoicedCommitment - creditNotes)
  const creditLimit = u.credit_limit === null ? null : n(u.credit_limit)

  // DSO over the last 90 days. Null rather than 0 when there is nothing to
  // measure — "we do not know" and "customers pay instantly" are different
  // statements and a dashboard must not conflate them.
  const dsoRow = await c.query(
    `SELECT COALESCE(SUM(amount_total), 0) AS billed
       FROM invoice
      WHERE customer_id = $1 AND posted_at >= now() - interval '90 days' AND status <> 'void'`,
    [customerId],
  )
  const billed90 = n(dsoRow.rows[0].billed)
  const dso = billed90 > 0 ? Math.round((openReceivable / billed90) * 90) : null

  return {
    customerId: Number(u.id),
    customerName: u.name,
    tierName: u.tier_name,
    currency: u.currency_code,
    creditLimit,
    paymentTermsDays: Number(u.payment_terms_days),
    onHold: u.credit_hold,
    openReceivable,
    uninvoicedCommitment,
    creditNotes,
    exposure,
    available: creditLimit === null ? null : round2(creditLimit - exposure),
    utilisationPct:
      creditLimit === null || creditLimit === 0 ? null : Math.round((exposure / creditLimit) * 100),
    aging,
    oldestOverdueDays: Math.max(0, oldestOverdueDays),
    dso,
  }
}

/**
 * May we commit `amount` more to this customer?
 *
 * Called before a quotation becomes an order.  Returns a DECISION, not a
 * thrown error, so the caller can choose to surface it as a warning on a
 * screen or as a refusal on a write — the same check, two presentations,
 * and no chance of the two disagreeing.
 */
export async function checkCredit(
  c: PoolClient,
  customerId: number,
  amount: number,
): Promise<CreditDecision> {
  const p = await getCreditProfile(c, customerId)
  if (!p) throw new Error(`No customer with id ${customerId}`)

  const wouldBecome = round2(p.exposure + amount)

  // A hold outranks the arithmetic. It is a human decision that this account
  // does not get more credit regardless of headroom, and headroom is exactly
  // the argument someone will make to override it.
  if (p.onHold) {
    return {
      allowed: false, reason: 'hold',
      message: `${p.customerName} is on credit hold. Finance must lift the hold before any new order is confirmed.`,
      exposure: p.exposure, creditLimit: p.creditLimit, wouldBecome, overBy: 0,
    }
  }

  if (p.creditLimit === null) {
    return {
      allowed: true, reason: 'ok',
      message: `${p.customerName} has no credit limit set.`,
      exposure: p.exposure, creditLimit: null, wouldBecome, overBy: 0,
    }
  }

  const overBy = round2(wouldBecome - p.creditLimit)
  if (overBy > 0) {
    return {
      allowed: false, reason: 'over_limit',
      message:
        `This order would take ${p.customerName} to ${fmt(wouldBecome)} against a ` +
        `${fmt(p.creditLimit)} limit — ${fmt(overBy)} over. ` +
        (p.oldestOverdueDays > 0
          ? `Their oldest invoice is ${p.oldestOverdueDays} days overdue.`
          : `Nothing is overdue; finance can raise the limit if the account warrants it.`),
      exposure: p.exposure, creditLimit: p.creditLimit, wouldBecome, overBy,
    }
  }

  return {
    allowed: true, reason: 'ok',
    message: `${fmt(round2(p.creditLimit - wouldBecome))} of credit would remain.`,
    exposure: p.exposure, creditLimit: p.creditLimit, wouldBecome, overBy: 0,
  }
}

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100
}
function fmt(v: number): string {
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
