-- OWNER: D1.
-- Quotations, lines, approval requests, negotiation, audit log, deal alerts.
--
-- SHIP THIS EARLY.  D2 and D3 are both blocked on having quotations to read.
--
-- NOTHING IN THIS FILE IS HAND-COMPUTED.  Line ceilings come from
-- effective_ceiling_pct(); over_by_pct / net_amount / margin_amount are
-- GENERATED columns; the quotation rollup and the risk score are computed by
-- the UPDATE at the bottom, using the same formula lib/risk.ts implements.
-- That makes this file the reference implementation — if the TypeScript ever
-- disagrees with these seeded numbers, the TypeScript is wrong.
BEGIN;

-- ─────────────────────────── QUOTATIONS ───────────────────────────
-- One in every kanban column (screen 3), plus the two deal-health cases.
--
--  Q-1042  Acme Corp       pending_approval  PS §10 worked example · HIGH
--                                            VERSION 2 — v1 was returned, and
--                                            its approval is orphaned by the
--                                            version key.  Law 1, in the data.
--  Q-1050  Acme Corp       draft             kanban: Draft
--  Q-1039  Beta Industries pending_approval  manager approved, finance pending
--  Q-1044  Nova Retail     approved          kanban: Approved · MEDIUM
--  Q-1031  Zenith Co       negotiation       kanban: Negotiation · portal target
--  Q-1028  Orion Ltd       confirmed         kanban: Confirmed · LOW, ZERO
--                                            approval rows — the §9 step 3
--                                            auto-approve branch
--  Q-1019  Delta LLC       draft             stalled, idle 9 days
--  Q-1021  Delta LLC       pending_approval  discount anomaly, 22% vs ~8% avg
INSERT INTO quotation (number, customer_id, owner_user_id, pricelist_id, currency_code, state, version, created_at, last_activity_at, submitted_at, approved_at, confirmed_at) VALUES
 ('Q-1042', (SELECT id FROM customer WHERE name='Acme Corp'),       (SELECT id FROM app_user WHERE email='rep@dealflow.app'),  (SELECT id FROM pricelist WHERE name='Gold List'),   'INR', 'pending_approval', 2, now()-interval '6 days',  now()-interval '1 day',  now()-interval '1 day',  NULL,                    NULL),
 ('Q-1050', (SELECT id FROM customer WHERE name='Acme Corp'),       (SELECT id FROM app_user WHERE email='rep@dealflow.app'),  (SELECT id FROM pricelist WHERE name='Gold List'),   'INR', 'draft',            1, now()-interval '1 day',  now()-interval '2 hours', NULL,                   NULL,                    NULL),
 ('Q-1039', (SELECT id FROM customer WHERE name='Beta Industries'), (SELECT id FROM app_user WHERE email='rep2@dealflow.app'), (SELECT id FROM pricelist WHERE name='Silver List'), 'INR', 'pending_approval', 1, now()-interval '5 days',  now()-interval '2 days', now()-interval '4 days', NULL,                    NULL),
 ('Q-1044', (SELECT id FROM customer WHERE name='Nova Retail'),     (SELECT id FROM app_user WHERE email='rep2@dealflow.app'), (SELECT id FROM pricelist WHERE name='Silver List'), 'INR', 'approved',         1, now()-interval '8 days',  now()-interval '3 days', now()-interval '7 days', now()-interval '3 days', NULL),
 ('Q-1031', (SELECT id FROM customer WHERE name='Zenith Co'),       (SELECT id FROM app_user WHERE email='rep@dealflow.app'),  (SELECT id FROM pricelist WHERE name='Gold List'),   'INR', 'negotiation',      1, now()-interval '10 days', now()-interval '1 day',  now()-interval '9 days', now()-interval '9 days', NULL),
 ('Q-1028', (SELECT id FROM customer WHERE name='Orion Ltd'),       (SELECT id FROM app_user WHERE email='rep3@dealflow.app'), (SELECT id FROM pricelist WHERE name='Gold List'),   'INR', 'confirmed',        1, now()-interval '14 days', now()-interval '5 days', now()-interval '13 days', now()-interval '13 days', now()-interval '12 days'),
 ('Q-1019', (SELECT id FROM customer WHERE name='Delta LLC'),       (SELECT id FROM app_user WHERE email='rep@dealflow.app'),  (SELECT id FROM pricelist WHERE name='Bronze List'), 'INR', 'draft',            1, now()-interval '12 days', now()-interval '9 days', NULL,                   NULL,                    NULL),
 ('Q-1021', (SELECT id FROM customer WHERE name='Delta LLC'),       (SELECT id FROM app_user WHERE email='rep@dealflow.app'),  (SELECT id FROM pricelist WHERE name='Bronze List'), 'INR', 'pending_approval', 1, now()-interval '3 days',  now()-interval '1 day',  now()-interval '2 days', NULL,                    NULL);

