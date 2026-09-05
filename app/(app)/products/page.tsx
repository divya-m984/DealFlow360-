// OWNER: D3.  Screen 16 — Product Catalog.
//
// Products, their variants and their list price.  Pricelist rules, upsell
// rules and stock movement are D2's; this screen renders catalogue rows.
//
// PROVISIONAL CONTRACT.  GET /api/products is still a 501 stub owned by D2
// with no declared response type, and it is read by D1's quotation builder as
// well as this screen — so the payload is D2's to define, not D3's.  The row
// shape is derived from `product` in db/schema.sql joined to
// `product_category`, plus two rollups: `variant_count` over `product_variant`
// and `qty_available` from the `product_stock` view that already exists in the
// schema.  Only `id`, `sku` and `name` are treated as required.
'use client'

import { useRouter } from 'next/navigation'
import {
  createDataTableColumns,
  DataTable,
  type DataTableColumns,
} from '@/components/data-table'
import { Money, Num } from '@/components/shared/money'
import { PageHeader } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { useListData } from '@/components/shared/use-list-data'

type ProductRow = {
  id: number
  sku: string
  name: string
  category_name?: string
  currency_code?: string
  base_price?: string | number
  unit?: string
  tax_pct?: string | number
  is_subscription?: boolean
  /** billing_cycle, present only when is_subscription is true. */
  recurring_cycle?: string
  is_active?: boolean
  variant_count?: number
  /** Summed across warehouses — the `product_stock` view in db/schema.sql. */
  qty_available?: string | number
}

function Muted() {
  return <span className="text-muted-foreground">—</span>
}

const col = createDataTableColumns<ProductRow>()

const columns: DataTableColumns<ProductRow> = col.columns([
  col.accessor('name', {
    header: 'Product',
    cell: ({ row }) => (
      <span className="flex flex-col leading-tight">
        <span className="font-medium text-foreground">{row.original.name}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.sku}
        </span>
      </span>
    ),
  }),
  col.accessor('category_name', {
    header: 'Category',
    cell: ({ row }) => row.original.category_name ?? <Muted />,
  }),
  col.display({
    id: 'billing',
    header: 'Billing',
    cell: ({ row }) => {
      const { is_subscription, recurring_cycle } = row.original
      if (is_subscription === undefined) return <Muted />
      if (!is_subscription) return <StatusBadge status="one_time" />
      return (
        <span className="inline-flex items-center gap-1.5">
          <StatusBadge status="recurring" />
          {recurring_cycle && (
            <span className="text-xs text-muted-foreground capitalize">
              {recurring_cycle}
            </span>
          )}
        </span>
      )
    },
  }),
  col.accessor('base_price', {
    header: 'List price',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Money
        value={row.original.base_price}
        currency={row.original.currency_code ?? 'INR'}
        className="font-medium"
      />
    ),
  }),
  col.accessor('unit', {
    header: 'Unit',
    cell: ({ row }) =>
      row.original.unit ? (
        <span className="text-muted-foreground">{row.original.unit}</span>
      ) : (
        <Muted />
      ),
  }),
  col.accessor('tax_pct', {
    header: 'Tax',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Num value={row.original.tax_pct} suffix="%" className="text-muted-foreground" />
    ),
  }),
  col.accessor('variant_count', {
    header: 'Variants',
    meta: { align: 'right' },
    cell: ({ row }) => (
      <Num value={row.original.variant_count} className="text-muted-foreground" />
    ),
  }),
  col.accessor('qty_available', {
    header: 'Available',
    meta: { align: 'right' },
    cell: ({ row }) => {
      const qty = row.original.qty_available
      if (qty === undefined || qty === null) return <Muted />
      // Nothing sellable is an operational fact, not a styling flourish.
      const out = Number(qty) <= 0
      return <Num value={qty} className={out ? 'font-medium text-red-300' : undefined} />
    },
  }),
  col.accessor('is_active', {
    header: 'Status',
    cell: ({ row }) => {
      if (row.original.is_active === undefined) return <Muted />
      return <StatusBadge status={row.original.is_active ? 'active' : 'inactive'} />
    },
  }),
])

export default function ProductsPage() {
  const router = useRouter()
  const { rows, loading, error, retry } = useListData<ProductRow>('/api/products')

  return (
    <>
      <PageHeader
        title="Product Catalog"
        description="Products, variants and list prices, with stock available across all warehouses."
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRetry={retry}
        onRowClick={(row) => router.push(`/products/${row.id}`)}
        getRowId={(row) => String(row.id)}
        filterPlaceholder="Filter by name, SKU or category…"
        emptyTitle="No products in the catalogue"
        emptyDescription="Seed the catalogue with db/reset.sh, or add a product from the admin screens."
        footnote="Click a row to open the product."
      />
    </>
  )
}
