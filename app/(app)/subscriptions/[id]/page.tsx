// OWNER: D2.  Subscription detail — the proration ledger made readable.
//
// PS §B7.  Every mid-cycle change writes ONE immutable proration_event row,
// and the table at the bottom of this screen shows days_remaining and
// days_in_period next to the money, so the arithmetic can be checked by
// someone who does not trust the code that produced it:
//
//     delta = (new_rate − old_rate) × days_remaining ÷ days_in_period
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
import {qty as fq, date as fd, localDate } from '@/components/billing/format'

const CHANGE_ROLES = ['sales_manager', 'finance', 'admin']

export default function SubscriptionDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [sub, setSub] = useState<any>(null)
  const [role, setRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newQty, setNewQty] = useState('')
  const [newPlan, setNewPlan] = useState<string>('')
  const [effective, setEffective] = useState('')

  // Set on any edit to the change-plan form below; cleared the instant
  // load() repopulates it. Otherwise a manager mid-way through composing a
  // qty/plan change would see their own inputs reset by the very poll that
  // exists to show them someone ELSE'S change.
  const dirty = useRef(false)

  const load = useCallback(async () => {
    setError(null)
    const [r, m] = await Promise.all([fetch(`/api/subscriptions/${id}`), fetch('/api/auth/me')])
    const b = await r.json()
    if (!r.ok) return setError(b?.error?.message ?? 'Could not load the subscription')
    setSub(b.data)
    setNewQty(String(Number(b.data.qty)))
    setNewPlan(String(b.data.plan_id))
    if (m.ok) setRole((await m.json()).data.role)
    dirty.current = false
  }, [id])

  useEffect(() => { load() }, [load])

  // Another user's cancel/pause/proration on this subscription — or an
  // admin's plan-price edit on Settings — becomes visible here on its own,
  // unless this screen has an unsaved change-plan edit in flight.
  useLiveRefresh(load, { isSafeToRefresh: () => !dirty.current && !busy })

  async function post(path: string, body: unknown, label: string) {
    setBusy(true); setError(null); setNotice(null)
    const res = await fetch(`/api/subscriptions/${id}/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    const b = await res.json()
    setBusy(false)
    if (!res.ok) return setError(b?.error?.message ?? 'That did not work')
    setNotice(typeof label === 'string' ? label : 'Done')
    if (path === 'change' || path === 'cancel') {
      const d = b.data
      setNotice(
        `${d.deltaAmount >= 0 ? 'Charge' : 'Credit'} of ₹${Math.abs(d.deltaAmount).toFixed(2)} — ` +
        `${d.daysRemaining} of ${d.daysInPeriod} days remaining` +
        (d.creditNoteId ? ` · credit note issued` : ''),
      )
    }
    load()
  }

  if (error && !sub) {
    return (
      <div className="p-6">
        <ErrorState error={error} onRetry={load} />
      </div>
    )
  }
  if (!sub) return <div className="p-6 text-sm text-muted-foreground">Loading subscription…</div>

  const cur = sub.currency_code
  const canChange = role !== null && CHANGE_ROLES.includes(role)
  const active = sub.status === 'active'
  const elapsed = sub.days_in_period - sub.days_remaining
  const pct = sub.days_in_period > 0 ? Math.min(100, Math.max(0, (elapsed / sub.days_in_period) * 100)) : 0

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{sub.plan_name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sub.customer_name} · {fq(sub.qty)} × <Money value={sub.plan_price} currency={cur} /> per {sub.cycle}
            {sub.source_order_number && (
              <> · from <Link className="underline underline-offset-2" href={`/fulfilment/${sub.source_order_id}`}>{sub.source_order_number}</Link></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={sub.status} />
          <span className="text-lg font-semibold"><Money value={sub.period_amount} currency={cur} /></span>
        </div>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Current period</CardTitle>
          <CardDescription>
            {fd(sub.current_period_start)} → {fd(sub.current_period_end)} ·{' '}
            {sub.days_remaining} of {sub.days_in_period} days remaining ·{' '}
            {sub.next_bill_date ? <>next bill {fd(sub.next_bill_date)}</> : 'no further billing'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-sky-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            Proration is charged on the remaining fraction of this bar. Dates are computed in
            Postgres, not JavaScript — <code className="font-mono">date − date</code> is an exact
            integer number of days and needs no timezone reasoning.
          </p>
        </CardContent>
      </Card>

      {sub.status !== 'cancelled' && canChange && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className={active ? '' : 'opacity-60'}>
            <CardHeader>
              <CardTitle className="text-base">Change mid-cycle</CardTitle>
              <CardDescription>Writes one immutable ledger row. A negative delta becomes a credit note.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className="text-xs text-muted-foreground">Quantity</label>
                  <Input type="number" min="0.001" step="1" className="w-28 text-right"
                    value={newQty} onChange={(e) => { dirty.current = true; setNewQty(e.target.value) }} />
                </div>
                <div className="min-w-52 flex-1">
                  <label className="text-xs text-muted-foreground">Plan</label>
                  <Select value={newPlan} onValueChange={(v) => { dirty.current = true; setNewPlan(v ?? newPlan) }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {sub.available_plans.map((p: any) => (
                        <SelectItem key={p.id} value={String(p.id)}>
                          {p.name} — {p.cycle}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Effective</label>
                  <Input type="date" value={effective} onChange={(e) => { dirty.current = true; setEffective(e.target.value) }} />
                </div>
              </div>
              <Button disabled={busy || !active} onClick={() => post('change', {
                newQty: Number(newQty),
                newPlanId: Number(newPlan),
                ...(effective ? { effectiveDate: effective } : {}),
              }, 'Change applied.')}>
                Apply change
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Billing actions</CardTitle>
              <CardDescription>
                Refund policy on this plan is <strong>{sub.cancellation_refund}</strong>
                {sub.cancellation_notice_days > 0 && (
                  <> with <strong>{sub.cancellation_notice_days} days notice</strong> — cancelling
                  today takes effect on {localDate(new Date(Date.now() + sub.cancellation_notice_days * 864e5))},
                  and only the days after that are refunded</>
                )}.
                {' '}Pausing stops future billing without refunding the current period.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {active ? (
                <>
                  <Button variant="outline" disabled={busy}
                    onClick={() => post('invoice', {}, 'Period invoiced and rolled forward.')}>
                    Invoice this period
                  </Button>
                  <Button variant="secondary" disabled={busy}
                    onClick={() => post('pause', {}, 'Paused. No further billing until it is resumed.')}>
                    Pause
                  </Button>
                </>
              ) : (
                <Button variant="secondary" disabled={busy}
                  onClick={() => post('resume', {}, 'Resumed on a fresh period.')}>
                  Resume
                </Button>
              )}
              <Button variant="destructive" disabled={busy}
                onClick={() => post('cancel', effective ? { effectiveDate: effective } : {}, 'Cancelled.')}>
                Cancel subscription
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proration ledger</CardTitle>
          <CardDescription>
            Append-only. Rows are never updated and never deleted — the day counts are stored
            alongside the money so the arithmetic stays checkable after the fact.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sub.events.length === 0 ? (
            <EmptyState title="No changes yet" description="A mid-cycle quantity or plan change writes one immutable row here." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Event</TableHead><TableHead>Effective</TableHead>
                    <TableHead>Qty</TableHead><TableHead>Plan</TableHead>
                    <TableHead className="text-right">Days left</TableHead>
                    <TableHead className="text-right">Days in period</TableHead>
                    <TableHead className="text-right">Delta</TableHead>
                    <TableHead>Credit note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sub.events.map((e: any) => (
                    <TableRow key={e.id}>
                      <TableCell><StatusBadge status={e.event_type} /></TableCell>
                      <TableCell>{fd(e.effective_date)}</TableCell>
                      <TableCell className="tabular-nums">{fq(e.old_qty)} → {fq(e.new_qty)}</TableCell>
                      <TableCell className="text-sm">
                        {e.old_plan_name === e.new_plan_name ? e.new_plan_name : `${e.old_plan_name} → ${e.new_plan_name}`}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{e.days_remaining}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.days_in_period}</TableCell>
                      <TableCell className={`text-right ${Number(e.delta_amount) < 0 ? 'text-emerald-700 dark:text-emerald-400' : ''}`}>
                        <Money value={e.delta_amount} currency={cur} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{e.credit_note_number ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Invoices</CardTitle></CardHeader>
        <CardContent>
          {sub.invoices.length === 0 ? (
            <EmptyState title="Nothing billed yet" description="The first invoice is raised when the period is billed." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead><TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sub.invoices.map((i: any) => (
                  <TableRow key={i.id}>
                    <TableCell><Link className="underline underline-offset-2" href={`/invoices/${i.id}`}>{i.number}</Link></TableCell>
                    <TableCell className="text-right"><Money value={i.amount_total} currency={cur} /></TableCell>
                    <TableCell className="text-right"><Money value={i.amount_paid} currency={cur} /></TableCell>
                    <TableCell><StatusBadge status={i.status} /></TableCell>
                    <TableCell>{fd(i.due_date)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
