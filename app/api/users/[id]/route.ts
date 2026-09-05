// OWNER: D2.  CLAIMED — new path.
//
// Deactivate and reactivate an account, and edit its display name.
//
// There is deliberately NO DELETE.  app_user is referenced by quotation
// (owner_user_id), approval_request, audit_log, negotiation_comment and
// destructive_action_log, all ON DELETE RESTRICT — so a real DELETE would
// either fail on anyone who has ever done anything, or cascade away the
// audit trail that exists precisely to survive them leaving.  Deactivation
// is what an ERP means by removing a user: the login stops working
// (POST /api/auth/login already refuses `!u.is_active`) and the history
// stays intact and attributable.  Odoo calls this archiving.
//
// Role changes are NOT accepted here — see ./role/route.ts for why that is
// a separate endpoint with its own refusals.

import { z } from 'zod'
import { one, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { ROLE_RANK, type Role } from '@/lib/jwt'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const USER_ADMIN_ROLES = ['admin', 'super_admin'] as const

const Body = z.strictObject({
  full_name: z.string().min(2).optional(),
  is_active: z.boolean().optional(),
})

const rank = (r: string) => ROLE_RANK[r as Exclude<Role, 'portal'>] ?? -1

export const PATCH = withAuth<Ctx>([...USER_ADMIN_ROLES], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid user id', 400)
  const b = await parseBody(req, Body)

  const fields = Object.entries(b).filter(([, v]) => v !== undefined)
  if (fields.length === 0) return fail('Nothing to update.', 400)

  // Locking yourself out is not a thing an administrator ever means to do,
  // and it is unrecoverable without database access.
  if (id === session.userId && b.is_active === false) {
    return fail('You cannot deactivate your own account.', 403)
  }

  const target = await one<{ role: Role; full_name: string }>(
    `SELECT role, full_name FROM app_user WHERE id = $1`, [id],
  )
  if (!target) return fail('No such user.', 404)

  // Same rank rule as the role endpoint: deactivating someone is functionally
  // a demotion to nothing, so it needs the same protection or it is a way
  // around it.
  if (target.role !== 'portal' && rank(target.role) > rank(session.role)) {
    return fail(`${article(session.role)} cannot modify a ${target.role}.`, 403)
  }

  const result = await tx(async (c) => {
    if (b.is_active === false) {
      const locked = await c.query(`SELECT role FROM app_user WHERE id = $1 FOR UPDATE`, [id])
      if (locked.rows[0]?.role === 'super_admin') {
        const remaining = await c.query(
          `SELECT count(*)::int AS n FROM app_user
            WHERE role = 'super_admin' AND is_active AND id <> $1`, [id],
        )
        if (remaining.rows[0].n === 0) {
          throw new Error('This is the last active super admin and cannot be deactivated.')
        }
      }
    }

    const sets = fields.map(([k], i) => `${k} = $${i + 2}`).join(', ')
    const upd = await c.query(
      `UPDATE app_user SET ${sets} WHERE id = $1
       RETURNING id, public_id, email, full_name, role, is_active`,
      [id, ...fields.map(([, v]) => v)],
    )
    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('app_user', $1, $2, $3, $4, $5)`,
      [id,
       b.is_active === false ? 'deactivate' : b.is_active === true ? 'reactivate' : 'update',
       session.userId,
       `Updated ${fields.map(([k]) => k).join(', ')} on ${target.full_name}`,
       JSON.stringify(Object.fromEntries(fields))],
    )
    return upd.rows[0]
  })

  return ok(result)
})

/** 'an admin', not 'a admin' — error strings are read by people. */
function article(role: string): string {
  return /^[aeiou]/i.test(role) ? `An ${role}` : `A ${role}`
}
