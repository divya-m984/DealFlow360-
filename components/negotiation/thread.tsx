// OWNER: D2.  CLAIMED — new path.  Mounted on D1's quotation detail screen
// as a two-line flagged edit; the component itself is self-contained, so
// moving it is a one-line change.
//
// Jury review 2, ask 1: a chat interface for the buyer↔seller negotiation.
//
// ── WHAT MAKES THIS A THREAD AND NOT A COMMENT LIST ──────────────────
// Author and SIDE.  Before this, negotiation_comment stored only
// (comment, created_at) — so there was no left/right, no "who conceded", and
// no answer in the data to "who agreed to 22%?".  author_side is stored on
// the row rather than derived from the author's current role, because roles
// are now mutable (ask 7): promote the rep who ran this negotiation and a
// derived side would silently re-render months of history.
//
// ── THE INTERNAL NOTE ────────────────────────────────────────────────
// Staff can post a note the customer never sees.  It is rendered here with a
// deliberately loud treatment, because the failure mode of this feature is
// someone believing a message is internal when it is not.  The portal route
// excludes them in the SQL WHERE clause, not in JavaScript.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useLiveRefresh } from '@/components/fulfilment/use-live-refresh'

type Msg = {
  id: number
  comment: string
  author_side: 'seller' | 'buyer' | null
  is_internal: boolean
  created_at: string
  read_at: string | null
  author_name: string | null
  author_role: string | null
}
type Thread = {
  id: number
  status: string
  quotation_number: string
  customer_name: string
  counter_discount_pct: string | null
  requested_delivery_date: string | null
}

const CAN_POST = ['sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin']

export function NegotiationThread({ quotationId }: { quotationId: number }) {
  const [thread, setThread] = useState<Thread | null>(null)
  const [role, setRole] = useState<string | null>(null)
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [error, setError] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [internal, setInternal] = useState(false)
  const [busy, setBusy] = useState(false)
  const dirty = useRef(false)
  const endRef = useRef<HTMLDivElement>(null)

  const canPost = role !== null && CAN_POST.includes(role)

  // Two hops: find this quotation's live thread, then read it.  Kept inside
  // the component so the mount stays a single line on any screen.
  const load = useCallback(async () => {
    try {
      const [tRes, meRes] = await Promise.all([
        fetch(`/api/negotiation?quotationId=${quotationId}`),
        fetch('/api/auth/me'),
      ])
      const tBody = await tRes.json()
      if (!tRes.ok) throw new Error(tBody.error?.message ?? 'Could not load the negotiation')
      if (meRes.ok) setRole((await meRes.json()).data.role)

      const t = tBody.data.thread
      if (!t) { setThread(null); setMsgs([]); setError(null); return }

      const r = await fetch(`/api/negotiation/${t.id}/messages`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not load the thread')
      setThread(j.data.thread); setMsgs(j.data.messages); setError(null)
    } catch (e: any) { setError(e.message) }
  }, [quotationId])

  useEffect(() => { load() }, [load])
  // A poll must never wipe a half-typed reply.
  useLiveRefresh(load, { intervalMs: 10_000, isSafeToRefresh: () => !dirty.current && !busy })

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }) }, [msgs.length])

  async function send() {
    if (!text.trim()) return
    setBusy(true); setError(null)
    try {
      const r = await fetch(`/api/negotiation/${thread!.id}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment: text, is_internal: internal }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not send')
      setText(''); dirty.current = false; setInternal(false)
      await load()
    } catch (e: any) { setError(e.message) } finally { setBusy(false) }
  }

  // No negotiation on this quotation is the ordinary case — render nothing
  // rather than an empty card that implies something is missing.
  if (!thread && !error) return null

  if (error && !thread) {
    return (
      <Card><CardHeader><CardTitle>Negotiation</CardTitle></CardHeader>
        <CardContent className="text-sm text-destructive">{error}</CardContent></Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          Negotiation
          {thread && <Badge variant="outline" className="text-[11px]">{thread.status}</Badge>}
          {thread?.counter_discount_pct && (
            <Badge variant="outline" className="border-amber-500/20 bg-amber-500/10 text-[11px] text-amber-700 dark:text-amber-400">
              counter {Number(thread.counter_discount_pct).toFixed(2)}%
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          {thread ? <>{thread.customer_name} · {thread.quotation_number}. </> : null}
          Both sides write into one thread. Messages marked internal are excluded from the customer
          portal in the query itself, not filtered afterwards.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border bg-muted/20 p-3">
          {msgs.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No messages yet.</p>
          )}
          {msgs.map((m) => {
            const seller = m.author_side === 'seller'
            return (
              <div key={m.id} className={`flex ${seller ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={[
                    'max-w-[80%] rounded-lg px-3 py-2 text-sm',
                    m.is_internal
                      ? 'border border-dashed border-amber-500/50 bg-amber-500/10'
                      : seller
                        ? 'bg-primary text-primary-foreground'
                        : 'border bg-background',
                  ].join(' ')}
                >
                  <div className="mb-0.5 flex items-center gap-2 text-[11px] opacity-80">
                    <span className="font-medium">{m.author_name ?? 'Unknown'}</span>
                    {m.author_role && <span>· {m.author_role}</span>}
                    {m.is_internal && (
                      <span className="font-semibold text-amber-700 dark:text-amber-400">
                        INTERNAL — not visible to the customer
                      </span>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap">{m.comment}</p>
                  <div className="mt-0.5 text-[10px] opacity-70">
                    {new Date(m.created_at).toLocaleString()}
                    {seller && !m.is_internal && (m.read_at ? ' · read' : ' · sent')}
                  </div>
                </div>
              </div>
            )
          })}
          <div ref={endRef} />
        </div>

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {canPost ? (
          <div className="space-y-2">
            <Textarea
              rows={2}
              placeholder="Reply to the customer…"
              value={text}
              onChange={(e) => { dirty.current = true; setText(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send() }
              }}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={internal}
                  onCheckedChange={(v) => setInternal(v === true)}
                />
                Internal note — staff only, never sent to the customer
              </label>
              <Button size="sm" onClick={send} disabled={busy || !text.trim()}>
                {busy ? 'Sending…' : internal ? 'Save internal note' : 'Send to customer'}
              </Button>
            </div>
          </div>
        ) : (
          <Badge variant="secondary">
            Read-only — {role ?? 'unknown role'} may read the negotiation, not post into it
          </Badge>
        )}
      </CardContent>
    </Card>
  )
}
