// OWNER: D2.  Screens 8 and 10 on one order.
//
//   Warehouse Split tab  → screen 8.  PS §B6.
//   Billing tab          → screen 10. PS §B7 — one order, two kinds of line,
//                          shown separately, because that separation IS the
//                          screen.
//
// Both tabs are about the same sales_order, so they share one fetch and one
// progress rail.  There is no /orders route in components/nav.ts (D3 owns
// that file and it is frozen), and inventing one would break Rule Zero —
// fulfilment/[id] is the order screen.
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SplitPlan, type Plan } from '@/components/fulfilment/split-plan'
import { SHIPMENT_BASE_COST } from '@/lib/allocate'
import { Money, money, qty as fq, date as fd } from '@/components/billing/format'

type StockRow = {
  warehouseId: number; warehouseCode?: string; warehouseName?: string
  available: number; onShelf: number; planned: number; shippingCostWeight: number
}
type Line = {
  id: number; product_sku: string; product_name: string; variant_sku: string | null
  line_type: 'one_time' | 'recurring'; qty: string; unit_price: string; net_amount: string
  is_stock_managed: boolean
  allocations: { id: number; warehouse_code: string; warehouse_name: string; qty: string; status: string; shipping_cost: string; is_manual_override: boolean; shipped_at: string | null }[]
  backorders: { id: number; qty_outstanding: string; resolved_at: string | null }[]
  stock: StockRow[]
  suggested: Plan | null
  consolidate: { fillable_qty: number; still_short: number } | null
}

