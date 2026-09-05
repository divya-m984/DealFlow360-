// OWNER: Integrator.  FROZEN after Phase 0.
//
// DEMO ROLE SWITCHER.  The five-minute demo crosses four identities —
// rep, manager, finance, customer.  Logging out and back in four times costs
// most of a minute of a five-minute slot and all of the momentum, so the app
// shell has a dropdown that calls this.
//
// This endpoint issues a session for ANY user without a password.  It is
// therefore hard-disabled outside development — an impersonation endpoint that
// shipped to production would be the single worst thing in this codebase.
import { cookies } from 'next/headers'
import { z } from 'zod'
import { q } from '@/lib/db'
import { ok, fail, parseBody } from '@/lib/api'
import { signToken, COOKIE, type Session } from '@/lib/auth'

export const runtime = 'nodejs'

const Body = z.strictObject({ email: z.string().min(3) })

type Row = {
  id: number; email: string; full_name: string
  role: Session['role']; customer_id: number | null; is_active: boolean
}

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') {
    return fail('Not available', 404)
  }

  try {
    const { email } = await parseBody(req, Body)

    const rows = await q<Row>(
      `SELECT id, email, full_name, role, customer_id, is_active
         FROM app_user WHERE lower(email) = lower($1)`,
      [email],
    )
    const u = rows[0]
    if (!u || !u.is_active) return fail('No such user', 404)

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
      secure: false,
    })

    return ok(session)
  } catch (e: any) {
    return fail(e?.message ?? 'Switch failed', 400)
  }
}

// The seeded demo identities, for the shell's dropdown.
export async function GET() {
  if (process.env.NODE_ENV === 'production') return fail('Not available', 404)
  return ok(
    await q(
      `SELECT email, full_name, role FROM app_user
        WHERE is_active ORDER BY
          CASE role WHEN 'sales_rep' THEN 1 WHEN 'sales_manager' THEN 2
                    WHEN 'finance' THEN 3 WHEN 'admin' THEN 4 ELSE 5 END,
          email`,
    ),
  )
}
