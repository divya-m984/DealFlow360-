// OWNER: Integrator.  FROZEN after Phase 0.
import { cookies } from 'next/headers'
import { ok } from '@/lib/api'
import { COOKIE } from '@/lib/auth'

export const runtime = 'nodejs'

export async function POST() {
  ;(await cookies()).delete(COOKIE)
  return ok({ ok: true })
}
