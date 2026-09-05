// OWNER: D2.  CLAIMED — new path.
//
// The UI for jury review 2, asks 3 and 7: create a user, and promote one.
// The API refusals in app/api/users/** are the real enforcement; everything
// here is a convenience on top of them.  Nothing in this component is a
// SECURITY control — it hides buttons the server would refuse anyway, so a
// user is never invited to click something that 403s.  That ordering matters:
// the server is authoritative, the UI is polite.

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useLiveRefresh } from '@/components/fulfilment/use-live-refresh'

type Row = {
  id: number
  email: string
  full_name: string
  role: string
  is_active: boolean
  customer_name: string | null
  created_by_name: string | null
  role_changed_at: string | null
  role_changed_by_name: string | null
}

/** Mirrors ROLE_RANK in lib/jwt.ts.  Duplicated deliberately: the client
 *  cannot import a server-authoritative rank and then be trusted with it, and
 *  this copy only decides which <option>s to render.  The server re-checks. */
const RANK: Record<string, number> = {
  viewer: 0, sales_rep: 1, sales_manager: 2, finance: 2, admin: 3, super_admin: 4,
}
const ASSIGNABLE = ['viewer', 'sales_rep', 'sales_manager', 'finance', 'admin', 'super_admin']

const ROLE_TONE: Record<string, string> = {
  super_admin: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20',
  admin: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20',
  finance: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20',
  sales_manager: 'bg-violet-500/10 text-violet-700 dark:text-violet-400 border-violet-500/20',
  sales_rep: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20',
  viewer: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
  portal: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20',
}

export function UserAdmin({ myRole, myUserId }: { myRole: string; myUserId: number }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | 'new' | null>(null)
  const [showNew, setShowNew] = useState(false)
  const dirty = useRef(false)

  const [form, setForm] = useState({ email: '', full_name: '', password: '', role: 'sales_rep' })

  const myRank = RANK[myRole] ?? -1

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/users')
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not load users')
      setRows(j.data)
      setError(null)
      dirty.current = false
    } catch (e: any) {
      setError(e.message)
    }
  }, [])

  useEffect(() => { load() }, [load])
  // Never refetch while a half-typed new user is on screen — a poll that
  // clears the form is data loss the user did not ask for.
  useLiveRefresh(load, { isSafeToRefresh: () => !dirty.current && busy === null && !showNew })

  async function create() {
    setBusy('new'); setError(null); setNotice(null)
    try {
      const r = await fetch('/api/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not create the user')
      setNotice(`Created ${j.data.email} as ${j.data.role}.`)
      setForm({ email: '', full_name: '', password: '', role: 'sales_rep' })
      setShowNew(false)
      await load()
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function changeRole(u: Row, role: string) {
    if (role === u.role) return
    setBusy(u.id); setError(null); setNotice(null)
    try {
      const r = await fetch(`/api/users/${u.id}/role`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ role, reason: 'Changed from Settings' }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not change the role')
      setNotice(`${j.data.full_name}: ${j.data.previous_role} → ${j.data.role} (${j.data.direction}d).`)
      await load()
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  async function setActive(u: Row, is_active: boolean) {
    setBusy(u.id); setError(null); setNotice(null)
    try {
      const r = await fetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active }),
      })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error?.message ?? 'Could not update the account')
      setNotice(`${u.full_name} ${is_active ? 'reactivated' : 'deactivated'}.`)
      await load()
    } catch (e: any) { setError(e.message) } finally { setBusy(null) }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle>Users &amp; roles</CardTitle>
          <CardDescription>
            Create an account, promote or demote one, or archive it. Deactivating is how an ERP
            removes a user — the login stops working and the history stays attributable. There is
            no delete: <code className="text-[11px]">app_user</code> is referenced by quotations,
            approvals and the audit log under <code className="text-[11px]">ON DELETE RESTRICT</code>.
          </CardDescription>
        </div>
        <Button size="sm" onClick={() => { setShowNew((v) => !v); dirty.current = false }}>
          {showNew ? 'Cancel' : 'New user'}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        {notice && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

        {showNew && (
          <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2">
            <Input
              placeholder="Full name" value={form.full_name}
              onChange={(e) => { dirty.current = true; setForm({ ...form, full_name: e.target.value }) }}
            />
            <Input
              type="email" placeholder="name@dealflow.app" value={form.email}
              onChange={(e) => { dirty.current = true; setForm({ ...form, email: e.target.value }) }}
            />
            <Input
              type="password" placeholder="Password (min 8 characters)" value={form.password}
              onChange={(e) => { dirty.current = true; setForm({ ...form, password: e.target.value }) }}
            />
            <div className="flex gap-2">
              <select
                className="h-9 flex-1 rounded-md border bg-background px-2 text-sm"
                value={form.role}
                onChange={(e) => { dirty.current = true; setForm({ ...form, role: e.target.value }) }}
              >
                {/* Only roles at or below your own — the server enforces the
                    same rule, this just avoids offering a certain refusal. */}
                {ASSIGNABLE.filter((r) => RANK[r] <= myRank).map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <Button onClick={create} disabled={busy === 'new' || !form.email || !form.full_name || form.password.length < 8}>
                {busy === 'new' ? 'Creating…' : 'Create'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              You may only create roles at or below <strong>{myRole}</strong>. Granting above your own
              rank is the one move that actually gains privilege, and the server refuses it.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-44">Role</TableHead>
                <TableHead>Last role change</TableHead>
                <TableHead className="w-28 text-right">Account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((u) => {
                const isSelf = u.id === myUserId
                const outranksMe = u.role !== 'portal' && (RANK[u.role] ?? 99) > myRank
                const locked = isSelf || outranksMe || u.role === 'portal'
                return (
                  <TableRow key={u.id} className={u.is_active ? '' : 'opacity-50'}>
                    <TableCell className="font-medium">
                      {u.full_name}
                      {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                      {u.customer_name && <div className="text-xs text-muted-foreground">{u.customer_name}</div>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{u.email}</TableCell>
                    <TableCell>
                      {locked ? (
                        <Badge variant="outline" className={ROLE_TONE[u.role] ?? ''}>{u.role}</Badge>
                      ) : (
                        <select
                          className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                          value={u.role}
                          disabled={busy === u.id || !u.is_active}
                          onChange={(e) => changeRole(u, e.target.value)}
                        >
                          {ASSIGNABLE.filter((r) => RANK[r] <= myRank || r === u.role).map((r) => (
                            <option key={r} value={r}>{r}</option>
                          ))}
                        </select>
                      )}
                      {locked && (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {isSelf ? 'You cannot change your own role'
                            : u.role === 'portal' ? 'Customer login — a different ladder'
                            : `Outranks ${myRole}`}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.role_changed_at
                        ? <>{new Date(u.role_changed_at).toLocaleString()}<br />by {u.role_changed_by_name ?? '—'}</>
                        : <>never{u.created_by_name ? <><br />created by {u.created_by_name}</> : null}</>}
                    </TableCell>
                    <TableCell className="text-right">
                      {isSelf ? (
                        <span className="text-xs text-muted-foreground">—</span>
                      ) : (
                        <Button
                          size="sm" variant={u.is_active ? 'outline' : 'secondary'}
                          disabled={busy === u.id || outranksMe}
                          onClick={() => setActive(u, !u.is_active)}
                        >
                          {u.is_active ? 'Archive' : 'Restore'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
              {rows && rows.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No users.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
