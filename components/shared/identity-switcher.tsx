// OWNER: D3.  The demo role switcher that lives in the app shell.
//
// The five-minute demo crosses four identities — rep, manager, finance,
// admin.  Logging out and back in four times costs most of a minute of a
// five-minute slot and all of the momentum, so the header switches session in
// place.
//
// CONTRACT (Integrator-owned, frozen, already implemented — app/api/auth/switch):
//   GET  -> { data: [{ email, full_name, role }] }   seeded active identities
//   POST { email } -> { data: Session }               re-issues the df_token cookie
// Both return 404 outside development: the endpoint issues a session for any
// user without a password, so it is hard-disabled in production.  A 404 here is
// therefore expected behaviour, not a bug, and the control hides itself.
//
// PORTAL EXCLUSION.  GET returns every active user including `role = 'portal'`
// (its ORDER BY has an explicit `ELSE 5` branch for them).  They are filtered
// out here, for a concrete reason rather than a stylistic one: middleware.ts
// refuses a portal session on any non-portal path, so switching to a portal
// identity from /quotations would replace the app with a plain-text 403 and
// strand the presenter mid-demo.  §7 also requires the portal to be a visibly
// separate application, which a dropdown entry in the internal chrome would
// undercut.  The portal is reached by logging into D1's separate shell.
'use client'

import * as React from 'react'
import { Check, ChevronDown, Loader2, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

/** The session shape returned by /api/auth/me (lib/jwt.ts `Session`). */
export type Identity = {
  userId: number
  role: string
  email: string
  fullName: string
  customerId: number | null
}

/** One row from GET /api/auth/switch. */
type SeededIdentity = {
  email: string
  full_name: string
  role: string
}

function roleLabel(role: string) {
  return role.replace(/_/g, ' ')
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?'
}

export function IdentitySwitcher({ me }: { me: Identity | null }) {
  const [open, setOpen] = React.useState(false)
  const [identities, setIdentities] = React.useState<SeededIdentity[] | null>(null)
  const [listError, setListError] = React.useState<string | null>(null)
  const [loadingList, setLoadingList] = React.useState(false)
  const [switchingTo, setSwitchingTo] = React.useState<string | null>(null)
  const loadedRef = React.useRef(false)

  // Fetched on first open rather than on mount: this list is demo furniture,
  // and it should not cost every page load a request.
  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (!next || loadedRef.current) return
    loadedRef.current = true
    setLoadingList(true)

    fetch('/api/auth/switch', { headers: { accept: 'application/json' } })
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        if (!res.ok || body?.error) {
          setListError(body?.error?.message ?? `Unavailable (HTTP ${res.status}).`)
          return
        }
        if (!Array.isArray(body?.data)) {
          setListError('Unexpected response from /api/auth/switch.')
          return
        }
        setIdentities(body.data as SeededIdentity[])
        setListError(null)
      })
      .catch((e) => setListError(e?.message ?? 'Could not reach /api/auth/switch.'))
      .finally(() => setLoadingList(false))
  }

  async function switchTo(identity: SeededIdentity) {
    if (switchingTo) return
    setSwitchingTo(identity.email)

    try {
      const res = await fetch('/api/auth/switch', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ email: identity.email }),
      })
      const body = await res.json().catch(() => null)

      if (!res.ok || body?.error) {
        toast.error('Could not switch identity', {
          description: body?.error?.message ?? `HTTP ${res.status}.`,
        })
        setSwitchingTo(null)
        return
      }

      // A full reload, not router.refresh(): every screen is a client
      // component holding its own already-fetched rows, and those rows were
      // scoped to the OLD session.  Reloading is the only way to guarantee the
      // whole UI reflects the new identity's permissions.
      window.location.reload()
    } catch (e) {
      toast.error('Could not switch identity', {
        description: e instanceof Error ? e.message : 'Network error.',
      })
      setSwitchingTo(null)
    }
  }

  // Portal identities are never offered here — see PORTAL EXCLUSION above.
  const internal = (identities ?? []).filter((i) => i.role !== 'portal')
  const busy = switchingTo !== null

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        disabled={busy}
        aria-label="Switch identity"
        className={cn(
          'inline-flex h-8 max-w-[13rem] items-center gap-2 rounded-md px-1.5 text-left transition-colors',
          'text-nav-foreground/85 hover:bg-white/10 hover:text-nav-foreground',
          'focus-visible:ring-2 focus-visible:ring-nav-foreground/60 outline-none',
          'aria-expanded:bg-white/10 disabled:opacity-60',
        )}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-white/15 text-[0.65rem] font-semibold">
          {busy ? (
            <Loader2 className="size-3 animate-spin" />
          ) : me ? (
            initials(me.fullName)
          ) : (
            <UserRound className="size-3" />
          )}
        </span>
        {/* The name block is the first thing to go on a narrow bar; the
            avatar and chevron keep the control reachable at any width. */}
        <span className="hidden min-w-0 flex-col leading-tight sm:flex">
          <span className="truncate text-xs font-medium">
            {me?.fullName ?? 'Signed in'}
          </span>
          <span className="truncate text-[0.65rem] text-nav-foreground/70 capitalize">
            {me ? roleLabel(me.role) : '—'}
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6} className="w-72">
        <DropdownMenuLabel>Switch identity</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {loadingList && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">Loading identities…</p>
        )}

        {listError && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">
            {listError}
            <span className="mt-1 block text-[0.7rem] opacity-70">
              Identity switching is disabled outside development.
            </span>
          </p>
        )}

        {!loadingList && !listError && internal.length === 0 && (
          <p className="px-1.5 py-2 text-xs text-muted-foreground">
            No other internal identities are seeded.
          </p>
        )}

        {internal.map((identity) => {
          const current = me?.email?.toLowerCase() === identity.email.toLowerCase()
          const pending = switchingTo === identity.email
          return (
            <DropdownMenuItem
              key={identity.email}
              disabled={busy || current}
              closeOnClick={false}
              onClick={() => switchTo(identity)}
              className="gap-2"
            >
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[0.65rem] font-semibold text-muted-foreground">
                {pending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  initials(identity.full_name)
                )}
              </span>
              <span className="flex min-w-0 flex-col leading-tight">
                <span className="truncate text-sm">{identity.full_name}</span>
                {/* The role is the point of the switch, so it is never truncated
                    away in favour of the email. */}
                <span className="truncate text-xs text-muted-foreground capitalize">
                  {roleLabel(identity.role)}
                </span>
              </span>
              {current && <Check className="ml-auto size-3.5 text-muted-foreground" />}
            </DropdownMenuItem>
          )
        })}

        <DropdownMenuSeparator />
        <p className="px-1.5 py-1 text-[0.7rem] leading-snug text-muted-foreground">
          Development only. The customer portal is a separate application and is
          not switchable from here.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