-- ───────────────────────────── LINES ──────────────────────────────
-- ceiling_pct is SNAPSHOTTED at line creation via effective_ceiling_pct()
-- = LEAST(tier.max_discount_pct, category.max_discount_pct).  It is never
-- looked up at read time — an admin editing a tier tomorrow must not silently
-- change the risk score of a quote that was already approved.
INSERT INTO quotation_line (quotation_id, line_no, product_id, line_type, subscription_plan_id, qty, unit_price, unit_cost, discount_pct, ceiling_pct, tax_pct)
SELECT qq.id, v.line_no, p.id, v.line_type::line_type,
       CASE WHEN v.line_type='recurring' THEN (SELECT id FROM subscription_plan WHERE name='Care Plan 2yr — Monthly') END,
       v.qty, p.base_price, p.cost, v.discount_pct,
       effective_ceiling_pct(c.tier_id, p.category_id),
       p.tax_pct
FROM (VALUES
  -- PS §10, verbatim: Gold customer, 15% tier ceiling.  Hardware allowed 15,
  -- Services only 10.  The Laptop at 12% is fine; the Service at 18% is 8
  -- points over ITS OWN limit, and that one line flags the whole quotation.
  ('Q-1042', 1, 'LP14',  'one_time',  2::numeric,  12.00::numeric),
  ('Q-1042', 2, 'SETUP', 'one_time',  1,           18.00),
  ('Q-1042', 3, 'WARR',  'one_time',  1,           10.00),

  ('Q-1050', 1, 'LP14',  'one_time',  8,            8.00),
  ('Q-1050', 2, 'MOUSE', 'one_time',  8,            8.00),

  -- Silver: hardware capped at 10, not 15
  ('Q-1039', 1, 'LP14',  'one_time', 20,           16.00),
  ('Q-1039', 2, 'DOCK',  'one_time', 20,           12.00),

  ('Q-1044', 1, 'LP14',  'one_time',  5,           12.00),
  ('Q-1044', 2, 'CARE2', 'recurring', 5,            0.00),

  ('Q-1031', 1, 'LP14',  'one_time', 10,            6.00),
  ('Q-1031', 2, 'DOCK',  'one_time', 10,            6.00),

  -- one_time AND recurring on ONE order — PS §B7 / §9 step 6.  D2 turns this
  -- into the sales_order that screens 8, 10 and 13 all hang off.
  ('Q-1028', 1, 'LP14',  'one_time', 25,           10.00),
  ('Q-1028', 2, 'SETUP', 'one_time', 10,            8.00),
  ('Q-1028', 3, 'CARE2', 'recurring',25,            0.00),

  ('Q-1019', 1, 'DOCK',  'one_time',  5,            4.00),

  -- Bronze caps hardware at 5.  22% is 17 points over — the anomaly.
  ('Q-1021', 1, 'LP14',  'one_time',  3,           22.00)
) AS v(number, line_no, sku, line_type, qty, discount_pct)
JOIN quotation qq ON qq.number = v.number
JOIN customer  c  ON c.id = qq.customer_id
JOIN product   p  ON p.sku = v.sku;

