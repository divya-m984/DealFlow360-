// OWNER: D3.  FROZEN after Phase 1 — all nine entries are written now so that
// D1 and D2 never have to add their own link and collide in this one file.
export type NavItem = { href: string; label: string }

export const NAV: NavItem[] = [
  { href: '/',              label: 'Dashboard' },
  { href: '/quotations',    label: 'Quotations' },
  { href: '/approvals',     label: 'Approvals' },
  { href: '/fulfilment',    label: 'Fulfillment' },
  { href: '/subscriptions', label: 'Subscriptions' },
  { href: '/invoices',      label: 'Invoices' },
  { href: '/deal-health',   label: 'Deal Health' },
  { href: '/reports',       label: 'Reports' },
  { href: '/products',      label: 'Products' },
]

// The customer portal is a SEPARATE shell with its own nav (PS §7).
// D1 owns it. Nothing from NAV appears there.
export const PORTAL_NAV: NavItem[] = [
  { href: '/portal',         label: 'My Quotation' },
  { href: '/portal/messages', label: 'Messages' },
  { href: '/portal/profile',  label: 'Profile' },
]
