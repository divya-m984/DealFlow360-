// OWNER: D2.  Ship what has been reserved.
//
// qty_on_hand and qty_reserved both come down by the same amount, so
// qty_available — a GENERATED column — does not move.  That is correct and
// worth saying out loud: shipping does not free up stock, because the stock
// was already spoken for the moment it was reserved.
import { tx } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { shipOrder, recomputeOrderState } from '../../_stock'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withAuth<Ctx>(null, async (_req, session, { params }) => {
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

    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('sales_order', $1, 'fulfilment_ship', $2, $3, $4)`,
      [orderId, session.userId, `Shipped ${shipped} allocation(s)`, JSON.stringify({ shipped, state })],
    )

    return { orderId, shipped, state }
  })

  return ok(result)
})
