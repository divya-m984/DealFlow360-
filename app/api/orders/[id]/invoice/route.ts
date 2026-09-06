// OWNER: D2.
//
// Jury review 2, ask 6.  "The shop has only 70 laptops but they get an order
// for 100.  Satisfy the 70 first and give them a proper invoice.  Then when
// they restock, give back the other 30."
//
// GET  — what could be billed right now, line by line, and why each blocked
//        line is blocked.  Safe to poll; writes nothing.
// POST — bill exactly that, and no more.  Call it again after the next
//        shipment and it bills the next slice.
//
// The jury's case is two POSTs against the same order: one when 70 units
// have shipped, one after the backorder is consolidated and the last 30 go
// out.  Two invoices, no double-billing, and the two amounts sum to exactly
// the order total — see "THE ROUNDING TRAP" in lib/invoice.ts for why that
// last part is not automatic.
//
// ── RBAC ─────────────────────────────────────────────────────────────
// GET is open to any internal role: a rep must be able to see whether their
// customer has been billed.  POST is finance/admin only, for the same reason
// POST /api/invoices/[id]/payments is — creating a debt owed to the company
// is a finance act, not a sales one.

import { z } from 'zod'
import { one, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody } from '@/lib/api'
import {
  getInvoiceableLines,
  deriveOrderInvoiceStatus,
  createDeliveryInvoice,
} from '@/lib/invoice'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const INVOICE_WRITE_ROLES = ['finance', 'admin'] as const

export const GET = withAuth<Ctx>(null, async (_req, _session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid order id', 400)

  const order = await one<{ id: number; number: string; grand_total: string }>(
    `SELECT id, number, grand_total FROM sales_order WHERE id = $1`, [id],
  )
  if (!order) return fail('No such order.', 404)

  const lines = await tx(async (c) => getInvoiceableLines(c, id))
  const status = deriveOrderInvoiceStatus(lines)

  return ok({
    order,
    // Odoo's own vocabulary — 'no' | 'to_invoice' | 'invoiced' | 'upselling'.
    // Derived on read, never stored, so it cannot drift from the invoices.
    invoiceStatus: status,
    canInvoice: lines.some((l) => l.qtyToInvoice > 0),
    amountToInvoice: round2(lines.reduce((t, l) => t + l.amountToInvoice, 0)),
    lines,
  })
})

const Body = z.strictObject({
  dueInDays: z.number().int().min(0).max(180).optional(),
})

export const POST = withAuth<Ctx>([...INVOICE_WRITE_ROLES], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid order id', 400)
  const b = await parseBody(req, Body)

  const order = await one<{ id: number; number: string }>(
    `SELECT id, number FROM sales_order WHERE id = $1`, [id],
  )
  if (!order) return fail('No such order.', 404)

  const result = await tx(async (c) => {
    const inv = await createDeliveryInvoice(c, id, { dueInDays: b.dueInDays ?? 15 })
    if (inv) {
      await c.query(
        `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
         VALUES ('invoice', $1, $2, $3, $4, $5)`,
        [inv.id,
         inv.isPartial ? 'invoice_partial' : 'invoice_final',
         session.userId,
         `${inv.isPartial ? 'Partial' : 'Final'} invoice ${inv.number} (#${inv.sequenceNo}) for order ${order.number}`,
         JSON.stringify({ lines: inv.lines, remaining: inv.remaining })],
      )
    }
    return inv
  })

  // Not an error.  Either the order is fully invoiced, or nothing has
  // shipped yet on a delivery-billed line — both are ordinary states, and a
  // 4xx would make the UI show a red box for "everything is fine".
  if (!result) {
    const lines = await tx(async (c) => getInvoiceableLines(c, id))
    return ok({
      invoice: null,
      invoiceStatus: deriveOrderInvoiceStatus(lines),
      message:
        lines.every((l) => l.qtyInvoiced >= l.qtyOrdered)
          ? `Order ${order.number} is already fully invoiced.`
          : `Nothing is billable on ${order.number} yet — no shipped quantity is awaiting an invoice.`,
      lines,
    })
  }

  const after = await tx(async (c) => getInvoiceableLines(c, id))

  return ok(
    {
      invoice: result,
      invoiceStatus: deriveOrderInvoiceStatus(after),
      message: result.isPartial
        ? `Partial invoice ${result.number} raised for what has shipped. ` +
          `Still outstanding: ${result.remaining.map((r) => `${r.qtyOutstanding} × ${r.sku}`).join(', ')}.`
        : `Invoice ${result.number} raised. Order ${order.number} is now fully invoiced.`,
      lines: after,
    },
    201,
  )
})

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
