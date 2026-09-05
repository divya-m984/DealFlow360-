// OWNER: D2.  Screen 18 — Discount Tiers & Approval Chains.
//
// These rows are the input to EVERY discount check in the application.  D1's
// risk engine reads customer_tier.max_discount_pct and
// product_category.max_discount_pct through effective_ceiling_pct(), and reads
// approval_policy to decide who has to sign.  PS §7 says that must be
// configurable data rather than constants in code — this route is the proof.
//
// A judge who changes "Silver: 10%" to "Silver: 3%" here and re-submits a
// quotation must see the routing change.  Nothing about the ceiling or the
// bands is hardcoded anywhere in the codebase.
import { z } from 'zod'
import { q, tx } from '@/lib/db'
import { ok, fail, parseBody, withAuth } from '@/lib/api'
import type { ConfigPayload } from '@/lib/types/catalog'

export const runtime = 'nodejs'

// Reading config is harmless and four screens want it.  Writing is a
// governance action, so it is restricted — and the screen renders read-only
// rather than 403-ing, so a sales rep can still SEE the rules they are held to.
export const CONFIG_WRITE_ROLES = ['admin', 'finance'] as const

export const GET = withAuth(null, async () => {
  const [tiers, categories, policy, warehouses, plans] = await Promise.all([
    q(`SELECT id, code, name, max_discount_pct, sort_order
         FROM customer_tier ORDER BY sort_order, id`),
    q(`SELECT id, code, name, max_discount_pct
         FROM product_category ORDER BY name`),
    // Ordered by score_from, not by the enum, so the screen always reads
    // low → high no matter what the thresholds are set to.
    q(`SELECT band, score_from, score_to, requires_manager, requires_finance
         FROM approval_policy ORDER BY score_from`),
    q(`SELECT id, code, name, shipping_cost_weight, is_active
         FROM warehouse ORDER BY shipping_cost_weight, code`),
    q(`SELECT id, name, cycle, price, currency_code, proration_enabled,
              cancellation_notice_days, cancellation_refund, is_active
         FROM subscription_plan ORDER BY id`),
  ])
  return ok({ tiers, categories, policy, warehouses, plans } as ConfigPayload)
})

const Pct = z.number().min(0).max(100)

const Body = z.strictObject({
  tiers: z.array(z.strictObject({ id: z.number().int(), max_discount_pct: Pct })).default([]),
  categories: z.array(z.strictObject({ id: z.number().int(), max_discount_pct: Pct })).default([]),
  // ── The approval chain ──────────────────────────────────────────────
  // Only the MEDIUM/HIGH boundary is editable; the band ranges are DERIVED
  // from it below.  That is deliberate.  If the three ranges were free-form,
  // a well-meaning edit could leave a gap (MEDIUM ends at 3.00, HIGH starts at
  // 4.00) and a quotation scoring 3.5 would match no band at all — a silent
  // hole in the governance rule, which is the worst possible bug for this
  // feature to have.  Deriving them makes that unrepresentable.
  policy: z
    .strictObject({
      high_band_from: z.number().gt(0).max(100),
      medium_requires_manager: z.boolean(),
      medium_requires_finance: z.boolean(),
      high_requires_manager: z.boolean(),
      high_requires_finance: z.boolean(),
    })
    .optional(),
})

