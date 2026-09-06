// OWNER: Integrator.  FROZEN after Phase 0.
//
// EDGE-SAFE.  This file must only ever import `jose`.
// middleware.ts runs on the Edge runtime and imports from here — never from
// lib/auth.ts, which pulls in bcryptjs and will not run on Edge.

import { SignJWT, jwtVerify } from 'jose'

// ⚠ CHANGED BY D2 AFTER THE FREEZE — Integrator, this needs your sign-off.
// Jury review 2 asked for a stronger RBAC story than username+password, and
// for a user lifecycle (create a user, promote a user).  Two labels were
// added to the user_role enum in db/seed/00-migrations.sql; this union is the
// TypeScript half of the same change and cannot be avoided, because every
// withAuth([...]) allow-list is typed against it.
//
//   'viewer'      — genuinely read-only.  No existing role was: sales_rep
//                   writes quotations and every other internal role has some
//                   write surface.
//   'super_admin' — the ONLY role permitted to destroy data.  Deliberately
//                   above 'admin' rather than equal to it; see
//                   app/api/admin/reset/route.ts for why that distinction is
//                   load-bearing and not decorative.
//
// This is SAFE as an add: every route in this app is an ALLOW-LIST, so a new
// label starts with zero permissions everywhere by construction.  There is no
// deny-list anywhere that a new role could slip past.
export type Role =
  | 'sales_rep'
  | 'sales_manager'
  | 'finance'
  | 'admin'
  | 'super_admin'
  | 'viewer'
  | 'portal'

/** Ordered least- to most-privileged.  Used by the promotion endpoint to
 *  forbid granting a role at or above your own — the rule that stops an
 *  admin minting a super_admin, and stops anyone promoting themselves.
 *  'portal' is deliberately absent: it is not a rung on this ladder, it is a
 *  different ladder entirely, and middleware.ts keeps the two apart. */
export const ROLE_RANK: Record<Exclude<Role, 'portal'>, number> = {
  viewer: 0,
  sales_rep: 1,
  sales_manager: 2,
  finance: 2,
  admin: 3,
  super_admin: 4,
}

export type Session = {
  userId: number
  role: Role
  customerId: number | null
  email: string
  fullName: string
}

export const COOKIE = 'df_token'

function secret() {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return new TextEncoder().encode(s)
}

export async function signToken(session: Session): Promise<string> {
  return new SignJWT({ ...session })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(secret())
}

export async function verifyToken(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret())
    return payload as unknown as Session
  } catch {
    return null
  }
}
