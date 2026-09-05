// OWNER: D1.  Nudge / Escalate / Resolve from an alert (PS §B9).
//
// "An automated nudge or escalation action can be triggered from an alert."
//
// D3's screen 14 calls this from the two row buttons and never writes the SQL
// itself — deal_alert.last_action / last_action_at / last_action_by_user_id
// are only ever set here, so the audit story stays in one place.
import { z } from 'zod'
import { tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import { audit } from '@/lib/quotation'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin'] as const
type Ctx = { params: Promise<{ id: string }> }

const Body = z.strictObject({
  action: z.enum(['nudge', 'escalate', 'resolve']),
  note: z.string().trim().min(1).optional(),
})

// What lands in deal_alert.last_action, matching the mockup's own wording.
const LABEL = {
  nudge: 'Nudge sent',
  escalate: 'Escalated to Manager',
  resolve: 'Resolved',
} as const

export const POST = withAuth<Ctx>([...INTERNAL], async (req, session, ctx) => {
  const id = Number((await ctx.params).id)
  const { action, note } = await parseBody(req, Body)

  return tx(async (c) => {
    const { rows } = await c.query<{
      id: number; kind: string; detail: string
      quotation_id: number; resolved_at: string | null; number: string
    }>(
      `SELECT a.id, a.kind, a.detail, a.quotation_id, a.resolved_at, qq.number
         FROM deal_alert a JOIN quotation qq ON qq.id = a.quotation_id
        WHERE a.id = $1 FOR UPDATE OF a`,
      [id],
    )
    const alert = rows[0]
    if (!alert) return fail('Alert not found', 404)
    if (alert.resolved_at) return fail('This alert is already resolved', 409)

    const label = LABEL[action]

    const { rows: updated } = await c.query(
      `UPDATE deal_alert
          SET last_action = $2,
              last_action_at = now(),
              last_action_by_user_id = $3,
              resolved_at = CASE WHEN $4 THEN now() ELSE resolved_at END
        WHERE id = $1
        RETURNING *`,
      [id, note ? `${label} — ${note}` : label, session.userId, action === 'resolve'],
    )

    // Acting on an alert is activity on the deal. Without this, nudging a
    // stalled quotation leaves it looking just as stalled as before.
    if (action !== 'resolve') {
      await c.query(`UPDATE quotation SET last_activity_at = now() WHERE id = $1`,
        [alert.quotation_id])
    }

    await audit(c, 'quotation', alert.quotation_id, `alert_${action}`, session.userId,
      `${label} — ${alert.kind}: ${alert.detail}`, { deal_alert_id: id })

    return ok(updated[0])
  })
})
