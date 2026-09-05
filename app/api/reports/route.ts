// OWNER: D4. Reporting aggregates (screen 15, optional).
// PS §A7 filters: Period · Sales Team/Rep · Approval Status · Product/Category.

import { withAuth, ok, fail } from '@/lib/api'
import { q } from '@/lib/db'

export const runtime = 'nodejs'

export const GET = withAuth(['sales_rep', 'sales_manager', 'finance', 'admin'], async (req, session) => {
  const url = new URL(req.url)
  const period = url.searchParams.get('period') || 'all'
  const teamId = url.searchParams.get('teamId')
  const repId = url.searchParams.get('repId')
  const status = url.searchParams.get('status')
  const categoryId = url.searchParams.get('categoryId')

  // Build dynamic where clause
  const conditions: string[] = []
  const params: any[] = []

  // If the logged in user is a rep and wants rep-scoping, they can see their own or their team's,
  // but let's support general filter query
  if (repId) {
    const parsed = parseInt(repId, 10)
    if (!isNaN(parsed)) {
      params.push(parsed)
      conditions.push(`quo.owner_user_id = $${params.length}`)
    }
  }

  if (teamId) {
    const parsed = parseInt(teamId, 10)
    if (!isNaN(parsed)) {
      params.push(parsed)
      conditions.push(`u.team_id = $${params.length}`)
    }
  }

  if (status && status !== 'all') {
    params.push(status)
    conditions.push(`quo.state::text = $${params.length}`)
  }

  if (period === 'today') {
    conditions.push(`quo.created_at >= CURRENT_DATE`)
  } else if (period === '7d') {
    conditions.push(`quo.created_at >= CURRENT_DATE - INTERVAL '7 days'`)
  } else if (period === '30d') {
    conditions.push(`quo.created_at >= CURRENT_DATE - INTERVAL '30 days'`)
  } else if (period === '90d') {
    conditions.push(`quo.created_at >= CURRENT_DATE - INTERVAL '90 days'`)
  }

  if (categoryId) {
    const parsed = parseInt(categoryId, 10)
    if (!isNaN(parsed)) {
      params.push(parsed)
      conditions.push(`EXISTS (
        SELECT 1 FROM quotation_line ql
        JOIN product p ON p.id = ql.product_id
        WHERE ql.quotation_id = quo.id AND p.category_id = $${params.length}
      )`)
    }
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  // 1. Overall KPIs
  const kpiSql = `
    SELECT
      COUNT(*)::int AS total_quotes,
      COALESCE(SUM(quo.grand_total), 0) AS pipeline_value,
      COALESCE(SUM(CASE WHEN quo.state = 'confirmed' THEN quo.grand_total ELSE 0 END), 0) AS won_revenue,
      COALESCE(ROUND(AVG(NULLIF(quo.discount_total, 0) / NULLIF(quo.subtotal, 0) * 100), 1), 0) AS avg_discount_pct,
      COALESCE(ROUND(SUM(quo.margin_total) / NULLIF(SUM(quo.grand_total), 0) * 100, 1), 0) AS avg_margin_pct,
      COUNT(CASE WHEN quo.state = 'confirmed' THEN 1 END)::int AS won_count
    FROM quotation quo
    JOIN app_user u ON u.id = quo.owner_user_id
    ${whereSql}
  `

  // 2. Stage Breakdown
  const stageSql = `
    SELECT
      quo.state,
      COUNT(*)::int AS count,
      COALESCE(SUM(quo.grand_total), 0) AS total_amount
    FROM quotation quo
    JOIN app_user u ON u.id = quo.owner_user_id
    ${whereSql}
    GROUP BY quo.state
    ORDER BY count DESC
  `

  // 3. Category Breakdown
  const categoryBreakdownSql = `
    SELECT
      cat.name AS category_name,
      COALESCE(SUM(ql.net_amount), 0) AS revenue,
      COALESCE(SUM(ql.margin_amount), 0) AS margin,
      COUNT(DISTINCT quo.id)::int AS quote_count
    FROM quotation quo
    JOIN app_user u ON u.id = quo.owner_user_id
    JOIN quotation_line ql ON ql.quotation_id = quo.id
    JOIN product p ON p.id = ql.product_id
    JOIN product_category cat ON cat.id = p.category_id
    ${whereSql}
    GROUP BY cat.id, cat.name
    ORDER BY revenue DESC
  `

  // 4. Team Performance
  const teamSql = `
    SELECT
      COALESCE(st.name, 'Unassigned') AS team_name,
      COUNT(quo.id)::int AS quote_count,
      COALESCE(SUM(quo.grand_total), 0) AS total_amount,
      COALESCE(SUM(CASE WHEN quo.state = 'confirmed' THEN quo.grand_total ELSE 0 END), 0) AS won_amount
    FROM quotation quo
    JOIN app_user u ON u.id = quo.owner_user_id
    LEFT JOIN sales_team st ON st.id = u.team_id
    ${whereSql}
    GROUP BY st.name
    ORDER BY total_amount DESC
  `

  // 5. Quotation Detail Records (up to 100)
  const detailSql = `
    SELECT
      quo.id,
      quo.public_id,
      quo.number,
      c.name AS customer_name,
      u.full_name AS rep_name,
      st.name AS team_name,
      quo.state,
      quo.currency_code,
      quo.grand_total,
      quo.discount_total,
      quo.margin_total,
      quo.risk_score,
      quo.risk_band,
      quo.created_at
    FROM quotation quo
    JOIN customer c ON c.id = quo.customer_id
    JOIN app_user u ON u.id = quo.owner_user_id
    LEFT JOIN sales_team st ON st.id = u.team_id
    ${whereSql}
    ORDER BY quo.created_at DESC
    LIMIT 100
  `

  // 6. Lookups for filters
  const [kpiRows, stages, categoryBreakdown, teamPerformance, quotations, teams, reps, categories] = await Promise.all([
    q(kpiSql, params),
    q(stageSql, params),
    q(categoryBreakdownSql, params),
    q(teamSql, params),
    q(detailSql, params),
    q(`SELECT id, code, name FROM sales_team WHERE is_active = true ORDER BY name`),
    q(`SELECT id, full_name, team_id FROM app_user WHERE role = 'sales_rep' AND is_active = true ORDER BY full_name`),
    q(`SELECT id, code, name FROM product_category ORDER BY name`),
  ])

  const kpis = kpiRows[0] || {
    total_quotes: 0,
    pipeline_value: '0',
    won_revenue: '0',
    avg_discount_pct: 0,
    avg_margin_pct: 0,
    won_count: 0,
  }

  const winRate = kpis.total_quotes > 0 ? Math.round((kpis.won_count / kpis.total_quotes) * 100) : 0

  return ok({
    kpis: {
      ...kpis,
      win_rate: winRate,
    },
    stages,
    categoryBreakdown,
    teamPerformance,
    quotations,
    lookups: {
      teams,
      reps,
      categories,
    },
  })
})
