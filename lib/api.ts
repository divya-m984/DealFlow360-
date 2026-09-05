// OWNER: Integrator.  FROZEN after Phase 0.
//
// EVERY API response is { data } or { error: { message } }.  No exceptions —
// D3 renders errors from exactly one shape.

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getSession, type Role, type Session } from './auth'

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status })
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: { message } }, { status })
}

/**
 * Wrap a route handler with auth + role check + error handling.
 *
 *   export const GET = withAuth(['sales_manager', 'finance'], async (req, session, { params }) => {
 *     const { id } = await params
 *     return ok(await q('SELECT ...', [id]))
 *   })
 *
 * Pass `null` for roles to allow any authenticated user.
 */
export function withAuth<C = unknown>(
  roles: Role[] | null,
  handler: (req: Request, session: Session, ctx: C) => Promise<Response>,
) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const session = await getSession()
    if (!session) return fail('Not authenticated', 401)
    if (roles && !roles.includes(session.role)) return fail('Forbidden', 403)
    try {
      return await handler(req, session, ctx)
    } catch (e: any) {
      console.error('[api]', e)
      // Postgres CHECK / constraint violations arrive here.  Surface the
      // message rather than a bare 500 — "cannot_reserve_more_than_held" is
      // more useful to the user than "Server error".
      return fail(e?.message ?? 'Server error', 500)
    }
  }
}

/** Parse a JSON body against a zod schema, or throw a message withAuth will render. */
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const raw = await req.json().catch(() => null)
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`${first.path.join('.') || 'body'}: ${first.message}`)
  }
  return parsed.data
}
