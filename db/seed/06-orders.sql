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
BEGIN;
-- TODO(D2)
COMMIT;
