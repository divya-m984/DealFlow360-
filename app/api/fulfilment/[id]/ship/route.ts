// OWNER: D2.  Ship what has been reserved.
//
// qty_on_hand and qty_reserved both come down by the same amount, so
// qty_available — a GENERATED column — does not move.  That is correct and
// worth saying out loud: shipping does not free up stock, because the stock
// was already spoken for the moment it was reserved.
import { tx } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { createOrderInvoice } from '@/lib/invoice'
import { shipOrder, recomputeOrderState } from '../../_stock'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

// RBAC — PS §3: "Finance / Operations User: Manages warehouse fulfillment
// splits and backorder decisions." Committing stock is an operations action,
// not a sales one, so the WRITE endpoints are Finance and Admin.
//
// The READ endpoints stay open to every internal role: §3 also gives the Sales
// Rep "tracks approval status and FULFILMENT PROGRESS" — they need to see
// where their order is, they just do not get to move it.
export const FULFIL_WRITE_ROLES = ['finance', 'admin'] as const

export const POST = withAuth<Ctx>([...FULFIL_WRITE_ROLES], async (_req, session, { params }) => {
  const orderId = Number((await params).id)
  if (!Number.isFinite(orderId)) return fail('Invalid order id', 400)

  const result = await tx(async (c) => {
    const ord = await c.query(`SELECT id, number, state FROM sales_order WHERE id = $1 FOR UPDATE`, [orderId])
    if (ord.rowCount === 0) throw new Error('No such order')
    if (ord.rows[0].state === 'cancelled') throw new Error('That order is cancelled.')

    const shipped = await shipOrder(c, orderId)
    if (shipped === 0) {
      throw new Error('Nothing on this order is reserved yet — reserve the split before shipping it.')
    }
    const state = await recomputeOrderState(c, orderId)

    // BILL WHAT JUST WENT OUT THE DOOR.
    //
    // The invoice is raised HERE rather than at order creation, and raised
    // again on every subsequent shipment, so a part-filled order is billed for
    // the part that was actually delivered.  createOrderInvoice() subtracts
    // what has already been invoiced for each line, so calling it after every
    // shipment can never double-bill a unit; it returns null when this
    // shipment had nothing new to charge for.
    //
    // Same transaction as the stock movement on purpose: stock leaving the
    // warehouse and the customer being charged for it are one event, and a
    // crash between them would either give the goods away or bill for goods
    // still on the shelf.
    const invoice = await createOrderInvoice(c, orderId)

    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('sales_order', $1, 'fulfilment_ship', $2, $3, $4)`,
      [
        orderId,
        session.userId,
        `Shipped ${shipped} allocation(s)` +
          (invoice ? `; invoiced ${invoice.number} for ${invoice.amount}` : '; nothing new to invoice'),
        JSON.stringify({ shipped, state, invoice }),
      ],
    )

    return { orderId, shipped, state, invoice }
  })

  return ok(result)
})
