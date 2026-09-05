// OWNER: D2.
//
// "TRY TO BREAK IT."
//
// Fires several reservation requests at the SAME order at the same instant,
// against the real endpoint — no test double, no simulation — and reports
// what each one got back, then checks stock integrity afterwards.
//
// ── WHY THIS IS THE DEMO AND NOT A UNIT TEST ─────────────────────────
// Reserving stock is the concurrency-critical write in this application. The
// defence is real: app/api/fulfilment/_stock.ts takes SELECT … FOR UPDATE on
// stock_level rows IN id ORDER (same order every time, so two transactions
// can never deadlock against each other), and the schema carries
// CHECK (qty_reserved <= qty_on_hand) underneath as a backstop Postgres
// enforces no matter what the application code does.
//
// None of that is visible on a screen. A reviewer reading the repo can find
// it; a reviewer watching a demo cannot. This button lets them cause the race
// themselves and watch it hold — which is worth more than being told.
//
// ── WHAT A PASS ACTUALLY LOOKS LIKE ──────────────────────────────────
// NOT "one 200 and nine errors". Measuring HTTP status would be measuring the
// wrong thing, and writing this probe is what surfaced that.
//
// /reserve is IDEMPOTENT: it reserves what is planned and not yet held, so a
// second call against an already-reserved order legitimately succeeds having
// done nothing. That is the better design — a user who double-clicks Reserve,
// or whose network retries, gets a consistent answer instead of a scary error
// about a thing that already worked.
//
// So the real claim is about WORK DONE, not status codes:
//
//   sum of allocations reserved across all N responses
//     == the number that needed reserving, ONCE
//
// If the lock were missing, several overlapping transactions would each read
// "0 reserved so far" and each commit the same allocations, and that sum would
// come back a multiple of the truth. It cannot, because
// app/api/fulfilment/_stock.ts takes SELECT … FOR UPDATE on the stock rows in
// id order before it reads the figure it is about to change.
//
// A 500 anywhere is still an outright failure: it would mean Postgres's CHECK
// caught what the application should have, and the user got a stack trace
// instead of a sentence. "The constraint saved us" is a different quality bar
// from "the code handled it".

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Attempt = { i: number; status: number; ms: number; message: string; reserved: number }
type Integrity = {
  ok: boolean
  oversold: { warehouse: string; sku: string; qty_on_hand: string; qty_reserved: string }[]
  strandedReservations: unknown[]
  totals: { rows: number; reserved: string; on_hand: string }
  enforcedBy: string[]
}

