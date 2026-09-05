// OWNER: D2.  Invoices, payments, and the one place invoice.status is set.
//
// ── THE RULE ─────────────────────────────────────────────────────────
//
//   applyPayment() is the ONLY function in this codebase that writes
//   invoice.status.  Nothing else — no route handler, no seed, no admin
//   screen — may set it.
//
// The reason is that status is not a fact, it is a CONCLUSION about the
// payments:
//
//   SUM(payment.amount) = 0             → unpaid
//   0 < SUM < invoice.amount_total      → partial
//   SUM >= invoice.amount_total         → paid
//
// The moment two places can write it, they can disagree, and an invoice that
// says "paid" with no payments behind it is the single most damaging bug this
// application could ship.  Recording the payment and recomputing the status
// happen in the SAME transaction, so they cannot come apart.
//
// PS §9's eighth and final acceptance step is "record a payment, and check
// that the invoice status updates correctly."  This file is that step.
//
// Every function takes a PoolClient — it can only be called from inside tx().

import type { PoolClient } from 'pg'
import { CYCLE_INTERVAL, type BillingCycle } from './billing'

export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void'

/** Sequential, human-readable, and unique — the UNIQUE constraint is the
 *  backstop if two transactions ever race to the same count. */
async function nextNumber(c: PoolClient, prefix: string, table: string): Promise<string> {
  const r = await c.query(
    `SELECT '${prefix}-' || to_char(now(), 'YYYY') || '-' ||
            lpad(((SELECT count(*) FROM ${table}) + 1)::text, 4, '0') AS n`,
  )
  return r.rows[0].n
}

/**
 * Invoice the one-time lines of an order.  PS §B7: one order, two kinds of
 * line, and they are billed by DIFFERENT mechanisms — this is the one-off
 * half.  Recurring lines are billed by their subscription instead.
 *
 * Returns null when the order has no one-time lines at all, which is a
 * perfectly normal pure-subscription order and not an error.
 */
export async function createOrderInvoice(
  c: PoolClient,
  orderId: number,
  opts: { dueInDays?: number } = {},
): Promise<{ id: number; number: string; amount: number } | null> {
  const ord = await c.query(
    `SELECT id, number, customer_id, currency_code FROM sales_order WHERE id = $1`,
    [orderId],
  )
  if (ord.rowCount === 0) throw new Error(`No order with id ${orderId}`)
  const o = ord.rows[0]

  const existing = await c.query(
    `SELECT id FROM invoice WHERE order_id = $1 AND kind = 'one_time'`,
    [orderId],
  )
  if (existing.rowCount && existing.rowCount > 0) {
    throw new Error(`Order ${o.number} has already been invoiced for its one-time lines.`)
  }

  const lines = await c.query(
    `SELECT sol.id, p.name, sol.qty, sol.unit_price, sol.net_amount
       FROM sales_order_line sol
       JOIN quotation_line ql ON ql.id = sol.quotation_line_id
       JOIN product p ON p.id = sol.product_id
      WHERE sol.order_id = $1 AND ql.line_type = 'one_time'
      ORDER BY sol.id`,
    [orderId],
  )
  if (lines.rowCount === 0) return null

  const total = lines.rows.reduce((t, l) => round2(t + Number(l.net_amount)), 0)

  const inv = await c.query(
    `INSERT INTO invoice (number, customer_id, order_id, kind, currency_code,
                          amount_total, status, issue_date, due_date)
     VALUES ($1, $2, $3, 'one_time', $4, $5, 'unpaid', CURRENT_DATE,
             (CURRENT_DATE + ($6 || ' days')::interval)::date)
     RETURNING id, number`,
    [await nextNumber(c, 'INV', 'invoice'), o.customer_id, orderId, o.currency_code, total, opts.dueInDays ?? 0],
  )

  for (const l of lines.rows) {
    await c.query(
      `INSERT INTO invoice_line (invoice_id, description, qty, unit_price, amount)
       VALUES ($1, $2, $3, $4, $5)`,
      [inv.rows[0].id, l.name, l.qty, l.unit_price, l.net_amount],
    )
  }

  return { id: inv.rows[0].id, number: inv.rows[0].number, amount: total }
}

/**
 * Invoice one period of a subscription.  Separate from the order invoice on
 * purpose — screen 10 shows the two side by side and the separation IS the
 * screen.
 */
