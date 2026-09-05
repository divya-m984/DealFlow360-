// OWNER: D3.  Screen 3 — Quotations.
//
// PHASE 1: the table view only.  This screen is the template the other seven
// list screens are cloned from, so it is deliberately thin: fetch, columns,
// <DataTable>, row click.  Everything else lives in the shared components.
//
// NOT YET BUILT (Phase 3): the kanban pipeline view (Draft / Pending Approval /
// Approved / Negotiation / Confirmed) and the "Switch to Table View" toggle.
//
// The row shape below is D3's read of the `quotation` table as it is exposed by
// D1's GET /api/quotations.  It is NOT a shared type — lib/types/quotation.ts
// belongs to D1, and a barrel type is a guaranteed cross-lane conflict.  Every
// joined field is optional so that a narrower payload renders "—" rather than
// crashing the list.
'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
} from '@/components/data-table'
import { Money } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { type ApiError } from '@/components/shared/error-state'

type QuotationRow = {
  id: number
  number: string
  state: string
  currency_code?: string
  grand_total?: string | number
  risk_band?: string
  risk_score?: string | number
  version?: number
  customer_name?: string
  owner_name?: string
  last_activity_at?: string
  created_at?: string
}

// pg returns timestamptz as an ISO string.  One date format for the whole
// screen; Phase 2 should lift this into components/shared/ once the other
// seven lists need it too.
const dateFormat = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
})

function formatDate(value: string | undefined) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : dateFormat.format(d)
}

function Muted() {
  return <span className="text-muted-foreground">—</span>
}

// Module scope: v9 re-derives column state whenever this array's identity
// changes, so it must not be rebuilt on every render.
const col = createDataTableColumns<QuotationRow>()

const columns: DataTableColumns<QuotationRow> = col.columns([
  col.accessor('number', {
    header: 'Quotation',
    cell: ({ row }) => (
      <span className="font-medium text-foreground">{row.original.number}</span>
    ),
  }),
  col.accessor('customer_name', {
    header: 'Customer',
    cell: ({ row }) => row.original.customer_name ?? <Muted />,
  }),
  col.accessor('state', {
    header: 'Stage',
    cell: ({ row }) => <StatusBadge status={row.original.state} />,
  }),
  col.accessor('risk_band', {
    header: 'Risk',
    cell: ({ row }) => {
      const { risk_band, risk_score } = row.original
      if (!risk_band) return <Muted />
      return (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status={risk_band} />
          {risk_score !== undefined && risk_score !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {Number(risk_score).toFixed(0)}
            </span>
          )}
        </span>
      )
    },
  }),
  col.accessor('grand_total', {
    header: 'Total',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.grand_total}
        currency={row.original.currency_code ?? 'INR'}
        className="font-medium"
      />
    ),
  }),
  col.accessor('owner_name', {
    header: 'Owner',
    cell: ({ row }) => row.original.owner_name ?? <Muted />,
  }),
  col.accessor('version', {
    header: 'Ver.',
    meta: { align: 'right' },
    cell: ({ row }) =>
      row.original.version ? (
        <span className="text-muted-foreground">v{row.original.version}</span>
      ) : (
        <Muted />
      ),
  }),
  col.accessor('last_activity_at', {
    header: 'Last activity',
    cell: ({ row }) => {
      const text = formatDate(row.original.last_activity_at)
      return text ? (
        <span className="whitespace-nowrap text-muted-foreground">{text}</span>
      ) : (
        <Muted />
      )
    },
  }),
])

export default function QuotationsPage() {
  const router = useRouter()
  const [rows, setRows] = React.useState<QuotationRow[] | undefined>(undefined)
  const [error, setError] = React.useState<ApiError | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  // The "request is starting" state is set by whoever starts the request —
  // initial state below, or the retry handler.  Writing it synchronously in
  // the effect body is what react-hooks/set-state-in-effect forbids.
  React.useEffect(() => {
    let cancelled = false

    fetch('/api/quotations', { headers: { accept: 'application/json' } })
      .then(async (res) => {
        // Every response is { data } or { error: { message } } (lib/api.ts).
        const body = await res.json().catch(() => null)
        if (cancelled) return

        if (!res.ok || body?.error) {
          setError({
            message: body?.error?.message ?? `Request failed (HTTP ${res.status}).`,
          })
          setRows(undefined)
          return
        }
        if (!Array.isArray(body?.data)) {
          setError({
            message:
              'Unexpected response from /api/quotations — expected { data: [ … ] }.',
          })
          setRows(undefined)
          return
        }
        setRows(body.data as QuotationRow[])
      })
      .catch((e) => {
        if (cancelled) return
        setError({ message: e?.message ?? 'Could not reach /api/quotations.' })
        setRows(undefined)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [reloadToken])

  function retry() {
    setLoading(true)
    setError(null)
    setReloadToken((n) => n + 1)
  }

  return (
    <>
      <PageHeader
        title="Quotations"
        description="Every quotation in the pipeline, across all customers and stages."
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={retry}
        onRowClick={(row) => router.push(`/quotations/${row.id}`)}
        getRowId={(row) => String(row.id)}
        filterPlaceholder="Filter quotations…"
        emptyTitle="No quotations yet"
        emptyDescription="Quotations will appear here once a sales rep creates one."
        footnote="Click a row to open the quotation."
      />
    </>
  )
}
