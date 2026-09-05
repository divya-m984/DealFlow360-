// OWNER: Integrator.  FROZEN after Phase 0.
// Creates an INTERNAL user (sales_rep).  Portal users are created against a
// customer and are seeded — a public signup must never be able to mint one,
// because app_user.portal_user_has_customer would then need a customer_id
// supplied by the caller.
import { cookies } from 'next/headers'
import { z } from 'zod'
import { q } from '@/lib/db'
import { ok, fail, parseBody } from '@/lib/api'
import { hashPassword, signToken, COOKIE, type Session } from '@/lib/auth'

export const runtime = 'nodejs'

const Body = z.strictObject({
  email: z.string().min(3),
  password: z.string().min(8),
  fullName: z.string().min(1),
})

export async function POST(req: Request) {
  try {
    const { email, password, fullName } = await parseBody(req, Body)

    const existing = await q(`SELECT 1 FROM app_user WHERE lower(email) = lower($1)`, [email])
    if (existing.length) return fail('That email is already registered', 409)

    const rows = await q<{ id: number }>(
      `INSERT INTO app_user (email, password_hash, full_name, role)
       VALUES ($1, $2, $3, 'sales_rep') RETURNING id`,
      [email, await hashPassword(password), fullName],
    )

    const session: Session = {
      userId: rows[0].id,
      role: 'sales_rep',
      customerId: null,
      email,
      fullName,
    }

    ;(await cookies()).set(COOKIE, await signToken(session), {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24,
      secure: process.env.NODE_ENV === 'production',
    })

    return ok(session, 201)
  } catch (e: any) {
    return fail(e?.message ?? 'Signup failed', 400)
  }
}
