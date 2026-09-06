// OWNER: D4.  Reports
// Screen 15: Filters, KPI tiles, charts, table, and PDF/CSV export.
'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Money, formatMoney } from '@/components/shared/money'
import { ErrorState } from '@/components/shared/error-state'
import { EmptyState } from '@/components/shared/empty-state'
import {
  Download,
  FileSpreadsheet,
  TrendingUp,
  Percent,
  Layers,
  ShieldAlert,
  Filter,
  RefreshCcw,
} from 'lucide-react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts'

interface ReportData {
  kpis: {
    total_quotes: number
    pipeline_value: string
    won_revenue: string
    avg_discount_pct: number
    avg_margin_pct: number
    won_count: number
    win_rate: number
  }
  stages: { state: string; count: number; total_amount: string }[]
  categoryBreakdown: { category_name: string; revenue: string; margin: string; quote_count: number }[]
  teamPerformance: { team_name: string; quote_count: number; total_amount: string; won_amount: string }[]
  quotations: {
    id: number
    public_id: string
    number: string
    customer_name: string
    rep_name: string
    team_name: string | null
    state: string
    currency_code: string
    grand_total: string
    discount_total: string
    margin_total: string
    risk_score: string
    risk_band: 'LOW' | 'MEDIUM' | 'HIGH'
    created_at: string
  }[]
  lookups: {
    teams: { id: number; code: string; name: string }[]
    reps: { id: number; full_name: string; team_id: number }[]
    categories: { id: number; code: string; name: string }[]
  }
}

const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899']

