// OWNER: D2.  Turn a planned split into held stock.
//
// This is the concurrency-critical write in the whole application: two reps
// confirming orders for the last laptop at the same instant must not both
// succeed.  The mechanics are in reserveOrder() in ../../_stock.ts —
// SELECT … FOR UPDATE in stock_level.id order, then increment qty_reserved
// while the lock is held.
//
// The schema's CHECK (qty_reserved <= qty_on_hand) is the backstop underneath
// that.  If it ever fires, Postgres has stopped us overselling, and the job of
// this handler is to turn 23514 into a sentence a salesperson can act on
// rather than a 500.
import { tx } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { reserveOrder, recomputeOrderState } from '../../_stock'

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

  try {
    const result = await tx(async (c) => {
      const ord = await c.query(`SELECT id, number, state FROM sales_order WHERE id = $1 FOR UPDATE`, [orderId])
      if (ord.rowCount === 0) throw new Error('No such order')
      if (ord.rows[0].state === 'cancelled') throw new Error('That order is cancelled.')

      const res = await reserveOrder(c, orderId)
      const state = await recomputeOrderState(c, orderId)

      await c.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
         VALUES ('sales_order', $1, 'fulfilment_reserve', $2, $3, $4)`,
        [orderId, session.userId,
         `Reserved ${res.reserved} allocation(s)` + (res.shortfalls.length ? `, ${res.shortfalls.length} short` : ''),
         JSON.stringify(res)],
      )

      return { orderId, state, ...res }
    })

    // A partial reservation is not a failure — some warehouses held, some did
    // not, and the user needs to see which.
    return ok(result, result.shortfalls.length > 0 ? 207 : 200)
  } catch (e: any) {
    if (e?.code === '23514' && String(e?.constraint) === 'cannot_reserve_more_than_held') {
      return fail(
        'Cannot reserve more stock than the warehouse holds. Recompute the split and try again — ' +
        'someone else reserved these units first.',
        409,
      )
    }
    throw e
  }
})
