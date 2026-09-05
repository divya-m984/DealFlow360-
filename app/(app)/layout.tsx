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
import { ChevronDown } from 'lucide-react'
import {
  isGroupActive,
  NAV_GROUPS,
  type NavGroup,
} from '@/components/shared/nav-groups'
import { IdentitySwitcher, type Identity } from '@/components/shared/identity-switcher'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Toaster } from '@/components/ui/sonner'
import { ThemeToggle } from '@/components/theme-toggle'

/** Full-height, square-cornered block. One definition so a direct link and a
 *  group trigger are the same target — they must not differ by a pixel. */
const NAV_BLOCK =
  'inline-flex h-14 shrink-0 items-center gap-1 border-b-2 px-4 text-[0.8rem] font-semibold tracking-wide whitespace-nowrap uppercase transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-nav-foreground/60'

function navBlockTone(active: boolean) {
  return active
    ? 'border-nav-foreground bg-nav-active text-nav-foreground'
    : 'border-transparent text-nav-foreground/75 hover:bg-white/10 hover:text-nav-foreground'
}

/** A group's flyout: solid panel, one row per screen with its description. */
function NavGroupMenu({ group, pathname }: { group: NavGroup; pathname: string }) {
  const active = isGroupActive(group, pathname)

  return (
    <DropdownMenu>
      {/* openOnHover, with click and keyboard still working — hover alone would
          strand touch and keyboard users, and this is the primary navigation. */}
      <DropdownMenuTrigger
        openOnHover
        delay={70}
        closeDelay={150}
        className={cn(NAV_BLOCK, navBlockTone(active), 'aria-expanded:bg-white/10')}
      >
        {group.label}
        <ChevronDown className="size-3.5 opacity-70" />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" sideOffset={0} className="w-72 min-w-72">
        {group.items.map((item) => {
          const current =
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <DropdownMenuItem
              key={item.href}
              // `render` keeps this a real <a>: middle-click, open-in-new-tab
              // and the browser's own link affordances all keep working, which
              // a div with an onClick would have thrown away.
              render={<Link href={item.href} />}
              className={cn(
                'flex-col items-start gap-0.5 py-2',
                current && 'bg-accent',
              )}
            >
              <span className="text-sm font-medium text-foreground">{item.label}</span>
              {item.description && (
                <span className="text-xs leading-snug text-muted-foreground">
                  {item.description}
                </span>
              )}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
    <div className="flex min-h-svh flex-col bg-background text-foreground transition-colors duration-200">
      <header className="sticky top-0 z-40 bg-nav text-nav-foreground">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-stretch gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="flex shrink-0 items-center text-base font-bold tracking-tight text-nav-foreground outline-none focus-visible:ring-2 focus-visible:ring-nav-foreground/60"
          >
            DealFlow360
          </Link>

          {/* Blocks butt against each other with no gap and run the full height
              of the bar, so each is a large rectangular target rather than a
              word floating in a row of words. */}
          <nav className="flex min-w-0 flex-1 items-stretch overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV_GROUPS.map((group) =>
              group.href ? (
                <Link
                  key={group.href}
                  href={group.href}
                  aria-current={isGroupActive(group, pathname) ? 'page' : undefined}
                  className={cn(
                    NAV_BLOCK,
                    navBlockTone(isGroupActive(group, pathname)),
                  )}
                >
                  {group.label}
                </Link>
              ) : (
                <NavGroupMenu key={group.label} group={group} pathname={pathname} />
              ),
            )}
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <IdentitySwitcher me={me} />
            <ThemeToggle />
            <button
              onClick={logout}
              title="Log out"
              className="inline-flex size-7 items-center justify-center rounded-md text-nav-foreground/75 transition-colors hover:bg-white/10 hover:text-nav-foreground focus-visible:ring-2 focus-visible:ring-nav-foreground/60 outline-none cursor-pointer"
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

      <Toaster position="bottom-right" />
    </div>
  )
}
