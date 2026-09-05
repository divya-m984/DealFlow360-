// Screen 2 — Sales Dashboard / Home.
// Built by D1 (this path is D3's in OWNERSHIP.md — flagged, not claimed).
//
// The mockup's brief for this screen is small and it should stay small: three
// tiles, two actions, and recent activity. It is a launchpad, not a workspace
// — its real job is being the place the demo starts from, and every tile is a
// link into the screen that can actually do something about the number.
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageHeader } from '@/components/shared/page-header'
import { ErrorState } from '@/components/shared/error-state'
import { EmptyState } from '@/components/shared/empty-state'
import { Money, DateValue } from '@/components/shared/money'

type Data = {
  pending_approvals: number
  open_quotations: number
  at_risk_deals: number
  open_value: string
  currency_code: string
  scopedToMe: boolean
  activity: {
    id: number; action: string; note: string | null; created_at: string
    actor_name: string | null; quotation_id: number; number: string; customer_name: string
  }[]
}

export default function DashboardPage() {
  const router = useRouter()
  const [d, setD] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = () =>
    fetch('/api/dashboard').then(async (r) => {
      const b = await r.json()
      if (!r.ok) return setError(b?.error?.message ?? 'Could not load the dashboard')
      setD(b.data)
    })

  useEffect(() => { load() }, [])

  // "+ New Quotation" from the mockup. Picks the first customer so the rep
  // lands straight in the builder; they change it there.
  async function newQuotation() {
    setCreating(true)
    const cs = await fetch('/api/quotations').then((r) => r.json())
    const customerId = cs?.data?.[0]?.customer_id ?? 1
    const res = await fetch('/api/quotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId }),
    })
    const b = await res.json()
    setCreating(false)
    if (!res.ok) return setError(b?.error?.message ?? 'Could not create a quotation')
    router.push(`/quotations/${b.data.id}`)
  }

  if (error && !d) return <div className="p-6"><ErrorState error={error} onRetry={load} /></div>
  if (!d) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="space-y-5 p-6">
      <PageHeader
        title="Sales Dashboard"
        description={
          d.scopedToMe
            ? 'Your pipeline. Every tile opens the screen that can act on it.'
            : 'Central hub. Every tile opens the screen that can act on it.'
        }
        actions={
          <div className="flex gap-2">
            <Button onClick={newQuotation} disabled={creating}>+ New Quotation</Button>
            <Button variant="outline" onClick={() => router.push('/approvals')}>View Approvals</Button>
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <TileLink
          href="/approvals"
          label="Pending Approvals"
          value={d.pending_approvals}
          hint={d.pending_approvals === 1 ? '1 quotation waiting' : `${d.pending_approvals} quotations waiting`}
          tone={d.pending_approvals > 0 ? 'amber' : undefined}
        />
        <TileLink
          href="/quotations"
          label="Open Quotations"
          value={d.open_quotations}
          hint="Active deals"
        />
        <TileLink
          href="/deal-health"
          label="At Risk Deals"
          value={d.at_risk_deals}
          hint="Flagged by Deal Health"
          tone={d.at_risk_deals > 0 ? 'red' : undefined}
        />
        <div className="rounded-lg border px-4 py-3">
          <div className="text-xs text-muted-foreground">Open pipeline value</div>
          <div className="mt-1 text-2xl font-semibold">
            <Money value={d.open_value} currency={d.currency_code} />
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Not yet confirmed</div>
        </div>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-medium">Recent activity</h2>
        {d.activity.length === 0 ? (
          <EmptyState
            title="Nothing has happened yet"
            description="Approvals, edits and confirmations show up here as they happen."
          />
        ) : (
          <Card>
            <CardContent className="divide-y p-0">
              {d.activity.map((a) => (
                <Link
                  key={a.id}
                  href={`/quotations/${a.quotation_id}`}
                  className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-sm transition-colors hover:bg-muted/40"
                >
                  <span className="font-medium">{a.customer_name}</span>
                  <span className="text-muted-foreground">
                    {a.number} · {a.action.replace(/_/g, ' ')}
                    {a.actor_name && ` by ${a.actor_name}`}
                  </span>
                  {a.note && <span className="text-muted-foreground">— {a.note}</span>}
                  <span className="ml-auto text-xs text-muted-foreground">
                    <DateValue value={a.created_at} />
                  </span>
                </Link>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}

function TileLink({
  href, label, value, hint, tone,
}: {
  href: string; label: string; value: number; hint: string; tone?: 'amber' | 'red'
}) {
  const colour =
    tone === 'red' ? 'text-red-400' : tone === 'amber' ? 'text-amber-400' : ''
  return (
    <Link href={href} className="rounded-lg border px-4 py-3 transition-colors hover:border-foreground/25">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${colour}`}>{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{hint}</div>
    </Link>
  )
}
