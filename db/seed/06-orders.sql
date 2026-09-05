-- OWNER: D2.
-- Sales orders, order lines, subscriptions, invoices, payments and the
-- delivery-slippage alert.
--
-- ═══ WHY THERE ARE NO ALLOCATIONS IN THIS FILE ═══════════════════════
--
-- The obvious thing to seed here is "one order already split across two
-- warehouses".  We deliberately do not, and the reason is the requirement
-- itself.
--
-- PS §7 names warehouse splitting as logic that must be REAL and "not
-- hardcoded or faked for the demo".  Writing the split as INSERT statements
-- means writing the algorithm a second time, in SQL, where it can drift out of
-- agreement with lib/allocate.ts — and a seeded split IS the hardcoded
-- version, sitting in the repository where a judge can read it.
--
-- So the seed ships orders with NOTHING allocated.  Screen 8 opens on a real
-- order, computes the suggested split live from current stock, and the Accept
-- button writes it.  The demo shows the engine running rather than a row
-- somebody typed.  db/seed/04-stock.sql is deliberately short so that the
-- first line a judge looks at has to split, the second has to backorder, and
-- the third catches out a greedy implementation.
--
-- Everything with no algorithm behind it IS seeded: orders, lines, mid-cycle
-- subscriptions, invoices in all three payment states, a late delivery.
--
-- ═══ DEPENDS ON D1 ══════════════════════════════════════════════════
-- Orders come from confirmed quotations, so this file is data-driven from
-- whatever db/seed/05-quotations.sql contains.  Until D1 ships it, this seed
-- prints a notice and creates nothing — the seed pipeline stays green either
-- way, which is what lets four people reset the database all day.
BEGIN;

DO $$
DECLARE
  v_q          record;
  v_line       record;
  v_order_id   bigint;
  v_sol_id     bigint;
  v_sub_id     bigint;
  v_inv_id     bigint;
  v_n          int := 0;
  v_promise    int;
  v_total      numeric(14,2);
  v_iv         interval;
  v_amount     numeric(14,2);
  v_plan       record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM quotation WHERE state = 'confirmed') THEN
    RAISE NOTICE '06-orders.sql: no confirmed quotations yet (D1 owns 05-quotations.sql) — no orders created.';
    RETURN;
  END IF;

  FOR v_q IN SELECT * FROM quotation WHERE state = 'confirmed' ORDER BY id LOOP
    v_n := v_n + 1;

    -- The FIRST confirmed order is deliberately overdue, so screen 14 has a
    -- real delivery_slippage alert rather than a decorative one.
    v_promise := CASE WHEN v_n = 1 THEN -3 ELSE 5 + v_n END;

    INSERT INTO sales_order (number, quotation_id, customer_id, currency_code, state,
                             promised_delivery_date, grand_total)
    VALUES ('SO-' || regexp_replace(v_q.number, '^Q[-_]?', ''),
            v_q.id, v_q.customer_id, v_q.currency_code, 'confirmed',
            (CURRENT_DATE + (v_promise || ' days')::interval)::date,
            v_q.grand_total)
    RETURNING id INTO v_order_id;

    FOR v_line IN
      SELECT * FROM quotation_line WHERE quotation_id = v_q.id ORDER BY line_no
    LOOP
      INSERT INTO sales_order_line (order_id, quotation_line_id, product_id, variant_id,
                                    qty, unit_price, net_amount)
      VALUES (v_order_id, v_line.id, v_line.product_id, v_line.variant_id,
              v_line.qty, v_line.unit_price, v_line.net_amount)
      RETURNING id INTO v_sol_id;

      CONTINUE WHEN v_line.line_type <> 'recurring';

      -- A recurring line becomes a subscription that started TEN DAYS AGO, so
      -- it sits mid-cycle and proration has something real to prorate.  A
      -- subscription seeded as starting today prorates to the full amount and
      -- demonstrates nothing.
      SELECT * INTO v_plan FROM subscription_plan WHERE id = v_line.subscription_plan_id;
      v_iv := CASE v_plan.cycle
                WHEN 'weekly'    THEN interval '7 days'
                WHEN 'monthly'   THEN interval '1 month'
                WHEN 'quarterly' THEN interval '3 months'
                WHEN 'yearly'    THEN interval '1 year'
              END;

      INSERT INTO subscription (customer_id, plan_id, source_order_line_id, qty, status,
                                current_period_start, current_period_end, next_bill_date,
                                started_at)
      VALUES (v_q.customer_id, v_plan.id, v_sol_id, v_line.qty, 'active',
              (CURRENT_DATE - interval '10 days')::date,
              (CURRENT_DATE - interval '10 days' + v_iv)::date,
              (CURRENT_DATE - interval '10 days' + v_iv)::date,
              now() - interval '10 days')
      RETURNING id INTO v_sub_id;

      v_amount := round(v_plan.price * v_line.qty, 2);

      INSERT INTO invoice (number, customer_id, subscription_id, kind, currency_code,
                           amount_total, status, issue_date, due_date)
      VALUES ('INV-' || to_char(now(), 'YYYY') || '-' ||
              lpad(((SELECT count(*) FROM invoice) + 1)::text, 4, '0'),
              v_q.customer_id, v_sub_id, 'recurring', v_plan.currency_code,
              v_amount, 'unpaid',
              (CURRENT_DATE - interval '10 days')::date,
              (CURRENT_DATE - interval '10 days' + v_iv)::date)
      RETURNING id INTO v_inv_id;

      INSERT INTO invoice_line (invoice_id, description, qty, unit_price, amount)
      VALUES (v_inv_id,
              v_plan.name || ' · ' ||
              to_char(CURRENT_DATE - interval '10 days', 'YYYY-MM-DD') || ' → ' ||
              to_char(CURRENT_DATE - interval '10 days' + v_iv, 'YYYY-MM-DD'),
              v_line.qty, v_plan.price, v_amount);
    END LOOP;

    -- The one-time half of the same order (PS §B7): same order, different
    -- billing mechanism, separate invoice.  Screen 10 shows the two side by
    -- side and that separation is the point of the screen.
    SELECT COALESCE(SUM(sol.net_amount), 0) INTO v_total
      FROM sales_order_line sol
      JOIN quotation_line ql ON ql.id = sol.quotation_line_id
     WHERE sol.order_id = v_order_id AND ql.line_type = 'one_time';

    CONTINUE WHEN v_total <= 0;

    INSERT INTO invoice (number, customer_id, order_id, kind, currency_code,
                         amount_total, status, issue_date, due_date)
    VALUES ('INV-' || to_char(now(), 'YYYY') || '-' ||
            lpad(((SELECT count(*) FROM invoice) + 1)::text, 4, '0'),
            v_q.customer_id, v_order_id, 'one_time', v_q.currency_code,
            v_total, 'unpaid',
            (CURRENT_DATE - interval '6 days')::date,
            (CURRENT_DATE + (CASE WHEN v_n = 1 THEN -2 ELSE 9 END || ' days')::interval)::date)
    RETURNING id INTO v_inv_id;

    INSERT INTO invoice_line (invoice_id, description, qty, unit_price, amount)
    SELECT v_inv_id, p.name, sol.qty, sol.unit_price, sol.net_amount
      FROM sales_order_line sol
      JOIN quotation_line ql ON ql.id = sol.quotation_line_id
      JOIN product p ON p.id = sol.product_id
     WHERE sol.order_id = v_order_id AND ql.line_type = 'one_time'
     ORDER BY sol.id;
  END LOOP;

  RAISE NOTICE '06-orders.sql: created % order(s) from confirmed quotations.', v_n;
