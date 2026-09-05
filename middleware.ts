// OWNER: Integrator.  FROZEN after Phase 0.
//
// Runs on the EDGE runtime.  Imports lib/jwt.ts (jose only) and nothing else.
// Never import lib/auth.ts here — bcryptjs will not run on Edge.
//
// This is where PS §7's "real, separate, restricted view" is enforced:
// a portal session cannot reach an internal route, and an internal session
// cannot reach the portal.  Both refusals are demonstrable on stage.

import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE, verifyToken } from '@/lib/jwt'

const PUBLIC = ['/login', '/signup', '/api/auth/login', '/api/auth/signup']

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next()
  }

  const token = req.cookies.get(COOKIE)?.value
  const session = token ? await verifyToken(token) : null

  if (!session) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: { message: 'Not authenticated' } }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  const isPortalPath = pathname.startsWith('/portal') || pathname.startsWith('/api/portal')

  // A portal user may only ever see the portal.
  if (session.role === 'portal' && !isPortalPath) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: { message: 'Forbidden — portal users cannot access internal routes' } },
        { status: 403 },
      )
    }
    return new NextResponse(
      'Forbidden — portal users cannot access the internal workspace.',
      { status: 403, headers: { 'content-type': 'text/plain' } },
    )
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
}
