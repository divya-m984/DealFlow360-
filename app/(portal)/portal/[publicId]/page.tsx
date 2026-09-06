// OWNER: D1.  Screen 11 — Customer Portal Negotiation.
//
// ADDRESSED BY public_id (uuid), NEVER by the integer id. A portal user must
// not be able to reach another customer's quotation by incrementing a number
// in the URL — and the handler behind this page re-checks row ownership on
// every request regardless, because a uuid makes enumeration impractical but
// is not authorisation on its own.
//
// The customer sees LESS than the rep, and not because the UI hides it: cost,
// margin, the per-line ceiling, the risk score and the audit trail are not in
// the API response at all.
//
// PS §B8: line-level comments, a counter discount, a requested delivery date,
// Submit Request and Confirm Quotation. If accepted terms exceed the
// thresholds, the quotation re-enters approval automatically — the customer
// sees that happen here as "waiting on internal approval".
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/components/shared/status-badge'
import { ErrorState } from '@/components/shared/error-state'
import { Money, Num, DateValue } from '@/components/shared/money'

type Line = {
  id: number; line_no: number; product_name: string; category_name: string
  line_type: 'one_time' | 'recurring'; plan_name: string | null; plan_cycle: string | null
  qty: string; unit_price: string; discount_pct: string; net_amount: string
}
type Comment = {
  id: number; quotation_line_id: number | null; comment: string
  created_at: string
  /** Stored per message by db/seed/00-migrations.sql; null only on a comment
   *  left unattributed. */
  author_name: string | null
  author_side: 'buyer' | 'seller' | null
}
type Req = {
  id: number; counter_discount_pct: string | null; requested_delivery_date: string | null
  status: string; created_at: string
  comments: Comment[]
}
type Data = {
  quotation: any; lines: Line[]; requests: Req[]
  canNegotiate: boolean; canConfirm: boolean; repName: string
}

