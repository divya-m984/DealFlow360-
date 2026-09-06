// The customer's message inbox.
//
// ── WHY THIS FILE EXISTS ─────────────────────────────────────────────
// components/nav.ts has shipped a "Messages" tab in PORTAL_NAV since Phase 1,
// and the route behind it was never written — clicking it in the customer-
// facing shell produced a 404.  A dead link is bad anywhere; in the half of the
// product we hand to a customer it is the worst place to have one.
//
// It is worth building rather than deleting because the conversation became
// real at review 2: both sides can now post to a negotiation thread, and a
// thread you can only reach by remembering which quotation it was attached to
// is a thread nobody reads.  An inbox is what turns "a comment box on a
// quotation" into messaging.
//
// ── NO NEW ENDPOINT ──────────────────────────────────────────────────
// This reads GET /api/portal, the same list the landing page uses, which was
// extended with the last message and a count.  A dedicated messages endpoint
// would return the same quotations again under a different name, and would be
// a second thing that can fail in the customer's application.
'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { MessageSquare } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/status-badge'
import { ErrorState } from '@/components/shared/error-state'
import { EmptyState } from '@/components/shared/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { DateValue, Money } from '@/components/shared/money'

type Row = {
  public_id: string
  number: string
  state: string
  currency_code: string
  grand_total: string
  last_activity_at: string
  rep_name: string
  has_open_request: boolean
  message_count: number
  last_message: string | null
  last_message_at: string | null
  last_message_author: string | null
  /** Stored per message by db/seed/00-migrations.sql; db/seed/09-backfill.sql
   *  guarantees it is set on every seeded row. */
  last_message_side: 'buyer' | 'seller' | null
}

export default function PortalMessagesPage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const r = await fetch('/api/portal', { headers: { accept: 'application/json' } })
    const b = await r.json().catch(() => null)
    if (!r.ok || b?.error) {
      setError(b?.error?.message ?? 'Could not load your messages')
      return
    }
    setRows(Array.isArray(b?.data) ? b.data : [])
  }, [])

  useEffect(() => { load() }, [load])

  // Only quotations that have actually been talked about.  A list of every
  // quotation would be the landing page again, with a different heading.
  const threads = (rows ?? []).filter((r) => r.message_count > 0)
  // Waiting on the rep first — that is the one the customer opened this page
  // to check on.
  const sorted = [...threads].sort((a, b) => {
    if (a.has_open_request !== b.has_open_request) return a.has_open_request ? -1 : 1
    return Date.parse(b.last_message_at ?? b.last_activity_at) -
           Date.parse(a.last_message_at ?? a.last_activity_at)
  })

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Messages</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conversations with your sales rep about a quotation.
        </p>
      </div>

      {error ? (
        <Card><CardContent className="p-0"><ErrorState error={{ message: error }} onRetry={load} /></CardContent></Card>
      ) : rows === null ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="p-0">
            <EmptyState
              icon={<MessageSquare className="size-4" />}
              title="No conversations yet"
              description="Open a quotation and send a change request — anything you and your rep say about it appears here."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {sorted.map((r) => {
            // A message from the rep with the request still open is the one
            // thing on this page that needs an answer.
            const awaitingYou = r.last_message_side === 'seller' && r.has_open_request
            return (
              <Link
                key={r.public_id}
                href={`/portal/${r.public_id}`}
                className="block rounded-xl border border-border bg-card shadow-[var(--shadow-card)] transition-colors hover:border-foreground/25 hover:bg-[var(--row-hover)] focus-visible:ring-2 focus-visible:ring-ring/50 outline-none"
              >
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">
                      {r.number}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        with {r.rep_name}
                      </span>
                    </CardTitle>
                    <div className="flex shrink-0 items-center gap-2">
                      {awaitingYou && <StatusBadge status="pending" label="Reply needed" />}
                      <StatusBadge status={r.state} />
                    </div>
                  </div>
                  <CardDescription>
                    <Money value={r.grand_total} currency={r.currency_code} /> ·{' '}
                    {r.message_count} {r.message_count === 1 ? 'message' : 'messages'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {r.last_message && (
                    <p className="line-clamp-2 text-sm text-foreground">
                      <span className="font-medium">
                        {r.last_message_side === 'buyer'
                          ? 'You'
                          : (r.last_message_author ?? r.rep_name)}
                        :
                      </span>{' '}
                      {r.last_message}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    <DateValue value={r.last_message_at ?? r.last_activity_at} />
                  </p>
                </CardContent>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
