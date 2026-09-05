// OWNER: D1.  Screen 6 — Approval Detail.
//
// The reviewer's screen. Everything on it is data that already exists; nothing
// here is invented in the UI.
//
// Two things it must get right, both from the mockup and PS §B4:
//
//  • "Why This Quote Was Flagged" — the per-line table showing Discount Given
//    against Limit Allowed and how far Over By. The point of the screen is
//    that the manager can see WHICH line broke WHICH limit, not just a score.
//
//  • Finance only appears when it is actually required, and cannot act until
//    the manager has approved. That ordering is enforced in the API too
//    (lib/approval.ts) — hiding the button is presentation, not a rule.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { ErrorState } from '@/components/shared/error-state'
import { Money } from '@/components/shared/money'

type Detail = {
  request: any
  breakdown: any[]
  chain: any[]
  auditTrail: any[]
  isStale: boolean
}

export default function ApprovalDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [d, setD] = useState<Detail | null>(null)
  const [me, setMe] = useState<any>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    const [r, m] = await Promise.all([fetch(`/api/approvals/${id}`), fetch('/api/auth/me')])
    const b = await r.json()
    if (!r.ok) return setError(b?.error?.message ?? 'Could not load this approval')
    setD(b.data)
    if (m.ok) setMe((await m.json()).data)
  }, [id])

  useEffect(() => { load() }, [load])

  async function act(status: 'approved' | 'returned' | 'rejected') {
    if (status !== 'approved' && !note.trim()) {
      return setError('A reason is required when returning or rejecting.')
    }
    setBusy(true); setError(null); setNotice(null)
    const res = await fetch(`/api/approvals/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, note: note.trim() || undefined }),
    })
    const b = await res.json()
    setBusy(false)
    if (!res.ok) return setError(b?.error?.message ?? 'That did not work')
    setNote('')
    setNotice(
      status === 'approved'
        ? b.data.isApproved
          ? 'Approved. Every required level has now signed — the quotation is approved.'
          : 'Approved. It still needs the next level in the chain.'
        : status === 'returned'
          ? 'Returned to the rep for revision.'
          : 'Rejected.',
    )
    load()
  }

  if (error && !d) return <div className="p-6"><ErrorState error={error} onRetry={load} /></div>
  if (!d) return <div className="p-6 text-sm text-muted-foreground">Loading approval…</div>

  const r = d.request
  const cur = r.currency_code
  const worst = d.breakdown.filter((b) => Number(b.over_by) > 0)

  // Can THIS user act on THIS row, right now?
  const myLevel = me?.role === 'finance' ? 'finance' : 'sales_manager'
  const managerStep = d.chain.find((c) => c.level === 'sales_manager')
  const blockedByOrder = r.level === 'finance' && managerStep && managerStep.status !== 'approved'
  const canAct =
    r.status === 'pending' &&
    !d.isStale &&
    !blockedByOrder &&
    (me?.role === 'admin' || r.level === myLevel)

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <Link href={`/quotations/${r.quotation_id}`} className="underline underline-offset-4">
              {r.number}
            </Link>
            <StatusBadge status={r.level} />
            <StatusBadge status={r.status} />
          </span>
        }
        description={
          <>
            {r.customer_name} · <StatusBadge status={r.tier_name?.toLowerCase()} label={r.tier_name} />{' '}
            tier ceiling {Number(r.tier_ceiling_pct).toFixed(0)}% ·{' '}
            <Badge variant="outline" className="font-mono text-xs">v{r.quotation_version}</Badge>
          </>
        }
        actions={<Button variant="outline" onClick={() => router.push('/approvals')}>Back</Button>}
      />

      {/* A superseded approval is dead. Acting on it would resurrect approval
          for terms nobody is looking at any more — the API refuses it too. */}
      {d.isStale && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3">
          <p className="text-sm font-medium text-red-300">This approval is out of date.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It was raised for version {r.quotation_version}; the quotation is now on version{' '}
            {r.current_version}. The terms changed after it was raised, so it cannot be actioned —
            the quotation has to be resubmitted and approved again.
          </p>
        </div>
      )}

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{notice}</p>}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Blended risk">
          <span className="flex items-center gap-2">
            <span className="text-lg font-semibold tabular-nums">{Number(r.risk_score).toFixed(2)}</span>
            <StatusBadge status={r.risk_band?.toLowerCase()} label={r.risk_band} />
          </span>
        </Tile>
        <Tile label="Approval needed">
          <span className="text-sm">
            {r.requires_finance ? 'Manager, then Finance' : r.requires_manager ? 'Sales Manager' : 'None'}
          </span>
        </Tile>
        <Tile label="Order value"><Money value={r.grand_total} currency={cur} /></Tile>
        <Tile label="Margin">
          <span className={Number(r.margin_total) < 0 ? 'text-red-400' : 'text-emerald-400'}>
            <Money value={r.margin_total} currency={cur} />
          </span>
        </Tile>
      </div>

      {/* ── Why this quote was flagged ─────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Why this quote was flagged</CardTitle>
          <CardDescription>
            Every line is measured against its own limit — the lower of the customer tier and the
            product category. {worst.length === 0
              ? 'No line is over its limit.'
              : worst.length === 1
                ? 'One line broke its limit, and that alone flags the whole quotation.'
                : `${worst.length} lines are over their limits.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line</TableHead>
                <TableHead>Category</TableHead>
                <TableHead className="text-right">Discount given</TableHead>
                <TableHead className="text-right">Limit allowed</TableHead>
                <TableHead className="text-right">Over by</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.breakdown.map((b) => {
                const over = Number(b.over_by)
                return (
                  <TableRow key={b.line_no} className={over > 0 ? 'bg-red-400/5' : undefined}>
                    <TableCell className="font-medium">{b.product_name}</TableCell>
                    <TableCell className="text-muted-foreground">{b.category_name}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(b.discount_given).toFixed(2)}%</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {Number(b.limit_allowed).toFixed(2)}%
                    </TableCell>
                    <TableCell className="text-right">
                      {over > 0
                        ? <StatusBadge status="high" label={`+${over.toFixed(0)} pt`} />
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="text-right"><Money value={b.net_amount} currency={cur} /></TableCell>
                    <TableCell className={`text-right ${Number(b.margin_amount) < 0 ? 'text-red-400' : ''}`}>
                      <Money value={b.margin_amount} currency={cur} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            The blended score is the worse of the single worst line and the value-weighted average
            across the order, so neither one badly-over line nor many slightly-over lines can slip
            through. The band decides who signs — and the bands are editable on the
            configuration screen, not written into the code.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── The chain ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approval chain</CardTitle>
            <CardDescription>Recorded against version {r.quotation_version}.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-2">
              <Step label="Submitted" done />
              {d.chain.map((c) => (
                <Step
                  key={c.id}
                  label={c.level === 'finance' ? 'Finance' : 'Sales Manager'}
                  done={c.status === 'approved'}
                  status={c.status}
                  who={c.acted_by_name ?? c.assigned_to_name}
                  note={c.note}
                />
              ))}
              <Step label="Confirmed" done={r.quotation_state === 'confirmed'} />
            </ol>
            {/* Finance is shown only when required — PS §B4 says so explicitly. */}
            {!r.requires_finance && (
              <p className="mt-3 text-xs text-muted-foreground">
                Finance is not in this chain — the blended risk did not reach the band that needs it.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ── Act ─────────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Decision</CardTitle>
            <CardDescription>
              {r.status !== 'pending'
                ? `Already ${r.status}.`
                : d.isStale
                  ? 'Out of date — cannot be actioned.'
                  : blockedByOrder
                    ? 'Waiting on the sales manager. Finance is the second step of the chain.'
                    : canAct
                      ? 'A reason is required to return or reject. It is written to the audit trail.'
                      : `This step belongs to ${r.level === 'finance' ? 'Finance' : 'the Sales Manager'}.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              placeholder="Reason (required to return or reject)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!canAct || busy}
              rows={3}
            />
            <div className="flex flex-wrap gap-2">
              <Button disabled={!canAct || busy} onClick={() => act('approved')}>Approve</Button>
              <Button variant="outline" disabled={!canAct || busy} onClick={() => act('returned')}>
                Return for Revision
              </Button>
              <Button variant="destructive" disabled={!canAct || busy} onClick={() => act('rejected')}>
                Reject
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Audit trail — PS §A3: user, timestamp AND reason ───────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Audit trail</CardTitle>
          <CardDescription>Every approval, rejection and edit, with who, when and why.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.auditTrail.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.actor_name ?? 'system'}</TableCell>
                  <TableCell className="capitalize">{a.action.replace(/_/g, ' ')}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(a.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{a.note ?? '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </div>
  )
}

function Step({
  label, done, status, who, note,
}: {
  label: string; done?: boolean; status?: string; who?: string | null; note?: string | null
}) {
  return (
    <li className="flex items-start gap-3 rounded-md border px-3 py-2">
      <span
        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
          done ? 'bg-emerald-400' : status === 'pending' ? 'bg-amber-400' : 'bg-muted-foreground/40'
        }`}
      />
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-sm font-medium">
          {label}
          {status && <StatusBadge status={status} />}
        </div>
        {who && <div className="text-xs text-muted-foreground">{who}</div>}
        {note && <div className="mt-0.5 text-xs text-muted-foreground">{note}</div>}
      </div>
    </li>
  )
}
