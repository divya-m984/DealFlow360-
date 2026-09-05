// OWNER: D2.
//
// POST / IMMUTABILITY / GST IRN / CREDIT NOTE — the document-state panel.
//
// ── THE QUESTION THIS ANSWERS ────────────────────────────────────────
// "Can you edit a posted invoice?" Every ERP reviewer asks it. The only
// correct answer is no: you reverse it with a credit note and issue a new
// one. A document the customer has received — and a tax authority may have
// seen — cannot be quietly changed. That is not a policy choice, it is what
// separates an accounting system from a spreadsheet.
//
// ── ABOUT THE IRN, PRECISELY ─────────────────────────────────────────
// Under CGST Rule 48(5) a notified taxpayer registers a B2B invoice on the
// Invoice Registration Portal and gets back a 64-character Invoice Reference
// Number: SHA-256 over supplier GSTIN + document number + document type +
// financial year.
//
// We compute that hash with the real algorithm, from the real four inputs,
// and show them alongside it so anyone can reproduce it offline and get the
// same 64 characters. We do NOT claim portal registration: nothing was sent
// to the IRP, there is no NIC digital signature, and therefore there is no
// signed QR code. The panel says so in plain words. A QR that does not scan
// when a reviewer points a phone at it would be worse than no QR at all.

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/shared/money'

type Inv = {
  id: number
  number: string
  status: string
  amount_total: string | number
  currency_code?: string
  posted_at?: string | null
  gst_irn?: string | null
  gst_ack_no?: string | null
  supplier_gstin?: string | null
}

export function InvoicePosting({
  invoice, canWrite, onChanged,
}: { invoice: Inv; canWrite: boolean; onChanged?: () => void }) {
  const [busy, setBusy] = useState<'post' | 'credit' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [showCredit, setShowCredit] = useState(false)
  const [reason, setReason] = useState('')
  const [amount, setAmount] = useState('')

  const posted = Boolean(invoice.posted_at)

  async function post() {
    setBusy('post'); setError(null); setNotice(null)
    try {
      const r = await fetch(`/api/invoices/${invoice.id}/post`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not post')
      setNotice(`Posted. IRN generated and the document is now immutable.`)
      onChanged?.()
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function credit() {
    setBusy('credit'); setError(null); setNotice(null)
    try {
      const body: Record<string, unknown> = { reason }
      if (amount.trim()) body.amount = Number(amount)
      const r = await fetch(`/api/invoices/${invoice.id}/credit-note`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not issue the credit note')
      setNotice(
        `${j.data.creditNote.number} issued for ₹${Number(j.data.creditNote.amount).toFixed(2)}. ` +
        `The invoice is unchanged — the credit note offsets it.`,
      )
      setShowCredit(false); setReason(''); setAmount('')
      onChanged?.()
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  return (
    <Card className={posted ? '' : 'border-amber-500/40'}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            Document state
            {posted ? (
              <Badge variant="outline" className="border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                Posted · locked
              </Badge>
            ) : (
              <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                Draft
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {posted
              ? 'This invoice has been issued. It cannot be edited or re-posted — corrections are made by issuing a credit note against it, so both documents survive and the net is the truth.'
              : 'A draft has not been issued to the customer. Posting fixes its identity, generates the GST reference number, and makes it immutable.'}
          </CardDescription>
        </div>
        {canWrite ? (
          posted ? (
            <Button size="sm" variant="outline" onClick={() => setShowCredit((v) => !v)}>
              {showCredit ? 'Cancel' : 'Issue credit note'}
            </Button>
          ) : (
            <Button size="sm" onClick={post} disabled={busy !== null}>
              {busy === 'post' ? 'Posting…' : 'Post invoice'}
            </Button>
          )
        ) : (
          <Badge variant="secondary">Read-only — posting is a finance action</Badge>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

        {posted && invoice.gst_irn && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                GST e-invoice reference
              </p>
              <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
                computed locally · not IRP-registered
              </Badge>
            </div>

            <p className="mb-0.5 text-[11px] text-muted-foreground">IRN (64-char SHA-256)</p>
            <p className="break-all rounded border bg-background px-2 py-1.5 font-mono text-[11px] leading-relaxed">
              {invoice.gst_irn}
            </p>

            <div className="mt-2 grid gap-x-6 gap-y-1 text-[11px] sm:grid-cols-2">
              <Field label="Supplier GSTIN" value={invoice.supplier_gstin ?? '—'} mono />
              <Field label="Ack. number" value={invoice.gst_ack_no ?? '—'} mono />
              <Field label="Document type" value="INV (tax invoice)" />
              <Field label="Posted" value={invoice.posted_at ? new Date(invoice.posted_at).toLocaleString() : '—'} />
            </div>

            <p className="mt-2 border-t pt-2 text-[11px] text-muted-foreground">
              <strong>Reproduce it:</strong> SHA-256 of supplier GSTIN + document number + document
              type + financial year, concatenated in that order, gives exactly the 64 characters
              above. What this is <em>not</em> is portal-registered — nothing was sent to the IRP,
              there is no NIC signature, and so there is deliberately no signed QR code rather than
              a decorative one.
            </p>
          </div>
        )}

        {showCredit && posted && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
            <p className="text-xs text-muted-foreground">
              Reversing <strong>{invoice.number}</strong> (<Money value={invoice.amount_total} currency={invoice.currency_code} />).
              Leave the amount blank to credit the full uncredited balance.
            </p>
            <div className="grid gap-2 sm:grid-cols-3">
              <Input
                placeholder="Amount (blank = full)" inputMode="decimal"
                value={amount} onChange={(e) => setAmount(e.target.value)}
              />
              <Input
                className="sm:col-span-2" placeholder="Reason — goods returned, pricing error…"
                value={reason} onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={credit} disabled={busy !== null || reason.trim().length < 3}>
              {busy === 'credit' ? 'Issuing…' : 'Issue credit note'}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              A credit note is <strong>not</strong> a payment. It reduces what is owed and the
              customer&rsquo;s credit exposure; invoice status stays derived from payments alone,
              which is what stops an invoice reading &ldquo;paid&rdquo; with no money behind it.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <p className="flex gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono' : ''}>{value}</span>
    </p>
  )
}
