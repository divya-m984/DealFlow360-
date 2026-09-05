// OWNER: D3.  Screen 16 — Product Catalog.
//
// Products, their variants and their list price.  Pricelist rules, upsell
// rules and stock movement are D2's; this screen renders catalogue rows.
//
// CONTRACT: matched against the landed GET /api/products (D2).  The Phase 2
// field guesses were all correct, but the payload carries one field the screen
// was missing and genuinely needs: `is_stock_managed`.
//
// `qty_available` is COALESCEd to 0 for any product with no `stock_level` rows,
// so a service or subscription product that is not stocked at all comes back as
// 0 — indistinguishable from a stocked product that has sold out.  Painting
// that red would report a shortage that does not exist, so the Available column
// checks `is_stock_managed` first and shows "—" for unstocked products.
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
  category_id: number
  category_name: string
  category_max_discount_pct: string | number
  currency_code: string
  base_price: string | number
  cost: string | number
  margin_pct: string | number | null
  unit: string
  tax_pct: string | number
  is_subscription: boolean
  /** billing_cycle, present only when is_subscription is true. */
  recurring_cycle: string | null
  is_active: boolean
  variant_count: number
  /** Summed across warehouses; 0 for anything with no stock_level rows. */
  qty_on_hand: string | number
  qty_available: string | number
  /** False when the product has no stock_level rows at all — see header. */
  is_stock_managed: boolean
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
    cell: ({ row }) => row.original.category_name,
  }),
  col.display({
    id: 'billing',
    header: 'Billing',
    cell: ({ row }) => {
      const { is_subscription, recurring_cycle } = row.original
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
        currency={row.original.currency_code}
        className="font-medium"
      />
    ),
  }),
  col.accessor('unit', {
    header: 'Unit',
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.unit}</span>
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
      // Not stocked at all is not the same as sold out — see the file header.
      if (!row.original.is_stock_managed) {
        return <Muted />
      }
      const out = Number(row.original.qty_available) <= 0
      return (
        <Num
          value={row.original.qty_available}
          className={out ? 'font-medium text-destructive' : undefined}
        />
      )
    },
  }),
  col.accessor('is_active', {
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge status={row.original.is_active ? 'active' : 'inactive'} />
    ),
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