END $$;

-- ── Payments, so screen 12 has all three states on it ────────────────
-- Enough to settle the oldest invoice, and a part-payment against the next.
INSERT INTO payment (invoice_id, amount, method, reference, paid_at)
SELECT i.id, i.amount_total, 'bank', 'NEFT-SEED-1', now() - interval '2 days'
  FROM invoice i WHERE i.kind = 'one_time'
 ORDER BY i.id LIMIT 1;

INSERT INTO payment (invoice_id, amount, method, reference, paid_at)
SELECT i.id, round(i.amount_total * 0.40, 2), 'card', 'CARD-SEED-2', now() - interval '1 day'
  FROM invoice i WHERE i.kind = 'one_time'
 ORDER BY i.id OFFSET 1 LIMIT 1;

-- ── Status is DERIVED, never typed ──────────────────────────────────
-- Exactly the rule applyPayment() applies in lib/invoice.ts.  The seed does
-- not get to hand-write a status either: an invoice reading "paid" with no
-- payment behind it is the one bug this application must never have, and a
-- seed file is the easiest place to introduce it.
UPDATE invoice i
   SET status = CASE
         WHEN paid.total >= i.amount_total THEN 'paid'::invoice_status
         WHEN paid.total > 0               THEN 'partial'::invoice_status
         ELSE 'unpaid'::invoice_status
       END
  FROM (SELECT i2.id, COALESCE((SELECT SUM(p.amount) FROM payment p WHERE p.invoice_id = i2.id), 0) AS total
          FROM invoice i2) paid
 WHERE paid.id = i.id;

-- ── Screen 14's third alert kind ────────────────────────────────────
-- D1 seeds 'stalled' and 'discount_anomaly' in 05.  This one is D2's because
-- it needs sales_order.promised_delivery_date to exist first.  Screen 14
-- RENDERS deal_alert — it does not derive alerts from order columns — so an
-- overdue order with no row here shows nothing.
INSERT INTO deal_alert (quotation_id, kind, detail, flagged_at)
SELECT o.quotation_id, 'delivery_slippage',
       'Promised ' || (CURRENT_DATE - o.promised_delivery_date) || ' days ago, not yet shipped',
       o.promised_delivery_date
  FROM sales_order o
 WHERE o.promised_delivery_date < CURRENT_DATE
   AND o.state <> 'fulfilled'
ON CONFLICT DO NOTHING;

COMMIT;
