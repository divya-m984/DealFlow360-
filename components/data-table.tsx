// OWNER: D3.  The single highest-leverage component in the project — seven list
// screens are built on it.  Get it right once and seven screens become
// configuration.
//
// TANSTACK TABLE v9, NOT v8.  The shadcn data-table recipe referenced in the
// brief predates v9 and will not compile: `useReactTable` is now `useTable`,
// and row models are no longer table options — they are registered as feature
// slots on `tableFeatures()`.  Verified against the installed 9.2.4 and its
// bundled skills in node_modules/@tanstack/react-table/skills/.
//
// This component owns loading / empty / error rendering as well as the table
// itself, so a list screen is only ever: fetch, define columns, render.
'use client'

import * as React from 'react'
import {
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  tableFeatures,
  useTable,
  type CellData,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type SortingState,
} from '@tanstack/react-table'
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Search,
} from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { EmptyState } from '@/components/shared/empty-state'
import { ErrorState, type ApiError } from '@/components/shared/error-state'

/**
 * Per-column presentation, declared on the column def as `meta`.
 * Numbers right, text left (see `alignClass`) is enforced here rather than
 * being re-decided on every screen.
 */
export type DataTableColumnMeta = {
  align?: 'left' | 'right' | 'center'
  /** Extra classes for body cells in this column. */
  className?: string
  /** Extra classes for the header cell. */
  headerClassName?: string
}

/**
 * Registered once for every table in the app.  In v9 an API does not exist
 * until its feature is registered — omitting `rowSortingFeature` does not make
 * sorting inert, it makes `column.getCanSort()` undefined at runtime.
 * Each row-model slot must follow its prerequisite feature.
 */
export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric },
  rowPaginationFeature,
  paginatedRowModel: createPaginatedRowModel(),
  // Type-only slot: gives `meta` on every column def the shape above.
  columnMeta: {} as DataTableColumnMeta,
})

export type DataTableFeatures = typeof dataTableFeatures

/** Column definitions for a list screen. */
export type DataTableColumns<T extends RowData> = Array<
  ColumnDef<DataTableFeatures, T, CellData>
>

/**
 * Column helper bound to the app's feature set.  Call this at MODULE scope in a
 * screen — v9 re-derives column state whenever the array identity changes.
 *
 *   const col = createDataTableColumns<QuotationRow>()
 *   const columns = col.columns([col.accessor('number', { header: 'Quotation' })])
 */
export function createDataTableColumns<T extends RowData>() {
  return createColumnHelper<DataTableFeatures, T>()
}

/**
 * A fresh `[]` on every render invalidates every data-dependent row model, so
 * the "no data yet" fallback must be one stable reference.  `never[]` is
 * assignable to every `T[]`, which keeps the fallback untyped-cast-free.
 */
const NO_ROWS: never[] = []

function alignClass(meta: DataTableColumnMeta | undefined) {
  if (meta?.align === 'right') return 'text-right tabular-nums'
  if (meta?.align === 'center') return 'text-center'
  return 'text-left'
}

export type DataTableProps<T extends RowData> = {
  columns: DataTableColumns<T>
  /** `undefined` while the first request is in flight. */
  data: T[] | undefined
  loading?: boolean
  /** The `error` payload from a failed API response, verbatim. */
  error?: ApiError | null
  onRetry?: () => void
  /** Row click is the primary navigation mechanism of the whole app. */
  onRowClick?: (row: T) => void
  /** Stable row identity — usually `(row) => String(row.id)`. */
  getRowId?: (row: T, index: number) => string
  filterPlaceholder?: string
  /** Extra controls rendered next to the filter input. */
  toolbar?: React.ReactNode
  emptyTitle?: string
  emptyDescription?: string
  /** The mockup's "Click a row to open…" line under every list. */
  footnote?: React.ReactNode
  pageSize?: number
  className?: string
}

