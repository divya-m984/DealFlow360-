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
 * Invoice the ORDER-POLICY one-time lines of an order, at confirmation.
 * PS §B7: one order, two kinds of line, billed by different mechanisms —
 * this is the one-off half.  Recurring lines are billed by their
 * subscription instead.
 *
 * ⚠ NARROWED for jury review 2, ask 6.  This used to bill EVERY one-time
 * line the moment the order was created.  That produced an invoice for 100
 * laptops on an order that could only ship 70 — the exact thing the jury
 * asked us to stop doing — and it did it before anyone could choose
 * otherwise, because POST /api/orders calls this automatically.
 *
 * It now bills only lines whose product is invoice_policy='order' (services,
 * warranties — things that do not ship and are earned on commitment).
 * Goods are invoice_policy='delivery' and are billed by
 * createDeliveryInvoice() as they actually ship.  This is Odoo's split, and
 * it is a property of the product rather than a decision taken per order.
 *
 * Returns null when the order has no order-policy one-time lines, which is
 * entirely normal — a pure-hardware order bills nothing at confirmation —
 * and is not an error.
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

  // Only lines that have not been billed yet.  The old blanket "has this
  // order any one_time invoice?" guard is gone: with partial invoicing an
  // order legitimately has several, and that guard would have refused every
  // one after the first.  qty_invoiced is the real, per-line record of what
  // has been billed, so it is what we check.
  const lines = await c.query(
    `SELECT sol.id, p.name, sol.qty, sol.unit_price, sol.net_amount
       FROM sales_order_line sol
       JOIN quotation_line ql ON ql.id = sol.quotation_line_id
       JOIN product p ON p.id = sol.product_id
      WHERE sol.order_id = $1
        AND ql.line_type = 'one_time'
        AND p.invoice_policy = 'order'
        AND sol.qty_invoiced < sol.qty
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
      `INSERT INTO invoice_line (invoice_id, order_line_id, description, qty, unit_price, amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [inv.rows[0].id, l.id, l.name, l.qty, l.unit_price, l.net_amount],
    )
    // Keeps qty_invoiced authoritative across BOTH invoicing paths.  Without
    // this, a later createDeliveryInvoice() would see qty_invoiced = 0 on a
    // service line and bill it a second time.
    await c.query(
      `UPDATE sales_order_line SET qty_invoiced = qty WHERE id = $1`,
      [l.id],
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

/** lib/db.ts parses `date` as a string, so this is normally a passthrough.
 *  The Date branch builds from LOCAL components — toISOString() would convert
 *  a local-midnight date to UTC and land on the previous day. */
function fmtDate(d: Date | string): string {
  if (d instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  return String(d).slice(0, 10)
}

// ═══════════════════════════════════════════════════════════════════════
// PARTIAL INVOICING — jury review 2: "the shop has only 70 laptops but they
// get an order for 100.  Satisfy the 70 first and give them a proper
// invoice.  Then when they restock, give back the other 30."
// ═══════════════════════════════════════════════════════════════════════
//
// ── WHY createOrderInvoice() COULD NOT JUST BE LOOSENED ──────────────
// createOrderInvoice() above bills an order ONCE, for everything, and throws
// on a second attempt.  That is "invoice what was ordered" and it is still
// correct for services and subscriptions.  It is wrong for goods, because it
// forces a choice between billing for 100 laptops when 70 shipped, or
// billing nothing until all 100 do.  Both are wrong answers to a real
// customer.  So this is a SECOND path, not a replacement, and which one
// applies is a property of the PRODUCT (product.invoice_policy), exactly as
// it is in Odoo.
//
// ── THE ARITHMETIC, AND WHERE IT IS ENFORCED ─────────────────────────
//   qty_shipped     = SUM(fulfillment_allocation.qty) WHERE status='shipped'
//   qty_to_invoice  = (policy='order' ? qty_ordered : qty_shipped) − qty_invoiced
//
// qty_invoiced is a real column on sales_order_line with a CHECK that it can
// never exceed qty_ordered, so double-billing is impossible at the DATABASE
// and not merely unlikely in a handler.  The tighter bound — never bill more
// than SHIPPED — is dynamic and lives here, because only this query can see
// the shipped quantity.
//
// ── THE ROUNDING TRAP ────────────────────────────────────────────────
// Billing 70 of 100 as net_amount × 70/100 and the rest as × 30/100 can miss
// the order total by a paisa, and an order that never reaches "fully
// invoiced" because of a rounding remainder is a bug a customer eventually
// finds.  So the CLOSING invoice for a line is not prorated at all: it is
// billed as (line total − everything already billed against that line).
// The parts therefore always sum to exactly the whole.

export type InvoicePolicy = 'order' | 'delivery'

/** Odoo's four states, same names and same meanings.  'upselling' is not an
 *  error — it is more delivered than ordered, which the allocator can
 *  legitimately produce on a consolidated backorder. */
export type OrderInvoiceStatus = 'no' | 'to_invoice' | 'invoiced' | 'upselling'

export type InvoiceableLine = {
  orderLineId: number
  sku: string
  productName: string
  policy: InvoicePolicy
  qtyOrdered: number
  qtyShipped: number
  qtyInvoiced: number
  qtyToInvoice: number
  /** Already billed against this line, across every non-void invoice. */
  amountInvoiced: number
  lineTotal: number
  /** What billing it right now would add. Exact on the closing invoice. */
  amountToInvoice: number
  /** Why qtyToInvoice is 0, for a UI that has to explain itself. */
  blockedReason: string | null
}

/**
 * What can be billed on this order right now, line by line.  Read-only —
 * safe to call from a GET.  Recurring lines are excluded throughout: they
 * are billed by their subscription, which is the whole point of §B7.
 */
export async function getInvoiceableLines(
  c: PoolClient,
  orderId: number,
): Promise<InvoiceableLine[]> {
  const r = await c.query(
    `SELECT sol.id,
            p.sku, p.name, p.invoice_policy,
            sol.qty::float8            AS qty_ordered,
            sol.qty_invoiced::float8   AS qty_invoiced,
            sol.net_amount::float8     AS line_total,
            COALESCE(ship.qty, 0)::float8 AS qty_shipped,
            COALESCE(billed.amt, 0)::float8 AS amount_invoiced
       FROM sales_order_line sol
       JOIN quotation_line ql ON ql.id = sol.quotation_line_id
       JOIN product p         ON p.id  = sol.product_id
       LEFT JOIN (
         SELECT order_line_id, SUM(qty) AS qty
           FROM fulfillment_allocation
          WHERE status = 'shipped'
          GROUP BY order_line_id
       ) ship ON ship.order_line_id = sol.id
       LEFT JOIN (
         -- A voided invoice never billed anything, so its lines must not
         -- count against what is still owed.  Without this filter, voiding
         -- an invoice would permanently strand the quantity it covered.
         SELECT il.order_line_id, SUM(il.amount) AS amt
           FROM invoice_line il
           JOIN invoice i ON i.id = il.invoice_id
          WHERE i.status <> 'void' AND il.order_line_id IS NOT NULL
          GROUP BY il.order_line_id
       ) billed ON billed.order_line_id = sol.id
      WHERE sol.order_id = $1
        AND ql.line_type = 'one_time'
      ORDER BY sol.id`,
    [orderId],
  )

  return r.rows.map((row) => {
    const policy = row.invoice_policy as InvoicePolicy
    const qtyOrdered = Number(row.qty_ordered)
    const qtyShipped = Number(row.qty_shipped)
    const qtyInvoiced = Number(row.qty_invoiced)
    const lineTotal = Number(row.line_total)
    const amountInvoiced = Number(row.amount_invoiced)

    // 'order' bills the whole line up front; 'delivery' bills only what has
    // physically left a warehouse.
    const billable = policy === 'order' ? qtyOrdered : Math.min(qtyShipped, qtyOrdered)
    const qtyToInvoice = Math.max(0, round3(billable - qtyInvoiced))

    // The closing invoice is billed as the remainder, never prorated — see
    // "THE ROUNDING TRAP" above.
    const closesLine = qtyToInvoice > 0 && round3(qtyInvoiced + qtyToInvoice) >= qtyOrdered
    const amountToInvoice =
      qtyToInvoice === 0
        ? 0
        : closesLine
          ? round2(lineTotal - amountInvoiced)
          : round2((lineTotal * qtyToInvoice) / qtyOrdered)

    let blockedReason: string | null = null
    if (qtyToInvoice === 0) {
      if (qtyInvoiced >= qtyOrdered) blockedReason = 'Fully invoiced'
      else if (policy === 'delivery' && qtyShipped === 0)
        blockedReason = 'Nothing shipped yet — this line bills on delivery'
      else if (policy === 'delivery')
        blockedReason = `Shipped ${qtyShipped} of ${qtyOrdered}, all of it already invoiced`
      else blockedReason = 'Nothing outstanding'
    }

    return {
      orderLineId: Number(row.id),
      sku: row.sku,
      productName: row.name,
      policy,
      qtyOrdered,
      qtyShipped,
      qtyInvoiced,
      qtyToInvoice,
      amountInvoiced,
      lineTotal,
      amountToInvoice,
      blockedReason,
    }
  })
}

/**
 * Odoo's invoice_status for the order as a whole, derived from the lines.
 * Never stored — deriving it means it cannot drift from the invoices the way
 * a cached column would.
 */
export function deriveOrderInvoiceStatus(lines: InvoiceableLine[]): OrderInvoiceStatus {
  if (lines.length === 0) return 'no'
  // Delivered MORE than ordered: a genuine upsell opportunity, not an error.
  if (lines.some((l) => l.qtyShipped > l.qtyOrdered)) return 'upselling'
  if (lines.some((l) => l.qtyToInvoice > 0)) return 'to_invoice'
  if (lines.every((l) => l.qtyInvoiced >= l.qtyOrdered)) return 'invoiced'
  return 'no'
}

export type PartialInvoiceResult = {
  id: number
  number: string
  amount: number
  isPartial: boolean
  sequenceNo: number
  lines: { orderLineId: number; sku: string; qty: number; amount: number }[]
  /** Still outstanding on the order AFTER this invoice. */
  remaining: { sku: string; qtyOutstanding: number }[]
}

/**
 * Bill everything currently billable on this order — no more.  Call it again
 * after the next shipment and it bills the next slice.  The jury's case is
 * two calls: one at 70 shipped, one after the backorder is consolidated.
 *
 * Returns null when there is nothing to bill, which is a normal state (the
 * order is fully invoiced, or nothing has shipped yet) and not an error.
 */
export async function createDeliveryInvoice(
  c: PoolClient,
  orderId: number,
  opts: { dueInDays?: number } = {},
): Promise<PartialInvoiceResult | null> {
  const ord = await c.query(
    `SELECT id, number, customer_id, currency_code FROM sales_order WHERE id = $1 FOR UPDATE`,
    [orderId],
  )
  if (ord.rowCount === 0) throw new Error(`No order with id ${orderId}`)
  const o = ord.rows[0]

  const all = await getInvoiceableLines(c, orderId)
  const billable = all.filter((l) => l.qtyToInvoice > 0)
  if (billable.length === 0) return null

  const total = billable.reduce((t, l) => round2(t + l.amountToInvoice), 0)

  // Which invoice this is for the order: 1st, 2nd, … Void invoices still
  // consumed a sequence number, so they are counted — the sequence is a
  // history of attempts, not a renumbering of survivors.
  const seq = await c.query(
    `SELECT count(*)::int + 1 AS n FROM invoice WHERE order_id = $1`,
    [orderId],
  )
  const sequenceNo = seq.rows[0].n as number

  // Does this invoice close the order out, or is more still coming?
  const closesOrder = all.every(
    (l) => round3(l.qtyInvoiced + l.qtyToInvoice) >= l.qtyOrdered,
  )

  const inv = await c.query(
    `INSERT INTO invoice (number, customer_id, order_id, kind, currency_code,
                          amount_total, status, issue_date, due_date,
                          is_partial, sequence_no)
     VALUES ($1, $2, $3, 'one_time', $4, $5, 'unpaid', CURRENT_DATE,
             (CURRENT_DATE + ($6 || ' days')::interval)::date, $7, $8)
     RETURNING id, number`,
    [
      await nextNumber(c, 'INV', 'invoice'),
      o.customer_id,
      orderId,
      o.currency_code,
      total,
      opts.dueInDays ?? 15,
      !closesOrder,
      sequenceNo,
    ],
  )
  const invoiceId = Number(inv.rows[0].id)

  for (const l of billable) {
    // The description carries the slice, because "Laptop × 70" on an invoice
    // for a 100-unit order is the line a customer telephones about.
    const desc =
      l.qtyToInvoice < l.qtyOrdered
        ? `${l.productName} — ${l.qtyToInvoice} of ${l.qtyOrdered}`
        : l.productName

    await c.query(
      `INSERT INTO invoice_line (invoice_id, order_line_id, description, qty, unit_price, amount)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        invoiceId,
        l.orderLineId,
        desc,
        l.qtyToInvoice,
        l.qtyOrdered === 0 ? 0 : round2(l.lineTotal / l.qtyOrdered),
        l.amountToInvoice,
      ],
    )

    // The CHECK (qty_invoiced <= qty) on this table is what makes
    // double-billing impossible rather than merely unlikely.  If this ever
    // throws, the whole transaction rolls back and no invoice exists.
    await c.query(
      `UPDATE sales_order_line SET qty_invoiced = qty_invoiced + $2 WHERE id = $1`,
      [l.orderLineId, l.qtyToInvoice],
    )
  }

  const after = await getInvoiceableLines(c, orderId)

  return {
    id: invoiceId,
    number: inv.rows[0].number,
    amount: total,
    isPartial: !closesOrder,
    sequenceNo,
    lines: billable.map((l) => ({
      orderLineId: l.orderLineId,
      sku: l.sku,
      qty: l.qtyToInvoice,
      amount: l.amountToInvoice,
    })),
    remaining: after
      .filter((l) => l.qtyOrdered > l.qtyInvoiced)
      .map((l) => ({ sku: l.sku, qtyOutstanding: round3(l.qtyOrdered - l.qtyInvoiced) })),
  }
}

/** Quantities are numeric(12,3) in the schema — match that, or a third
 *  decimal place survives the arithmetic and the CHECK fires on a rounding
 *  artefact rather than on a real overbill. */
function round3(n: number): number {
  return Math.round((n + Number.EPSILON) * 1000) / 1000
}