-- ────────────────────── APPROVAL REQUESTS ─────────────────────────
-- Keyed (quotation_id, quotation_version, level).  LAW 1.
--
-- Q-1042 carries TWO generations: a v1 manager row that was RETURNED, and the
-- v2 rows created after the rep edited.  The v1 row still exists and is simply
-- no longer the current version — that is the orphaning, visible in the data
-- with no flag to reset.
INSERT INTO approval_request (quotation_id, quotation_version, level, seq, status, assigned_to_user_id, acted_by_user_id, acted_at, note, created_at) VALUES
 ((SELECT id FROM quotation WHERE number='Q-1042'), 1, 'sales_manager', 1, 'returned', (SELECT id FROM app_user WHERE email='manager@dealflow.app'), (SELECT id FROM app_user WHERE email='manager@dealflow.app'), now()-interval '4 days', 'Requested justification for the 18% service discount', now()-interval '5 days'),
 ((SELECT id FROM quotation WHERE number='Q-1042'), 2, 'sales_manager', 1, 'pending',  (SELECT id FROM app_user WHERE email='manager@dealflow.app'), NULL, NULL, NULL, now()-interval '1 day'),
 ((SELECT id FROM quotation WHERE number='Q-1042'), 2, 'finance',       2, 'pending',  (SELECT id FROM app_user WHERE email='finance@dealflow.app'), NULL, NULL, NULL, now()-interval '1 day'),

 -- manager signed, finance has NOT.  isApproved() must read false here.
 ((SELECT id FROM quotation WHERE number='Q-1039'), 1, 'sales_manager', 1, 'approved', (SELECT id FROM app_user WHERE email='manager@dealflow.app'), (SELECT id FROM app_user WHERE email='manager@dealflow.app'), now()-interval '3 days', 'Volume deal, margin acceptable', now()-interval '4 days'),
 ((SELECT id FROM quotation WHERE number='Q-1039'), 1, 'finance',       2, 'pending',  (SELECT id FROM app_user WHERE email='finance@dealflow.app'), NULL, NULL, NULL, now()-interval '3 days'),

 -- MEDIUM: manager only, and signed.  isApproved() must read true.
 ((SELECT id FROM quotation WHERE number='Q-1044'), 1, 'sales_manager', 1, 'approved', (SELECT id FROM app_user WHERE email='manager@dealflow.app'), (SELECT id FROM app_user WHERE email='manager@dealflow.app'), now()-interval '3 days', 'Within policy', now()-interval '7 days'),

 ((SELECT id FROM quotation WHERE number='Q-1021'), 1, 'sales_manager', 1, 'pending',  (SELECT id FROM app_user WHERE email='manager@dealflow.app'), NULL, NULL, NULL, now()-interval '2 days'),
 ((SELECT id FROM quotation WHERE number='Q-1021'), 1, 'finance',       2, 'pending',  (SELECT id FROM app_user WHERE email='finance@dealflow.app'), NULL, NULL, NULL, now()-interval '2 days');

-- Q-1028 and Q-1031 get NO rows at all.  Both score LOW, so neither requires
-- an approval — and isApproved() must still return true for them.  Any version
-- of that query built on "an approved row exists" breaks here.

-- ───────────────────────── NEGOTIATION ────────────────────────────
-- Q-1031 is Gold, currently discounted 6%, well inside its 15% ceiling.
-- The buyer is asking for 22%.  Accepting this counter pushes the hardware
-- lines 7 points over, bumps the version, orphans nothing (it is LOW and has
-- no approvals) and drops it straight into pending_approval.  That is the
-- portal loop, set up and ready to run on stage.
INSERT INTO negotiation_request (quotation_id, created_by_user_id, counter_discount_pct, requested_delivery_date, status, created_at) VALUES
 ((SELECT id FROM quotation WHERE number='Q-1031'), (SELECT id FROM app_user WHERE email='buyer@zenith.example'), 22.00, CURRENT_DATE + 14, 'open', now()-interval '1 day');

INSERT INTO negotiation_comment (negotiation_request_id, quotation_line_id, comment, created_at) VALUES
 ((SELECT id FROM negotiation_request WHERE quotation_id=(SELECT id FROM quotation WHERE number='Q-1031')),
  (SELECT id FROM quotation_line WHERE quotation_id=(SELECT id FROM quotation WHERE number='Q-1031') AND line_no=1),
  'Can this be 22% off if instead of 10%?', now()-interval '1 day'),
 ((SELECT id FROM negotiation_request WHERE quotation_id=(SELECT id FROM quotation WHERE number='Q-1031')),
  (SELECT id FROM quotation_line WHERE quotation_id=(SELECT id FROM quotation WHERE number='Q-1031') AND line_no=2),
  'Can we push the docks to next month?', now()-interval '1 day');

