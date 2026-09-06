// OWNER: D2.  CLAIMED — new path.
//
// FILTERS FOR THE QUOTATION PIPELINE.
//
// ── THE GAP ──────────────────────────────────────────────────────────
// GET /api/quotations has supported seven filter parameters since it was
// written — state, ownerId, teamId, customerId, band, from, to, search — and
// the screen sent none of them. Every load fetched the entire pipeline and
// the user's only tool was their eyes. On a demo database that is invisible;
// on a real one it is the difference between a usable screen and a wall.
//
// ── WHY THE OPTION LISTS ARE CAPTURED ON FIRST LOAD ──────────────────
// Owner and team have no facet endpoint, so their options come from the rows
// themselves. Deriving them from the CURRENT rows would be circular: filter
// to one owner and every other owner vanishes from the dropdown, so you can
// never get back. They are therefore captured once, from the first
// unfiltered response, and kept — which is also what a facet endpoint would
// return, without adding one to another lane's route.
//
// ── SEARCH IS DEBOUNCED ──────────────────────────────────────────────
// It goes into the URL, and the URL is the fetch key. Without a debounce,
// typing "Acme" is four requests and four re-renders, and the last one to
// arrive wins rather than the last one sent.

'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'

export type QuotationFilterValue = {
  state?: string
  band?: string
  ownerId?: string
  teamId?: string
  customerId?: string
  from?: string
  to?: string
  search?: string
}

/** Every state the enum declares. Kept in enum order, not alphabetical —
 *  this is a pipeline and the order is the lifecycle. */
const STATES = [
  'draft', 'pending_approval', 'approved', 'negotiation',
  'confirmed', 'rejected', 'cancelled', 'expired',
] as const

const BANDS = ['LOW', 'MEDIUM', 'HIGH'] as const

/** Builds the querystring the API expects. Empty values are omitted rather
 *  than sent blank, because `?state=` is not the same request as no state. */
export function buildQuotationUrl(f: QuotationFilterValue): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(f)) {
    if (v !== undefined && v !== null && String(v).trim() !== '') p.set(k, String(v))
  }
  const qs = p.toString()
  return qs ? `/api/quotations?${qs}` : '/api/quotations'
}

type Row = {
  owner_user_id?: number | null
  owner_name?: string | null
  team_id?: number | null
  team_name?: string | null
  customer_name?: string | null
  [k: string]: unknown
}

type Facet = { id: string; name: string }

export function QuotationFilters({
  value, onChange, rows, total,
}: {
  value: QuotationFilterValue
  onChange: (v: QuotationFilterValue) => void
  rows: Row[] | undefined
  total?: number
}) {
  // Local text state so typing stays responsive; the committed value is
  // pushed up on a debounce.
  const [search, setSearch] = React.useState(value.search ?? '')
  const [open, setOpen] = React.useState(false)

  // Captured once, from the first response that arrives. See the header.
  const facets = React.useRef<{ owners: Facet[]; teams: Facet[] } | null>(null)
  if (rows && rows.length > 0 && facets.current === null) {
    // Keyed by ID, labelled by name: the API filters on the id, so sending a
    // name would post text into Number() and match nothing without erroring.
    const uniq = (pairs: (Facet | null)[]) => {
      const m = new Map<string, string>()
      for (const p of pairs) if (p && p.id && p.name) m.set(p.id, p.name)
      return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
    }
    facets.current = {
      owners: uniq(rows.map((r) =>
        r.owner_user_id != null ? { id: String(r.owner_user_id), name: String(r.owner_name ?? '') } : null)),
      teams: uniq(rows.map((r) =>
        r.team_id != null ? { id: String(r.team_id), name: String(r.team_name ?? '') } : null)),
    }
  }

  React.useEffect(() => {
    const t = setTimeout(() => {
      if ((value.search ?? '') !== search) onChange({ ...value, search: search || undefined })
    }, 300)
    return () => clearTimeout(t)
    // `value` is deliberately absent: including it re-arms the timer on every
    // parent render and the debounce never fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const set = (k: keyof QuotationFilterValue) => (v: string) =>
    onChange({ ...value, [k]: v || undefined })

  const active = Object.entries(value).filter(([, v]) => v !== undefined && v !== '')
  const activeCount = active.length

  return (
    <div className="mb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="h-9 w-full max-w-xs"
          placeholder="Search quotation number or customer…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <Select value={value.state ?? ''} onChange={set('state')} label="Any stage">
          {STATES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </Select>

        <Select value={value.band ?? ''} onChange={set('band')} label="Any risk">
          {BANDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </Select>

        <Button size="sm" variant="ghost" className="h-9" onClick={() => setOpen((v) => !v)}>
          {open ? 'Fewer filters' : 'More filters'}
        </Button>

        {activeCount > 0 && (
          <>
            <Badge variant="outline" className="text-[10px]">
              {activeCount} filter{activeCount === 1 ? '' : 's'}
              {typeof total === 'number' ? ` · ${total} match${total === 1 ? '' : 'es'}` : ''}
            </Badge>
            <Button
              size="sm" variant="ghost" className="h-9"
              onClick={() => { setSearch(''); onChange({}) }}
            >
              Clear
            </Button>
          </>
        )}
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2.5">
          <FacetSelect
            value={value.ownerId ?? ''} onChange={set('ownerId')}
            label="Any owner" options={facets.current?.owners ?? []}
            hint="Matched by id, labelled by name. Captured from the first unfiltered load so filtering cannot shrink the list you need to get back."
          />
          <FacetSelect
            value={value.teamId ?? ''} onChange={set('teamId')}
            label="Any team" options={facets.current?.teams ?? []}
          />
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Created from
            <Input
              type="date" className="h-9 w-40"
              value={value.from ?? ''} onChange={(e) => set('from')(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            to
            <Input
              type="date" className="h-9 w-40"
              value={value.to ?? ''} onChange={(e) => set('to')(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  )
}

function Select({
  value, onChange, label, children,
}: { value: string; onChange: (v: string) => void; label: string; children: React.ReactNode }) {
  return (
    <select
      className="h-9 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">{label}</option>
      {children}
    </select>
  )
}

/**
 * Labels by name, submits the id — because the API filters on the id and a
 * name would become NaN and match nothing without raising anything. Renders
 * a plain note rather than an empty select when there is nothing to offer:
 * a control with no options invites clicking and explains nothing.
 */
function FacetSelect({
  value, onChange, label, options, hint,
}: { value: string; onChange: (v: string) => void; label: string; options: Facet[]; hint?: string }) {
  if (options.length === 0) {
    return (
      <span className="text-xs text-muted-foreground" title={hint}>
        {label.replace('Any ', 'No ')} data yet
      </span>
    )
  }
  return (
    <select
      className="h-9 rounded-md border bg-background px-2 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={hint}
    >
      <option value="">{label}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  )
}