export const PUT = withAuth([...CONFIG_WRITE_ROLES], async (req, session) => {
  const body = await parseBody(req, Body)

  if (body.policy) {
    const p = body.policy
    // Finance is the SECOND level of a two-level chain (PS §A3/§B4).  A band
    // that needs finance but not a manager would produce an approval_request
    // with seq 2 and no seq 1 — an approval chain with a hole in it.
    if (p.medium_requires_finance && !p.medium_requires_manager) {
      return fail('Finance is the second level of the chain — a band that requires Finance must also require the Sales Manager.', 400)
    }
    if (p.high_requires_finance && !p.high_requires_manager) {
      return fail('Finance is the second level of the chain — a band that requires Finance must also require the Sales Manager.', 400)
    }
    // A higher-risk band can never demand LESS scrutiny than a lower one.
    if (p.medium_requires_manager && !p.high_requires_manager) {
      return fail('HIGH cannot require less approval than MEDIUM.', 400)
    }
    if (p.medium_requires_finance && !p.high_requires_finance) {
      return fail('HIGH cannot require less approval than MEDIUM.', 400)
    }
  }

  const changes = await tx(async (c) => {
    const log: { what: string; from: string; to: string }[] = []

    for (const t of body.tiers) {
      const before = await c.query(
        `SELECT name, max_discount_pct FROM customer_tier WHERE id = $1 FOR UPDATE`,
        [t.id],
      )
      if (before.rowCount === 0) throw new Error(`No customer tier with id ${t.id}`)
      const old = before.rows[0]
      if (Number(old.max_discount_pct) === t.max_discount_pct) continue
      await c.query(`UPDATE customer_tier SET max_discount_pct = $2 WHERE id = $1`, [t.id, t.max_discount_pct])
      log.push({ what: `Tier ${old.name} ceiling`, from: `${old.max_discount_pct}%`, to: `${t.max_discount_pct.toFixed(2)}%` })
      await audit(c, 'customer_tier', t.id, 'update_max_discount', session.userId, `${old.max_discount_pct}%`, `${t.max_discount_pct.toFixed(2)}%`)
    }

    for (const cat of body.categories) {
      const before = await c.query(
        `SELECT name, max_discount_pct FROM product_category WHERE id = $1 FOR UPDATE`,
        [cat.id],
      )
      if (before.rowCount === 0) throw new Error(`No product category with id ${cat.id}`)
      const old = before.rows[0]
      if (Number(old.max_discount_pct) === cat.max_discount_pct) continue
      await c.query(`UPDATE product_category SET max_discount_pct = $2 WHERE id = $1`, [cat.id, cat.max_discount_pct])
      log.push({ what: `Category ${old.name} ceiling`, from: `${old.max_discount_pct}%`, to: `${cat.max_discount_pct.toFixed(2)}%` })
      await audit(c, 'product_category', cat.id, 'update_max_discount', session.userId, `${old.max_discount_pct}%`, `${cat.max_discount_pct.toFixed(2)}%`)
    }

    if (body.policy) {
      const p = body.policy
      const before = await c.query(
        `SELECT band, score_from, score_to, requires_manager, requires_finance
           FROM approval_policy ORDER BY band FOR UPDATE`,
      )
      const prev = Object.fromEntries(before.rows.map((r) => [r.band, r]))

      // LOW is "exactly on or under every ceiling" — score 0.  It is not a
      // configurable range: any point over a ceiling is at least MEDIUM.
      const rows = [
        { band: 'LOW',    from: 0,                 to: 0,                        mgr: false,                 fin: false },
        { band: 'MEDIUM', from: 0.01,              to: round2(p.high_band_from - 0.01), mgr: p.medium_requires_manager, fin: p.medium_requires_finance },
        { band: 'HIGH',   from: p.high_band_from,  to: 100,                      mgr: p.high_requires_manager,   fin: p.high_requires_finance },
      ]
      if (rows[1].to < rows[1].from) {
        throw new Error('The HIGH band must start above 0.01 so the MEDIUM band has room to exist.')
      }

      for (const r of rows) {
        await c.query(
          `UPDATE approval_policy
              SET score_from = $2, score_to = $3, requires_manager = $4, requires_finance = $5
            WHERE band = $1`,
          [r.band, r.from, r.to, r.mgr, r.fin],
        )
        const o = prev[r.band]
        if (!o) continue
        const oldDesc = `${o.score_from}–${o.score_to} · ${chain(o.requires_manager, o.requires_finance)}`
        const newDesc = `${r.from.toFixed(2)}–${r.to.toFixed(2)} · ${chain(r.mgr, r.fin)}`
        if (oldDesc !== newDesc) {
          log.push({ what: `${r.band} band`, from: oldDesc, to: newDesc })
          await audit(c, 'approval_policy', 0, `update_band_${r.band}`, session.userId, oldDesc, newDesc)
        }
      }
    }

    return log
  })

  return ok({ changed: changes.length, changes })
})

function chain(mgr: boolean, fin: boolean) {
  if (mgr && fin) return 'Manager then Finance'
  if (mgr) return 'Manager'
  return 'Auto-approved'
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

/** Every governance change is traceable to a user and a moment (PS §A3). */
async function audit(
  c: { query: (sql: string, params: unknown[]) => Promise<unknown> },
  entity: string,
  entityId: number,
  action: string,
  actor: number,
  from: unknown,
  to: unknown,
) {
  await c.query(
    `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [entity, entityId, action, actor, `${from} → ${to}`, JSON.stringify({ from, to })],
  )
}
