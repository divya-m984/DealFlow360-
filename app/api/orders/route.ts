// OWNER: D2.  Confirmed quotation → sales_order.  The handover point where
// D1's lane ends and mine begins.
import { z } from 'zod'
import { q, tx } from '@/lib/db'
import { ok, fail, parseBody, withAuth, BusinessRuleError } from '@/lib/api'
import { INTERNAL_WRITERS } from '@/lib/roles'
import { startSubscription } from '@/lib/billing'
import { createOrderInvoice, createSubscriptionInvoice } from '@/lib/invoice'
import { isStockManaged, suggestPlan, persistPlan, recomputeOrderState } from '../fulfilment/_stock'
import { checkCredit } from '@/lib/credit'

export const runtime = 'nodejs'

export const GET = withAuth(null, async (req) => {
  const url = new URL(req.url)
  const state = url.searchParams.get('state')

  const rows = await q(
    `SELECT o.id, o.number, o.quotation_id, qt.number AS quotation_number,
            o.customer_id, cu.name AS customer_name, o.currency_code, o.state,
            o.promised_delivery_date, o.grand_total, o.created_at,
            (o.promised_delivery_date IS NOT NULL
             AND o.promised_delivery_date < CURRENT_DATE
             AND o.state <> 'fulfilled')                       AS is_late,
            (SELECT count(*)::int FROM backorder b
               JOIN sales_order_line sl ON sl.id = b.order_line_id
              WHERE sl.order_id = o.id AND b.resolved_at IS NULL) AS open_backorders
       FROM sales_order o
       JOIN customer cu ON cu.id = o.customer_id
       JOIN quotation qt ON qt.id = o.quotation_id
      WHERE ($1::text IS NULL OR o.state::text = $1)
      ORDER BY o.created_at DESC, o.id DESC`,
    [state],
  )
  return ok(rows)
})

const Body = z.strictObject({
  quotationId: z.number().int().positive(),
  /** Days from today.  The mockup's progress rail needs a promise to slip against. */
  promisedInDays: z.number().int().min(0).max(365).default(7),
})