export function DataTable<T extends RowData>({
  columns,
  data,
  loading = false,
  error = null,
  onRetry,
  onRowClick,
  getRowId,
  filterPlaceholder = 'Filter…',
  toolbar,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  footnote,
  pageSize = 25,
  className,
}: DataTableProps<T>) {
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState<PaginationState>({
    pageIndex: 0,
    pageSize,
  })

  const table = useTable<DataTableFeatures, T>({
    features: dataTableFeatures,
    columns,
    data: data ?? NO_ROWS,
    getRowId,
    state: { globalFilter, sorting, pagination },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    globalFilterFn: 'includesString',
    // Filtering already resets to page 1 below; keep the page while a poll or
    // refetch replaces the same rows.
    autoResetPageIndex: false,
  })

  const headerGroups = table.getHeaderGroups()
  const rows = table.getRowModel().rows
  const columnCount = table.getAllLeafColumns().length

  const filtering = globalFilter.trim().length > 0
  const totalRows = table.getRowCount()
  const firstRow = pagination.pageIndex * pagination.pageSize + 1
  const lastRow = Math.min(totalRows, firstRow + pagination.pageSize - 1)
  const pageCount = table.getPageCount()

  function onFilterChange(value: string) {
    setGlobalFilter(value)
    // A filtered view that opens on page 4 looks broken.
    setPagination((p) => ({ ...p, pageIndex: 0 }))
  }

  // Error wins over everything: there is no table to show.
  if (error) {
    return (
      <div
        className={cn(
          'rounded-lg border border-border bg-card',
          className,
        )}
      >
        <ErrorState error={error} onRetry={onRetry} />
      </div>
    )
  }

  return (
    // ONE ENCLOSED PANEL, three bands.  The toolbar and the pager used to float
    // outside the card, so a list read as three loose objects; enclosing them
    // and dividing with rules makes the screen one component with a control
    // strip, a body and a status bar — the shape every mature CRM list uses.
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border bg-card',
        className,
      )}
    >
      {/* Control band */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalFilter}
            onChange={(e) => onFilterChange(e.currentTarget.value)}
            placeholder={filterPlaceholder}
            aria-label={filterPlaceholder}
            className="pl-8"
            disabled={loading}
          />
        </div>
        {toolbar && <div className="ml-auto flex items-center gap-2">{toolbar}</div>}
      </div>

      {/* Body band.  Scrolls horizontally on its own rather than being clipped
          by the panel, so a wide table stays reachable. */}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {headerGroups.map((group) => (
              <TableRow
                key={group.id}
                className="border-border bg-muted/40 hover:bg-muted/40"
              >
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta as
                    | DataTableColumnMeta
                    | undefined
                  const sortable = header.column.getCanSort()
                  const sorted = header.column.getIsSorted()

                  return (
                    <TableHead
                      key={header.id}
                      colSpan={header.colSpan}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      // CONSISTENCY: same header treatment as the dashboard
                      // table and the pipeline lane headers — uppercase, bold,
                      // tracked.  Three different header styles for the same
                      // job is the thing that makes an app look assembled by
                      // four people.
                      className={cn(
                        'h-9 px-3 text-xs font-bold tracking-wide text-muted-foreground uppercase',
                        alignClass(meta),
                        meta?.headerClassName,
                      )}
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            'inline-flex items-center gap-1 rounded-sm outline-none transition-colors hover:text-foreground focus-visible:text-foreground',
                            meta?.align === 'right' && 'flex-row-reverse',
                          )}
                        >
                          <table.FlexRender header={header} />
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-40" />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>

          <TableBody>
            {loading ? (
              // Skeleton rows match the real column count so the layout does
              // not jump when the data lands.
              Array.from({ length: 8 }).map((_, r) => (
                <TableRow key={`skeleton-${r}`} className="border-border">
                  {Array.from({ length: Math.max(columnCount, 1) }).map((__, c) => (
                    <TableCell key={c} className="px-3 py-2.5">
                      <Skeleton className="h-4 w-full max-w-[8rem]" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={Math.max(columnCount, 1)}
                  className="p-0 whitespace-normal"
                >
                  {filtering ? (
                    <EmptyState
                      icon={<Search className="size-4" />}
                      title="No matching rows"
                      description={`Nothing matches “${globalFilter.trim()}”.`}
                      action={
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => onFilterChange('')}
                        >
                          Clear filter
                        </Button>
                      }
                    />
                  ) : (
                    <EmptyState title={emptyTitle} description={emptyDescription} />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  tabIndex={onRowClick ? 0 : undefined}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onRowClick(row.original)
                          }
                        }
                      : undefined
                  }
                  // CONSISTENCY: the same --row-hover the dashboard table and
                  // the pipeline cards use, so "the thing under my pointer" is
                  // one colour across the whole application.
                  // ACCESSIBILITY: no `role="button"` — that would replace the
                  // row semantics a screen reader needs to announce cells
                  // against their headers.  The row stays a row; it is reachable
                  // by Tab and activated by Enter/Space, and focus-visible gets
                  // the same treatment as hover so keyboard users see position.
                  className={cn(
                    'border-border outline-none',
                    onRowClick &&
                      'cursor-pointer hover:bg-[var(--row-hover)] focus-visible:bg-[var(--row-hover)]',
                  )}
                >
                  {row.getAllCells().map((cell) => {
                    const meta = cell.column.columnDef.meta as
                      | DataTableColumnMeta
                      | undefined
                    return (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          'px-3 py-2 text-sm',
                          alignClass(meta),
                          meta?.className,
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Status band.  The record count lives here and ONLY here — it used to
          appear twice, as "8 rows" above the table and "1–8 of 8" below it. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border px-3 py-2">
        <p className="text-xs text-muted-foreground">
          {!loading && (
            <span className="font-medium text-foreground tabular-nums">
              {totalRows} {totalRows === 1 ? 'record' : 'records'}
            </span>
          )}
          {!loading && footnote ? ' · ' : null}
          {footnote}
        </p>

        {!loading && totalRows > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground tabular-nums">
              {firstRow}–{lastRow} of {totalRows}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <ChevronLeft className="size-3.5" />
              <span className="sr-only">Previous page</span>
            </Button>
            <span className="text-xs text-muted-foreground tabular-nums">
              {pagination.pageIndex + 1} / {Math.max(pageCount, 1)}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <ChevronRight className="size-3.5" />
              <span className="sr-only">Next page</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
