// OWNER: D2.  Everything downstream of `confirmed`: orders, the warehouse
// split, subscriptions, invoices, payments and proration.
//
// Money and quantities are STRINGS — see the note at the top of
// lib/types/catalog.ts for why.  Ids are numbers.

import type { BillingCycle } from './catalog'

export type OrderState =
  | 'confirmed' | 'split_pending' | 'partially_fulfilled'
  | 'fulfilled' | 'backorder' | 'cancelled'

export type AllocStatus = 'planned' | 'reserved' | 'shipped' | 'cancelled'
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void'
export type SubStatus = 'active' | 'paused' | 'cancelled'
export type LineType = 'one_time' | 'recurring'

export type OrderSummary = {
  id: number
  number: string
  quotation_id: number
  quotation_number: string
  customer_id: number
  customer_name: string
  currency_code: string
  state: OrderState
  promised_delivery_date: string | null
  grand_total: string
  created_at: string
  /** Derived, not stored — see app/api/orders/route.ts. */
  is_late: boolean
  open_backorders: number
}

export type AllocationRow = {
  id: number
  warehouse_id: number
  warehouse_code: string
  warehouse_name: string
  qty: string
  status: AllocStatus
  shipping_cost: string
  is_manual_override: boolean
  promised_ship_date: string | null
  shipped_at: string | null
}

export type BackorderRow = {
  id: number
  qty_outstanding: string
  created_at: string
  resolved_at: string | null
  /** Recomputed on every read — can this backorder be filled from stock NOW? */
  fillable_qty: string
}

export type OrderLineDetail = {
  id: number
  quotation_line_id: number
  product_id: number
  product_sku: string
  product_name: string
  variant_id: number | null
  variant_sku: string | null
  line_type: LineType
  qty: string
  unit_price: string
  net_amount: string
  /** False for services and subscriptions — they hold no stock and are never split. */
  is_stock_managed: boolean
  allocations: AllocationRow[]
  backorders: BackorderRow[]
  /** Live availability per warehouse, for the manual-override editor. */
  stock: {
    warehouse_id: number
    warehouse_code: string
    warehouse_name: string
    available: string
    shipping_cost_weight: string
  }[]
}

export type OrderDetail = OrderSummary & {
  lines: OrderLineDetail[]
  /** Order Confirmed → Shipped → Invoiced → Paid, driven from real state. */
  progress: {
    confirmed: boolean
    shipped: boolean
    invoiced: boolean
    paid: boolean
  }
  invoices: InvoiceSummary[]
  subscriptions: SubscriptionSummary[]
}

export type InvoiceSummary = {
  id: number
  number: string
  customer_id: number
  customer_name: string
  order_id: number | null
  order_number: string | null
  subscription_id: number | null
  kind: LineType
  currency_code: string
  amount_total: string
  amount_paid: string
  amount_due: string
  status: InvoiceStatus
  issue_date: string
  due_date: string
  is_overdue: boolean
}

export type InvoiceDetail = InvoiceSummary & {
  lines: { id: number; description: string; qty: string; unit_price: string; amount: string }[]
  payments: { id: number; amount: string; method: string; reference: string | null; paid_at: string }[]
  credit_notes: { id: number; number: string; amount: string; reason: string | null; created_at: string }[]
  progress: OrderDetail['progress']
}

export type SubscriptionSummary = {
  id: number
  customer_id: number
  customer_name: string
  plan_id: number
  plan_name: string
  cycle: BillingCycle
  plan_price: string
  qty: string
  status: SubStatus
  current_period_start: string
  current_period_end: string
  next_bill_date: string | null
  /** qty × plan price for one cycle. */
  period_amount: string
}

export type ProrationEventRow = {
  id: number
  event_type: 'qty_change' | 'plan_change' | 'cancel' | 'reactivate'
  effective_date: string
  old_qty: string | null
  new_qty: string | null
  old_plan_name: string | null
  new_plan_name: string | null
  days_remaining: number
  days_in_period: number
  delta_amount: string
  credit_note_id: number | null
  credit_note_number: string | null
  created_at: string
}

export type SubscriptionDetail = SubscriptionSummary & {
  source_order_id: number | null
  source_order_number: string | null
  proration_enabled: boolean
  cancellation_notice_days: number
  cancellation_refund: 'none' | 'prorated' | 'full'
  events: ProrationEventRow[]
  invoices: InvoiceSummary[]
}

/**
 * Screen 10 — hybrid billing.  One order, two kinds of line, shown separately.
 * The separation IS the screen.
 */
export type BillingDetail = {
  order: OrderSummary
  one_time_lines: {
    id: number; product_name: string; qty: string; unit_price: string; net_amount: string
  }[]
  one_time_total: string
  recurring_lines: {
    id: number; product_name: string; qty: string; unit_price: string; net_amount: string
    plan_name: string; cycle: BillingCycle; subscription_id: number | null
    next_bill_date: string | null
  }[]
  recurring_total_per_cycle: string
  invoices: InvoiceSummary[]
  subscriptions: SubscriptionSummary[]
}
