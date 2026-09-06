// OWNER: D2.  CLAIMED — new path.
//
// REVERSE A POSTED INVOICE.  The only legitimate way to undo one.
//
// A posted invoice is immutable (see ../post/route.ts). When it turns out to
// be wrong — wrong quantity, wrong price, goods returned — the correction is
// a NEW document that offsets it, not an edit to the old one. Both documents
// survive, and the net is the truth. That is what a credit note is, and it is
// why accounting systems have them instead of an edit button.
//
// ── WHAT THIS DOES NOT DO ────────────────────────────────────────────
// It does not mark the invoice paid. A credit note is not a payment: it
// reduces what is OWED, and applyPayment() in lib/invoice.ts remains the only
// writer of invoice.status. Conflating the two is how an invoice ends up
// reading "paid" with no money behind it — the worst bug this app could ship.
// The credit note reduces the customer's EXPOSURE (see lib/credit.ts), which
// is the thing it should affect.

import { z } from 'zod'
import { tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody, BusinessRuleError } from '@/lib/api'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const CN_ROLES = ['finance', 'admin'] as const

const Body = z.strictObject({
  amount: z.number().positive().optional(),
  reason: z.string().min(3).max(500),
})

export const POST = withAuth<Ctx>([...CN_ROLES], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid invoice id', 400)
  const b = await parseBody(req, Body)

  const result = await tx(async (c) => {
    // Two statements, not one: Postgres refuses FOR UPDATE on a query that
    // joins an aggregate, and the lock is the part that matters — it must be
    // taken before the credited total is read, or two concurrent credit notes
    // could each see the same headroom and both fit inside it.
    const r = await c.query(
      `SELECT id, number, customer_id, amount_total, status, posted_at
         FROM invoice WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (r.rowCount === 0) throw new BusinessRuleError('No such invoice.')
    const credited = await c.query(
      `SELECT COALESCE(SUM(amount), 0) AS total FROM credit_note WHERE invoice_id = $1`,
      [id],
    )
    const inv = { ...r.rows[0], already_credited: credited.rows[0].total }

    // A draft has not been issued to anybody, so there is nothing to reverse.
    // Void it instead — which is why voiding is restricted to drafts.
    if (!inv.posted_at) {
      throw new BusinessRuleError(
        `Invoice ${inv.number} is still a draft. A draft has never been issued, so there is nothing ` +
        `to credit — post it first, or void it.`,
      )
    }

    const already = Number(inv.already_credited)
    const headroom = Math.round((Number(inv.amount_total) - already) * 100) / 100
    const amount = b.amount ?? headroom

    if (headroom <= 0) {
      throw new BusinessRuleError(`Invoice ${inv.number} has already been fully credited.`)
    }
    // You cannot credit more than was invoiced. Crediting beyond the document
    // would turn a correction into a payment to the customer, which is a
    // different transaction with different authority behind it.
    if (amount > headroom + 1e-9) {
      throw new BusinessRuleError(
        `Cannot credit ₹${amount.toFixed(2)} against invoice ${inv.number}: only ₹${headroom.toFixed(2)} ` +
        `remains uncredited of ₹${Number(inv.amount_total).toFixed(2)}.`,
      )
    }

    const num = await c.query(
      `SELECT 'CN-' || to_char(now(), 'YYYY') || '-' ||
              lpad(((SELECT count(*) FROM credit_note) + 1)::text, 4, '0') AS n`,
    )

    const cn = await c.query(
      `INSERT INTO credit_note (number, customer_id, invoice_id, amount, reason,
                                is_reversal, issued_by_user_id)
       VALUES ($1, $2, $3, $4, $5, true, $6)
       RETURNING id, number, amount, reason, created_at`,
      [num.rows[0].n, inv.customer_id, id, amount, b.reason, session.userId],
    )

    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('invoice', $1, 'credit_note', $2, $3, $4)`,
      [id, session.userId,
       `Credit note ${cn.rows[0].number} for ₹${Number(amount).toFixed(2)} against ${inv.number} — ${b.reason}`,
       JSON.stringify({ creditNote: cn.rows[0].number, amount, reason: b.reason })],
    )

    return {
      creditNote: cn.rows[0],
      invoice: { id: inv.id, number: inv.number, amountTotal: Number(inv.amount_total) },
      totalCredited: Math.round((already + amount) * 100) / 100,
      fullyReversed: Math.abs(already + amount - Number(inv.amount_total)) < 0.005,
    }
  })

  return ok({
    ...result,
    note:
      'The invoice is unchanged — it stays posted and its total stands. The credit note offsets it. ' +
      'Invoice status is still derived only from payments; what this reduces is the customer’s credit exposure.',
  }, 201)
})
