-- OWNER: D2.
-- Sales orders, order lines, allocations, backorders, subscriptions, invoices,
-- payments.
--
-- Must contain, at minimum:
--   • one confirmed order already split across two warehouses
--   • one order with an open backorder row
--   • one order whose promised_delivery_date has passed  → screen 14 slippage
--   • one active subscription mid-cycle                  → proration has
--     something to prorate
--   • invoices: one unpaid, one partial, one paid        → screen 12
--   • ONE deal_alert of kind 'delivery_slippage' for the late order.
--     D1 seeds the 'stalled' and 'discount_anomaly' alerts in 05; this one is
--     yours because it needs sales_order.promised_delivery_date to exist.
BEGIN;
-- TODO(D2)
COMMIT;
