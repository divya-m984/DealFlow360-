// OWNER: D1.  Portal landing — the customer's own quotations.
//
// Scoped server-side by session.customerId; this page never asks for an id.
'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badge'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorState } from '@/components/shared/error-state'
import { Money, DateValue } from '@/components/shared/money'

type Row = {
  public_id: string; number: string; state: string; currency_code: string
  grand_total: string; last_activity_at: string; rep_name: string
  has_open_request: boolean
}

export default function PortalHome() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal').then(async (r) => {
      const b = await r.json()
      if (!r.ok) return setError(b?.error?.message ?? 'Could not load your quotations')
      setRows(b.data)
    })
  }, [])

  if (error) return <div className="p-6"><ErrorState error={error} /></div>
  if (!rows) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>

  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-lg font-semibold">My quotations</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review your quotation, ask for changes, and confirm — no email back and forth.
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing to review yet"
          description="When your sales rep sends a quotation, it will appear here."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((r) => (
            <Card
              key={r.public_id}
              className="cursor-pointer transition-colors hover:border-foreground/25"
              onClick={() => router.push(`/portal/${r.public_id}`)}
            >
              <CardContent className="space-y-2 pt-5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.number}</span>
                  <StatusBadge status={r.state} />
                </div>
                <div className="text-2xl font-semibold">
                  <Money value={r.grand_total} currency={r.currency_code} />
                </div>
                <div className="text-xs text-muted-foreground">
                  Your rep: {r.rep_name} · updated <DateValue value={r.last_activity_at} />
                </div>
                {r.has_open_request && (
                  <p className="text-xs text-amber-400">Your change request is with the sales team.</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
