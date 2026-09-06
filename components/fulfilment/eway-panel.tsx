// OWNER: D2.
//
// E-WAY BILLS — Rule 138, on the fulfilment screen where the goods are.
//
// ── WHY THIS BELONGS NEXT TO THE WAREHOUSE SPLIT ─────────────────────
// One bill per DESPATCHING WAREHOUSE, not per order. A split shipment is two
// physical movements from two states, and each lorry carries its own
// document. So the allocator's split — which until now only affected a
// shipping cost — turns out to decide how many statutory documents this
// order needs and which state's threshold applies to each. Putting the two
// on one screen is the point: the split has consequences beyond cost.
//
// ── HONESTY ──────────────────────────────────────────────────────────
// Nothing here is filed with the NIC portal. The EBN is ours and is
// prefixed so it cannot be mistaken for a portal number. What IS real is
// the rule: the inter-state versus intra-state threshold, and the one-day-
// per-200-km validity. The panel labels which thresholds were verified and
// which are widely reported but unconfirmed, because a threshold that is
// wrong in the permissive direction tells someone they need no document
// when they do — and that gets a lorry detained.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Money } from '@/components/shared/money'
import { useLiveRefresh } from '@/components/fulfilment/use-live-refresh'

type Consignment = {
  warehouse_id: number; warehouse_code: string; warehouse_name: string
  from_state_code: string; from_state_name: string
  to_state_code: string; to_state_name: string
  customer_name: string; customer_gstin: string | null
  consignment_value: number; skus: string; existing_bill_id: number | null
  evaluation: {
    required: boolean; isInterstate: boolean; threshold: number
    thresholdBasis: 'interstate' | 'intra_verified' | 'intra_reported' | 'intra_default'
    explanation: string
  }
}
type Bill = {
  id: number; ebn: string; from_warehouse_id: number; consignment_value: string
  is_interstate: boolean; vehicle_number: string | null; transport_mode: string | null
  distance_km: number | null; part_b_at: string | null; valid_until: string | null
}

const BASIS_LABEL: Record<Consignment['evaluation']['thresholdBasis'], string> = {
  interstate: 'inter-state · verified',
  intra_verified: 'intra-state · verified',
  intra_reported: 'intra-state · reported, unconfirmed',
  intra_default: 'intra-state · central default',
}

export function EwayPanel({ orderId, canWrite }: { orderId: number; canWrite: boolean }) {
  const [d, setD] = useState<{ consignments: Consignment[]; bills: Bill[]; requiredCount: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [openFor, setOpenFor] = useState<number | null>(null)
  const [form, setForm] = useState({ vehicleNumber: '', distanceKm: '', transportMode: 'road' })

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/eway/${orderId}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not load e-way bills')
      setD(j.data); setError(null)
    } catch (e: any) { setError(e.message) }
  }, [orderId])

  useEffect(() => { load() }, [load])
  useLiveRefresh(load, { isSafeToRefresh: () => busy === null && openFor === null })

  async function file(warehouseId: number, withPartB: boolean) {
    setBusy(warehouseId); setError(null); setNotice(null)
    try {
      const body: Record<string, unknown> = { warehouseId, reason: 'Supply' }
      if (withPartB) {
        body.transportMode = form.transportMode
        body.vehicleNumber = form.vehicleNumber
        body.distanceKm = Number(form.distanceKm)
      }
      const r = await fetch(`/api/eway/${orderId}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not file')
      setNotice(
        `${j.data.bill.ebn} raised` +
        (j.data.validityDays ? ` · valid ${j.data.validityDays} day(s)` : ' · Part A only, no validity clock yet'),
      )
      setOpenFor(null); setForm({ vehicleNumber: '', distanceKm: '', transportMode: 'road' })
      await load()
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  if (!d) return null
  if (d.consignments.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          E-way bills
          <Badge variant="outline" className="text-[10px]">Rule 138</Badge>
          {d.requiredCount > 0 && (
            <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
              {d.requiredCount} required
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          One bill per despatching warehouse — a split shipment is two physical movements from two
          states, so each vehicle carries its own document and each is judged against its own
          state&rsquo;s threshold. Generated locally; not filed with the NIC portal.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

        {d.consignments.map((c) => {
          // One live bill per warehouse — the API refuses a second while the
          // first is uncancelled, so first match is the only match.
          const bill = d.bills.find((b) => b.from_warehouse_id === c.warehouse_id)
          const e = c.evaluation
          return (
            <div key={c.warehouse_id} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{c.warehouse_code}</span>
                    <span className="text-sm">
                      {c.from_state_name} <span className="text-muted-foreground">→</span> {c.to_state_name}
                    </span>
                    <Badge variant="outline" className={`text-[10px] ${e.isInterstate ? 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-400' : ''}`}>
                      {e.isInterstate ? 'IGST · inter-state' : 'CGST+SGST · intra-state'}
                    </Badge>
                    {e.required
                      ? <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">bill required</Badge>
                      : <Badge variant="outline" className="text-[10px]">below threshold</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Consignment <Money value={c.consignment_value} /> · threshold{' '}
                    <Money value={e.threshold} /> ({BASIS_LABEL[e.thresholdBasis]}) · {c.skus}
                  </p>
                </div>

                {bill ? (
                  <div className="text-right">
                    <p className="font-mono text-xs">{bill.ebn}</p>
                    {bill.part_b_at ? (
                      <p className="text-[11px] text-muted-foreground">
                        {bill.vehicle_number} · {bill.distance_km} km ·{' '}
                        <span className="text-emerald-700 dark:text-emerald-400">
                          valid to {new Date(bill.valid_until!).toLocaleDateString()}
                        </span>
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        Part A only — no vehicle, clock not started
                      </p>
                    )}
                  </div>
                ) : canWrite && e.required ? (
                  <div className="flex gap-1.5">
                    <Button size="sm" variant="outline" disabled={busy === c.warehouse_id}
                            onClick={() => file(c.warehouse_id, false)}>
                      Part A
                    </Button>
                    <Button size="sm" disabled={busy === c.warehouse_id}
                            onClick={() => setOpenFor(openFor === c.warehouse_id ? null : c.warehouse_id)}>
                      Assign vehicle
                    </Button>
                  </div>
                ) : null}
              </div>

              {openFor === c.warehouse_id && (
                <div className="mt-3 space-y-2 rounded-md border bg-muted/30 p-2.5">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <Input placeholder="Vehicle no. e.g. MH12AB1234" value={form.vehicleNumber}
                           onChange={(ev) => setForm({ ...form, vehicleNumber: ev.target.value })} />
                    <Input placeholder="Distance (km)" inputMode="numeric" value={form.distanceKm}
                           onChange={(ev) => setForm({ ...form, distanceKm: ev.target.value })} />
                    <select className="h-9 rounded-md border bg-background px-2 text-sm"
                            value={form.transportMode}
                            onChange={(ev) => setForm({ ...form, transportMode: ev.target.value })}>
                      {['road', 'rail', 'air', 'ship'].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <Button size="sm" disabled={busy !== null || !form.vehicleNumber || !form.distanceKm}
                          onClick={() => file(c.warehouse_id, true)}>
                    File Part A + Part B
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Validity is <strong>one day per 200 km</strong> or part thereof — 250 km is two
                    days, not one and a quarter. The clock starts now, with Part B, not when Part A
                    was prepared.
                  </p>
                </div>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
