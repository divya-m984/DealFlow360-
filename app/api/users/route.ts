// OWNER: D2.  CLAIMED — new path, announced in OWNERSHIP.md.
//
// Jury review 2, ask 3: "How do we create a new user into the ERP?"
//
// The honest answer before this file was: you cannot.  POST /api/auth/signup
// exists but it only ever mints a `sales_rep` and it is a PUBLIC endpoint —
// that is a self-service registration door, not user administration.  No
// route could create a manager, a finance user, a viewer or a portal login
// for a customer.  Every account in the system came from the seed.
//
// ── WHY THIS IS NOT IN app/api/auth/ ─────────────────────────────────
// app/api/auth/** is the Integrator's and frozen, and the two things are
// genuinely different anyway: /auth is "prove who you are", this is "manage
// who exists".  Odoo draws the same line — res.users administration lives in
// Settings behind an access group, not in the login controller.
//
// ── THE RULES, AND WHY EACH ONE EXISTS ───────────────────────────────
// 1. You cannot create a role at or above your own rank.  Without this an
//    admin can mint a super_admin and then log in as it, which makes the
//    super_admin distinction decorative.
// 2. A portal user MUST be tied to a customer, and an internal user must NOT
//    be.  The schema already enforces this (app_user.portal_user_has_customer)
//    but a CHECK violation reaches the user as 23514; this turns it into a
//    sentence.
// 3. Passwords are hashed with bcrypt and never returned by any branch of
//    this file, including the create response.

import { z } from 'zod'
import { q, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { hashPassword } from '@/lib/auth'
import { ROLE_RANK, type Role } from '@/lib/jwt'

export const runtime = 'nodejs'

/** Who may administer users at all.  sales_manager is deliberately absent:
 *  approving a discount and creating a login are different powers, and
 *  conflating them is how a sales org ends up with shadow accounts. */
const USER_ADMIN_ROLES = ['admin', 'super_admin'] as const

const CreateBody = z.strictObject({
  email: z.string().email(),
  full_name: z.string().min(2),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  role: z.enum(['viewer', 'sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin', 'portal']),
  customer_id: z.number().int().positive().nullable().optional(),
})

export const GET = withAuth([...USER_ADMIN_ROLES], async () => {
  return ok(
    await q(
      `SELECT u.id, u.public_id, u.email, u.full_name, u.role, u.is_active,
              u.customer_id, c.name AS customer_name,
              u.created_at, u.role_changed_at,
              creator.full_name AS created_by_name,
              changer.full_name AS role_changed_by_name
         FROM app_user u
         LEFT JOIN customer c       ON c.id = u.customer_id
         LEFT JOIN app_user creator ON creator.id = u.created_by_user_id
         LEFT JOIN app_user changer ON changer.id = u.role_changed_by_user_id
        ORDER BY u.is_active DESC, u.role, u.full_name`,
    ),
  )
})

export const POST = withAuth([...USER_ADMIN_ROLES], async (req, session) => {
  const b = await parseBody(req, CreateBody)

  // RULE 1 — no minting a peer or a superior.  'portal' is off the internal
  // ladder entirely, so it is exempt from the rank comparison but still
  // requires user-admin rights to create.
  if (b.role !== 'portal') {
    const mine = ROLE_RANK[session.role as Exclude<Role, 'portal'>] ?? -1
    const theirs = ROLE_RANK[b.role as Exclude<Role, 'portal'>]
    // STRICTLY above, not at-or-above.  Creating a PEER is not escalation —
    // you already hold that rank — and forbidding it would mean no super_admin
    // could ever onboard a second one, leaving the "last super admin" guard in
    // ./[id]/role permanently unreachable and the system with a single point
    // of failure no one inside it could fix.
    if (theirs > mine) {
      return fail(
        `${article(session.role)} cannot create a ${b.role}. You may only create roles at or below your own.`,
        403,
      )
    }
  }

  // RULE 2 — the portal/internal split, caught here rather than as a 23514.
  if (b.role === 'portal' && !b.customer_id) {
    return fail('A portal user must be linked to a customer.', 400)
  }
  if (b.role !== 'portal' && b.customer_id) {
    return fail('Only a portal user may be linked to a customer.', 400)
  }

  const dupe = await q(`SELECT 1 FROM app_user WHERE lower(email) = lower($1)`, [b.email])
  if (dupe.length > 0) return fail('That email address already has an account.', 409)

  if (b.customer_id) {
    const cust = await q(`SELECT 1 FROM customer WHERE id = $1`, [b.customer_id])
    if (cust.length === 0) return fail('No such customer.', 400)
  }

  const hash = await hashPassword(b.password)

  const created = await tx(async (c) => {
    const r = await c.query(
      `INSERT INTO app_user (email, password_hash, full_name, role, customer_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, public_id, email, full_name, role, customer_id, is_active, created_at`,
      [b.email, hash, b.full_name, b.role, b.customer_id ?? null, session.userId],
    )
    const row = r.rows[0]
    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('app_user', $1, 'create', $2, $3, $4)`,
      [row.id, session.userId, `Created ${b.role} account for ${b.email}`,
       JSON.stringify({ role: b.role, customer_id: b.customer_id ?? null })],
    )
    return row
  })

  // No password_hash on this object, and none on any other branch above.
  return ok(created, 201)
})

/** 'an admin', not 'a admin' — error strings are read by people. */
function article(role: string): string {
  return /^[aeiou]/i.test(role) ? `An ${role}` : `A ${role}`
}
