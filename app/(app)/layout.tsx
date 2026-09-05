// OWNER: D3.  The internal app shell — one blue bar on all 16 internal screens.
// This is the single thing making the build read as one application rather than
// four people's screens, so nothing here is per-screen configurable.
//
// The customer portal (§7) is a SEPARATE shell owned by D1.  Nothing from NAV
// appears there, and the identity switcher below deliberately refuses to switch
// into a portal identity — see PORTAL EXCLUSION in identity-switcher.tsx.
'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { LogOut } from 'lucide-react'
import { cn } from 'cn'
import { NAV } from '@/components/nav'
import { IdentitySwitcher, type Identity } from '@/components/shared/identity-switcher'
import { Toaster } from '@/components/ui/sonner'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [me, setMe] = useState<Identity | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!cancelled && b?.data) setMe(b.data as Identity)
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

          <div className="flex shrink-0 items-center gap-1">
            <IdentitySwitcher me={me} />
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

      {/* Dark is forced: the app ships one theme, and sonner would otherwise
          read prefers-color-scheme and render a light toast on a dark page. */}
      <Toaster theme="dark" position="bottom-right" />
    </div>
  )
}
