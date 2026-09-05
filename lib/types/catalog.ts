// OWNER: D2.  Products, variants, pricelists, and the discount configuration
// that screen 18 edits.
//
// ── MONEY IS A STRING ────────────────────────────────────────────────
// lib/db.ts deliberately leaves Postgres `numeric` as a string, because
// parsing it to a JS float reintroduces exactly the rounding error that
// numeric(14,2) exists to prevent.  Every money and percentage field below is
// therefore `string`.  Format it for display; never parseFloat it and write it
// back.  Ids are numbers — lib/db.ts parses bigint for us.

export type BillingCycle = 'weekly' | 'monthly' | 'quarterly' | 'yearly'
export type RiskBand = 'LOW' | 'MEDIUM' | 'HIGH'
export type RefundPolicy = 'none' | 'prorated' | 'full'

export type CustomerTier = {
  id: number
  code: string
  name: string
  max_discount_pct: string
  sort_order: number
}

export type ProductCategory = {
  id: number
  code: string
  name: string
  max_discount_pct: string
}

/**
 * One band of the approval chain.  `band` is the primary key — there are
 * exactly three rows, forever.
 */
export type ApprovalPolicy = {
  band: RiskBand
  score_from: string
  score_to: string
  requires_manager: boolean
  requires_finance: boolean
}

export type Warehouse = {
  id: number
  code: string
  name: string
  shipping_cost_weight: string
  is_active: boolean
}

export type SubscriptionPlan = {
  id: number
  name: string
  cycle: BillingCycle
  price: string
  currency_code: string
  proration_enabled: boolean
  cancellation_notice_days: number
  cancellation_refund: RefundPolicy
  is_active: boolean
}

/** Everything screen 18 renders, in one request. */
export type ConfigPayload = {
  tiers: CustomerTier[]
  categories: ProductCategory[]
  policy: ApprovalPolicy[]
  warehouses: Warehouse[]
  plans: SubscriptionPlan[]
}

export type ProductVariant = {
  id: number
  sku: string
  extra_price: string
  is_active: boolean
  options: { attribute: string; value: string; extra_price: string }[]
}

export type PricelistLine = {
  pricelist_id: number
  pricelist_name: string
  tier_name: string | null
  currency_code: string
  rule_type: 'no_adjustment' | 'discount_pct' | 'fixed_price'
  value: string
  /** Resolved unit price for this product under this pricelist. */
  effective_price: string
}

export type ProductDetail = {
  id: number
  sku: string
  name: string
  category_id: number
  category_name: string
  category_max_discount_pct: string
  base_price: string
  cost: string
  currency_code: string
  unit: string
  tax_pct: string
  description: string | null
  is_subscription: boolean
  recurring_cycle: BillingCycle | null
  is_active: boolean
  variants: ProductVariant[]
  pricelists: PricelistLine[]
  stock: {
    warehouse_id: number
    warehouse_code: string
    warehouse_name: string
    qty_on_hand: string
    qty_reserved: string
    qty_available: string
    reorder_point: string
    below_reorder_point: boolean
  }[]
}