-- ────────────────────────── AUDIT LOG ─────────────────────────────
-- PS §A3: every approval, rejection and edit logged with user, timestamp AND
-- reason.  Screen 6 renders this.
INSERT INTO audit_log (entity_type, entity_id, action, actor_user_id, note, created_at) VALUES
 ('quotation', (SELECT id FROM quotation WHERE number='Q-1042'), 'submitted',   (SELECT id FROM app_user WHERE email='rep@dealflow.app'),     'Initial 12% discount',      now()-interval '5 days'),
 ('quotation', (SELECT id FROM quotation WHERE number='Q-1042'), 'returned',    (SELECT id FROM app_user WHERE email='manager@dealflow.app'), 'Requested justification',   now()-interval '4 days'),
 ('quotation', (SELECT id FROM quotation WHERE number='Q-1042'), 'edited',      (SELECT id FROM app_user WHERE email='rep@dealflow.app'),     'Added margin note — version bumped to 2', now()-interval '1 day'),
 ('quotation', (SELECT id FROM quotation WHERE number='Q-1042'), 'resubmitted', (SELECT id FROM app_user WHERE email='rep@dealflow.app'),     'Resubmitted for approval',  now()-interval '1 day'),
 ('quotation', (SELECT id FROM quotation WHERE number='Q-1039'), 'submitted',   (SELECT id FROM app_user WHERE email='rep2@dealflow.app'),    'Volume order',              now()-interval '4 days'),
 ('quotation', (SELECT id FROM quotation WHERE number='Q-1039'), 'approved',    (SELECT id FROM app_user WHERE email='manager@dealflow.app'), 'Volume deal, margin acceptable', now()-interval '3 days'),
 ('quotation', (SELECT id FROM quotation WHERE number='Q-1044'), 'approved',    (SELECT id FROM app_user WHERE email='manager@dealflow.app'), 'Within policy',             now()-interval '3 days'),
 ('quotation', (SELECT id FROM quotation WHERE number='Q-1028'), 'auto_approved',(SELECT id FROM app_user WHERE email='rep3@dealflow.app'),   'Risk LOW — no approval required', now()-interval '13 days'),
 ('quotation', (SELECT id FROM quotation WHERE number='Q-1031'), 'sent_to_portal',(SELECT id FROM app_user WHERE email='rep@dealflow.app'),   'Sent to customer portal',   now()-interval '9 days');

-- ───────────────────────── DEAL ALERTS ────────────────────────────
-- Screen 14 RENDERS these rows.  It does not derive them from quotation
-- columns, so a 9-day-old last_activity_at is not enough on its own.
-- ('delivery_slippage' is D2's, in 06-orders.sql — it needs an order first.)
INSERT INTO deal_alert (quotation_id, kind, detail, flagged_at, created_at) VALUES
 ((SELECT id FROM quotation WHERE number='Q-1019'), 'stalled',          'Idle 9 days',              CURRENT_DATE - 1, now()-interval '1 day'),
 ((SELECT id FROM quotation WHERE number='Q-1021'), 'discount_anomaly', 'Discount 22% vs avg 8%',   CURRENT_DATE - 1, now()-interval '1 day');

-- ══════════════════════════════════════════════════════════════════
-- ROLLUP + RISK SCORE — the reference implementation of lib/risk.ts
-- ══════════════════════════════════════════════════════════════════
-- The blended score (PS §10) is the GREATER of:
--   • the worst single line's over_by_pct, and
--   • the value-weighted average over_by_pct across the order
-- so neither one badly-over line nor many slightly-over lines can hide.
--
-- The band, and whether manager/finance are required, come from
-- approval_policy — NEVER from a threshold written into code.
WITH agg AS (
  SELECT l.quotation_id,
         SUM(l.qty * l.unit_price)                       AS subtotal,
         SUM(l.qty * l.unit_price) - SUM(l.net_amount)   AS discount_total,
         ROUND(SUM(l.net_amount * l.tax_pct / 100.0), 2) AS tax_total,
         SUM(l.net_amount)                               AS net_total,
         SUM(l.margin_amount)                            AS margin_total,
         GREATEST(
           COALESCE(MAX(l.over_by_pct), 0),
           COALESCE(SUM(l.over_by_pct * l.net_amount) / NULLIF(SUM(l.net_amount), 0), 0)
         )::numeric(6,2)                                 AS risk_score
  FROM quotation_line l
  GROUP BY l.quotation_id
)
UPDATE quotation q
   SET subtotal         = a.subtotal,
       discount_total   = a.discount_total,
       tax_total        = a.tax_total,
       grand_total      = a.net_total + a.tax_total,
       margin_total     = a.margin_total,
       risk_score       = a.risk_score,
       risk_band        = p.band,
       requires_manager = p.requires_manager,
       requires_finance = p.requires_finance
  FROM agg a
  JOIN approval_policy p
    ON a.risk_score BETWEEN p.score_from AND p.score_to
 WHERE q.id = a.quotation_id;

COMMIT;
