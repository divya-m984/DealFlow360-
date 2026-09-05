// OWNER: D1.  Live upsell / cross-sell suggestions — PS §B5, screen 4's panel.
//
// §9 step 4: "accept one upsell suggestion and confirm the order total and
// margin update right away."
//
// The panel shows, per the mockup: the suggested product, the MARGIN DELTA if
// added, and a promotion tag where one applies.
//
// HONESTY NOTE, worth having ready if a judge asks: PS §B5 says suggestions
// are ranked "based on co purchase history". We rank on upsell_rule.rank_score,
// which is SEEDED rather than derived from past orders. Deriving it from
// sales_order_line co-occurrence is a real query and it is in D4's "what we'd
// build next" note. Do not claim history on stage that we did not compute.
import { q } from '@/lib/db'
import { ok, fail, withAuth } from '@/lib/api'

export const runtime = 'nodejs'

const INTERNAL = ['sales_rep', 'sales_manager', 'finance', 'admin'] as const
type Ctx = { params: Promise<{ id: string }> }

export const GET = withAuth<Ctx>([...INTERNAL], async (_req, _session, ctx) => {
  const id = Number((await ctx.params).id)

  const [head] = await q<{ id: number }>(`SELECT id FROM quotation WHERE id = $1`, [id])
  if (!head) return fail('Quotation not found', 404)

  const rows = await q(
    `WITH on_quote AS (
       SELECT DISTINCT product_id FROM quotation_line WHERE quotation_id = $1
     )
     SELECT DISTINCT ON (sp.id)
            r.id            AS rule_id,
            r.kind,
            r.is_promoted,
            r.promo_text,
            r.rank_score,
            r.min_margin_pct,
            sp.id           AS suggested_product_id,
            sp.sku,
            sp.name,
            sp.base_price,
            sp.cost,
            sp.unit,
            sp.tax_pct,
            sp.is_subscription,
            sp.recurring_cycle,
            cat.name        AS category_name,
            -- effective ceiling this product would get on THIS quotation
            effective_ceiling_pct(cu.tier_id, sp.category_id) AS ceiling_pct,
            -- margin delta if added at qty 1, no discount: price - cost.
            -- This is what the mockup's "Margin +$18" chip shows.
            ROUND(sp.base_price - sp.cost, 2)                 AS margin_delta,
            CASE WHEN sp.base_price > 0
                 THEN ROUND((sp.base_price - sp.cost) / sp.base_price * 100, 2)
                 ELSE 0 END                                   AS margin_pct,
            tp.name         AS triggered_by
       FROM quotation qq
       JOIN customer cu            ON cu.id = qq.customer_id
       JOIN on_quote oq            ON true
       JOIN upsell_rule r          ON r.trigger_product_id = oq.product_id
       JOIN product sp             ON sp.id = r.suggested_product_id
       JOIN product tp             ON tp.id = r.trigger_product_id
       JOIN product_category cat   ON cat.id = sp.category_id
      WHERE qq.id = $1
        AND sp.is_active
        -- never suggest something already on the quotation
        AND sp.id NOT IN (SELECT product_id FROM on_quote)
        -- PS §A6: "only healthy margin suggestions surface"
        AND (r.min_margin_pct IS NULL
             OR (sp.base_price > 0
                 AND (sp.base_price - sp.cost) / sp.base_price * 100 >= r.min_margin_pct))
      -- DISTINCT ON keeps the best rule when two lines suggest the same product
      ORDER BY sp.id, r.is_promoted DESC, r.rank_score DESC`,
    [id],
  )

  // PS §A6: promoted products rank higher. Final ordering is done here rather
  // than in SQL because DISTINCT ON dictates its own ORDER BY.
  rows.sort(
    (a: any, b: any) =>
      Number(b.is_promoted) - Number(a.is_promoted) ||
      Number(b.rank_score) - Number(a.rank_score),
  )

  return ok(rows)
})