export default function OrderFulfilmentPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [fx, setFx] = useState<any>(null)
  const [ord, setOrd] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [edit, setEdit] = useState<Record<number, Record<number, string>>>({})

  const load = useCallback(async () => {
    setError(null)
    const [f, o] = await Promise.all([fetch(`/api/fulfilment/${id}`), fetch(`/api/orders/${id}`)])
    const fb = await f.json()
    const ob = await o.json()
    if (!f.ok) return setError(fb?.error?.message ?? 'Could not load the order')
    setFx(fb.data)
    if (o.ok) setOrd(ob.data)
  }, [id])

  useEffect(() => { load() }, [load])

  async function act(path: string, body?: unknown, label = 'Done') {
    setBusy(path); setError(null); setNotice(null)
    const res = await fetch(`/api/fulfilment/${id}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const b = await res.json()
    setBusy(null)
    if (!res.ok) return setError(b?.error?.message ?? 'That did not work')
    setNotice(label)
    setEdit({})
    load()
    router.refresh()
  }

  function saveOverride(line: Line) {
    const rows = edit[line.id] ?? {}
    const allocations = Object.entries(rows)
      .map(([wid, v]) => ({ warehouseId: Number(wid), qty: Number(v) }))
      .filter((a) => a.qty > 0)
    if (allocations.length === 0) return setError('Enter a quantity for at least one warehouse.')
    act('plan', { overrides: [{ orderLineId: line.id, allocations }] }, 'Manual override saved.')
  }

  if (error && !fx) {
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">{error}</p>
        <Button className="mt-3" variant="outline" onClick={load}>Try again</Button>
      </div>
    )
  }
  if (!fx) return <div className="p-6 text-sm text-muted-foreground">Loading order…</div>

  const lines: Line[] = fx.lines
  const cur = fx.currency_code
  const stockLines = lines.filter((l) => l.is_stock_managed)
  const oneTime = lines.filter((l) => l.line_type === 'one_time')
  const recurring = lines.filter((l) => l.line_type === 'recurring')
  const progress = ord?.progress ?? { confirmed: true, shipped: false, invoiced: false, paid: false }
  const anyPlanned = stockLines.some((l) => l.allocations.some((a) => a.status === 'planned'))
  const anyReserved = stockLines.some((l) => l.allocations.some((a) => a.status === 'reserved'))

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{fx.number}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {fx.customer_name} · from quotation {fx.quotation_number} ·{' '}
            promised {fd(fx.promised_delivery_date)}
            {fx.is_late && <span className="ml-2 font-medium text-destructive">overdue</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={fx.state === 'fulfilled' ? 'secondary' : fx.state === 'backorder' ? 'destructive' : 'outline'}>
            {String(fx.state).replace('_', ' ')}
          </Badge>
          <span className="text-lg font-semibold"><Money value={fx.grand_total} currency={cur} /></span>
        </div>
      </div>

      {/* Order Confirmed → Shipped → Invoiced → Paid.  Every step is read from
          real state — allocation rows, invoice rows, payment sums — never from
          a stored step column. */}
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {([['Confirmed', progress.confirmed], ['Shipped', progress.shipped],
           ['Invoiced', progress.invoiced], ['Paid', progress.paid]] as const).map(([label, done], i) => (
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

      <Tabs defaultValue="split">
        <TabsList>
          <TabsTrigger value="split">Warehouse split</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
        </TabsList>

        {/* ───────────────────────── SCREEN 8 ───────────────────────── */}
        <TabsContent value="split" className="space-y-4 pt-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => act('plan', {}, 'Suggested split accepted.')} disabled={busy !== null}>
              {anyPlanned ? 'Recompute suggested split' : 'Accept suggested split'}
            </Button>
            <Button variant="outline" onClick={() => act('reserve', {}, 'Stock reserved.')} disabled={busy !== null || !anyPlanned}>
              Reserve stock
            </Button>
            <Button variant="outline" onClick={() => act('ship', {}, 'Marked as shipped.')} disabled={busy !== null || !anyReserved}>
              Mark shipped
            </Button>
          </div>

          {stockLines.length === 0 && (
            <Card><CardContent className="py-6 text-sm text-muted-foreground">
              Nothing on this order is stock-managed. Services and subscriptions are held in no
              warehouse, so they are never split — they are fulfilled on confirmation.
            </CardContent></Card>
          )}

          {stockLines.map((l) => {
            const openBackorder = l.backorders.find((b) => b.resolved_at === null)
            const locked = l.allocations.some((a) => a.status !== 'planned')
            return (
              <Card key={l.id}>
                <CardHeader>
                  <CardTitle className="text-base">
                    {l.product_name} <span className="font-mono text-xs text-muted-foreground">{l.product_sku}</span>
                  </CardTitle>
                  <CardDescription>
                    {fq(l.qty)} units at <Money value={l.unit_price} currency={cur} /> ·
                    line total <Money value={l.net_amount} currency={cur} />
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-5 lg:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Suggested by the engine</h3>
                    {l.suggested ? <SplitPlan plan={l.suggested} currency={cur} /> : <p className="text-sm text-muted-foreground">—</p>}

                    <h3 className="pt-2 text-sm font-medium">Availability</h3>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Warehouse</TableHead>
                          <TableHead className="text-right">On shelf</TableHead>
                          <TableHead className="text-right">Planned</TableHead>
                          <TableHead className="text-right">Promisable</TableHead>
                          <TableHead className="text-right">Ship cost</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {l.stock.map((s) => (
                          <TableRow key={s.warehouseId}>
                            <TableCell>{s.warehouseName}</TableCell>
                            <TableCell className="text-right tabular-nums">{fq(s.onShelf)}</TableCell>
                            <TableCell className="text-right tabular-nums">{fq(s.planned)}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">{fq(s.available)}</TableCell>
                            <TableCell className="text-right"><Money value={SHIPMENT_BASE_COST * s.shippingCostWeight} currency={cur} /></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="text-xs text-muted-foreground">
                      Promisable is on-shelf minus what other plans already claim. A planned
                      allocation holds no stock — only reserving does — so this is the number the
                      allocator is given.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Saved split</h3>
                    {l.allocations.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Nothing allocated yet.</p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Warehouse</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead>Status</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {l.allocations.map((a) => (
                            <TableRow key={a.id}>
                              <TableCell>
                                {a.warehouse_name}
                                {a.is_manual_override && <Badge variant="outline" className="ml-2">manual</Badge>}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">{fq(a.qty)}</TableCell>
                              <TableCell><Badge variant={a.status === 'shipped' ? 'secondary' : 'outline'}>{a.status}</Badge></TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}

                    {openBackorder && (
                      <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                        <p className="font-medium text-destructive">{fq(openBackorder.qty_outstanding)} units on backorder</p>
                        {l.consolidate ? (
                          <>
                            <p className="mt-1 text-muted-foreground">
                              {fq(l.consolidate.fillable_qty)} of them can be filled from stock now.
                              {l.consolidate.still_short > 0 && ` ${fq(l.consolidate.still_short)} would remain outstanding.`}
                            </p>
                            <Button size="sm" className="mt-2" disabled={busy !== null}
                              onClick={() => act('consolidate', {}, 'Backorder consolidated.')}>
                              Consolidate remaining backorder
                            </Button>
                          </>
                        ) : (
                          <p className="mt-1 text-muted-foreground">
                            No stock available to consolidate. This is recomputed every time the
                            screen loads — there is no background watcher.
                          </p>
                        )}
                      </div>
                    )}

                    {!locked && (
                      <div className="space-y-2 rounded-md border p-3">
                        <h4 className="text-sm font-medium">Manual override</h4>
                        <p className="text-xs text-muted-foreground">
                          Move quantities by hand. Allocating less than the line is allowed — the
                          remainder becomes a backorder, which is often the point.
                        </p>
                        {l.stock.map((s) => (
                          <div key={s.warehouseId} className="flex items-center gap-2">
                            <span className="flex-1 text-sm">{s.warehouseName}</span>
                            <span className="text-xs text-muted-foreground">max {fq(s.available)}</span>
                            <Input type="number" min="0" step="1" className="w-24 text-right"
                              value={edit[l.id]?.[s.warehouseId] ?? ''}
                              onChange={(e) => setEdit((st) => ({
                                ...st, [l.id]: { ...(st[l.id] ?? {}), [s.warehouseId]: e.target.value },
                              }))} />
                          </div>
                        ))}
                        <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => saveOverride(l)}>
                          Save override
                        </Button>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </TabsContent>

        {/* ───────────────────────── SCREEN 10 ──────────────────────── */}
        <TabsContent value="billing" className="space-y-4 pt-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">One-time lines</CardTitle>
                <CardDescription>Invoiced once, on confirmation.</CardDescription>
              </CardHeader>
              <CardContent>
                {oneTime.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No one-time lines on this order.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="text-right">Unit</TableHead>
                        <TableHead className="text-right">Net</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {oneTime.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>{l.product_name}</TableCell>
                          <TableCell className="text-right tabular-nums">{fq(l.qty)}</TableCell>
                          <TableCell className="text-right"><Money value={l.unit_price} currency={cur} /></TableCell>
                          <TableCell className="text-right"><Money value={l.net_amount} currency={cur} /></TableCell>
                        </TableRow>
                      ))}
                      <TableRow>
                        <TableCell colSpan={3} className="font-medium">Total</TableCell>
                        <TableCell className="text-right font-medium">
                          <Money value={oneTime.reduce((t, l) => t + Number(l.net_amount), 0)} currency={cur} />
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Recurring lines</CardTitle>
                <CardDescription>Each becomes a subscription with its own billing cycle.</CardDescription>
              </CardHeader>
              <CardContent>
                {recurring.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No recurring lines on this order.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Product</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead>Cycle</TableHead>
                        <TableHead className="text-right">Per cycle</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recurring.map((l) => {
                        const sub = ord?.subscriptions?.find((s: any) => Number(s.source_order_line_id) === Number(l.id))
                        return (
                          <TableRow key={l.id}>
                            <TableCell>
                              {sub ? (
                                <Link className="underline underline-offset-2" href={`/subscriptions/${sub.id}`}>{l.product_name}</Link>
                              ) : l.product_name}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">{fq(l.qty)}</TableCell>
                            <TableCell>{sub?.cycle ?? '—'}</TableCell>
                            <TableCell className="text-right">
                              {sub ? <Money value={Number(sub.plan_price) * Number(sub.qty)} currency={cur} /> : '—'}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invoices</CardTitle>
              <CardDescription>
                One order, two billing mechanisms. The <code className="font-mono text-xs">kind</code>{' '}
                column is what keeps them apart.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!ord?.invoices?.length ? (
                <p className="text-sm text-muted-foreground">No invoices raised yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead><TableHead>Kind</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead>Status</TableHead><TableHead>Due</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ord.invoices.map((i: any) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <Link className="underline underline-offset-2" href={`/invoices/${i.id}`}>{i.number}</Link>
                        </TableCell>
                        <TableCell><Badge variant="outline">{i.kind === 'one_time' ? 'one-time' : 'recurring'}</Badge></TableCell>
                        <TableCell className="text-right"><Money value={i.amount_total} currency={cur} /></TableCell>
                        <TableCell className="text-right"><Money value={i.amount_paid} currency={cur} /></TableCell>
                        <TableCell>
                          <Badge variant={i.status === 'paid' ? 'secondary' : i.status === 'partial' ? 'outline' : 'destructive'}>{i.status}</Badge>
                        </TableCell>
                        <TableCell>{fd(i.due_date)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
