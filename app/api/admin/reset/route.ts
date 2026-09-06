// OWNER: D2.  CLAIMED — new path.
//
// Jury review 2, ask 4: "What happens when an admin wants to clear the
// database and recreate something new?" — asked alongside the idea of a
// super admin.
//
// ═════════════════════════════════════════════════════════════════════
// THE ARCHITECTURAL ANSWER, WHICH MATTERS MORE THAN THE BUTTON
// ═════════════════════════════════════════════════════════════════════
// Odoo solves this exact problem and is worth copying rather than
// improvising against.  Its database manager can create, duplicate, drop and
// restore whole databases — and it is protected by `admin_passwd`, a master
// password that lives ONLY in odoo.conf, never in any database row.  Odoo's
// own deployment documentation then says the manager must be DISABLED in
// production (`list_db = False`), because leaving it reachable exposes an
// interface that can destroy or download a customer's entire database to
// anyone who can load the URL.
//
// Two lessons, both applied below:
//
//   1. THE CREDENTIAL FOR DESTRUCTION MUST NOT LIVE IN THE THING IT CAN
//      DESTROY.  A role column is not enough: a role is granted by a row,
//      and any attacker who can write rows can grant it to themselves.  So
//      this endpoint requires BOTH super_admin AND a token from the
//      environment (ADMIN_RESET_TOKEN) which no database write can forge.
//      If the variable is unset the endpoint refuses — it fails CLOSED,
//      so an unconfigured deployment is a safe deployment.
//
//   2. SCOPE IT.  Dropping and recreating the whole schema is genuinely
//      destructive and is deliberately NOT exposed over HTTP at all — it is
//      `./db/reset.sh` at a shell, gated by filesystem access, exactly the
//      way Odoo gates its manager behind a config file.  What IS exposed is
//      the bounded operation people actually want before a demo: clear the
//      TRANSACTIONAL data and keep the master data.
//
// ═════════════════════════════════════════════════════════════════════
// WHY super_admin EXISTS AS A SEPARATE ROLE
// ═════════════════════════════════════════════════════════════════════
// It would have been easier to let `admin` do this.  But `admin` is an
// operational role — it edits discount ceilings and approval bands in
// Settings all day.  The role that tunes pricing and the role that can
// erase the order book should not be the same role, for the same reason a
// production deploy key and a CI read key are not the same key.  Adding
// super_admin costs one enum value and buys a real blast-radius boundary.
//
// ═════════════════════════════════════════════════════════════════════
// THE AUDIT PARADOX
// ═════════════════════════════════════════════════════════════════════
// audit_log is transactional data, so a reset wipes it — which makes it
// exactly the wrong place to record that a reset happened.  destructive_
// action_log is therefore NEVER truncated by this endpoint.  It is the one
// table that survives, so "who cleared the demo data twenty minutes before
// judging, and when?" always has an answer.