export async function createSubscriptionInvoice(
  c: PoolClient,
  subscriptionId: number,
): Promise<{ id: number; number: string; amount: number }> {
  const s = await c.query(
    `SELECT s.id, s.customer_id, s.qty, s.current_period_start, s.current_period_end,
            p.name AS plan_name, p.price, p.cycle, p.currency_code
       FROM subscription s
       JOIN subscription_plan p ON p.id = s.plan_id
      WHERE s.id = $1`,
    [subscriptionId],
  )
  if (s.rowCount === 0) throw new Error(`No subscription with id ${subscriptionId}`)
  const sub = s.rows[0]

  const amount = round2(Number(sub.price) * Number(sub.qty))
  const cycle = sub.cycle as BillingCycle
  if (!CYCLE_INTERVAL[cycle]) throw new Error(`Unknown billing cycle: ${cycle}`)

  const inv = await c.query(
    `INSERT INTO invoice (number, customer_id, subscription_id, kind, currency_code,
                          amount_total, status, issue_date, due_date)
     VALUES ($1, $2, $3, 'recurring', $4, $5, 'unpaid', CURRENT_DATE, $6)
     RETURNING id, number`,
    [
      await nextNumber(c, 'INV', 'invoice'),
      sub.customer_id, subscriptionId, sub.currency_code, amount, sub.current_period_end,
    ],
  )

  await c.query(
    `INSERT INTO invoice_line (invoice_id, description, qty, unit_price, amount)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      inv.rows[0].id,
      `${sub.plan_name} · ${fmtDate(sub.current_period_start)} → ${fmtDate(sub.current_period_end)}`,
      sub.qty, sub.price, amount,
    ],
  )

  return { id: inv.rows[0].id, number: inv.rows[0].number, amount }
}

export type PaymentResult = {
  invoiceId: number
  paymentId: number
  amountTotal: number
  amountPaid: number
  amountDue: number
  status: InvoiceStatus
  /** True when THIS payment is the one that settled the invoice. */
  settled: boolean
}

/**
 * Record a payment and recompute the invoice status — the only path by which
 * invoice.status ever changes.
 *
 * The invoice row is locked FOR UPDATE first, so two payments arriving at the
 * same moment cannot both read "outstanding 500" and both be accepted.
 */
export async function applyPayment(
  c: PoolClient,
  invoiceId: number,
  p: { amount: number; method: 'bank' | 'cash' | 'card'; reference?: string | null },
): Promise<PaymentResult> {
  const inv = await c.query(
    `SELECT id, number, amount_total, status FROM invoice WHERE id = $1 FOR UPDATE`,
    [invoiceId],
  )
  if (inv.rowCount === 0) throw new Error(`No invoice with id ${invoiceId}`)
  const i = inv.rows[0]
  if (i.status === 'void') throw new Error(`Invoice ${i.number} is void and cannot take a payment.`)
  if (!(p.amount > 0)) throw new Error('A payment must be for more than zero.')

  const prior = await c.query(
    `SELECT COALESCE(SUM(amount), 0) AS paid FROM payment WHERE invoice_id = $1`,
    [invoiceId],
  )
  const alreadyPaid = Number(prior.rows[0].paid)
  const total = Number(i.amount_total)
  const outstanding = round2(total - alreadyPaid)

  if (p.amount > outstanding + 1e-9) {
    throw new Error(
      `Invoice ${i.number} has ₹${outstanding.toFixed(2)} outstanding; ` +
      `a payment of ₹${p.amount.toFixed(2)} would overpay it.`,
    )
  }

  const pay = await c.query(
    `INSERT INTO payment (invoice_id, amount, method, reference)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [invoiceId, p.amount, p.method, p.reference ?? null],
  )

  const status = await recomputeInvoiceStatus(c, invoiceId)
  const amountPaid = round2(alreadyPaid + p.amount)

  return {
    invoiceId,
    paymentId: pay.rows[0].id,
    amountTotal: total,
    amountPaid,
    amountDue: round2(total - amountPaid),
    status,
    settled: status === 'paid',
  }
}

/**
 * Derive status from the payments and write it.  PRIVATE to this module by
 * convention — it is exported only so that a migration or a repair script has
 * a way in, and nothing in app/ calls it directly.
 */
export async function recomputeInvoiceStatus(
  c: PoolClient,
  invoiceId: number,
): Promise<InvoiceStatus> {
  const r = await c.query(
    `UPDATE invoice i
        SET status = CASE
              WHEN i.status = 'void' THEN 'void'::invoice_status
              WHEN paid.total >= i.amount_total THEN 'paid'::invoice_status
              WHEN paid.total > 0 THEN 'partial'::invoice_status
              ELSE 'unpaid'::invoice_status
            END
       FROM (SELECT COALESCE(SUM(amount), 0) AS total
               FROM payment WHERE invoice_id = $1) paid
      WHERE i.id = $1
      RETURNING i.status`,
    [invoiceId],
  )
  return r.rows[0].status as InvoiceStatus
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function fmtDate(d: Date | string): string {
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
  return s
}