export function ConcurrencyProbe({ orderId, onDone }: { orderId: number; onDone?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [attempts, setAttempts] = useState<Attempt[] | null>(null)
  const [integrity, setIntegrity] = useState<Integrity | null>(null)
  const [n, setN] = useState(5)

  async function run() {
    setBusy(true); setAttempts(null); setIntegrity(null)
    try {
      // Promise.all, not a loop — these leave the browser together and hit
      // the same rows inside overlapping transactions. A sequential loop
      // would prove nothing at all.
      const results = await Promise.all(
        Array.from({ length: n }, async (_, i) => {
          const t0 = performance.now()
          const res = await fetch(`/api/fulfilment/${orderId}/reserve`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
          const body = await res.json().catch(() => null)
          const reserved = Number(body?.data?.reserved ?? 0)
          return {
            i: i + 1,
            status: res.status,
            ms: Math.round(performance.now() - t0),
            reserved,
            message: res.ok
              ? (reserved > 0
                  ? `reserved ${reserved} allocation${reserved === 1 ? '' : 's'}`
                  : 'no-op — already reserved by another request')
              : (body?.error?.message ?? `HTTP ${res.status}`),
          } as Attempt
        }),
      )
      setAttempts(results.sort((a, b) => a.i - b.i))

      const iRes = await fetch('/api/fulfilment/integrity')
      if (iRes.ok) setIntegrity((await iRes.json()).data)
      onDone?.()
    } finally { setBusy(false) }
  }

  const server5xx = attempts?.filter((a) => a.status >= 500).length ?? 0
  const didWork = attempts?.filter((a) => a.reserved > 0).length ?? 0
  const noops = attempts?.filter((a) => a.status < 300 && a.reserved === 0).length ?? 0
  const totalReserved = attempts?.reduce((t, a) => t + a.reserved, 0) ?? 0

  // The assertion is about work done, not status codes — see the header.
  const verdict =
    attempts === null ? null
    : server5xx > 0
      ? { pass: false, text: `${server5xx} request(s) returned 500. The database caught what the application should have.` }
    : didWork > 1
      ? { pass: false, text: `${didWork} requests each committed stock (${totalReserved} allocations total). The same stock was reserved more than once.` }
    : didWork === 0 && totalReserved === 0 && noops === attempts.length
      ? { pass: true, text: `Nothing left to reserve — this order is already fully reserved, so all ${noops} requests were correctly no-ops. Re-plan the split to run a fresh race.` }
    : didWork === 1 && integrity?.ok
      ? { pass: true, text: `Exactly one request committed stock (${totalReserved} allocation${totalReserved === 1 ? '' : 's'}). The other ${noops} raced it, lost the lock, re-read the row and correctly did nothing. No stock anywhere is oversold.` }
    : { pass: false, text: 'Unexpected outcome — inspect the responses below.' }

  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base">Try to break it — concurrent reservation</CardTitle>
        <CardDescription>
          Fires {n} reservation requests at this order simultaneously, against the real endpoint.
          Reserving stock is the concurrency-critical write in this application: two people
          confirming orders for the last laptop at the same instant must not both succeed.
          The endpoint is idempotent, so the test is not &ldquo;one succeeds and the rest
          error&rdquo; — it is that <strong>exactly one of them actually commits stock</strong>,
          however many arrive together.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={run} disabled={busy}>
            {busy ? 'Racing…' : `Fire ${n} simultaneous reservations`}
          </Button>
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs"
            value={n} disabled={busy}
            onChange={(e) => setN(Number(e.target.value))}
          >
            {[2, 5, 10, 20].map((k) => <option key={k} value={k}>{k} at once</option>)}
          </select>
        </div>

        {verdict && (
          <div className={`rounded-md px-3 py-2 text-sm ${
            verdict.pass
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
              : 'bg-destructive/10 text-destructive'}`}>
            <strong>{verdict.pass ? 'HELD' : 'FAILED'}</strong> — {verdict.text}
          </div>
        )}

        {attempts && (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="py-1.5 pl-3 pr-2 text-left font-normal">#</th>
                  <th className="py-1.5 pr-2 text-left font-normal">Status</th>
                  <th className="py-1.5 pr-2 text-right font-normal">ms</th>
                  <th className="py-1.5 pr-2 text-right font-normal">Reserved</th>
                  <th className="py-1.5 pr-3 text-left font-normal">Response</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.i} className="border-t">
                    <td className="py-1.5 pl-3 pr-2 tabular-nums">{a.i}</td>
                    <td className="py-1.5 pr-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] ${
                          a.status < 300 ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : a.status < 500 ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400'
                          : 'border-destructive/20 bg-destructive/10 text-destructive'}`}
                      >
                        {a.status}
                      </Badge>
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-muted-foreground">{a.ms}</td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums ${a.reserved > 0 ? 'font-semibold text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                      {a.reserved}
                    </td>
                    <td className="py-1.5 pr-3">{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {integrity && (
          <div className="rounded-lg border bg-muted/20 p-3">
            <p className="text-xs font-medium">
              Stock integrity across all {integrity.totals.rows} shelves:{' '}
              <span className={integrity.ok ? 'text-emerald-700 dark:text-emerald-400' : 'text-destructive'}>
                {integrity.ok ? 'clean' : `${integrity.oversold.length} oversold`}
              </span>
              <span className="ml-1 font-normal text-muted-foreground">
                ({Number(integrity.totals.reserved)} reserved of {Number(integrity.totals.on_hand)} on hand)
              </span>
            </p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-muted-foreground">
              {integrity.enforcedBy.map((e) => <li key={e}>• {e}</li>)}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
