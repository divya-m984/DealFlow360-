// OWNER: D3.  The internal app shell — one blue bar on all 16 internal screens.
// This is the single thing making the build read as one application rather than
// four people's screens, so nothing here is per-screen configurable.
//
// The customer portal (§7) is a SEPARATE shell owned by D1.  Nothing from NAV
// appears there.
//
// NOT YET BUILT (Phase 3): the demo role switcher.  /api/auth/switch already
// exists and is implemented; the dropdown is deliberately out of Phase 1 scope.
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { cn } from 'cn'
import { NAV } from '@/components/nav'

type Me = { fullName: string; role: string; email: string }

/** Roles are stored as snake_case enums; the chrome shows them as words. */
function roleLabel(role: string) {
  return role.replace(/_/g, ' ')
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled && b?.data) setMe(b.data as Me)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-40 bg-nav text-nav-foreground">
        <div className="mx-auto flex h-12 w-full max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="shrink-0 text-sm font-semibold tracking-tight text-nav-foreground"
          >
            DealFlow360
          </Link>

          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV.map((item) => {
              const active =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'shrink-0 rounded-md px-2.5 py-1.5 text-[0.8rem] font-medium whitespace-nowrap transition-colors',
                    'outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/60',
                    active
                      ? 'bg-nav-active text-nav-foreground'
                      : 'text-nav-foreground/75 hover:bg-white/10 hover:text-nav-foreground',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            {me && (
              <span className="hidden text-right text-xs leading-tight sm:block">
                <span className="block font-medium">{me.fullName}</span>
                <span className="block text-nav-foreground/70 capitalize">
                  {roleLabel(me.role)}
                </span>
              </span>
            )}
            <button
              onClick={logout}
              title="Log out"
              className="inline-flex size-7 items-center justify-center rounded-md text-nav-foreground/75 transition-colors hover:bg-white/10 hover:text-nav-foreground focus-visible:ring-2 focus-visible:ring-nav-foreground/60 outline-none"
            >
              <LogOut className="size-4" />
              <span className="sr-only">Log out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  )
}
