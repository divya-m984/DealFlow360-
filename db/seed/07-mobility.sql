-- OWNER: D2.  CLAIMED — new file, additive only.  db/reset.sh runs
-- db/seed/*.sql in filename order, so this lands AFTER 06-orders.sql and
-- cannot disturb any invariant those files assert: every check in 04 and 06
-- runs to completion before the first row below exists.
--
-- Nothing here EDITS another lane's seed.  02-catalog.sql (Integrator's) is
-- untouched; this file only INSERTs alongside it.  That is deliberate — the
-- alternative was a five-way merge on the one file every lane reads.
--
-- ── WHY THIS FILE EXISTS ─────────────────────────────────────────────
-- Jury review 2 asked for a real many-to-many "bought alongside" relation,
-- with the related product's primary key appearing as a foreign key —
-- their example was a phone carrying its cover and power bank.
--
-- That relation ALREADY EXISTS: `upsell_rule` is a textbook junction table —
-- trigger_product_id and suggested_product_id are both FKs to product(id),
-- UNIQUE(trigger, suggested) makes the pair the real key, and a CHECK forbids
-- self-reference.  What was missing was a catalogue that made it *legible*:
-- laptop → docking station reads as an accessory only if you already know the
-- domain.  Phone → case → power bank reads as one to anybody.  So this file
-- seeds the judge's own example rather than arguing that ours was equivalent.
--
-- Odoo models the same idea as product.template.accessory_product_ids (a
-- many2many through the relation table product_accessory_rel) for cross-sell
-- and alternative_product_ids for upsell.  `upsell_rule.kind` collapses both
-- into one table and adds the margin guard Odoo's version does not have.
--
-- ── PROVENANCE — READ BEFORE QUOTING A NUMBER ────────────────────────
-- Every price below is a PLAUSIBLE 2026 INDIAN STREET ESTIMATE, not a
-- scraped or verified figure.  Model names are real; the rupee values are
-- ours.  Say "representative" if a judge asks, never "market data" —
-- 02-catalog.sql separates its three verified prices from its eight
-- estimates for exactly this reason, and this file is all estimates.
--
-- TAX IS NOT ESTIMATED.  GST 2.0 (effective 22 Sept 2025) collapsed the
-- slabs to 0/5/18/40 and abolished 12% and 28%.  Every HSN below sits at
-- 18%: phones 8517, cases 4202, power banks 8507, earphones 8518,
-- chargers 8504, screen protectors 3919.

BEGIN;

-- ── A FOURTH CATEGORY, WITH A DELIBERATELY TIGHTER CEILING ───────────
-- Hardware allows 15%.  Mobility allows 8%.  That gap is the point: a Gold
-- customer whose TIER ceiling is higher still cannot discount a phone past
-- 8, because effective_ceiling_pct() takes LEAST(tier, category).  Before
-- this row the two ceilings never disagreed on a real order, so the LEAST()
-- was untested by anything a judge could click.
INSERT INTO product_category (code, name, max_discount_pct) VALUES
  ('mobility', 'Mobility', 8.00)
ON CONFLICT (code) DO NOTHING;

-- ── PRODUCTS ────────────────────────────────────────────────────────
-- cost is a margin ASSUMPTION in every row, as in 02-catalog.sql.  The
-- margins are load-bearing: upsell_rule.min_margin_pct below is checked
-- against them, and a rule whose threshold sits above its suggested
-- product's real margin silently never fires.  Margins, computed:
--   CASE-A56 50.0 · SCRNGD 60.1 · CHRG65 40.0 · PWRBNK 35.0 · EARBUD 35.0
--   PH-A56   20.0 · PH-P9A   17.0 · PH-I16E 15.0 · PH-S25U 15.0
--   LP15HP   20.0 · LP13MB   15.0
INSERT INTO product (sku, name, category_id, base_price, cost, currency_code, unit, tax_pct, description, is_subscription, recurring_cycle) VALUES
  -- PHONES · HSN 8517, 18%
  ('PH-A56',  'Samsung Galaxy A56 5G · 8/256GB',
              (SELECT id FROM product_category WHERE code='mobility'),  34999.0000,  27999.0000, 'INR', 'Each', 18.00,
              'HSN 8517 · 6.7" AMOLED 120Hz, Exynos 1580, 5000mAh — the volume handset',                      false, NULL),
  ('PH-P9A',  'Google Pixel 9a · 8/128GB',
              (SELECT id FROM product_category WHERE code='mobility'),  49999.0000,  41499.0000, 'INR', 'Each', 18.00,
              'HSN 8517 · Tensor G4, 7 years of OS updates — the fleet-longevity option',                     false, NULL),
  ('PH-I16E', 'Apple iPhone 16e · 128GB',
              (SELECT id FROM product_category WHERE code='mobility'),  59900.0000,  50900.0000, 'INR', 'Each', 18.00,
              'HSN 8517 · A18, USB-C — thin margin, high pull-through on accessories',                        false, NULL),
  ('PH-S25U', 'Samsung Galaxy S25 Ultra · 12/512GB',
              (SELECT id FROM product_category WHERE code='mobility'), 109999.0000,  93499.0000, 'INR', 'Each', 18.00,
              'HSN 8517 · the trade-up target for PH-A56 — deliberately scarce in stock',                     false, NULL),

  -- PHONE ACCESSORIES · the judge's "bought alongside" set
  ('CASE-A56','Rugged Case · Galaxy A56',
              (SELECT id FROM product_category WHERE code='mobility'),   1299.0000,    649.0000, 'INR', 'Each', 18.00,
              'HSN 4202 · MIL-STD-810H drop rated, model-specific fit',                                       false, NULL),
  ('SCRNGD',  'Tempered Glass Screen Guard · universal 6.1-6.9"',
              (SELECT id FROM product_category WHERE code='mobility'),    699.0000,    279.0000, 'INR', 'Each', 18.00,
              'HSN 3919 · 9H, oleophobic — highest-margin line in the catalogue',                             false, NULL),
  ('PWRBNK',  'Power Bank · 20000mAh 65W PD',
              (SELECT id FROM product_category WHERE code='mobility'),   2499.0000,   1624.0000, 'INR', 'Each', 18.00,
              'HSN 8507 · dual USB-C PD, airline-safe 74Wh',                                                  false, NULL),
  ('EARBUD',  'Wireless Earbuds · ANC',
              (SELECT id FROM product_category WHERE code='mobility'),   4999.0000,   3249.0000, 'INR', 'Each', 18.00,
              'HSN 8518 · hybrid ANC, 36h total playback',                                                    false, NULL),
  ('CHRG65',  'GaN Charger · 65W tri-port',
              (SELECT id FROM product_category WHERE code='mobility'),   1899.0000,   1139.0000, 'INR', 'Each', 18.00,
              'HSN 8504 · charges a phone and a laptop from one brick',                                       false, NULL),

  -- TWO MORE LAPTOPS · hardware, HSN 8471, 18% — same as LP14/LP16
  ('LP15HP',  'HP ProBook 450 G11 · i5-1335U 16/512',
              (SELECT id FROM product_category WHERE code='hardware'),  58990.0000,  47190.0000, 'INR', 'Each', 18.00,
              'HSN 8471 · seeded to exactly 70 units network-wide — see the invariant at the foot of this file', false, NULL),
  ('LP13MB',  'Apple MacBook Air 13" M3 · 8/256',
              (SELECT id FROM product_category WHERE code='hardware'),  99900.0000,  84900.0000, 'INR', 'Each', 18.00,
              'HSN 8471 · the premium trade-up from LP16',                                                    false, NULL);

-- ── TIER PRICING FOR THE NEW CATEGORY ───────────────────────────────
-- Smaller steps than hardware's 5/10, because phone margins are 15-20%
-- against hardware's 20-25%.  A Gold customer getting 10% off an iPhone at
-- a 15% margin would leave 5 points to cover shipping, and the allocator
-- alone can spend more than that.  This is the answer to "why is the Gold
-- rate different per category?" — margin, not favouritism.
INSERT INTO pricelist_item (pricelist_id, category_id, rule_type, value) VALUES
  ((SELECT id FROM pricelist WHERE name='Bronze List'), (SELECT id FROM product_category WHERE code='mobility'), 'no_adjustment', 0),
  ((SELECT id FROM pricelist WHERE name='Silver List'), (SELECT id FROM product_category WHERE code='mobility'), 'discount_pct',  3),
  ((SELECT id FROM pricelist WHERE name='Gold List'),   (SELECT id FROM product_category WHERE code='mobility'), 'discount_pct',  6);

COMMIT;

BEGIN;

-- ── THE MANY-TO-MANY THE JURY ASKED FOR ─────────────────────────────
-- Every row below is one edge in a product↔product graph.  Both endpoints
-- are foreign keys to product(id); the pair (trigger, suggested) is the
-- natural key and is UNIQUE; a product cannot suggest itself.  That is the
-- whole of the judge's "phone should have a dedicated relation to the cover
-- and the power bank", expressed relationally instead of as a column list —
-- which is the point worth making out loud: a repeating group of accessory
-- columns on `product` would cap the relationship at however many columns
-- somebody guessed, and would need a schema change to add a third accessory.
--
-- kind='cross_sell'  → bought ALONGSIDE (case, guard, power bank)
-- kind='upsell'      → bought INSTEAD, one tier up (A56 → S25U)
--
-- min_margin_pct is the guard Odoo's accessory_product_ids has no equivalent
-- of: a suggestion is suppressed when the suggested product's own margin is
-- below it, so the engine never pushes a product that is not worth pushing.
-- Every threshold here sits UNDER its target's real margin (listed above) —
-- otherwise the rule would be dead on arrival and nobody would notice.
INSERT INTO upsell_rule (trigger_product_id, suggested_product_id, kind, is_promoted, promo_text, min_margin_pct, rank_score) VALUES
  -- Galaxy A56 · the fully-worked example.  Case and guard are promoted as a
  -- bundle; the power bank and buds rank below them; the S25U is the trade-up.
  ((SELECT id FROM product WHERE sku='PH-A56'),  (SELECT id FROM product WHERE sku='CASE-A56'), 'cross_sell', true,  'Bundle: case + guard 20% off', 40.00, 95.00),
  ((SELECT id FROM product WHERE sku='PH-A56'),  (SELECT id FROM product WHERE sku='SCRNGD'),   'cross_sell', true,  'Bundle: case + guard 20% off', 50.00, 88.00),
  ((SELECT id FROM product WHERE sku='PH-A56'),  (SELECT id FROM product WHERE sku='PWRBNK'),   'cross_sell', false, NULL,                           30.00, 80.00),
  ((SELECT id FROM product WHERE sku='PH-A56'),  (SELECT id FROM product WHERE sku='EARBUD'),   'cross_sell', false, NULL,                           30.00, 72.00),
  ((SELECT id FROM product WHERE sku='PH-A56'),  (SELECT id FROM product WHERE sku='CHRG65'),   'cross_sell', false, NULL,                           35.00, 68.00),
  ((SELECT id FROM product WHERE sku='PH-A56'),  (SELECT id FROM product WHERE sku='PH-S25U'),  'upsell',     false, NULL,                           12.00, 60.00),
  ((SELECT id FROM product WHERE sku='PH-A56'),  (SELECT id FROM product WHERE sku='CARE2'),    'upsell',     false, NULL,                           50.00, 55.00),

  -- Pixel 9a · no model-specific case seeded, so the universal lines only.
  ((SELECT id FROM product WHERE sku='PH-P9A'),  (SELECT id FROM product WHERE sku='SCRNGD'),   'cross_sell', false, NULL,                           50.00, 85.00),
  ((SELECT id FROM product WHERE sku='PH-P9A'),  (SELECT id FROM product WHERE sku='PWRBNK'),   'cross_sell', false, NULL,                           30.00, 78.00),
  ((SELECT id FROM product WHERE sku='PH-P9A'),  (SELECT id FROM product WHERE sku='EARBUD'),   'cross_sell', false, NULL,                           30.00, 70.00),
  ((SELECT id FROM product WHERE sku='PH-P9A'),  (SELECT id FROM product WHERE sku='CHRG65'),   'cross_sell', false, NULL,                           35.00, 62.00),

  -- iPhone 16e · thinnest phone margin in the catalogue (15%), so the
  -- accessory attach is where the deal actually earns.  Ranked accordingly.
  ((SELECT id FROM product WHERE sku='PH-I16E'), (SELECT id FROM product WHERE sku='SCRNGD'),   'cross_sell', true,  'Attach rate driver',           50.00, 92.00),
  ((SELECT id FROM product WHERE sku='PH-I16E'), (SELECT id FROM product WHERE sku='CHRG65'),   'cross_sell', true,  'No charger in the box',        35.00, 90.00),
  ((SELECT id FROM product WHERE sku='PH-I16E'), (SELECT id FROM product WHERE sku='EARBUD'),   'cross_sell', false, NULL,                           30.00, 74.00),
  ((SELECT id FROM product WHERE sku='PH-I16E'), (SELECT id FROM product WHERE sku='PWRBNK'),   'cross_sell', false, NULL,                           30.00, 66.00),
  ((SELECT id FROM product WHERE sku='PH-I16E'), (SELECT id FROM product WHERE sku='CARE2'),    'upsell',     false, NULL,                           50.00, 58.00),

  -- S25U · already the top of the range, so no upsell edge out of it.
  ((SELECT id FROM product WHERE sku='PH-S25U'), (SELECT id FROM product WHERE sku='EARBUD'),   'cross_sell', false, NULL,                           30.00, 76.00),
  ((SELECT id FROM product WHERE sku='PH-S25U'), (SELECT id FROM product WHERE sku='PWRBNK'),   'cross_sell', false, NULL,                           30.00, 64.00),
  ((SELECT id FROM product WHERE sku='PH-S25U'), (SELECT id FROM product WHERE sku='CARE2'),    'upsell',     false, NULL,                           50.00, 82.00),

  -- The two new laptops reuse the existing hardware accessories, which is
  -- the cheapest possible proof that the relation is general and not a
  -- special case bolted on for phones.
  ((SELECT id FROM product WHERE sku='LP15HP'),  (SELECT id FROM product WHERE sku='DOCK'),     'cross_sell', false, NULL,                           20.00, 86.00),
  ((SELECT id FROM product WHERE sku='LP15HP'),  (SELECT id FROM product WHERE sku='MOUSE'),    'cross_sell', false, NULL,                           30.00, 50.00),
  ((SELECT id FROM product WHERE sku='LP15HP'),  (SELECT id FROM product WHERE sku='KBD'),      'cross_sell', false, NULL,                           25.00, 46.00),
  ((SELECT id FROM product WHERE sku='LP15HP'),  (SELECT id FROM product WHERE sku='SETUP'),    'cross_sell', false, NULL,                            8.00, 42.00),
  ((SELECT id FROM product WHERE sku='LP15HP'),  (SELECT id FROM product WHERE sku='LP13MB'),   'upsell',     false, NULL,                           12.00, 55.00),
  ((SELECT id FROM product WHERE sku='LP13MB'),  (SELECT id FROM product WHERE sku='DOCK'),     'cross_sell', false, NULL,                           20.00, 84.00),
  ((SELECT id FROM product WHERE sku='LP13MB'),  (SELECT id FROM product WHERE sku='CHRG65'),   'cross_sell', false, NULL,                           35.00, 70.00),
  ((SELECT id FROM product WHERE sku='LP13MB'),  (SELECT id FROM product WHERE sku='CARE2'),    'upsell',     false, NULL,                           50.00, 60.00)
ON CONFLICT (trigger_product_id, suggested_product_id) DO NOTHING;

COMMIT;

BEGIN;

-- ── STOCK FOR THE NEW LINES ─────────────────────────────────────────
-- Same declarative-matrix + skip-loop shape as 04-stock.sql: a pair whose
-- warehouse or product does not exist is COUNTED AND REPORTED rather than
-- aborting the seed or, worse, silently inserting nothing.  That pattern is
-- what surfaced the "6 stock rows created, 19 skipped" line which turned out
-- to be the whole of the "the new database isn't visible" bug.
DO $$
DECLARE
  v_row     record;
  v_wh      bigint;
  v_prod    bigint;
  v_made    int := 0;
  v_skipped int := 0;
  v_missing text[] := '{}';
BEGIN
  FOR v_row IN
    SELECT * FROM (VALUES
      -- (warehouse, sku, on_hand, reorder_point, reorder_qty)
      -- LP15HP totals EXACTLY 70 across the network.  That is not decoration:
      -- it is the jury's own worked example — "the shop has only 70 laptops
      -- but they get an order for 100" — seeded so the partial-fulfilment
      -- and partial-invoice path can be demonstrated on real rows instead of
      -- described.  The invariant at the foot of this file fails the seed if
      -- anyone retunes it without noticing.
      ('MAIN','LP15HP',   30, 10, 25), ('PNQ','LP15HP',   20,  8, 20),
      ('EAST','LP15HP',   12,  5, 15), ('HSR','LP15HP',    8,  4, 12),

      ('MAIN','LP13MB',    9,  4, 10), ('PNQ','LP13MB',    5,  3,  8),

      ('MAIN','PH-A56',   45, 15, 40), ('PNQ','PH-A56',   30, 12, 30),
      ('EAST','PH-A56',   25, 10, 25), ('HSR','PH-A56',   20,  8, 20),
      ('GAU','PH-A56',    10,  5, 15),

      ('MAIN','PH-P9A',   22, 10, 25), ('PNQ','PH-P9A',   14,  6, 15),
      ('HSR','PH-P9A',     9,  4, 12),

      ('MAIN','PH-I16E',  16,  8, 20), ('PNQ','PH-I16E',  10,  5, 15),
      ('EAST','PH-I16E',   6,  3, 10),

      -- Flagship kept deliberately scarce: 9 units network-wide, so an
      -- upsell from A56 to S25U on any real quantity goes to backorder.
      ('MAIN','PH-S25U',   6,  3,  8), ('PNQ','PH-S25U',   3,  2,  6),

      ('MAIN','CASE-A56',120, 40,100), ('PNQ','CASE-A56', 80, 30, 80),
      ('EAST','CASE-A56', 60, 25, 60), ('HSR','CASE-A56', 50, 20, 50),
      ('GAU','CASE-A56',  25, 10, 30),

      ('MAIN','SCRNGD',  200, 60,150), ('PNQ','SCRNGD',  140, 50,120),
      ('EAST','SCRNGD',  100, 40,100), ('HSR','SCRNGD',   80, 30, 80),
      ('GAU','SCRNGD',    40, 15, 40),

      ('MAIN','PWRBNK',   90, 30, 75), ('PNQ','PWRBNK',   55, 20, 50),
      ('EAST','PWRBNK',   40, 15, 40), ('HSR','PWRBNK',   35, 15, 35),

      ('MAIN','EARBUD',   60, 20, 50), ('PNQ','EARBUD',   40, 15, 40),
      ('EAST','EARBUD',   30, 12, 30), ('HSR','EARBUD',   20, 10, 25),
      ('GAU','EARBUD',    12,  6, 15),

      ('MAIN','CHRG65',   75, 25, 60), ('PNQ','CHRG65',   50, 20, 50),
      ('EAST','CHRG65',   35, 15, 35)
    ) AS t(wh, sku, on_hand, rp, rq)
  LOOP
    SELECT id INTO v_wh   FROM warehouse WHERE code = v_row.wh;
    SELECT id INTO v_prod FROM product   WHERE sku  = v_row.sku;
    IF v_wh IS NULL OR v_prod IS NULL THEN
      v_skipped := v_skipped + 1;
      v_missing := v_missing || (v_row.wh || '/' || v_row.sku);
      CONTINUE;
    END IF;

    INSERT INTO stock_level (warehouse_id, product_id, variant_id, qty_on_hand, reorder_point, reorder_qty)
    VALUES (v_wh, v_prod, NULL, v_row.on_hand, v_row.rp, v_row.rq)
    ON CONFLICT (warehouse_id, product_id, variant_id) DO NOTHING;
    v_made := v_made + 1;
  END LOOP;

  RAISE NOTICE '07-mobility.sql: % stock row(s) created, % skipped%',
    v_made, v_skipped,
    CASE WHEN v_skipped > 0 THEN ' — missing: ' || array_to_string(v_missing, ', ') ELSE '' END;
END $$;

-- ── SELF-CHECKING INVARIANTS ────────────────────────────────────────
-- A seed that quietly stops demonstrating what it was written to demonstrate
-- is worse than one that fails loudly, because nobody finds out until the
-- demo.  Both checks below RAISE rather than warn.

-- (1) The jury's 70-of-100 case.  If this drifts, the partial-fulfilment
--     demo silently becomes an ordinary fully-satisfiable order.
DO $$
DECLARE v_total numeric;
BEGIN
  SELECT COALESCE(sum(s.qty_available), 0) INTO v_total
    FROM stock_level s JOIN product p ON p.id = s.product_id
   WHERE p.sku = 'LP15HP';
  IF v_total <> 70 THEN
    RAISE EXCEPTION
      'LP15HP network stock is %, expected exactly 70 — the partial-fulfilment demo (order 100, ship 70, backorder 30) depends on this number.', v_total;
  END IF;
END $$;

-- (2) Every upsell rule must be able to fire.  A rule whose min_margin_pct
--     sits above its suggested product's real margin is dead on arrival and
--     looks identical to a working one from the UI.
DO $$
DECLARE v_dead int;
BEGIN
  SELECT count(*) INTO v_dead
    FROM upsell_rule u
    JOIN product p ON p.id = u.suggested_product_id
   WHERE p.base_price > 0
     AND u.min_margin_pct > round((p.base_price - p.cost) / p.base_price * 100, 2);
  IF v_dead > 0 THEN
    RAISE EXCEPTION
      '% upsell rule(s) can never fire — min_margin_pct exceeds the suggested product''s actual margin.', v_dead;
  END IF;
END $$;

COMMIT;
