// OWNER: D3.  Groups the flat NAV list into the top-level bar.
//
// WHY THIS FILE EXISTS AND components/nav.ts IS UNTOUCHED: nav.ts is frozen so
// four people never collide in it.  Grouping is presentation, not routing, so it
// lives here and READS nav.ts rather than rewriting it.  Adding a screen to
// nav.ts still works with no edit here — see the fallback below.
//
// Ten flat links is more than a person scans; the bar had already started
// horizontally scrolling. Four groups plus Dashboard is five targets, which is
// inside what someone can pick out at a glance.
import { NAV, type NavItem } from '@/components/nav'

export type NavGroup = {
  label: string
  /** Present for a direct link (Dashboard); absent for a group with children. */
  href?: string
  items: NavLeaf[]
}

export type NavLeaf = NavItem & { description: string }

/**
 * One line per screen, saying what is ON it rather than restating its name.
 * These are the flyout contents — a menu that just repeats the label teaches
 * nothing, and this is the only place in the app that explains what each screen
 * is for before you open it.
 */
const DESCRIPTIONS: Record<string, string> = {
  '/': 'Pipeline totals and the most recently touched quotations.',
  '/quotations': 'The pipeline board, every quotation by stage.',
  '/approvals': 'Deals waiting on a manager or finance sign-off.',
  '/deal-health': 'Stalled deals, discount anomalies and delivery slippage.',
  '/fulfilment': 'Confirmed orders and how far each is allocated.',
  '/products': 'Catalogue, list prices and stock across warehouses.',
  '/invoices': 'Issued invoices, what is paid and what is overdue.',
  '/subscriptions': 'Recurring plans, their period and next renewal.',
  '/reports': 'Exportable summaries of pipeline, margin and fulfilment.',
  '/settings': 'Discount tiers and approval thresholds — the governance rules.',
  // ⚠ Added by D2, flagged in OWNERSHIP.md.
  '/credit': 'Exposure, ageing and credit limits — what order confirmation enforces.',
}

/** Which hrefs sit under which group, in the order they should be listed. */
const LAYOUT: Array<{ label: string; href?: string; children?: string[] }> = [
  { label: 'Dashboard', href: '/' },
  { label: 'Sell', children: ['/quotations', '/approvals', '/deal-health'] },
  { label: 'Deliver', children: ['/fulfilment', '/products'] },
  { label: 'Billing', children: ['/invoices', '/subscriptions'] },
  { label: 'Admin', children: ['/reports', '/credit', '/settings'] },
]

function leaf(item: NavItem): NavLeaf {
  return { ...item, description: DESCRIPTIONS[item.href] ?? '' }
}

/**
 * Built from NAV, not from a second hardcoded list.  Anything in NAV that no
 * group claims is appended as its own top-level link, so a screen added to
 * nav.ts by another lane appears in the bar immediately instead of becoming
 * unreachable — the exact failure /settings already had once.
 */
export const NAV_GROUPS: NavGroup[] = (() => {
  const byHref = new Map(NAV.map((item) => [item.href, item]))
  const claimed = new Set<string>()

  const groups: NavGroup[] = []

  for (const entry of LAYOUT) {
    if (entry.href) {
      const item = byHref.get(entry.href)
      if (!item) continue
      claimed.add(entry.href)
      groups.push({ label: entry.label, href: entry.href, items: [leaf(item)] })
      continue
    }

    const items = (entry.children ?? [])
      .map((href) => {
        const item = byHref.get(href)
        if (item) claimed.add(href)
        return item
      })
      .filter((item): item is NavItem => Boolean(item))
      .map(leaf)

    if (items.length > 0) groups.push({ label: entry.label, items })
  }

  for (const item of NAV) {
    if (!claimed.has(item.href)) {
      groups.push({ label: item.label, href: item.href, items: [leaf(item)] })
    }
  }

  return groups
})()

/** True when `pathname` is inside this group — drives the bar's active state. */
export function isGroupActive(group: NavGroup, pathname: string) {
  return group.items.some((item) =>
    item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
  )
}
