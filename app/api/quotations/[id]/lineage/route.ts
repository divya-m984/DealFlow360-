// OWNER: D1.  CLAIMED — new path.
//
// JURY REVIEW 2, ASK 5: "When a quotation is updated to a sales bill, how does
// it affect both tables? Will the quotation table lose a value and add
// something new?"
//
// The answer is NO, and the whole point of this endpoint is that we can show
// it rather than assert it. It returns the actual rows on both sides of the
// conversion, plus the constraints that make the guarantee real.
//
// ── THE ANSWER, IN ONE PARAGRAPH ─────────────────────────────────────
// Confirming a quotation writes exactly THREE columns on `quotation`: state,
// confirmed_at, last_activity_at. Nothing is deleted, nothing is emptied, no
// line moves. The order is a SEPARATE row in `sales_order` that points back
// with `quotation_id`, and every `sales_order_line` keeps `quotation_line_id`
// pointing at the line it was copied from. So the quotation survives intact as
// the historical record of what was agreed, at the version it was agreed at,
// and the order is the record of what is being delivered.
//
// ── WHY IT IS A COPY AND NOT A MOVE ──────────────────────────────────
// They are different facts with different lifetimes. A quotation line records
// what was NEGOTIATED — the discount, the ceiling it was measured against, the
// margin at the moment of agreement. An order line records what is being
// SHIPPED, and it goes on to accumulate allocations, backorders and
// qty_invoiced. Moving the row would force one table to mean both things, and
// the first partial shipment would start overwriting the commercial history
// that the approval chain signed off on.
//
// ── THE GUARANTEE IS IN THE SCHEMA, NOT IN THIS CODE ─────────────────
//   sales_order.quotation_id            UNIQUE, FK → quotation(id) RESTRICT
//   sales_order_line.quotation_line_id  FK → quotation_line(id) RESTRICT
//
// UNIQUE is why one quotation can never become two orders. ON DELETE RESTRICT
// is the stronger half: Postgres will REFUSE to delete a quotation that has
// become an order. "The quotation does not lose anything" is therefore not a
// convention this route politely follows — it is enforced one layer below any
// code we could get wrong.
import { q } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { INTERNAL_READERS } from '@/lib/roles'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>([...INTERNAL_READERS], async (_req, session, ctx) => {
  const id = Number((await ctx.params).id)
  if (!Number.isFinite(id)) return fail('Invalid quotation id', 400)

  const [quotation] = await q(
    `SELECT qt.id, qt.number, qt.state, qt.version, qt.confirmed_at, qt.approved_at,
            qt.grand_total, qt.currency_code, qt.owner_user_id,
            (SELECT count(*)::int FROM quotation_line l WHERE l.quotation_id = qt.id) AS line_count
       FROM quotation qt WHERE qt.id = $1`,
    [id],
  )
  if (!quotation) return fail('Quotation not found', 404)

  // Same ownership rule as the detail screen: a rep sees their own deals.
  if (session.role === 'sales_rep' && quotation.owner_user_id !== session.userId) {
    return fail('Quotation not found', 404)
  }

  const [order] = await q(
    `SELECT o.id, o.number, o.state, o.quotation_id, o.created_at, o.grand_total,
            o.promised_delivery_date,
            (SELECT count(*)::int FROM sales_order_line sl WHERE sl.order_id = o.id) AS line_count
       FROM sales_order o WHERE o.quotation_id = $1`,
    [id],
  )

  // The line-by-line correspondence. This is the part that answers the
  // question literally: every quotation line is still there, and each one has
  // an order line pointing back at it by primary key.
  const lines = await q(
    `SELECT ql.id            AS quotation_line_id,
            ql.line_no,
            p.name           AS product_name,
            ql.qty           AS quotation_qty,
            ql.discount_pct,
            ql.net_amount    AS quotation_net,
            sl.id            AS order_line_id,
            sl.qty           AS order_qty,
            sl.qty_invoiced,
            (SELECT COALESCE(sum(fa.qty), 0) FROM fulfillment_allocation fa
              WHERE fa.order_line_id = sl.id)                       AS qty_allocated,
            (SELECT b.qty_outstanding FROM backorder b
              WHERE b.order_line_id = sl.id AND b.resolved_at IS NULL) AS qty_backordered
       FROM quotation_line ql
       JOIN product p ON p.id = ql.product_id
       LEFT JOIN sales_order_line sl ON sl.quotation_line_id = ql.id
      WHERE ql.quotation_id = $1
      ORDER BY ql.line_no`,
    [id],
  )

  const invoices = order
    ? await q(
        `SELECT i.id, i.number, i.sequence_no, i.is_partial, i.amount_total,
                i.status, i.issue_date,
                (SELECT count(*)::int FROM invoice_line il WHERE il.invoice_id = i.id) AS line_count,
                (SELECT COALESCE(sum(pm.amount), 0) FROM payment pm WHERE pm.invoice_id = i.id) AS paid
           FROM invoice i
          WHERE i.order_id = $1
          ORDER BY i.sequence_no, i.id`,
        [order.id],
      )
    : []

  return ok({
    quotation,
    order: order ?? null,
    lines,
    invoices,
    // Shown verbatim in the UI. These are the schema facts a judge can check
    // against `\d sales_order` in psql — the claim and its proof travel
    // together rather than the UI asking to be believed.
    guarantees: [
      {
        claim: 'The quotation keeps every row and every line.',
        proof: 'Confirming writes only state, confirmed_at and last_activity_at. No DELETE, no UPDATE of any line.',
      },
      {
        claim: 'One quotation can never become two orders.',
        proof: 'sales_order.quotation_id is UNIQUE.',
      },
      {
        claim: 'A converted quotation cannot be deleted.',
        proof: 'sales_order.quotation_id REFERENCES quotation(id) ON DELETE RESTRICT — Postgres refuses.',
      },
      {
        claim: 'Every order line remembers the quotation line it came from.',
        proof: 'sales_order_line.quotation_line_id REFERENCES quotation_line(id) ON DELETE RESTRICT.',
      },
    ],
  })
})