export default function PortalQuotationPage() {
  const { publicId } = useParams<{ publicId: string }>()
  const router = useRouter()

  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [counter, setCounter] = useState('')
  const [wantDate, setWantDate] = useState('')
  const [lineComments, setLineComments] = useState<Record<number, string>>({})
  const [reply, setReply] = useState('')

  const load = useCallback(async () => {
    setError(null)
    const r = await fetch(`/api/portal/quotations/${publicId}`)
    const b = await r.json()
    if (!r.ok) return setError(b?.error?.message ?? 'Could not load this quotation')
    setD(b.data)
  }, [publicId])

  useEffect(() => { load() }, [load])

  /**
   * Reply to the rep WITHOUT raising a new counter-offer.
   *
   * This did not exist before review 2, and its absence is what stopped the
   * feature being a conversation: a new request supersedes the live one and
   * the request form is disabled while a request is open, so once the customer
   * had asked for something they could not say another word until the rep
   * ruled on it.  A message-only body appends to the open request instead.
   */
  async function sendReply() {
    const message = reply.trim()
    if (!message) return
    setBusy(true); setError(null); setNotice(null)
    const r = await fetch(`/api/portal/quotations/${publicId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    const b = await r.json()
    setBusy(false)
    if (!r.ok) return setError(b?.error?.message ?? 'Could not send that message')
    setReply('')
    setNotice('Message sent.')
    await load()
  }

  async function submitRequest() {
    setBusy(true); setError(null); setNotice(null)
    const comments = Object.entries(lineComments)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => ({ quotationLineId: Number(k), comment: v.trim() }))
    const res = await fetch(`/api/portal/quotations/${publicId}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        counterDiscountPct: counter ? Number(counter) : null,
        requestedDeliveryDate: wantDate || null,
        comments,
      }),
    })
    const b = await res.json()
    setBusy(false)
    if (!res.ok) return setError(b?.error?.message ?? 'Could not send your request')
    setCounter(''); setWantDate(''); setLineComments({})
    setNotice('Sent to your sales rep. They will come back to you here.')
    load()
  }

  async function confirm() {
    setBusy(true); setError(null); setNotice(null)
    const res = await fetch(`/api/portal/quotations/${publicId}`, { method: 'PUT' })
    const b = await res.json()
    setBusy(false)
    if (!res.ok) return setError(b?.error?.message ?? 'Could not confirm')
    setNotice('Confirmed. Your order is being prepared.')
    load()
  }

  if (error && !d) return <div className="p-6"><ErrorState error={error} onRetry={load} /></div>
  if (!d) return <div className="p-6 text-sm text-muted-foreground">Loading your quotation…</div>

  const q = d.quotation
  const cur = q.currency_code
  const open = d.requests.find((r) => r.status === 'open')
  const settled = d.requests.filter((r) => r.status !== 'open')

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-lg font-semibold">
            {q.number}
            <StatusBadge
              status={q.state}
              label={
                q.state === 'negotiation' ? 'Under negotiation'
                  : q.state === 'approved' ? 'Sent to you'
                  : q.state === 'pending_approval' ? 'With the sales team'
                  : undefined
              }
            />
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {q.customer_name} · your rep is {d.repName} · updated <DateValue value={q.last_activity_at} />
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push('/portal')}>All quotations</Button>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{notice}</p>}

      {/* The customer's view of where things stand. This is what makes the
          re-approval loop legible from their side rather than a dead button. */}
      {q.state === 'pending_approval' && (
        <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-4 py-3 text-sm">
          <p className="font-medium text-amber-300">Your request is being reviewed internally.</p>
          <p className="mt-1 text-muted-foreground">
            The terms you asked for need sign-off from the sales team before you can confirm.
            You will be able to confirm here once that is done.
          </p>
        </div>
      )}
      {q.state === 'confirmed' && (
        <div className="rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm">
          <p className="font-medium text-emerald-400">Confirmed — thank you.</p>
          <p className="mt-1 text-muted-foreground">Your order is being prepared for fulfilment.</p>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your quotation</CardTitle>
          <CardDescription>
            Add a comment on any line if something needs changing.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Price</TableHead>
                  <TableHead className="text-right">Discount</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.lines.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell>
                      <div className="font-medium">{l.product_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.category_name}
                        {l.line_type === 'recurring' && ` · ${l.plan_name} (${l.plan_cycle})`}
                      </div>
                      {d.canNegotiate && !open && (
                        <Input
                          className="mt-2 h-8"
                          placeholder="Comment on this line…"
                          value={lineComments[l.id] ?? ''}
                          onChange={(e) =>
                            setLineComments((s) => ({ ...s, [l.id]: e.target.value }))
                          }
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right"><Num value={l.qty} /></TableCell>
                    <TableCell className="text-right"><Money value={l.unit_price} currency={cur} /></TableCell>
                    <TableCell className="text-right tabular-nums">
                      {Number(l.discount_pct).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right"><Money value={l.net_amount} currency={cur} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="ml-auto w-full max-w-xs space-y-1 text-sm">
            <Row label="Subtotal"><Money value={q.subtotal} currency={cur} /></Row>
            <Row label="Discount">−<Money value={q.discount_total} currency={cur} /></Row>
            <Row label="Tax"><Money value={q.tax_total} currency={cur} /></Row>
            <div className="border-t pt-1">
              <Row label="Total" bold><Money value={q.grand_total} currency={cur} /></Row>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Ask for changes ────────────────────────────────────────────── */}
      {d.canNegotiate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Request a change</CardTitle>
            <CardDescription>
              {open
                ? 'Your request is with the sales team. You can send another once they respond.'
                : 'Ask for a different discount or delivery date. Your rep sees it immediately.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Counter discount (%)
                </label>
                <Input
                  className="w-36" placeholder="e.g. 22" value={counter}
                  disabled={!!open || busy}
                  onChange={(e) => setCounter(e.target.value)}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Requested delivery date
                </label>
                <Input
                  className="w-48" type="date" value={wantDate}
                  disabled={!!open || busy}
                  onChange={(e) => setWantDate(e.target.value)}
                />
              </div>
              <Button disabled={!!open || busy} onClick={submitRequest}>Submit Request</Button>
              <Button
                variant="outline"
                disabled={!d.canConfirm || busy}
                onClick={confirm}
                title={!d.canConfirm ? 'Settle your open request first' : undefined}
              >
                Confirm Quotation
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              If the terms you ask for go beyond what your rep can approve alone, the quotation
              goes back through internal approval automatically before you can confirm.
            </p>
          </CardContent>
        </Card>
      )}

      {/* ── Conversation ──────────────────────────────────────────────── */}
      {(open || settled.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conversation</CardTitle>
            <CardDescription>
              Everything you and {d.repName} have said about this quotation.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Oldest first, so the newest message sits next to the reply box.
                Requests are flattened into one timeline: the data model keeps
                them separate because only one ask may be live at a time, but
                that is a rule about offers, not about how a conversation
                reads. */}
            {[...(open ? [open] : []), ...settled]
              .slice()
              .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))
              .map((r) => (
                <div key={r.id} className="space-y-2">
                  <div className="rounded-md border border-dashed px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <StatusBadge status={r.status === 'open' ? 'pending' : r.status} />
                      {r.counter_discount_pct != null && (
                        <span>you asked for {Number(r.counter_discount_pct).toFixed(0)}%</span>
                      )}
                      {r.requested_delivery_date && (
                        <span className="text-muted-foreground">
                          · delivery by <DateValue value={r.requested_delivery_date} />
                        </span>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground">
                        <DateValue value={r.created_at} />
                      </span>
                    </div>
                  </div>

                  {r.comments.length > 0 && (
                    <ul className="space-y-2">
                      {r.comments.map((c) => {
                        // Sides differ by ALIGNMENT as well as colour, so the
                        // thread survives being read without colour vision.
                        const mine = c.author_side !== 'seller'
                        return (
                          <li
                            key={c.id}
                            className={`flex flex-col gap-1 ${mine ? 'items-start' : 'items-end'}`}
                          >
                            <div
                              className={`max-w-[85%] rounded-lg border px-3 py-2 text-sm ${
                                mine ? 'bg-muted' : 'border-primary/25 bg-primary/10'
                              }`}
                            >
                              {c.comment}
                              {c.quotation_line_id && (
                                <span className="mt-1 block text-xs text-muted-foreground">
                                  on{' '}
                                  {d.lines.find((l) => l.id === c.quotation_line_id)?.product_name ??
                                    'a line'}
                                </span>
                              )}
                            </div>
                            <span className="px-1 text-xs text-muted-foreground">
                              {mine ? 'You' : (c.author_name ?? d.repName)} ·{' '}
                              <DateValue value={c.created_at} />
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              ))}

            {/* The reply box only appears while a request is live — there is
                nothing on the seller's side listening otherwise, and an input
                that silently fails is worse than no input. */}
            {open ? (
              <form
                className="flex gap-2 border-t pt-3"
                onSubmit={(e) => { e.preventDefault(); sendReply() }}
              >
                <Input
                  value={reply}
                  onChange={(e) => setReply(e.currentTarget.value)}
                  placeholder={`Message ${d.repName}…`}
                  aria-label="Message your sales rep"
                  disabled={busy}
                />
                <Button type="submit" disabled={busy || reply.trim() === ''}>Send</Button>
              </form>
            ) : (
              <p className="border-t pt-3 text-xs text-muted-foreground">
                This request is closed. Send a new change request above to reopen the
                conversation.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function Row({ label, children, bold }: { label: string; children: React.ReactNode; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-muted-foreground'}>{label}</span>
      <span>{children}</span>
    </div>
  )
}
