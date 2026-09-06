// OWNER: D3.  Screen 20 — Messages (the internal negotiation inbox).
//
// The customer portal has had a Messages tab since the shell was built.  The
// internal application never did: after review 2 a rep could read and answer a
// counter-offer, but only by already knowing which quotation it hung off and
// opening that screen.  The customer could see they had a conversation; the
// salesperson could not.  A message the recipient has to go looking for is a
// message they miss.
//
// THE SCREEN IS A TRIAGE LIST, NOT A CHAT CLIENT.  The conversation itself
// lives on the quotation, next to the lines and the risk score it is arguing
// about — moving it here would separate the argument from its subject.  So
// this answers one question only: which deals are waiting on us, and how long
// have they been waiting.  Every row opens the thread in place.
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { MessageSquare } from 'lucide-react'
import { cn } from 'cn'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorState } from '@/components/shared/error-state'
import { DateValue, Money, Num } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'
import { Skeleton } from '@/components/ui/skeleton'

type Thread = {
  id: number
  number: string
  state: string
  currency_code: string
  grand_total: string | number
  last_activity_at: string
  customer_name: string
  owner_name: string
  message_count: number
  open_requests: number
  open_counter_pct: string | null
  last_message: string | null
  last_message_at: string | null
  last_message_author: string | null
  last_message_side: 'buyer' | 'seller' | null
  /** Open request whose last word came from the customer — our move. */
  awaiting_us: boolean
}

const PANEL = 'rounded-xl border border-border bg-card shadow-[var(--shadow-card)]'

/** Whole days since a message, for the "waiting N days" pressure. */
function daysSince(iso: string | null) {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

function ThreadRow({ row, onOpen }: { row: Thread; onOpen: () => void }) {
  const waiting = daysSince(row.last_message_at ?? row.last_activity_at)

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors',
          'hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)]',
          'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50',
        )}
      >
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {row.number}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {row.customer_name}
            <span className="text-muted-foreground/70"> · {row.owner_name}</span>
          </span>

          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* The one label that means "do something". */}
            {row.awaiting_us && <StatusBadge status="pending" label="Awaiting our reply" />}
            <StatusBadge status={row.state} />
          </span>
        </div>

        {row.last_message ? (
          // line-clamp-2, not truncate: the first line of a message is often
          // "Hi —", and a one-line preview of that says nothing.
          <p className="line-clamp-2 text-sm text-foreground/85">
            <span className="font-medium text-foreground">
              {row.last_message_side === 'seller'
                ? 'Us'
                : (row.last_message_author ?? row.customer_name)}
              :
            </span>{' '}
            {row.last_message}
          </p>
        ) : (
          // A request can exist with no comments on it — the customer asked for
          // a number and said nothing else.  That is still a live thread.
          <p className="text-sm text-muted-foreground italic">
            A change request with no message attached.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.7rem] text-muted-foreground">
          <span className="tabular-nums">
            <Num value={row.message_count} />{' '}
            {row.message_count === 1 ? 'message' : 'messages'}
          </span>
          {row.open_counter_pct != null && (
            <>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                asking <Num value={row.open_counter_pct} suffix="%" />
              </span>
            </>
          )}
          <span aria-hidden>·</span>
          <Money
            value={row.grand_total}
            currency={row.currency_code}
            className="text-[0.7rem]"
          />
          <span className="ml-auto shrink-0 tabular-nums">
            {waiting === null ? (
              <DateValue value={row.last_activity_at} className="text-[0.7rem]" />
            ) : waiting === 0 ? (
              'today'
            ) : (
              <span className={cn(row.awaiting_us && waiting >= 2 && 'font-semibold text-[var(--accent-red)]')}>
                {waiting}d ago
              </span>
            )}
          </span>
        </div>
      </button>
    </li>
  )
}

export default function MessagesPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<Thread>('/api/negotiation/inbox')

  const awaiting = (rows ?? []).filter((r) => r.awaiting_us)
  const rest = (rows ?? []).filter((r) => !r.awaiting_us)

  return (
    <>
      <PageHeader
        title="Messages"
        description="Every quotation the customer is talking to us about, and which ones are waiting on a reply."
      />

      {error ? (
        <div className={PANEL}>
          <ErrorState error={error} onRetry={retry} />
        </div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      ) : (rows?.length ?? 0) === 0 ? (
        <div className={PANEL}>
          <EmptyState
            icon={<MessageSquare className="size-4" />}
            title="No conversations"
            description="A thread starts when a customer sends a change request from their portal. Nothing is waiting on you."
          />
        </div>
      ) : (
        <div className="space-y-6">
          {/* TWO SECTIONS, not one sorted list.  "Waiting on us" is a worklist
              and everything else is history; a single list ordered by recency
              buries the four rows that need action under twenty that do not. */}
          {awaiting.length > 0 && (
            <section className={cn(PANEL, 'overflow-hidden')}>
              <header className="flex items-start gap-2.5 border-b border-border px-4 py-3">
                <span
                  aria-hidden
                  className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-red-soft)] text-[var(--accent-red)]"
                >
                  <MessageSquare className="size-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-foreground">
                    Waiting on us
                    <span className="ml-1.5 font-semibold text-muted-foreground tabular-nums">
                      {awaiting.length}
                    </span>
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    The customer spoke last and their request is still open.
                  </p>
                </div>
              </header>
              <ul className="divide-y divide-border">
                {awaiting.map((row) => (
                  <ThreadRow
                    key={row.id}
                    row={row}
                    onOpen={() => router.push(`/quotations/${row.id}`)}
                  />
                ))}
              </ul>
            </section>
          )}

          <section className={cn(PANEL, 'overflow-hidden')}>
            <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-foreground">
                  {awaiting.length > 0 ? 'Everything else' : 'Conversations'}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Answered, settled, or waiting on the customer.
                </p>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                <Num value={rest.length} /> {rest.length === 1 ? 'thread' : 'threads'}
              </span>
            </header>
            {rest.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                Nothing else — every conversation is waiting on us.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {rest.map((row) => (
                  <ThreadRow
                    key={row.id}
                    row={row}
                    onOpen={() => router.push(`/quotations/${row.id}`)}
                  />
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-muted-foreground">
            Opening a row goes to the quotation, where the full thread and the
            Accept / Decline decision live.
          </p>
        </div>
      )}
    </>
  )
}