export default function ReportsPage() {
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  const [isExporting, startExport] = useTransition()

  // Filter state
  const [period, setPeriod] = useState('all')
  const [teamId, setTeamId] = useState('')
  const [repId, setRepId] = useState('')
  const [status, setStatus] = useState('all')
  const [categoryId, setCategoryId] = useState('')

  const fetchReports = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (period !== 'all') params.set('period', period)
      if (teamId) params.set('teamId', teamId)
      if (repId) params.set('repId', repId)
      if (status !== 'all') params.set('status', status)
      if (categoryId) params.set('categoryId', categoryId)

      const res = await fetch(`/api/reports?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json?.error?.message || 'Failed to load report data')
      }
      setData(json.data)
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setMounted(true)
    fetchReports()
  }, [period, teamId, repId, status, categoryId])

  // PDF Export via dynamic import to guarantee zero SSR crash
  const handleExportPDF = () => {
    startExport(async () => {
      if (!data) return
      try {
        const { jsPDF } = await import('jspdf')
        const autoTableMod = await import('jspdf-autotable')
        const autoTable = (autoTableMod as any).default || autoTableMod

        const doc = new jsPDF()
        const renderTable = (opts: any) => {
          if (typeof autoTable === 'function') {
            autoTable(doc, opts)
          } else if (typeof (doc as any).autoTable === 'function') {
            (doc as any).autoTable(opts)
          }
        }

        doc.setFontSize(16)
        doc.text('DealFlow360 — Sales Operations & Performance Report', 14, 18)
        doc.setFontSize(9)
        doc.setTextColor(100)
        doc.text(
          `Generated: ${new Date().toLocaleString()} | Period: ${period.toUpperCase()} | Currency: INR`,
          14,
          24
        )

        // KPI Summary Table
        doc.setFontSize(11)
        doc.setTextColor(30)
        doc.text('Key Performance Indicators', 14, 32)

        renderTable({
          startY: 36,
          head: [['Total Pipeline', 'Won Revenue', 'Avg Discount', 'Avg Margin', 'Win Rate', 'Total Quotes']],
          body: [
            [
              `Rs. ${Number(data.kpis.pipeline_value).toLocaleString('en-IN')}`,
              `Rs. ${Number(data.kpis.won_revenue).toLocaleString('en-IN')}`,
              `${data.kpis.avg_discount_pct}%`,
              `${data.kpis.avg_margin_pct}%`,
              `${data.kpis.win_rate}%`,
              `${data.kpis.total_quotes}`,
            ],
          ],
          theme: 'grid',
          headStyles: { fillColor: [30, 41, 59] },
        })

        // Quotations Listing
        const lastY = (doc as any).lastAutoTable?.finalY || 65
        doc.setFontSize(11)
        doc.setTextColor(30)
        doc.text('Quotation Summary (Filtered)', 14, lastY + 10)

        renderTable({
          startY: lastY + 14,
          head: [['Quote #', 'Customer', 'Rep', 'Team', 'Status', 'Total (INR)', 'Risk Band']],
          body: data.quotations.map((q) => [
            q.number,
            q.customer_name,
            q.rep_name,
            q.team_name || 'Unassigned',
            q.state.replace('_', ' ').toUpperCase(),
            `Rs. ${Number(q.grand_total).toLocaleString('en-IN')}`,
            q.risk_band,
          ]),
          theme: 'striped',
          headStyles: { fillColor: [79, 70, 229] },
        })

        const p = (n: number) => String(n).padStart(2, '0')
        const d = new Date()
        const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`

        doc.save(`dealflow-report-${stamp}.pdf`)
      } catch (e) {
        console.error('PDF export failed', e)
      }
    })
  }

  // Native CSV / Excel Export with UTF-8 BOM
  const handleExportCSV = () => {
    if (!data?.quotations?.length) return
    const headers = [
      'Quotation Number',
      'Customer',
      'Sales Rep',
      'Team',
      'Status',
      'Grand Total (INR)',
      'Discount (INR)',
      'Margin (INR)',
      'Risk Band',
      'Risk Score',
      'Created At',
    ]

    const rows = data.quotations.map((q) => [
      `"${q.number}"`,
      `"${q.customer_name.replace(/"/g, '""')}"`,
      `"${q.rep_name.replace(/"/g, '""')}"`,
      `"${(q.team_name || 'Unassigned').replace(/"/g, '""')}"`,
      `"${q.state}"`,
      q.grand_total,
      q.discount_total,
      q.margin_total,
      `"${q.risk_band}"`,
      q.risk_score,
      `"${q.created_at}"`,
    ])

    const csvContent = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const p = (n: number) => String(n).padStart(2, '0')
    const d = new Date()
    const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    link.download = `dealflow-report-${stamp}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Top Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sales & Governance Reports</h1>
          <p className="text-sm text-muted-foreground">
            Screen 15: Pipeline performance, discount governance analytics, and audit exports.
          </p>
        </div>

        {/* ⚠ CHANGED BY D1 AFTER THE FREEZE — D4, this is your file.
            HYDRATION MISMATCH, third of the same family (see the long note in
            components/data-table.tsx for the first).

            All three of these buttons had `disabled` bound to state that is
            still settling when React hydrates. `loading` starts TRUE and
            `data` starts null, so the server rendered all three as
            `disabled=""` — verified by dumping the SSR HTML of /reports, which
            was the only screen in the app emitting a disabled button. By the
            time React hydrated, the fetch had resolved, so the client's first
            render disagreed on exactly that attribute and React reported the
            tree as unpatchable.

            `mounted` is the fix and it was already here — you use it at the
            two chart blocks below for the same reason. It is false on the
            server AND on the client's first render (an effect sets it), so
            both agree; the real value takes over on the next render. Guarding
            the attribute rather than removing it keeps the disabled-while-
            loading behaviour you wanted. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => fetchReports()} disabled={mounted && loading}>
            <RefreshCcw className="mr-2 size-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} disabled={mounted && !data?.quotations?.length}>
            <FileSpreadsheet className="mr-2 size-4 text-emerald-600 dark:text-emerald-400" />
            Export CSV / XLS
          </Button>
          <Button
            size="sm"
            onClick={handleExportPDF}
            disabled={mounted && (!data?.quotations?.length || isExporting)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            <Download className="mr-2 size-4" />
            {isExporting ? 'Generating PDF...' : 'Export PDF'}
          </Button>
        </div>
      </div>

      {/* Filter Toolbar (PS §A7) */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            <Filter className="size-3.5" />
            <span>Filter Criteria (PS §A7)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {/* Period */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Period</label>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">All Time</option>
                <option value="today">Today</option>
                <option value="7d">Last 7 Days</option>
                <option value="30d">Last 30 Days</option>
                <option value="90d">Last 90 Days</option>
              </select>
            </div>

            {/* Sales Team */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Sales Team</label>
              <select
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">All Teams</option>
                {data?.lookups?.teams?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Sales Rep */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Sales Rep</label>
              <select
                value={repId}
                onChange={(e) => setRepId(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">All Reps</option>
                {data?.lookups?.reps?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}
                  </option>
                ))}
              </select>
            </div>

            {/* Approval / State */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="all">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="pending_approval">Pending Approval</option>
                <option value="approved">Approved</option>
                <option value="negotiation">In Negotiation</option>
                <option value="confirmed">Confirmed (Won)</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>

            {/* Product Category */}
            <div>
              <label className="text-xs font-medium text-muted-foreground">Product Category</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="">All Categories</option>
                {data?.lookups?.categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error state with retry */}
      {error && (
        <Card>
          <ErrorState error={error} title="Could not load reports" onRetry={fetchReports} />
        </Card>
      )}

      {/* KPI Tiles */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Pipeline</CardTitle>
            <TrendingUp className="size-4 text-indigo-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-2xl font-bold">
                <Money value={data?.kpis?.pipeline_value} currency="INR" />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Across {data?.kpis?.total_quotes || 0} active & historical deals
            </p>
          </CardContent>
        </Card>

        {/* KPI 2 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Won Revenue</CardTitle>
            <Layers className="size-4 text-emerald-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                <Money value={data?.kpis?.won_revenue} currency="INR" />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              Win Rate: {data?.kpis?.win_rate || 0}% ({data?.kpis?.won_count || 0} confirmed)
            </p>
          </CardContent>
        </Card>

        {/* KPI 3 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Avg Discount %</CardTitle>
            <Percent className="size-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{data?.kpis?.avg_discount_pct || 0}%</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Relative to customer tier ceilings</p>
          </CardContent>
        </Card>

        {/* KPI 4 */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Gross Margin %</CardTitle>
            <ShieldAlert className="size-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <div className="text-2xl font-bold">{data?.kpis?.avg_margin_pct || 0}%</div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Protected by blended risk score</p>
          </CardContent>
        </Card>
      </div>

      {/* Visual Analytics (Recharts with SSR Mount Guard) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stage Distribution Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Pipeline Volume by Stage</CardTitle>
            <CardDescription>Deal volume across the discount governance lifecycle</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            {!mounted || loading ? (
              <div className="h-full flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            ) : data?.stages?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.stages}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis
                    dataKey="state"
                    tickFormatter={(v) => v.replace('_', ' ')}
                    fontSize={11}
                    tickLine={false}
                  />
                  <YAxis fontSize={11} tickLine={false} />
                  <RechartsTooltip
                    formatter={(val: any) => [formatMoney(val, 'INR') ?? '₹0.00', 'Volume']}
                    labelFormatter={(lbl: any) => `Stage: ${lbl ? String(lbl).replace('_', ' ') : ''}`}
                  />
                  <Bar dataKey="total_amount" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No deal stages match current filters
              </div>
            )}
          </CardContent>
        </Card>

        {/* Category Contribution Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Revenue by Product Category</CardTitle>
            <CardDescription>Contribution per catalog classification</CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            {!mounted || loading ? (
              <div className="h-full flex items-center justify-center">
                <Skeleton className="h-full w-full" />
              </div>
            ) : data?.categoryBreakdown?.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.categoryBreakdown}
                    dataKey="revenue"
                    nameKey="category_name"
                    cx="50%"
                    cy="50%"
                    outerRadius={85}
                    label={({ name, percent }: any) => `${name} ${(percent * 100).toFixed(0)}%`}
                    fontSize={11}
                  >
                    {data.categoryBreakdown.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <RechartsTooltip formatter={(val: any) => [formatMoney(val, 'INR') ?? '₹0.00', 'Revenue']} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                No category breakdown available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filtered Quotations Data Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base font-semibold">Detailed Quotation Records</CardTitle>
          <CardDescription>
            Audit list matching current period, team, status, and category criteria
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex flex-col gap-2 py-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !data?.quotations?.length ? (
            <EmptyState
              title="No quotations found"
              description="No quotations match the selected filter criteria."
            />
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Quote #</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Sales Rep</TableHead>
                    <TableHead>Team</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead className="text-right">Margin</TableHead>
                    <TableHead className="text-center">Risk</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.quotations.map((q) => (
                    <TableRow key={q.id}>
                      <TableCell className="font-mono text-xs font-semibold">{q.number}</TableCell>
                      <TableCell className="font-medium">{q.customer_name}</TableCell>
                      <TableCell>{q.rep_name}</TableCell>
                      <TableCell className="text-muted-foreground">{q.team_name || 'Unassigned'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            q.state === 'confirmed'
                              ? 'default'
                              : q.state === 'approved'
                              ? 'secondary'
                              : q.state === 'rejected'
                              ? 'destructive'
                              : 'outline'
                          }
                        >
                          {q.state.replace('_', ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={q.grand_total} currency={q.currency_code || 'INR'} className="font-medium" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Money value={q.margin_total} currency={q.currency_code || 'INR'} className="text-muted-foreground" />
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                            q.risk_band === 'HIGH'
                              ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                              : q.risk_band === 'MEDIUM'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {q.risk_band} ({q.risk_score}%)
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
