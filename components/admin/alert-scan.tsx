// OWNER: D2.  CLAIMED.
//
// The trigger for lib/alerts.ts.  Self-contained, like the negotiation
// thread: mounting it anywhere is one line and it carries all its own state.
//
// ── WHY A BUTTON AND NOT A GET SIDE EFFECT ───────────────────────────
// It would have been fewer lines to run the scan inside D1's
// GET /api/deal-alerts so the screen always showed fresh alerts.  That makes
// a read mutate, which is the kind of thing that is invisible until two
// people load the page at once, or until a cache is added and the writes
// silently stop happening.  An explicit POST is honest about what it does,
// and it gives the demo a moment: press it, watch an alert appear.
//
// The scan is idempotent — `one_open_alert_per_kind` is a partial unique
// index — so the button cannot be double-clicked into a mess.

'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'

type Result = {
  opened: { kind: string; number: string; detail: string }[]
  updated: number
  autoResolved: { kind: string; number: string }[]
  thresholds: { stallDays: number; discountAnomalyPoints: number }
}

export function AlertScan({ onDone }: { onDone?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [r, setR] = useState<Result | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setBusy(true); setError(null)
    try {
      const res = await fetch('/api/alerts/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error?.message ?? 'Scan failed')
      setR(j.data)
      onDone?.()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" onClick={run} disabled={busy}>
        {busy ? 'Scanning…' : 'Re-scan for alerts'}
      </Button>
      {r && (
        <span className="text-xs text-muted-foreground">
          {r.opened.length > 0 && (
            <Badge variant="outline" className="mr-1 border-amber-500/20 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-400">
              +{r.opened.length} opened
            </Badge>
          )}
          {r.autoResolved.length > 0 && (
            <Badge variant="outline" className="mr-1 border-emerald-500/20 bg-emerald-500/10 text-[10px] text-emerald-700 dark:text-emerald-400">
              {r.autoResolved.length} auto-resolved
            </Badge>
          )}
          {r.opened.length === 0 && r.autoResolved.length === 0 && <span className="mr-1">no change · </span>}
          stale after {r.thresholds.stallDays}d · anomaly at +{r.thresholds.discountAnomalyPoints} pts over the tier average
        </span>
      )}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}
