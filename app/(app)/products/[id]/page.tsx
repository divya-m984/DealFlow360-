// OWNER: D2.  Screen 17 — Product + Pricelist.
//
// This folder is SHARED: products/page.tsx is D3's (screen 16, the list),
// this [id]/page.tsx is D2's (screen 17, the detail).  Same directory,
// different files — that is what keeps git quiet.
//
// Variants are READ-ONLY on purpose: seeded, rendered, never generated.
// The subscription toggle is wired so the form cannot submit an impossible
// pair — product.recurring_iff_subscription is a CHECK constraint, and a raw
// 23514 is not a message anybody can act on.
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useLiveRefresh } from '@/components/fulfilment/use-live-refresh'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Money } from '@/components/shared/money'
import { StatusBadge } from '@/components/shared/status-badge'
import { ErrorState } from '@/components/shared/error-state'
import { EmptyState } from '@/components/shared/empty-state'
import {qty as fq } from '@/components/billing/format'
import { RelatedProducts } from '@/components/fulfilment/related-products'

const EDIT_ROLES = ['admin', 'sales_manager']
const CYCLES = ['weekly', 'monthly', 'quarterly', 'yearly'] as const

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [p, setP] = useState<any>(null)
  const [role, setRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<any>({})
  const [receive, setReceive] = useState<Record<number, string>>({})

  // Set on any edit to `form` (the price/cost/tax/unit form) or `receive`
  // (per-warehouse stock-receipt quantities); cleared the instant load()
  // repopulates both from the server. Without this an admin mid-edit on
  // this exact product's price would see their own typing overwritten by
  // the poll that exists to show them OTHER people's edits.
  const dirty = useRef(false)

  const load = useCallback(async () => {
    setError(null)
    const [r, m] = await Promise.all([fetch(`/api/products/${id}`), fetch('/api/auth/me')])
    const b = await r.json()
    if (!r.ok) return setError(b?.error?.message ?? 'Could not load the product')
    setP(b.data)
    setForm({
      base_price: b.data.base_price, cost: b.data.cost, tax_pct: b.data.tax_pct,
      unit: b.data.unit, is_subscription: b.data.is_subscription,
      recurring_cycle: b.data.recurring_cycle, is_active: b.data.is_active,
    })
    if (m.ok) setRole((await m.json()).data.role)
    dirty.current = false
  }, [id])

  useEffect(() => { load() }, [load])

  // A judge who edits this same product's price on another machine, or an
  // admin who receives stock against it elsewhere, becomes visible here —
  // unless this screen has its own unsaved edit in flight.
  useLiveRefresh(load, { isSafeToRefresh: () => !dirty.current && !busy })

  const canEdit = role !== null && EDIT_ROLES.includes(role)

  async function save() {
    setBusy(true); setError(null); setNotice(null)
    const res = await fetch(`/api/products/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        base_price: Number(form.base_price), cost: Number(form.cost),
        tax_pct: Number(form.tax_pct), unit: form.unit,
        is_active: form.is_active,
        is_subscription: form.is_subscription,
        recurring_cycle: form.is_subscription ? (form.recurring_cycle ?? 'monthly') : null,
      }),
    })
    const b = await res.json()
    setBusy(false)
    if (!res.ok) return setError(b?.error?.message ?? 'Save failed')
    setNotice('Saved.')
    load()
  }

  async function receiveStock(warehouseId: number) {
    const v = Number(receive[warehouseId])
    if (!(v > 0)) return setError('Enter a quantity greater than zero.')
    setBusy(true); setError(null); setNotice(null)
    const res = await fetch('/api/fulfilment/stock', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ warehouseId, productId: Number(id), qty: v, reference: 'Manual goods receipt' }),
    })
    const b = await res.json()
    setBusy(false)
    if (!res.ok) return setError(b?.error?.message ?? 'Goods receipt failed')
    setNotice(`Received ${v} units. Any backorder waiting on this product can now be consolidated.`)
    setReceive({})
    load()
  }

  if (error && !p) {
    return (
      <div className="p-6">
        <ErrorState error={error} onRetry={load} />
      </div>
    )
  }
  if (!p) return <div className="p-6 text-sm text-muted-foreground">Loading product…</div>

  const cur = p.currency_code

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">
            {p.name} <span className="ml-1 font-mono text-sm text-muted-foreground">{p.sku}</span>
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {p.category_name} · margin {p.margin_pct}% · ceiling in this category {p.category_max_discount_pct}%
          </p>
        </div>
        <div className="flex items-center gap-2">
          {p.is_subscription && <StatusBadge status={p.recurring_cycle} label={`subscription · ${p.recurring_cycle}`} />}
          {!p.is_active && <StatusBadge status="inactive" />}
          {canEdit && <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>}
        </div>
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">General</CardTitle>
            <CardDescription>
              Cost is not decoration — it drives <code className="font-mono text-xs">margin_amount</code> on
              every quotation line and the live margin indicator on screen 4.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {([['base_price', 'Sales price'], ['cost', 'Cost'], ['tax_pct', 'Tax %'], ['unit', 'Unit']] as const).map(([k, label]) => (
              <div key={k} className="flex items-center gap-3">
                <label className="w-28 text-sm text-muted-foreground">{label}</label>
                <Input className="w-40 text-right" disabled={!canEdit}
                  type={k === 'unit' ? 'text' : 'number'} step="0.01"
                  value={form[k] ?? ''} onChange={(e) => { dirty.current = true; setForm((f: any) => ({ ...f, [k]: e.target.value })) }} />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <label className="w-28 text-sm text-muted-foreground">Active</label>
              <Checkbox disabled={!canEdit} checked={!!form.is_active}
                onCheckedChange={(v) => { dirty.current = true; setForm((f: any) => ({ ...f, is_active: v === true })) }} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription</CardTitle>
            <CardDescription>
              <code className="font-mono text-xs">recurring_iff_subscription</code> is a CHECK
              constraint: the toggle and the cycle move together or the row is refused. The form
              enforces it so nobody ever sees the raw constraint error.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <Checkbox disabled={!canEdit} checked={!!form.is_subscription}
                onCheckedChange={(v) => { dirty.current = true; setForm((f: any) => ({
                  ...f,
                  is_subscription: v === true,
                  recurring_cycle: v === true ? (f.recurring_cycle ?? 'monthly') : null,
                })) }} />
              <span className="text-sm">Billed on a recurring cycle</span>
            </div>
            {form.is_subscription && (
              <div className="flex items-center gap-3">
                <label className="w-28 text-sm text-muted-foreground">Cycle</label>
                <Select value={form.recurring_cycle ?? 'monthly'}
                  onValueChange={(v) => { dirty.current = true; setForm((f: any) => ({ ...f, recurring_cycle: v ?? f.recurring_cycle })) }}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CYCLES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tier pricelists</CardTitle>
          <CardDescription>
            A product-specific rule beats a category rule; with neither, the base price stands.
            Resolved in one place — see <code className="font-mono text-xs">app/api/products/[id]</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pricelist</TableHead><TableHead>Tier</TableHead>
                <TableHead>Rule</TableHead><TableHead className="text-right">Value</TableHead>
                <TableHead className="text-right">Effective price</TableHead>
                <TableHead className="text-right">Discount ceiling</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {p.pricelists.map((pl: any) => {
                const c = p.ceilings.find((x: any) => x.tier === pl.tier_name)
                return (
                  <TableRow key={pl.pricelist_id}>
                    <TableCell>{pl.pricelist_name}</TableCell>
                    <TableCell>{pl.tier_name ?? '—'}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{String(pl.rule_type).replace('_', ' ')}</TableCell>
                    <TableCell className="text-right tabular-nums">{Number(pl.value)}</TableCell>
                    <TableCell className="text-right"><Money value={pl.effective_price} currency={cur} /></TableCell>
                    <TableCell className="text-right tabular-nums">{c ? `${c.ceiling.toFixed(2)}%` : '—'}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Variants</CardTitle>
            <CardDescription>Read-only. Seeded and rendered, never generated.</CardDescription>
          </CardHeader>
          <CardContent>
            {p.variants.length === 0 ? (
              <EmptyState title="No variants" description="Variants are seeded and rendered, never generated." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead><TableHead>Options</TableHead>
                    <TableHead className="text-right">Extra price</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.variants.map((v: any) => (
                    <TableRow key={v.id}>
                      <TableCell className="font-mono text-xs">{v.sku}</TableCell>
                      <TableCell className="text-sm">
                        {v.options.map((o: any) => `${o.attribute}: ${o.value}`).join(' · ') || '—'}
                      </TableCell>
                      <TableCell className="text-right"><Money value={v.extra_price} currency={cur} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stock</CardTitle>
            <CardDescription>
              {p.stock.length === 0
                ? 'Held in no warehouse — this product is not stock-managed, so it is never split and never backordered.'
                : 'Receiving stock here is what lets a waiting backorder be consolidated.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {p.stock.length === 0 ? (
              <EmptyState title="Not stock-managed" description="Held in no warehouse, so it is never split and never backordered — services and subscriptions are fulfilled on confirmation." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">On hand</TableHead>
                    <TableHead className="text-right">Reserved</TableHead>
                    <TableHead className="text-right">Available</TableHead>
                    <TableHead className="text-right">Reorder at</TableHead>
                    {canEdit && <TableHead className="text-right">Receive</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {p.stock.map((s: any) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        {s.warehouse_name}
                        {s.below_reorder_point && <StatusBadge status="rejected" label="below reorder" className="ml-2" />}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fq(s.qty_on_hand)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fq(s.qty_reserved)}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">{fq(s.qty_available)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fq(s.reorder_point)}</TableCell>
                      {canEdit && (
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Input type="number" min="1" className="w-20 text-right"
                              value={receive[s.warehouse_id] ?? ''}
                              onChange={(e) => { dirty.current = true; setReceive((r) => ({ ...r, [s.warehouse_id]: e.target.value })) }} />
                            <Button size="sm" variant="secondary" disabled={busy}
                              onClick={() => receiveStock(s.warehouse_id)}>Receive</Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Jury review 2, ask 2 — the many-to-many, made visible. */}
      <RelatedProducts
        accessories={p.accessories ?? []}
        alternatives={p.alternatives ?? []}
        accessoryFor={p.accessoryFor ?? []}
      />
    </div>
  )
}
