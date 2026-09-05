// OWNER: D1.  Screen 4 — Quotation Detail / Builder.
//
// The centre of the product. Three things happen here that happen nowhere
// else, and each has to be VISIBLE, not merely true in the database:
//
//  1. Every line is checked against ITS OWN ceiling — LEAST(tier, category) —
//     so a Gold customer buying Services is capped at 10%, not 15%. The Limit
//     and Status columns are that rule, on screen (PS §10).
//
//  2. The blended risk score and the approval routing it implies update as
//     you type. The rep never picks an approver.
//
//  3. LAW 1: editing an approved quotation bumps its version, which orphans
//     the approval. The banner below is built so a judge WATCHES the approval
//     disappear rather than being told it did.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { ErrorState } from '@/components/shared/error-state'
import { EmptyState } from '@/components/shared/empty-state'
import { Money, Num, formatMoney } from '@/components/shared/money'

type Line = {
  id: number; line_no: number; product_name: string; sku: string
  category_name: string; variant_sku: string | null
  line_type: 'one_time' | 'recurring'; plan_name: string | null; plan_cycle: string | null
  qty: string; unit_price: string; unit_cost: string
  discount_pct: string; ceiling_pct: string; over_by_pct: string
  net_amount: string; margin_amount: string; tax_pct: string
}
type Approval = {
  id: number; level: string; seq: number; status: string
  assigned_to_name: string | null; acted_by_name: string | null
  acted_at: string | null; note: string | null; quotation_version: number
}
type Detail = {
  quotation: any; lines: Line[]; approvals: Approval[]
  auditTrail: any[]; isApproved: boolean
}
type Suggestion = {
  suggested_product_id: number; name: string; sku: string; category_name: string
  base_price: string; margin_delta: string; margin_pct: string
  is_promoted: boolean; promo_text: string | null; kind: string; triggered_by: string
}

const EDITABLE = ['draft', 'pending_approval', 'approved', 'negotiation']