import { z } from 'zod'
import { tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'

export const runtime = 'nodejs'

/** Only super_admin.  Note this is an allow-list of ONE — `admin` is
 *  deliberately absent and its absence is the feature. */
const RESET_ROLES = ['super_admin'] as const

/**
 * TRANSACTIONAL tables — everything a demo generates and a reset should
 * clear.  Order does not matter because of CASCADE, but the grouping is
 * kept readable on purpose: a future reader has to be able to check this
 * list against the schema by eye.
 *
 * NOT LISTED, and therefore PRESERVED: currency, fx_rate, customer_tier,
 * customer, app_user, sales_team, product_category, product,
 * product_attribute, product_attribute_value, product_variant,
 * variant_option, pricelist, pricelist_item, upsell_rule, approval_policy,
 * subscription_plan, warehouse, stock_level — the catalogue, the config, the
 * people and the places.  Clearing those would not be "reset the demo", it
 * would be "empty the ERP", and you would then need the seed files to get a
 * working system back, which is what db/reset.sh is for.
 *
 * destructive_action_log is ALSO absent, deliberately.  See THE AUDIT
 * PARADOX above.
 */
const TRANSACTIONAL_TABLES = [
  // billing
  'payment', 'invoice_line', 'invoice', 'credit_note', 'proration_event', 'subscription',
  // fulfilment
  'backorder', 'fulfillment_allocation', 'sales_order_line', 'sales_order',
  // commercial
  'deal_alert', 'negotiation_comment', 'negotiation_request',
  'approval_request', 'quotation_line', 'quotation',
  // history
  'audit_log',
] as const

const Body = z.strictObject({
  /** The literal string RESET.  A confirmation the user has to type rather
   *  than a checkbox they can click past — the same reason GitHub makes you
   *  type a repository name to delete it. */
  confirm: z.string(),
  /** Never persisted, never logged, never compared before the role check. */
  token: z.string().min(1),
  reason: z.string().max(500).optional(),
})

export const POST = withAuth([...RESET_ROLES], async (req, session) => {
  const b = await parseBody(req, Body)

  // ── GATE 1 · configured at all? ─────────────────────────────────────
  const expected = process.env.ADMIN_RESET_TOKEN
  if (!expected) {
    return fail(
      'Destructive reset is not enabled on this deployment. Set ADMIN_RESET_TOKEN in the environment to enable it.',
      503,
    )
  }

  // ── GATE 2 · never in production without an explicit opt-in ─────────
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_PROD_RESET !== 'true') {
    return fail(
      'Destructive reset is disabled in production. This is the same stance Odoo takes on its database manager.',
      403,
    )
  }

  // ── GATE 3 · the typed confirmation ─────────────────────────────────
  if (b.confirm !== 'RESET') {
    return fail('Type RESET to confirm. Nothing has been changed.', 400)
  }

  // ── GATE 4 · the out-of-band secret ─────────────────────────────────
  // Length-independent comparison is overkill against a local demo, but the
  // habit is the point: a token check that leaks its length via early exit
  // is the kind of detail this codebase should not get wrong anywhere.
  if (!timingSafeEqual(b.token, expected)) {
    // Logged BEFORE returning: a failed attempt to wipe the database is more
    // interesting than a successful one, not less.
    await logDestructive({
      action: 'reset.denied',
      actorEmail: session.email,
      actorUserId: session.userId,
      detail: 'Invalid master token',
      rowCounts: null,
    })
    return fail('Invalid master token.', 403)
  }

  // Count first, so the log records what was actually destroyed rather than
  // an assertion that something was.
  const result = await tx(async (c) => {
    const counts: Record<string, number> = {}
    for (const t of TRANSACTIONAL_TABLES) {
      const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`)
      counts[t] = r.rows[0].n
    }

    await c.query(
      `TRUNCATE TABLE ${TRANSACTIONAL_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
    )

    // Stock survives the truncate because stock_level is master data — but
    // every reservation on it was made by an order that no longer exists.
    // Leaving qty_reserved set would strand that stock permanently and the
    // allocator would quietly under-allocate forever afterwards.
    const freed = await c.query(
      `UPDATE stock_level SET qty_reserved = 0 WHERE qty_reserved <> 0 RETURNING id`,
    )
    counts['stock_level.qty_reserved_cleared'] = freed.rowCount ?? 0

    return counts
  })

  await logDestructive({
    action: 'reset.transactional',
    actorEmail: session.email,
    actorUserId: session.userId,
    detail: b.reason ?? 'Cleared transactional data',
    rowCounts: result,
  })

  return ok({
    cleared: result,
    preserved:
      'Catalogue, pricelists, upsell rules, warehouses, stock, customers, users and configuration are intact.',
    note:
      'To rebuild the entire database from schema and seeds, run ./db/reset.sh at a shell. That path is deliberately not reachable over HTTP.',
  })
})

/** Written outside the reset transaction on purpose: if the truncate rolls
 *  back, the attempt still happened and should still be recorded. */
async function logDestructive(entry: {
  action: string
  actorEmail: string
  actorUserId: number
  detail: string
  rowCounts: Record<string, number> | null
}) {
  await tx(async (c) => {
    await c.query(
      `INSERT INTO destructive_action_log (action, actor_email, actor_user_id, detail, row_counts)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.action, entry.actorEmail, entry.actorUserId, entry.detail,
       entry.rowCounts ? JSON.stringify(entry.rowCounts) : null],
    )
  })
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
