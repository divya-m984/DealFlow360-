// OWNER: D2.  Screen 18 — Discount Tiers & Approval Chains.
//
// The last-numbered screen and the first one that matters.  Everything on it
// is a row in a table that the discount engine reads at request time:
//
//   customer_tier.max_discount_pct     ─┐
//   product_category.max_discount_pct  ─┴→ effective_ceiling_pct() = LEAST(…)
//   approval_policy                     → who has to sign
//
// PS §7 requires this to be configurable rather than hardcoded.  Change Silver
// from 10% to 3% here, re-submit a quotation, and the routing changes — with
// no deploy and no code edit.  That is the whole point of the screen.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/components/shared/status-badge'
import { ErrorState } from '@/components/shared/error-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { ConfigPayload } from '@/lib/types/catalog'
import { SHIPMENT_BASE_COST } from '@/lib/allocate'

const WRITE_ROLES = ['admin', 'finance']

type PolicyForm = {
  high_band_from: string
  medium_requires_manager: boolean
  medium_requires_finance: boolean
  high_requires_manager: boolean
  high_requires_finance: boolean
}

export default function SettingsPage() {
  const [cfg, setCfg] = useState<ConfigPayload | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Edits are held as strings so a half-typed "1" is not silently read as 1%.
  const [tierPct, setTierPct] = useState<Record<number, string>>({})
  const [catPct, setCatPct] = useState<Record<number, string>>({})
  const [policy, setPolicy] = useState<PolicyForm | null>(null)

  const canWrite = role !== null && WRITE_ROLES.includes(role)

  async function load() {
    setError(null)
    const [cRes, mRes] = await Promise.all([fetch('/api/config'), fetch('/api/auth/me')])
    const cBody = await cRes.json()
    if (!cRes.ok) return setError(cBody?.error?.message ?? 'Could not load configuration')
    const data: ConfigPayload = cBody.data
    setCfg(data)
    setTierPct(Object.fromEntries(data.tiers.map((t) => [t.id, t.max_discount_pct])))
    setCatPct(Object.fromEntries(data.categories.map((c) => [c.id, c.max_discount_pct])))
    const high = data.policy.find((p) => p.band === 'HIGH')
    const med = data.policy.find((p) => p.band === 'MEDIUM')
    setPolicy({
      high_band_from: high?.score_from ?? '5.01',
      medium_requires_manager: med?.requires_manager ?? true,
      medium_requires_finance: med?.requires_finance ?? false,
      high_requires_manager: high?.requires_manager ?? true,
      high_requires_finance: high?.requires_finance ?? true,
    })
    if (mRes.ok) setRole((await mRes.json()).data.role)
  }

  useEffect(() => { load() }, [])

  async function save() {
    if (!cfg || !policy) return
    setBusy(true); setError(null); setNotice(null)
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        tiers: cfg.tiers.map((t) => ({ id: t.id, max_discount_pct: Number(tierPct[t.id]) })),
        categories: cfg.categories.map((c) => ({ id: c.id, max_discount_pct: Number(catPct[c.id]) })),
        policy: { ...policy, high_band_from: Number(policy.high_band_from) },
      }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body?.error?.message ?? 'Save failed')
    const n = body.data.changed as number
    setNotice(n === 0 ? 'Nothing changed.' : `Saved ${n} change${n === 1 ? '' : 's'}. Every one is in audit_log.`)
    load()
  }

  // The effective ceiling is LEAST(tier, category) — two independent tables,
  // NOT a stored matrix.  Recomputing it here as the user types is the fastest
  // way to make that rule visible without opening the database.
  const matrix = useMemo(() => {
    if (!cfg) return []
    return cfg.tiers.map((t) => ({
      tier: t.name,
      cells: cfg.categories.map((c) => {
        const a = Number(tierPct[t.id] ?? t.max_discount_pct)
        const b = Number(catPct[c.id] ?? c.max_discount_pct)
        const min = Math.min(a, b)
        return { category: c.name, value: min, from: min === a ? 'tier' : 'category' }
      }),
    }))
  }, [cfg, tierPct, catPct])

  const highFrom = Number(policy?.high_band_from ?? 0)
  const bands = [
    { band: 'LOW',    range: '0.00 only',                                     mgr: false, fin: false, note: 'On or under every ceiling.' },
    { band: 'MEDIUM', range: `0.01 – ${(highFrom - 0.01).toFixed(2)}`,        mgr: policy?.medium_requires_manager ?? false, fin: policy?.medium_requires_finance ?? false, note: '' },
    { band: 'HIGH',   range: `${highFrom.toFixed(2)} – 100.00`,               mgr: policy?.high_requires_manager ?? false,   fin: policy?.high_requires_finance ?? false,   note: '' },
  ]

  if (error && !cfg) {
    return (
      <div className="p-6">
        <ErrorState error={error} onRetry={load} />
      </div>
    )
  }
  if (!cfg || !policy) return <div className="p-6 text-sm text-muted-foreground">Loading configuration…</div>

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Discount Tiers &amp; Approval Chains</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Screen 18. Every discount check in the application reads these rows at request time —
            nothing here is a constant in code. Change a ceiling, re-submit a quotation, and the
            approval routing changes.
          </p>
        </div>
        {canWrite ? (
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
        ) : (
          <Badge variant="secondary">Read-only — {role ?? 'unknown role'}</Badge>
        )}
      </div>

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Customer tiers</CardTitle>
            <CardDescription>The most a customer at this tier may ever be discounted.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Tier</TableHead><TableHead className="w-40 text-right">Max discount %</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {cfg.tiers.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" step="0.01" min="0" max="100" disabled={!canWrite}
                        className="ml-auto w-28 text-right"
                        value={tierPct[t.id] ?? ''}
                        onChange={(e) => setTierPct((s) => ({ ...s, [t.id]: e.target.value }))} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Product categories</CardTitle>
            <CardDescription>
              The most any product in this category may be discounted. Services are lower than
              hardware because their margin is thinner — the seeded costs bear that out.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow><TableHead>Category</TableHead><TableHead className="w-40 text-right">Max discount %</TableHead></TableRow>
              </TableHeader>
              <TableBody>
                {cfg.categories.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" step="0.01" min="0" max="100" disabled={!canWrite}
                        className="ml-auto w-28 text-right"
                        value={catPct[c.id] ?? ''}
                        onChange={(e) => setCatPct((s) => ({ ...s, [c.id]: e.target.value }))} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Effective ceiling</CardTitle>
          <CardDescription>
            Derived, never stored: <code className="font-mono text-xs">LEAST(tier.max_discount_pct, category.max_discount_pct)</code>.
            Two independent tables, not a matrix — which is why adding a tier or a category needs
            no new rows here. Updates as you type above.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tier \ Category</TableHead>
                {cfg.categories.map((c) => <TableHead key={c.id} className="text-right">{c.name}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {matrix.map((row) => (
                <TableRow key={row.tier}>
                  <TableCell className="font-medium">{row.tier}</TableCell>
                  {row.cells.map((cell) => (
                    <TableCell key={cell.category} className="text-right tabular-nums">
                      {Number.isFinite(cell.value) ? cell.value.toFixed(2) : '—'}%
                      <span className="ml-1 text-xs text-muted-foreground">({cell.from})</span>
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Approval chain</CardTitle>
          <CardDescription>
            The band is chosen by the blended risk score — the worst single line over its ceiling,
            or the value-weighted pattern across the order, whichever is higher. Bands are
            contiguous <em>by construction</em>: only the HIGH threshold is editable and the other
            edges are derived from it, so a score can never fall into a gap between two bands.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">HIGH band starts at</span>
            <Input type="number" step="0.01" min="0.02" max="100" disabled={!canWrite}
              className="w-28 text-right"
              value={policy.high_band_from}
              onChange={(e) => setPolicy((p) => p && { ...p, high_band_from: e.target.value })} />
            <span className="text-muted-foreground">points over the ceiling</span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Band</TableHead>
                <TableHead>Score range</TableHead>
                <TableHead className="text-center">Sales Manager</TableHead>
                <TableHead className="text-center">Finance</TableHead>
                <TableHead>Resulting chain</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bands.map((b) => (
                <TableRow key={b.band}>
                  <TableCell>
                    <StatusBadge status={b.band} />
                  </TableCell>
                  <TableCell className="tabular-nums">{b.range}</TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      disabled={!canWrite || b.band === 'LOW'}
                      checked={b.mgr}
                      onCheckedChange={(v) => setPolicy((p) => p && ({
                        ...p,
                        [`${b.band.toLowerCase()}_requires_manager`]: v === true,
                      } as PolicyForm))} />
                  </TableCell>
                  <TableCell className="text-center">
                    <Checkbox
                      disabled={!canWrite || b.band === 'LOW'}
                      checked={b.fin}
                      onCheckedChange={(v) => setPolicy((p) => p && ({
                        ...p,
                        [`${b.band.toLowerCase()}_requires_finance`]: v === true,
                      } as PolicyForm))} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {b.mgr && b.fin ? 'Manager → Finance' : b.mgr ? 'Manager only' : 'Auto-approved'}
                    {b.note && ` · ${b.note}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Finance is the second level of the chain, so a band that requires Finance must also
            require the Sales Manager — the API refuses the combination rather than creating an
            approval chain with a hole in it.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Warehouses</CardTitle>
          <CardDescription>
            <code className="font-mono text-xs">shipping_cost_weight</code> is charged once per
            shipment and is the cost side of the warehouse split in
            <code className="mx-1 font-mono text-xs">lib/allocate.ts</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead><TableHead>Name</TableHead>
                <TableHead className="text-right">Shipping cost weight</TableHead>
                <TableHead className="text-right">Cost per shipment</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cfg.warehouses.map((w) => (
                <TableRow key={w.id}>
                  <TableCell className="font-mono text-xs">{w.code}</TableCell>
                  <TableCell>{w.name}</TableCell>
                  <TableCell className="text-right tabular-nums">{w.shipping_cost_weight}</TableCell>
                  <TableCell className="text-right tabular-nums">₹{(SHIPMENT_BASE_COST * Number(w.shipping_cost_weight)).toFixed(2)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
