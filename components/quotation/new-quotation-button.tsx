// OWNER: D1.  "+ New Quotation" — the app's entry point into its own core flow.
//
// PS §5's end-to-end flow begins "Rep opens the workspace and creates a new
// quotation for a customer", and §9 step 2 is the same thing. Until this
// existed, POST /api/quotations was reachable only by curl.
//
// The customer is chosen here rather than inside the builder because it decides
// the tier, and the tier is half of every discount ceiling on the next screen
// (the other half being the product category). Picking it first means the
// builder opens already knowing what the rep is allowed to give away — and the
// ceiling is shown in the picker so the constraint arrives before the discount,
// not after it is rejected.
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { StatusBadge } from '@/components/shared/status-badge'

type Customer = {
  id: number
  name: string
  currency_code: string
  tier_name: string
  tier_ceiling_pct: string
  quotation_count: number
}

export function NewQuotationButton({ onCreated }: { onCreated?: () => void }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [customers, setCustomers] = React.useState<Customer[] | null>(null)
  const [filter, setFilter] = React.useState('')
  const [busy, setBusy] = React.useState<number | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  // Loaded when the dialog opens, not on page load — the list screen should not
  // pay for a request most visits never use.
  React.useEffect(() => {
    if (!open || customers) return
    fetch('/api/customers').then(async (r) => {
      const b = await r.json()
      if (!r.ok) return setError(b?.error?.message ?? 'Could not load customers')
      setCustomers(b.data)
    })
  }, [open, customers])

  async function create(c: Customer) {
    setBusy(c.id)
    setError(null)
    const res = await fetch('/api/quotations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ customerId: c.id }),
    })
    const b = await res.json()
    setBusy(null)
    if (!res.ok) return setError(b?.error?.message ?? 'Could not create the quotation')
    onCreated?.()
    setOpen(false)
    // Straight into the builder — a new empty quotation on a list screen is a
    // dead end.
    router.push(`/quotations/${b.data.id}`)
  }

  const shown = (customers ?? []).filter((c) =>
    c.name.toLowerCase().includes(filter.trim().toLowerCase()),
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>+ New Quotation</Button>} />
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New quotation</DialogTitle>
          <DialogDescription>
            Pick the customer. Their tier sets the discount ceiling on every line —
            the effective limit is the lower of the tier and the product category.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
        )}

        <Input
          placeholder="Search customers…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <div className="max-h-80 space-y-1 overflow-y-auto">
          {customers === null && !error && (
            <p className="px-1 py-2 text-sm text-muted-foreground">Loading customers…</p>
          )}
          {customers !== null && shown.length === 0 && (
            <p className="px-1 py-2 text-sm text-muted-foreground">No customer matches that.</p>
          )}
          {shown.map((c) => (
            <button
              key={c.id}
              type="button"
              disabled={busy !== null}
              onClick={() => create(c)}
              className="flex w-full items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{c.name}</span>
                <span className="text-xs text-muted-foreground">
                  {c.quotation_count === 1 ? '1 quotation' : `${c.quotation_count} quotations`}
                  {' · '}{c.currency_code}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <StatusBadge status={c.tier_name?.toLowerCase()} label={c.tier_name} />
                <span className="text-xs text-muted-foreground tabular-nums">
                  ≤ {Number(c.tier_ceiling_pct).toFixed(0)}%
                </span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
