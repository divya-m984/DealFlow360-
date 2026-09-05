// OWNER: Integrator.  FROZEN after Phase 0.
// NODE runtime — verifyPassword uses bcryptjs, which does not run on Edge.
import { cookies } from 'next/headers'
import { z } from 'zod'
import { q } from '@/lib/db'
import { ok, fail, parseBody } from '@/lib/api'
import { verifyPassword, signToken, COOKIE, type Session } from '@/lib/auth'

export const runtime = 'nodejs'

const Body = z.strictObject({
  email: z.string().min(3),
  password: z.string().min(1),
})

type Row = {
  id: number; email: string; password_hash: string; full_name: string
  role: Session['role']; customer_id: number | null; is_active: boolean
}

export async function POST(req: Request) {
  try {
    const { email, password } = await parseBody(req, Body)

    const rows = await q<Row>(
      `SELECT id, email, password_hash, full_name, role, customer_id, is_active
         FROM app_user WHERE lower(email) = lower($1)`,
      [email],
    )
    const u = rows[0]

    // Same message for "no such user" and "wrong password" — never reveal
    // which emails exist.
    if (!u || !u.is_active) return fail('Invalid email or password', 401)
    if (!(await verifyPassword(password, u.password_hash))) {
      return fail('Invalid email or password', 401)
    }

    const session: Session = {
      userId: u.id,
      role: u.role,
      customerId: u.customer_id,
      email: u.email,
      fullName: u.full_name,
    }

    ;(await cookies()).set(COOKIE, await signToken(session), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24,
      secure: process.env.NODE_ENV === 'production',
    })

    return ok(session)
  } catch (e: any) {
    return fail(e?.message ?? 'Login failed', 400)
  }
}
