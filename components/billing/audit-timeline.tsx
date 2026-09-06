// OWNER: D2.
//
// "Who changed this, and when?" — answered on the record's own screen.
//
// audit_log has been written by nearly every write in this application from
// day one and was readable on only two screens. This is the other screens.
//
// Deliberately plain: a vertical rail, one row per event, newest first. An
// audit trail is read under pressure by someone reconstructing what happened,
// and cleverness in that context is an obstacle. The only visual encoding is
// a colour on the action dot, because the eye finds "who deleted something"
// faster than it reads nine lines of prose.

'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useLiveRefresh } from '@/components/fulfilment/use-live-refresh'

type Entry = {
  id: number
  action: string
  note: string | null
  payload: unknown
  created_at: string
  actor_name: string | null
  actor_email: string | null
  actor_role: string | null
}

/** Destructive and privilege actions get a colour; everything else is neutral.
 *  If everything is highlighted, nothing is. */
const TONE: Record<string, string> = {
  create: 'bg-emerald-500',
  post: 'bg-emerald-500',
  promote: 'bg-violet-500',
  demote: 'bg-amber-500',
  deactivate: 'bg-red-500',
  reactivate: 'bg-emerald-500',
  credit_note: 'bg-amber-500',
  invoice_partial: 'bg-blue-500',
  invoice_final: 'bg-emerald-500',
  eway_bill: 'bg-blue-500',
  update: 'bg-slate-400',
}

export function AuditTimeline({
  entityType, entityId, title = 'History',
}: { entityType: string; entityId: number; title?: string }) {
  const [entries, setEntries] = useState<Entry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/audit?entityType=${entityType}&entityId=${entityId}`)
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not load history')
      setEntries(j.data.entries); setError(null)
    } catch (e: any) { setError(e.message) }
  }, [entityType, entityId])

  useEffect(() => { load() }, [load])
  useLiveRefresh(load, { intervalMs: 30_000 })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>
          Every recorded change to this record, newest first. Written in the same transaction as
          the change itself, so an action cannot succeed without leaving a trace.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {entries && entries.length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing recorded against this record yet.</p>
        )}
        {entries && entries.length > 0 && (
          <ol className="relative space-y-0 border-l pl-5">
            {entries.map((e) => (
              <li key={e.id} className="relative pb-4 last:pb-0">
                <span
                  className={`absolute -left-[1.4rem] top-1.5 h-2 w-2 rounded-full ring-2 ring-background ${TONE[e.action] ?? 'bg-slate-400'}`}
                />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm font-medium">{e.action.replace(/_/g, ' ')}</span>
                  {e.actor_role && (
                    <Badge variant="outline" className="text-[10px]">{e.actor_role}</Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground">
                    {e.actor_name ?? 'system'} · {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                {e.note && <p className="mt-0.5 text-xs text-muted-foreground">{e.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
