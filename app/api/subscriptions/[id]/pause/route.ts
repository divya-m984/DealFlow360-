// OWNER: D2.  Pause a subscription — completes the sub_status lifecycle
// (active · paused · cancelled) that the schema declares.
import { tx } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'
import { pauseSubscription } from '@/lib/billing'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

export const POST = withAuth<Ctx>(['sales_manager', 'finance', 'admin'], async (_req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid subscription id', 400)

  const result = await tx(async (c) => {
    const r = await pauseSubscription(c, id)
    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('subscription', $1, 'pause', $2, $3, $4)`,
      [id, session.userId, 'Pause requested', JSON.stringify(r)],
    )
    return r
  })

  return ok(result, 201)
})
