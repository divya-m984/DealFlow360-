// OWNER: D2.  Screen 13 — Invoice Detail.
//
// This screen is where PS §9's eighth and final acceptance step happens:
// "record a payment, and check that the invoice status updates correctly."
// The status shown here is never typed by anyone — it is recomputed from the
// payments in the same transaction that records them (lib/invoice.ts).
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useLiveRefresh } from '@/components/fulfilment/use-live-refresh'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Money } from '@/components/shared/money'
import { StatusBadge } from '@/components/shared/status-badge'
import { ErrorState } from '@/components/shared/error-state'
import { EmptyState } from '@/components/shared/empty-state'
import { InvoicePosting } from '@/components/billing/invoice-posting'
import { AuditTimeline } from '@/components/billing/audit-timeline'
import {qty as fq, date as fd } from '@/components/billing/format'
import { downloadInvoicePdf } from '@/components/billing/invoice-pdf'

const PAY_ROLES = ['finance', 'admin']

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [inv, setInv] = useState<any>(null)
  const [role, setRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<'bank' | 'cash' | 'card'>('bank')
  const [reference, setReference] = useState('')

  // Set the instant the finance user types into the payment form; cleared
  // the instant load() repopulates it. A poll that overwrites a half-typed
  // payment amount back to the old amount_due is the one bug this screen
  // must never have — worse than being merely stale, it is actively wrong.
  const dirty = useRef(false)

  const load = useCallback(async () => {
    setError(null)
    const [r, m] = await Promise.all([fetch(`/api/invoices/${id}`), fetch('/api/auth/me')])
    const b = await r.json()
    if (!r.ok) return setError(b?.error?.message ?? 'Could not load the invoice')
    setInv(b.data)
    setAmount(String(Number(b.data.amount_due)))
    if (m.ok) setRole((await m.json()).data.role)
    dirty.current = false
  }, [id])

  useEffect(() => { load() }, [load])

  // A payment recorded by someone else on this invoice — or a status change
  // from a subscription's billing run — shows up here without a manual
  // reload, unless this user is mid-way through entering their own payment.
  useLiveRefresh(load, { isSafeToRefresh: () => !dirty.current && !busy })

  async function pay(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(null); setNotice(null)
    const res = await fetch(`/api/invoices/${id}/payments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: Number(amount), method, reference: reference || null }),
    })
    const b = await res.json()
    setBusy(false)
    if (!res.ok) return setError(b?.error?.message ?? 'Payment failed')
    setNotice(`Payment recorded. The invoice is now ${b.data.status}.`)
    setReference('')
    load()
  }

  if (error && !inv) {
    return (
      <div className="p-6">
        <ErrorState error={error} onRetry={load} />
      </div>
    )
  }
  if (!inv) return <div className="p-6 text-sm text-muted-foreground">Loading invoice…</div>

  const cur = inv.currency_code
  const canPay = role !== null && PAY_ROLES.includes(role)
  const settled = inv.status === 'paid' || inv.status === 'void'
  const p = inv.progress

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{inv.number}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {inv.customer_name}
            {inv.order_number && <> · order <Link className="underline underline-offset-2" href={`/fulfilment/${inv.order_id}`}>{inv.order_number}</Link></>}
            {inv.subscription_id && <> · subscription <Link className="underline underline-offset-2" href={`/subscriptions/${inv.subscription_id}`}>#{inv.subscription_id}</Link></>}
            {' '}· issued {fd(inv.issue_date)} · due {fd(inv.due_date)}
            {inv.is_overdue && <span className="ml-2 font-medium text-destructive">overdue</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={inv.kind} />
          <StatusBadge status={inv.status} />
          <Button variant="outline" onClick={() => downloadInvoicePdf(inv)}>Download PDF</Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 text-sm">
        {([['Confirmed', p.confirmed], ['Shipped', p.shipped], ['Invoiced', p.invoiced], ['Paid', p.paid]] as const).map(([label, done], i) => (
          <span key={label} className="flex items-center gap-1">
            {i > 0 && <span className="px-1 text-muted-foreground">→</span>}
            <span className={`rounded-full px-3 py-1 ${done ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
              {done ? '● ' : '○ '}{label}
            </span>
          </span>
        ))}
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Lines</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Unit price</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {inv.lines.map((l: any) => (
                  <TableRow key={l.id}>
                    <TableCell>{l.description}</TableCell>
                    <TableCell className="text-right tabular-nums">{fq(l.qty)}</TableCell>
                    <TableCell className="text-right"><Money value={l.unit_price} currency={cur} /></TableCell>
                    <TableCell className="text-right"><Money value={l.amount} currency={cur} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Balance</CardTitle>
            <CardDescription>Paid is SUM(payment.amount) — never a stored column.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span>Total</span><Money value={inv.amount_total} currency={cur} /></div>
            <div className="flex justify-between"><span>Paid</span><Money value={inv.amount_paid} currency={cur} /></div>
            <div className="flex justify-between border-t pt-2 font-medium"><span>Due</span><Money value={inv.amount_due} currency={cur} /></div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record a payment</CardTitle>
            <CardDescription>
              {settled
                ? 'This invoice is settled.'
                : canPay
                  ? 'Recording the payment and recomputing the status happen in one transaction.'
                  : 'Recording money received is a finance action — sign in as Finance to do it.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {settled || !canPay ? (
              <p className="text-sm text-muted-foreground">
                {settled ? 'Nothing outstanding.' : `Your role is ${role ?? 'unknown'}.`}
              </p>
            ) : (
              <form onSubmit={pay} className="space-y-3">
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground">Amount</label>
                    <Input type="number" step="0.01" min="0.01" className="w-36 text-right"
                      value={amount} onChange={(e) => { dirty.current = true; setAmount(e.target.value) }} required />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Method</label>
                    <Select value={method} onValueChange={(v) => { dirty.current = true; setMethod(v as any) }}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground">Reference</label>
                    <Input value={reference} onChange={(e) => { dirty.current = true; setReference(e.target.value) }} placeholder="NEFT-1234" />
                  </div>
                  <Button type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record payment'}</Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  A payment larger than the outstanding balance is refused rather than silently
                  creating a credit.
                </p>
              </form>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Payments</CardTitle></CardHeader>
          <CardContent>
            {inv.payments.length === 0 ? (
              <EmptyState title="Nothing received yet" description="Recording a payment here is what moves the invoice status." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Paid at</TableHead><TableHead>Method</TableHead>
                    <TableHead>Reference</TableHead><TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inv.payments.map((pm: any) => (
                    <TableRow key={pm.id}>
                      <TableCell>{fd(pm.paid_at)}</TableCell>
                      <TableCell>{pm.method}</TableCell>
                      <TableCell className="font-mono text-xs">{pm.reference ?? '—'}</TableCell>
                      <TableCell className="text-right"><Money value={pm.amount} currency={cur} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {inv.credit_notes?.length > 0 && (
              <>
                <h3 className="mt-4 text-sm font-medium">Credit notes</h3>
                <Table>
                  <TableBody>
                    {inv.credit_notes.map((cn: any) => (
                      <TableRow key={cn.id}>
                        <TableCell className="font-mono text-xs">{cn.number}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{cn.reason}</TableCell>
                        <TableCell className="text-right"><Money value={cn.amount} currency={cur} /></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Document states, GST reference and the credit-note reversal path.
          canPay is finance/admin, the same allow-list both endpoints use. */}
      <InvoicePosting invoice={inv} canWrite={canPay} onChanged={load} />

      <AuditTimeline entityType="invoice" entityId={Number(id)} title="Invoice history" />
    </div>
  )
}
