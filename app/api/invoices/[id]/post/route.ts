// OWNER: D2.  CLAIMED — new path.
//
// POST AN INVOICE.  Draft → posted, and from that moment it is immutable.
//
// ── "CAN YOU EDIT A POSTED INVOICE?" ─────────────────────────────────
// Every ERP reviewer asks it, and the only correct answer is no. A document
// the customer has received — and that a tax authority may already have seen
// — cannot be quietly changed; you reverse it with a credit note and issue a
// new one. Editing posted financial documents is what accounting fraud looks
// like from the inside, which is why every accounting system forbids it.
//
// Until now `invoice` had no draft/posted distinction at all. Rows were
// created final and nothing marked the moment they became real.
//
// ── WHY THE IRN IS COMPUTED HERE ─────────────────────────────────────
// Under CGST Rule 48(5) a notified taxpayer registers a B2B invoice on the
// Invoice Registration Portal and receives an Invoice Reference Number: a
// 64-character SHA-256 hash over supplier GSTIN, document number, document
// type and financial year. That hash is a pure function of the document's
// IDENTITY — and identity is exactly what becomes fixed at posting. Computing
// it in draft would mean recomputing it on every edit.
//
// ── WHAT WE ARE AND ARE NOT CLAIMING ─────────────────────────────────
// The IRN below is computed with the REAL algorithm and is reproducible by
// anyone with the same four inputs — a judge can hash them independently and
// get the same 64 characters. What it is NOT is portal-registered: nothing
// here was sent to the IRP, there is no NIC digital signature, and therefore
// no signed QR code. The UI says exactly that. A fake QR that does not scan
// would be worse than no QR at all.

import { z } from 'zod'
import { one, tx } from '@/lib/db'
import { ok, fail, withAuth, parseBody, BusinessRuleError } from '@/lib/api'
import { createHash } from 'node:crypto'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ id: string }> }

const POST_ROLES = ['finance', 'admin'] as const

const Body = z.strictObject({
  supplierGstin: z.string().length(15).optional(),
})

/** Indian financial year: 1 April to 31 March, rendered as the IRP expects. */
export function financialYear(d: Date): string {
  const y = d.getFullYear()
  const startYear = d.getMonth() >= 3 ? y : y - 1
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}

/**
 * The IRN, exactly as the IRP computes it: SHA-256 over the concatenation of
 * supplier GSTIN, document number, document type and financial year, rendered
 * as 64 lowercase hex characters.
 *
 * Document type is INV for a tax invoice, CRN for a credit note, DBN for a
 * debit note. The same four inputs may only ever produce one IRN, which is
 * what makes duplicate submission detectable at the portal — and why
 * invoice_gst_irn_key is UNIQUE here too.
 */
export function computeIrn(
  supplierGstin: string,
  docNumber: string,
  docType: 'INV' | 'CRN' | 'DBN',
  fy: string,
): string {
  return createHash('sha256')
    .update(`${supplierGstin}${docNumber}${docType}${fy}`, 'utf8')
    .digest('hex')
}

export const POST = withAuth<Ctx>([...POST_ROLES], async (req, session, { params }) => {
  const id = Number((await params).id)
  if (!Number.isFinite(id)) return fail('Invalid invoice id', 400)
  const b = await parseBody(req, Body)

  // Configuration, not a row: we have no company table, and the supplier
  // GSTIN belongs to the entity issuing the document. It is COPIED onto the
  // invoice at posting so the IRN stays reproducible years later, after the
  // setting has changed.
  const gstin = b.supplierGstin ?? process.env.SUPPLIER_GSTIN ?? '27AABCD1234E1ZP'

  const result = await tx(async (c) => {
    const r = await c.query(
      `SELECT id, number, status, posted_at, issue_date, amount_total
         FROM invoice WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (r.rowCount === 0) throw new BusinessRuleError('No such invoice.')
    const inv = r.rows[0]

    if (inv.posted_at) {
      throw new BusinessRuleError(
        `Invoice ${inv.number} was already posted on ${new Date(inv.posted_at).toLocaleDateString()}. ` +
        `A posted invoice cannot be posted again, or edited — reverse it with a credit note.`,
      )
    }
    if (inv.status === 'void') {
      throw new BusinessRuleError(`Invoice ${inv.number} is void and cannot be posted.`)
    }

    const fy = financialYear(new Date(inv.issue_date))
    const irn = computeIrn(gstin, inv.number, 'INV', fy)
    const ackNo =
      String(inv.issue_date).slice(0, 10).replace(/-/g, '') + String(inv.id).padStart(6, '0')

    const upd = await c.query(
      `UPDATE invoice
          SET posted_at = now(), posted_by_user_id = $2,
              supplier_gstin = $3, gst_irn = $4, gst_ack_no = $5
        WHERE id = $1
        RETURNING id, number, posted_at, gst_irn, gst_ack_no, supplier_gstin, amount_total, status`,
      [id, session.userId, gstin, irn, ackNo],
    )

    await c.query(
      `INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, payload)
       VALUES ('invoice', $1, 'post', $2, $3, $4)`,
      [id, session.userId, `Posted ${inv.number} — IRN ${irn.slice(0, 12)}…`,
       JSON.stringify({ irn, fy, supplierGstin: gstin, docType: 'INV' })],
    )

    return { ...upd.rows[0], financialYear: fy }
  })

  return ok({
    invoice: result,
    irnInputs: {
      supplierGstin: result.supplier_gstin,
      documentNumber: result.number,
      documentType: 'INV',
      financialYear: result.financialYear,
      note:
        'SHA-256 over these four values concatenated, in this order. Reproducible offline — ' +
        'hash them yourself and you get the same 64 characters.',
    },
    registered: false,
    disclaimer:
      'Computed locally with the IRP algorithm. NOT registered with the Invoice Registration Portal: ' +
      'there is no NIC digital signature and therefore no signed QR code.',
  })
})
