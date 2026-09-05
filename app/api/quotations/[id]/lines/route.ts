// OWNER: D1.  Add a line to a quotation.
//
// Every write in this file is a COMMERCIAL TERM change, so every one of them
// ends in recomputeQuotation({ termsChanged: true }) — which bumps the version
// and thereby orphans any approval the quotation already had. That is Law 1
// doing its job: nobody sets a flag, and nobody has to remember to clear one.
import { z } from 'zod'
import { tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { recomputeQuotation, audit } from '@/lib/quotation'
import { isApproved } from '@/lib/approval'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin'] as const
type Ctx = { params: Promise<{ id: string }> }

const NewLine = z.strictObject({
  productId: z.number().int().positive(),
  variantId: z.number().int().positive().nullable().optional(),
  qty: z.number().positive(),
  discountPct: z.number().min(0).max(100).default(0),
  lineType: z.enum(['one_time', 'recurring']).default('one_time'),
  subscriptionPlanId: z.number().int().positive().nullable().optional(),
})

export const POST = withAuth<Ctx>([...INTERNAL], async (req, session, ctx) => {
  const id = Number((await ctx.params).id)
  const body = await parseBody(req, NewLine)

  return tx(async (c) => {
    const { rows: qq } = await c.query<{ id: number; state: string; customer_id: number }>(
      `SELECT id, state, customer_id FROM quotation WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (!qq[0]) return fail('Quotation not found', 404)
    if (['confirmed', 'rejected', 'cancelled', 'expired'].includes(qq[0].state)) {
      return fail(`A ${qq[0].state} quotation cannot be edited`, 409)
    }

    const { rows: prod } = await c.query<{
      id: number; base_price: string; cost: string; tax_pct: string
      is_subscription: boolean; recurring_cycle: string | null
    }>(
      `SELECT id, base_price, cost, tax_pct, is_subscription, recurring_cycle
         FROM product WHERE id = $1 AND is_active`,
      [body.productId],
    )
    if (!prod[0]) return fail('No such product', 404)

    // The schema's recurring_needs_plan CHECK requires line_type = 'recurring'
    // IFF subscription_plan_id is set. Reject the impossible pair here — a raw
    // constraint error is not a message anyone can act on.
    let planId = body.subscriptionPlanId ?? null
    if (body.lineType === 'recurring' && !planId) {
      const { rows: plan } = await c.query<{ id: number }>(
        `SELECT id FROM subscription_plan
          WHERE is_active AND cycle = $1::billing_cycle ORDER BY id LIMIT 1`,
        [prod[0].recurring_cycle],
      )
      if (!plan[0]) return fail('This product has no matching subscription plan', 400)
      planId = plan[0].id
    }
    if (body.lineType === 'one_time' && planId) {
      return fail('A one-time line cannot carry a subscription plan', 400)
    }

    // Variant surcharge rides on the unit price (PS §A2: "Values, Extra prices").
    let unitPrice = Number(prod[0].base_price)
    if (body.variantId) {
      const { rows: v } = await c.query<{ extra_price: string }>(
        `SELECT extra_price FROM product_variant WHERE id = $1 AND product_id = $2 AND is_active`,
        [body.variantId, body.productId],
      )
      if (!v[0]) return fail('No such variant for this product', 404)
      unitPrice += Number(v[0].extra_price)
    }

    const { rows: nextNo } = await c.query<{ n: number }>(
      `SELECT COALESCE(MAX(line_no), 0) + 1 AS n FROM quotation_line WHERE quotation_id = $1`,
      [id],
    )

    // ceiling_pct is SNAPSHOTTED now, not looked up later. If an admin edits a
    // tier ceiling tomorrow, an already-scored quotation must not silently
    // change its own risk.
    const { rows: line } = await c.query(
      `INSERT INTO quotation_line
         (quotation_id, line_no, product_id, variant_id, line_type, subscription_plan_id,
          qty, unit_price, unit_cost, discount_pct, ceiling_pct, tax_pct)
       SELECT $1, $2, $3, $4, $5::line_type, $6, $7, $8, p.cost, $9,
              effective_ceiling_pct(cu.tier_id, p.category_id), p.tax_pct
         FROM product p, customer cu
        WHERE p.id = $3 AND cu.id = $10
       RETURNING *`,
      [id, nextNo[0].n, body.productId, body.variantId ?? null, body.lineType, planId,
       body.qty, unitPrice, body.discountPct, qq[0].customer_id],
    )

    await audit(c, 'quotation', id, 'line_added', session.userId,
      `Line ${nextNo[0].n} added at ${body.discountPct}% discount`)

    const recompute = await recomputeQuotation(c, id, {
      termsChanged: true, actorUserId: session.userId,
    })

    // Adding a line to an approved quotation invalidates that approval.
    if (!(await isApproved(c, id))) {
      await c.query(
        `UPDATE quotation SET state = 'draft'
          WHERE id = $1 AND state IN ('approved','pending_approval','negotiation')`,
        [id],
      )
    }

    return ok({ line: line[0], recompute }, 201)
  })
})