// ⚠ CHANGED BY D1 AFTER THE FREEZE — D2, this is your file; flagged rather
// than worked around because it is a live privilege hole, not a preference.
//
// This was `withAuth(null, ...)`, meaning "any authenticated user". That was
// TRUE when it was written: withAuth already refuses portal users on internal
// routes, so `null` meant "any internal user", and every internal role could
// legitimately turn a confirmed quotation into an order.
//
// Adding `viewer` to the Role union changed what `null` MEANS without changing
// a character of this line. Verified against the running app: viewer@dealflow
// .app POSTed here and created SO-2016, allocated stock and put the order into
// `backorder`. The read-only role wrote to the order book.
//
// This is the general hazard with `null` — it is not a permission, it is the
// absence of one, so it silently widens every time the role list grows. Naming
// the roles means the next added role starts with nothing here, which is the
// behaviour the rest of the codebase already relies on.
export const POST = withAuth([...INTERNAL_WRITERS], async (req, session) => {
  const { quotationId, promisedInDays } = await parseBody(req, Body)

  const result = await tx(async (c) => {
    // Lock the quotation.  Confirming the same quotation twice from two tabs
    // is exactly the kind of thing that happens during a demo.
    const qt = await c.query(
      `SELECT id, number, customer_id, currency_code, state, grand_total, version
         FROM quotation WHERE id = $1 FOR UPDATE`,
      [quotationId],
    )
    if (qt.rowCount === 0) throw new Error(`No quotation with id ${quotationId}`)
    const quo = qt.rows[0]
    if (quo.state !== 'confirmed') {
      throw new BusinessRuleError(
        `Quotation ${quo.number} is ${quo.state}. Only a confirmed quotation becomes an order.`,
      )
    }

    const dup = await c.query(`SELECT number FROM sales_order WHERE quotation_id = $1`, [quotationId])
    if (dup.rowCount && dup.rowCount > 0) {
      throw new BusinessRuleError(`Quotation ${quo.number} is already order ${dup.rows[0].number}.`)
    }

    // ── CREDIT CONTROL ──────────────────────────────────────────────
    // The last point at which refusing is still cheap.  Once this returns,
    // stock is allocated and reserved and the customer is expecting goods;
    // discovering a credit breach after that means either eating the risk or
    // retracting a commitment, and organisations reliably choose the first.
    //
    // It runs INSIDE the transaction that locked the quotation, so two reps
    // confirming two deals for the same near-limit customer at the same
    // instant cannot both read the pre-breach exposure and both pass.
    //
    // Deliberately NOT a warning. §7 wants business rules to be real, and a
    // rule that can be clicked past is a label. Finance raises the limit or
    // lifts the hold — both are one edit on the customer, both are recorded.
    const credit = await checkCredit(c, quo.customer_id, Number(quo.grand_total))
    if (!credit.allowed) {
      // 409, not 500 — the request was understood and declined.
      throw new BusinessRuleError(credit.message)
    }

    // SO-1042 from Q-1042.  Derived rather than sequenced, so the order number
    // is readable next to the quotation it came from — and unique for free,
    // because sales_order.quotation_id is UNIQUE.
    const number = 'SO-' + String(quo.number).replace(/^Q[-_]?/i, '')

    const ord = await c.query(
      `INSERT INTO sales_order
         (number, quotation_id, customer_id, currency_code, state,
          promised_delivery_date, grand_total)
       VALUES ($1, $2, $3, $4, 'confirmed',
               (CURRENT_DATE + ($5 || ' days')::interval)::date, $6)
       RETURNING id, number`,
      [number, quotationId, quo.customer_id, quo.currency_code, promisedInDays, quo.grand_total],
    )
    const orderId = Number(ord.rows[0].id)

    // EVERY line becomes an order line, recurring ones included — a
    // subscription links back through sales_order_line.source_order_line_id,
    // so the order stays the single record of what was bought.
    const lines = await c.query(
      `SELECT id, product_id, variant_id, line_type, subscription_plan_id,
              qty, unit_price, net_amount
         FROM quotation_line WHERE quotation_id = $1 ORDER BY line_no`,
      [quotationId],
    )
    if (lines.rowCount === 0) throw new Error(`Quotation ${quo.number} has no lines.`)

    const created = { orderLines: 0, allocated: 0, backordered: 0, subscriptions: [] as number[] }

    for (const l of lines.rows) {
      const sol = await c.query(
        `INSERT INTO sales_order_line
           (order_id, quotation_line_id, product_id, variant_id, qty, unit_price, net_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [orderId, l.id, l.product_id, l.variant_id, l.qty, l.unit_price, l.net_amount],
      )
      const orderLineId = Number(sol.rows[0].id)
      created.orderLines++

      if (l.line_type === 'recurring') {
        const sub = await startSubscription(c, {
          customerId: Number(quo.customer_id),
          planId: Number(l.subscription_plan_id),
          sourceOrderLineId: orderLineId,
          qty: Number(l.qty),
        })
        created.subscriptions.push(sub.id)
        continue
      }

      // A product held in no warehouse is a service — nothing to split.
      if (!(await isStockManaged(c, Number(l.product_id)))) continue

      const plan = await suggestPlan(c, {
        orderLineId,
        productId: Number(l.product_id),
        variantId: l.variant_id === null ? null : Number(l.variant_id),
        qty: Number(l.qty),
      })
      await persistPlan(c, orderLineId, plan)
      created.allocated += plan.allocations.length
      if (plan.backorderQty > 0) created.backordered++
    }

    // Billing, per PS §B7: the two kinds of line are billed by different
    // mechanisms, from the same order.
    //
    // AT CREATION THIS BILLS SERVICES ONLY.  createOrderInvoice() charges for
    // stock-managed lines when they SHIP, and nothing has shipped yet — so on
    // a physical-goods order this returns null and the first invoice appears
    // at the first shipment instead.  Lines held in no warehouse (Onsite
    // Setup, Extended Warranty) have no shipment to wait for and are billed
    // here, in full.  A pure-goods order therefore now leaves this endpoint
    // with no one-time invoice, which is correct and is the whole point of the
    // change: the customer is not charged for 100 laptops on the day 70 of
    // them exist.
    const oneTimeInvoice = await createOrderInvoice(c, orderId)
    const recurringInvoices: { id: number; number: string; amount: number }[] = []
    for (const subId of created.subscriptions) {
      recurringInvoices.push(await createSubscriptionInvoice(c, subId))
    }

    const state = await recomputeOrderState(c, orderId)

    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('sales_order', $1, 'create_from_quotation', $2, $3, $4)`,
      [
        orderId, session.userId,
        `Order ${number} created from quotation ${quo.number} (v${quo.version})`,
        JSON.stringify({ quotationId, ...created, state }),
      ],
    )

    return {
      id: orderId,
      number,
      state,
      ...created,
      oneTimeInvoice,
      recurringInvoices,
    }
  })

  return ok(result, 201)
})
