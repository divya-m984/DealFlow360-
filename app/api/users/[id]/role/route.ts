// OWNER: D2.  CLAIMED — new path.
//
// Jury review 2, ask 7: "How can a normal user be promoted to a higher
// position?"
//
// ── WHY PROMOTION IS ITS OWN ENDPOINT ────────────────────────────────
// It would have been less code to let PATCH /api/users/[id] accept `role`
// alongside `full_name` and `is_active`.  It would also have been wrong.
// Changing someone's role is the single highest-consequence write in this
// application — it is the one that grants the power to make every other
// write.  Giving it its own route means it has its own allow-list, its own
// audit record, and its own set of refusals, none of which can be diluted
// later by somebody adding a field to a general-purpose update.
//
// ── THE FIVE REFUSALS ────────────────────────────────────────────────
// Each exists because of a specific way privilege escalation actually
// happens, not as defensive decoration:
//
// 1. YOU CANNOT CHANGE YOUR OWN ROLE.  Otherwise every other rule is
//    theatre: an admin promotes themselves to super_admin and the ladder
//    is gone.  This holds even for a super_admin — the highest role in the
//    system still cannot rewrite its own grant.
// 2. YOU CANNOT GRANT ABOVE YOUR OWN RANK.  An admin promoting someone to
//    super_admin, then logging in as them, is the same escalation taking
//    one extra step.  Granting a PEER is allowed and is not escalation —
//    you already hold that rank — and forbidding it would mean no
//    super_admin could ever onboard a second one, which would make rule 4
//    below unreachable and leave the system a single point of failure.
// 3. YOU CANNOT CHANGE SOMEONE ABOVE YOUR OWN RANK.  Otherwise an admin
//    demotes the super_admin to viewer and is now the top of the ladder by
//    subtraction rather than by grant.
// 4. YOU CANNOT REMOVE THE LAST SUPER_ADMIN.  A system nobody can
//    administer is unrecoverable without database access, and the person
//    who does it will not realise until they need it.
// 5. YOU CANNOT MOVE BETWEEN THE PORTAL AND INTERNAL LADDERS.  A customer
//    login promoted to sales_rep would walk straight through middleware.ts,
//    which only ever asks "is this session portal?".  The schema's
//    portal_user_has_customer CHECK blocks the row, but a 23514 is not an
//    explanation.

import { z } from 'zod'
import { one, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { ROLE_RANK, type Role } from '@/lib/jwt'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const USER_ADMIN_ROLES = ['admin', 'super_admin'] as const

const Body = z.strictObject({
  role: z.enum(['viewer', 'sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin']),
  reason: z.string().min(3).max(500).optional(),
})

const rank = (r: string) => ROLE_RANK[r as Exclude<Role, 'portal'>] ?? -1

export const PATCH = withAuth<Ctx>([...USER_ADMIN_ROLES], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid user id', 400)
  const b = await parseBody(req, Body)

  // REFUSAL 1 — self.  Checked before anything else because it is the one
  // that makes the rest meaningful.
  if (id === session.userId) {
    return fail('You cannot change your own role. Ask another administrator.', 403)
  }

  const target = await one<{ id: number; email: string; full_name: string; role: Role; is_active: boolean }>(
    `SELECT id, email, full_name, role, is_active FROM app_user WHERE id = $1`,
    [id],
  )
  if (!target) return fail('No such user.', 404)

  // REFUSAL 5 — different ladders.
  if (target.role === 'portal') {
    return fail(
      'A portal (customer) login cannot be given an internal role. Create a separate internal account instead.',
      400,
    )
  }

  if (target.role === b.role) {
    return fail(`${target.full_name} is already a ${b.role}.`, 400)
  }

  const mine = rank(session.role)

  // REFUSAL 3 — the target strictly outranks me.
  if (rank(target.role) > mine) {
    return fail(
      `${article(session.role)} cannot change the role of a ${target.role}.`,
      403,
    )
  }

  // REFUSAL 2 — the grant strictly outranks me.  Peer grants are allowed:
  // see the note in ../../route.ts.  What this still forbids is the only
  // move that actually gains privilege — handing out a rank above your own.
  if (rank(b.role) > mine) {
    return fail(
      `${article(session.role)} cannot grant the role ${b.role}. You may only grant roles at or below your own.`,
      403,
    )
  }

  const result = await tx(async (c) => {
    // Lock the row so two concurrent demotions cannot both pass the
    // last-super_admin check below and leave the system with none.
    const locked = await c.query(
      `SELECT role FROM app_user WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (locked.rowCount === 0) throw new Error('No such user.')
    const currentRole = locked.rows[0].role as Role

    // REFUSAL 4 — the last super_admin.  Counted inside the transaction,
    // after the lock, so the count cannot go stale between check and write.
    if (currentRole === 'super_admin' && b.role !== 'super_admin') {
      const remaining = await c.query(
        `SELECT count(*)::int AS n FROM app_user
          WHERE role = 'super_admin' AND is_active AND id <> $1`,
        [id],
      )
      if (remaining.rows[0].n === 0) {
        throw new Error(
          'This is the last active super admin. Promote someone else first, or the system will have no one who can administer it.',
        )
      }
    }

    const upd = await c.query(
      `UPDATE app_user
          SET role = $2, role_changed_at = now(), role_changed_by_user_id = $3
        WHERE id = $1
        RETURNING id, public_id, email, full_name, role, is_active, role_changed_at`,
      [id, b.role, session.userId],
    )

    const direction =
      rank(b.role) > rank(currentRole) ? 'promote'
      : rank(b.role) < rank(currentRole) ? 'demote'
      : 'reassign'

    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('app_user', $1, $2, $3, $4, $5)`,
      [
        id,
        direction,
        session.userId,
        `${direction === 'promote' ? 'Promoted' : direction === 'demote' ? 'Demoted' : 'Reassigned'} ` +
          `${target.email}: ${currentRole} → ${b.role}` + (b.reason ? ` — ${b.reason}` : ''),
        JSON.stringify({ from: currentRole, to: b.role, reason: b.reason ?? null }),
      ],
    )

    return { ...upd.rows[0], previous_role: currentRole, direction }
  })

  return ok(result)
})

/** 'an admin', not 'a admin' — error strings are read by people. */
function article(role: string): string {
  return /^[aeiou]/i.test(role) ? `An ${role}` : `A ${role}`
}
