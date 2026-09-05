// OWNER: Integrator.  FROZEN after Phase 0.
// Who am I?  Used by the app shell to render the header and the role badge.
import { ok } from '@/lib/api'
import { withAuth } from '@/lib/api'

export const runtime = 'nodejs'

export const GET = withAuth(null, async (_req, session) => ok(session))
