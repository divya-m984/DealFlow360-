// OWNER: D1.  List and create quotations.
import { z } from 'zod'
import { q, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { recomputeQuotation, audit } from '@/lib/quotation'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin'] as const

// ── GET /api/quotations ────────────────────────────────────────────
// Screen 3 (kanban + table).  PS §A7 filter set: period, sales team / rep,
// approval status, product / category.
export const GET = withAuth([...INTERNAL], async (req) => {
  const p = new URL(req.url).searchParams
  const where: string[] = []
  const args: unknown[] = []

  /** Push a value, get back its `$n` placeholder. */
  const bind = (v: unknown) => `$${args.push(v)}`

  if (p.get('state')) where.push(`q.state = ${bind(p.get('state'))}::quotation_state`)
  if (p.get('ownerId')) where.push(`q.owner_user_id = ${bind(Number(p.get('ownerId')))}`)
  if (p.get('teamId')) where.push(`u.team_id = ${bind(Number(p.get('teamId')))}`)
  if (p.get('customerId')) where.push(`q.customer_id = ${bind(Number(p.get('customerId')))}`)
  if (p.get('band')) where.push(`q.risk_band = ${bind(p.get('band'))}::risk_band`)
  if (p.get('from')) where.push(`q.created_at >= ${bind(p.get('from'))}`)
  if (p.get('to')) where.push(`q.created_at <= ${bind(p.get('to'))}`)
  if (p.get('search')) {
    const s = bind(`%${p.get('search')}%`) // one placeholder, used twice
    where.push(`(q.number ILIKE ${s} OR c.name ILIKE ${s})`)
  }

  const clause = where.length ? 'WHERE ' + where.join(' AND ') : ''

  return ok(
    await q(
      `SELECT q.id, q.public_id, q.number, q.state, q.version,
              q.risk_score, q.risk_band, q.requires_manager, q.requires_finance,
              q.grand_total, q.margin_total, q.currency_code,
              q.created_at, q.last_activity_at,
              c.name AS customer_name, t.name AS tier_name,
              u.full_name AS owner_name, st.name AS team_name
         FROM quotation q
         JOIN customer c      ON c.id = q.customer_id
         JOIN customer_tier t ON t.id = c.tier_id
         JOIN app_user u      ON u.id = q.owner_user_id
         LEFT JOIN sales_team st ON st.id = u.team_id
         ${clause}
        ORDER BY q.last_activity_at DESC`,
      args,
    ),
  )
})

// ── POST /api/quotations ───────────────────────────────────────────
const NewQuotation = z.strictObject({
  customerId: z.number().int().positive(),
})

export const POST = withAuth([...INTERNAL], async (req, session) => {
  const { customerId } = await parseBody(req, NewQuotation)

  return tx(async (c) => {
    const { rows: cust } = await c.query<{ id: number; currency_code: string; tier_id: number }>(
      `SELECT id, currency_code, tier_id FROM customer WHERE id = $1 AND is_active`,
      [customerId],
    )
    if (!cust[0]) return fail('No such customer', 404)

    // The customer's tier picks the pricelist.  PS §A2.
    const { rows: pl } = await c.query<{ id: number }>(
      `SELECT id FROM pricelist WHERE tier_id = $1 AND is_active ORDER BY id LIMIT 1`,
      [cust[0].tier_id],
    )

    // Number is derived from the identity value so it cannot collide, and is
    // offset past the seeded Q-10xx range.
    const { rows: created } = await c.query<{ id: number }>(
      `INSERT INTO quotation (number, customer_id, owner_user_id, pricelist_id, currency_code, state)
       VALUES ('TMP-' || gen_random_uuid(), $1, $2, $3, $4, 'draft') RETURNING id`,
      [customerId, session.userId, pl[0]?.id ?? null, cust[0].currency_code],
    )
    const id = created[0].id

    const { rows: final } = await c.query(
      `UPDATE quotation SET number = 'Q-' || (2000 + id) WHERE id = $1 RETURNING *`,
      [id],
    )

    await audit(c, 'quotation', id, 'created', session.userId, 'Quotation created')
    // No lines yet, so this scores 0 / LOW — but run it anyway so a fresh
    // quotation is never in a state recompute has not touched.
    await recomputeQuotation(c, id, { termsChanged: false })

    return ok(final[0], 201)
  })
})