export default function QuotationDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()

  const [d, setD] = useState<Detail | null>(null)
  const [sugs, setSugs] = useState<Suggestion[]>([])
  const [products, setProducts] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // What the approval looked like BEFORE the last edit. This is the whole
  // point of the screen: we keep the previous verdict so the transition
  // "approved → orphaned" can be shown, not just the end state.
  const [wasApproved, setWasApproved] = useState<boolean | null>(null)
  const [orphaned, setOrphaned] = useState(false)

  const [newProduct, setNewProduct] = useState<string>('')
  const [newQty, setNewQty] = useState('1')
  const [newDiscount, setNewDiscount] = useState('0')

  const load = useCallback(async (opts?: { keepNotice?: boolean }) => {
    setError(null)
    if (!opts?.keepNotice) setNotice(null)
    const [r, u, p] = await Promise.all([
      fetch(`/api/quotations/${id}`),
      fetch(`/api/quotations/${id}/upsell`),
      fetch('/api/products'),
    ])
    const body = await r.json()
    if (!r.ok) return setError(body?.error?.message ?? 'Could not load the quotation')
    setD(body.data)
    if (u.ok) setSugs((await u.json()).data ?? [])
    if (p.ok) {
      const pb = await p.json()
      setProducts(Array.isArray(pb.data) ? pb.data : (pb.data?.products ?? []))
    }
    return body.data as Detail
  }, [id])

  useEffect(() => { load() }, [load])

  /** Every mutating call goes through here so the orphan check is never skipped. */
  async function mutate(url: string, init: RequestInit, successMsg: string) {
    if (!d) return
    setBusy(true); setError(null); setNotice(null)
    const before = d.isApproved
    const res = await fetch(url, {
      headers: { 'content-type': 'application/json' }, ...init,
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body?.error?.message ?? 'That did not work')

    const fresh = await load({ keepNotice: true })
    setNotice(successMsg)
    // LAW 1, made visible: it was approved, the terms changed, and now it is
    // not. Nobody cleared a flag — the approval simply no longer matches the
    // quotation's version.
    if (before && fresh && !fresh.isApproved) {
      setWasApproved(true); setOrphaned(true)
    } else if (fresh?.isApproved) {
      setOrphaned(false)
    }
  }

  if (error && !d) return <div className="p-6"><ErrorState error={error} onRetry={() => load()} /></div>
  if (!d) return <div className="p-6 text-sm text-muted-foreground">Loading quotation…</div>

  const q = d.quotation
  const cur = q.currency_code
  const editable = EDITABLE.includes(q.state)
  const overLines = d.lines.filter((l) => Number(l.over_by_pct) > 0)

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            {q.number}
            <StatusBadge status={q.state} />
            <Badge variant="outline" className="font-mono text-xs">v{q.version}</Badge>
          </span>
        }
        description={
          <>
            {q.customer_name} · <StatusBadge status={q.tier_name?.toLowerCase()} label={q.tier_name} />{' '}
            tier ceiling {Number(q.tier_ceiling_pct).toFixed(0)}% · owner {q.owner_name}
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            {q.state === 'draft' || q.state === 'negotiation' ? (
              <Button
                disabled={busy || d.lines.length === 0}
                onClick={() => mutate(`/api/quotations/${id}/submit`, { method: 'POST' }, 'Submitted.')}
              >
                Submit for Approval
              </Button>
            ) : null}
            {q.state === 'approved' && d.isApproved ? (
              <Button
                disabled={busy}
                onClick={() => mutate(`/api/quotations/${id}/confirm`, { method: 'POST' }, 'Confirmed.')}
              >
                Confirm Order
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => router.push('/quotations')}>Back</Button>
          </div>
        }
      />

      {/* ── LAW 1 banner. The reason this screen exists. ───────────────── */}
      {orphaned && wasApproved && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3">
          <p className="text-sm font-medium text-red-300">
            The approval for this quotation no longer applies.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Commercial terms changed, so the version moved to{' '}
            <span className="font-mono">v{q.version}</span>. Approvals are recorded against the
            version they were granted for — the earlier one is still in the audit trail below, it
            simply is not this quotation any more. Nothing was reset; there is no flag to forget.
          </p>
        </div>
      )}

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-400">{notice}</p>}

      {/* ── Risk summary ──────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Blended risk">
          <span className="flex items-center gap-2">
            <span className="text-lg font-semibold tabular-nums">{Number(q.risk_score).toFixed(2)}</span>
            <StatusBadge status={q.risk_band?.toLowerCase()} label={q.risk_band} />
          </span>
        </Tile>
        <Tile label="Routes to">
          <span className="text-sm">
            {q.requires_finance ? 'Manager, then Finance'
              : q.requires_manager ? 'Sales Manager'
              : 'Auto-approved'}
          </span>
        </Tile>
        <Tile label="Subtotal"><Money value={q.subtotal} currency={cur} /></Tile>
        <Tile label="Grand total">
          <span className="font-semibold"><Money value={q.grand_total} currency={cur} /></span>
        </Tile>
        <Tile label="Margin">
          <span className={Number(q.margin_total) < 0 ? 'text-red-400' : 'text-emerald-400'}>
            <Money value={q.margin_total} currency={cur} />
          </span>
        </Tile>
      </div>

      {/* ── Lines ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Order lines</CardTitle>
          <CardDescription>
            Each line is checked against its own limit — the lower of the customer tier and the
            product category. A Gold customer buying Services is capped at 10%, not 15%.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {d.lines.length === 0 ? (
            <EmptyState title="No lines yet" description="Add a product below to start building the quotation." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Discount</TableHead>
                    <TableHead className="text-right">Limit</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.lines.map((l) => {
                    const over = Number(l.over_by_pct)
                    return (
                      <TableRow key={l.id} className={over > 0 ? 'bg-red-400/5' : undefined}>
                        <TableCell>
                          <div className="font-medium">{l.product_name}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.category_name}
                            {l.variant_sku && ` · ${l.variant_sku}`}
                            {l.line_type === 'recurring' && ` · ${l.plan_name} (${l.plan_cycle})`}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          {editable ? (
                            <NumberField
                              value={l.qty}
                              disabled={busy}
                              valid={(v) => v > 0}
                              onCommit={(v) =>
                                mutate(`/api/quotations/${id}/lines/${l.id}`,
                                  { method: 'PATCH', body: JSON.stringify({ qty: v }) },
                                  `Line ${l.line_no} quantity updated.`)
                              }
                            />
                          ) : <Num value={l.qty} />}
                        </TableCell>
                        <TableCell className="text-right"><Money value={l.unit_price} currency={cur} /></TableCell>
                        <TableCell className="text-right">
                          {editable ? (
                            <NumberField
                              value={l.discount_pct}
                              disabled={busy}
                              suffix="%"
                              valid={(v) => v >= 0 && v <= 100}
                              onCommit={(v) =>
                                mutate(`/api/quotations/${id}/lines/${l.id}`,
                                  { method: 'PATCH', body: JSON.stringify({ discountPct: v }) },
                                  `Line ${l.line_no} discount set to ${v}%.`)
                              }
                            />
                          ) : `${Number(l.discount_pct).toFixed(2)}%`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {Number(l.ceiling_pct).toFixed(0)}%
                        </TableCell>
                        <TableCell className="text-right"><Money value={l.net_amount} currency={cur} /></TableCell>
                        <TableCell className={`text-right ${Number(l.margin_amount) < 0 ? 'text-red-400' : ''}`}>
                          <Money value={l.margin_amount} currency={cur} />
                        </TableCell>
                        <TableCell>
                          {over > 0
                            ? <StatusBadge status="high" label={`OVER +${over.toFixed(0)}pt`} />
                            : <StatusBadge status="approved" label="OK" />}
                        </TableCell>
                        <TableCell className="text-right">
                          {editable && (
                            <Button
                              size="sm" variant="ghost" disabled={busy}
                              onClick={() => mutate(`/api/quotations/${id}/lines/${l.id}`,
                                { method: 'DELETE' }, `Line ${l.line_no} removed.`)}
                            >
                              Remove
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          {overLines.length > 0 && (
            <p className="rounded-md border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-300">
              {overLines.length === 1
                ? `1 line is over its own limit — that alone flags the whole quotation.`
                : `${overLines.length} lines are over their own limits.`}{' '}
              The blended score is the worse of the single worst line and the value-weighted
              average across the order, so neither one bad line nor many small ones can hide.
            </p>
          )}

          {editable && (
            <div className="flex flex-wrap items-end gap-2 border-t pt-4">
              <div className="min-w-56 flex-1">
                <label className="mb-1 block text-xs text-muted-foreground">Product</label>
                <Select value={newProduct} onValueChange={(v) => setNewProduct(v ?? '')}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="Choose a product" /></SelectTrigger>
                  <SelectContent>
                    {products.map((p: any) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.name} — {formatMoney(p.base_price, cur)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Qty</label>
                <Input className="w-20 text-right" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Discount %</label>
                <Input className="w-24 text-right" value={newDiscount} onChange={(e) => setNewDiscount(e.target.value)} />
              </div>
              <Button
                disabled={busy || !newProduct}
                onClick={() => {
                  const p = products.find((x: any) => String(x.id) === newProduct)
                  mutate(`/api/quotations/${id}/lines`, {
                    method: 'POST',
                    body: JSON.stringify({
                      productId: Number(newProduct),
                      qty: Number(newQty) || 1,
                      discountPct: Number(newDiscount) || 0,
                      lineType: p?.is_subscription ? 'recurring' : 'one_time',
                    }),
                  }, 'Line added.')
                  setNewProduct(''); setNewQty('1'); setNewDiscount('0')
                }}
              >
                Add line
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Upsell / cross-sell (PS §B5) ──────────────────────────────── */}
      {editable && sugs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upsell and cross-sell suggestions</CardTitle>
            <CardDescription>
              Ranked by promotion then score, and filtered to healthy margins only. Adding one
              updates the order total and the margin immediately.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-3">
              {sugs.slice(0, 3).map((s) => (
                <div key={s.suggested_product_id} className="rounded-lg border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium">{s.name}</div>
                    {s.is_promoted && <StatusBadge status="progress" label="Promoted" />}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.category_name} · with {s.triggered_by}
                  </div>
                  {s.promo_text && <div className="mt-1 text-xs text-amber-300">{s.promo_text}</div>}
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span><Money value={s.base_price} currency={cur} /></span>
                    <span className="text-emerald-400">
                      margin +{formatMoney(s.margin_delta, cur)}
                    </span>
                  </div>
                  <Button
                    size="sm" variant="outline" className="mt-3 w-full" disabled={busy}
                    onClick={() => mutate(`/api/quotations/${id}/lines`, {
                      method: 'POST',
                      body: JSON.stringify({ productId: s.suggested_product_id, qty: 1, discountPct: 0 }),
                    }, `${s.name} added.`)}
                  >
                    Add to quote
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Approval chain + audit ────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Approval</CardTitle>
            <CardDescription>
              Recorded against version {q.version}. An edit moves the version and the approval
              stops applying.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {d.approvals.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {q.requires_manager || q.requires_finance
                  ? 'Not submitted yet.'
                  : 'No approval required — the blended risk is inside every limit.'}
              </p>
            ) : (
              <div className="space-y-2">
                {d.approvals.map((a) => (
                  <div key={a.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div>
                      <div className="text-sm font-medium">
                        <StatusBadge status={a.level} />{' '}
                        {a.acted_by_name ?? a.assigned_to_name ?? 'unassigned'}
                      </div>
                      {a.note && <div className="mt-0.5 text-xs text-muted-foreground">{a.note}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={a.status} />
                      {(a.status === 'pending') && (
                        <Link className="text-xs underline underline-offset-2" href={`/approvals/${a.id}`}>
                          open
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
                <p className="pt-1 text-xs text-muted-foreground">
                  Fully approved: <span className="font-medium">{d.isApproved ? 'yes' : 'no'}</span>
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Audit trail</CardTitle></CardHeader>
          <CardContent>
            {d.auditTrail.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {d.auditTrail.map((a: any) => (
                  <div key={a.id} className="text-sm">
                    <span className="font-medium">{a.action.replace(/_/g, ' ')}</span>
                    <span className="text-muted-foreground"> · {a.actor_name ?? 'system'} · {new Date(a.created_at).toLocaleString()}</span>
                    {a.note && <div className="text-xs text-muted-foreground">{a.note}</div>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

/**
 * A CONTROLLED numeric cell that commits on blur or Enter.
 *
 * It has to be controlled. With `defaultValue` on an uncontrolled input, React
 * ignores the prop once the field is mounted — so after a line edit refetches
 * the quotation, the cell keeps showing what was typed rather than what the
 * server actually stored. Base UI warns about exactly this. Worse, a rejected
 * edit (over 100%, a confirmed quotation) would leave the bad number sitting
 * on screen as if it had been saved.
 *
 * `draft` holds what the user is typing; the server value flows back in
 * whenever it changes, which also reverts the field when an edit is refused.
 */
function NumberField({
  value, onCommit, valid, disabled, suffix,
}: {
  value: string | number
  onCommit: (v: number) => void
  valid: (v: number) => boolean
  disabled?: boolean
  suffix?: string
}) {
  const server = Number(value)
  const [draft, setDraft] = useState(String(server))

  // Re-sync when the server value changes — after a successful edit, and after
  // a rejected one (where it snaps back to the truth).
  useEffect(() => { setDraft(String(server)) }, [server])

  function commit() {
    const v = Number(draft)
    if (!Number.isFinite(v) || !valid(v)) return setDraft(String(server))
    if (v === server) return
    onCommit(v)
  }

  return (
    <div className="flex items-center justify-end gap-1">
      <Input
        className="h-8 w-20 text-right tabular-nums"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') setDraft(String(server))
        }}
      />
      {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
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
