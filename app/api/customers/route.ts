// OWNER: D1.  The customer list, for the "New Quotation" picker.
//
// POST /api/quotations has always taken a customerId, but nothing in the UI
// could offer one — there was no way to list customers, so there was no way to
// start a quotation from the app at all. PS §5's flow opens with "Rep opens the
// workspace and creates a new quotation for a customer", and §9 step 2 is
// exactly that, so this is on the demo's critical path.
//
// The tier comes back with each row because it decides the discount ceiling the
// rep will be held to on the very next screen — showing it at the moment they
// pick the customer is cheaper than making them discover it from a rejected
// discount.
import { q } from '@/lib/db'
import { ok, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin'] as const

export const GET = withAuth([...INTERNAL], async (req) => {
  const search = new URL(req.url).searchParams.get('search')
  const args: unknown[] = []
  const where = ['c.is_active']
  if (search) {
    args.push(`%${search}%`)
    where.push(`c.name ILIKE $${args.length}`)
  }

  return ok(
    await q(
      `SELECT c.id, c.name, c.currency_code, c.email,
              t.name AS tier_name, t.max_discount_pct AS tier_ceiling_pct,
              (SELECT count(*) FROM quotation qq WHERE qq.customer_id = c.id)::int AS quotation_count
         FROM customer c
         JOIN customer_tier t ON t.id = c.tier_id
        WHERE ${where.join(' AND ')}
        ORDER BY c.name`,
      args,
    ),
  )
})
