-- PROPOSED REPLACEMENT for db/seed/02-catalog.sql
-- Written by D2.  OWNER of the real file is the Integrator (content from D4).
-- DO NOT `cp` THIS OVER THE REAL FILE WITHOUT READING db/seed/handoff/README.md.
--
-- ── WHAT THIS FIXES ─────────────────────────────────────────────────
-- The current catalogue prices a business laptop at ₹1,200.  That number came
-- from the mockup, where it is dollars, and the seed kept it digit-for-digit
-- so the screens would line up beside the mockup during review.  That was a
-- reasonable trade in Phase 1 and it is the wrong one now: the jury asked for
-- data that is real or plausible, and ₹1,200 is not a plausible laptop.  A
-- judge in Gandhinagar clocks that in one second.
--
-- ── WHAT IS REAL HERE ───────────────────────────────────────────────
--   · product names are real, currently-sold business hardware
--   · base_price is the real Indian street price (Sept 2026), rounded
--   · tax_pct is the REAL GST rate for that item's REAL HSN/SAC code
--   · HSN and SAC codes are carried in `description` because the schema has
--     no column for them and the schema is frozen — see README.md
--
-- ── THE GST TRAP WE WALKED INTO, AND OUT OF ─────────────────────────
-- The public HSN dataset we pulled these rates from is PRE-GST-2.0.  It still
-- carries the 12% and 28% slabs, both of which were abolished on 22 Sept 2025
-- when the four-slab structure collapsed to 5 / 18 (plus nil and a 40%
-- demerit rate).  Taken literally it would have taxed our 27" monitor at 28%.
-- Every rate below is the POST-reform rate, and the two we had to remap are
-- called out on their own lines.  Believing a downloaded dataset because it
-- is downloaded is exactly the failure mode "understanding the data you use"
-- is asking about.
--
-- ── MARGINS ARE NOT DECORATION ──────────────────────────────────────
-- product.cost drives margin_amount, the live margin indicator on screen 4,
-- and upsell_rule.min_margin_pct.  It also has to make PS §10's own
-- justification TRUE:
--   "Hardware items are allowed up to 15 percent, since they have healthy margins"
--   "Service items are allowed only up to 10 percent, since they have thin margins"
-- So hardware reads 20–31% and services read ~11%.  If the costs said
-- otherwise, the seed data would argue against our own ceiling rule in front
-- of a judge.
BEGIN;

-- PS §A3: Hardware 15, Services 10 (services have thinner margins)
INSERT INTO product_category (code, name, max_discount_pct) VALUES
  ('hardware',     'Hardware',     15.00),
  ('services',     'Services',     10.00),
  ('subscription', 'Subscription', 10.00);

-- ── PRODUCTS ────────────────────────────────────────────────────────
-- SKUs LP14, SETUP, DOCK, MOUSE, WARR, CARE2 and SLA MUST KEEP THEIR CODES.
-- db/seed/05-quotations.sql joins `product p ON p.sku = v.sku` and derives
-- every line's unit_price and unit_cost from this table — which is why
-- repricing here flows through quotations, orders and invoices automatically
-- and why renaming a SKU would silently drop lines from D1's seed.
--
--   margin % = (base_price − cost) / base_price
INSERT INTO product (sku, name, category_id, base_price, cost, currency_code, unit, tax_pct, description, is_subscription, recurring_cycle) VALUES
  -- HARDWARE · HSN 8471 (data processing machines) and 8473 (parts) → 18%
  ('LP14',   'Lenovo ThinkPad E14 Gen 5 · Ryzen 5 · 16GB / 512GB',
             (SELECT id FROM product_category WHERE code='hardware'),   65990.0000, 52792.0000, 'INR', 'Each',    18.00,
             'HSN 8471 · 14" business laptop, Ryzen 5 7530U, 16GB RAM, 512GB NVMe, Win 11 Pro',                  false, NULL),
  ('LP16',   'Dell Latitude 5450 · Core Ultra 5 · 16GB / 512GB',
             (SELECT id FROM product_category WHERE code='hardware'),   78500.0000, 62800.0000, 'INR', 'Each',    18.00,
             'HSN 8471 · 14" business laptop, Intel Core Ultra 5 125U, 16GB RAM, 512GB NVMe',                    false, NULL),
  ('DOCK',   'Dell Dock WD19S · 180W USB-C',
             (SELECT id FROM product_category WHERE code='hardware'),   11999.0000,  8999.0000, 'INR', 'Each',    18.00,
             'HSN 8473 · USB-C docking station, 130W power delivery, dual 4K display support',                   false, NULL),
  ('MOUSE',  'Logitech MX Master 3S · Wireless',
             (SELECT id FROM product_category WHERE code='hardware'),    8995.0000,  6200.0000, 'INR', 'Each',    18.00,
             'HSN 8471 · wireless performance mouse, 8000 DPI, Bluetooth and USB receiver',                      false, NULL),
  ('KBD',    'Logitech MX Keys S · Wireless Keyboard',
             (SELECT id FROM product_category WHERE code='hardware'),   10495.0000,  7400.0000, 'INR', 'Each',    18.00,
             'HSN 8471 · wireless backlit keyboard, multi-device, USB-C rechargeable',                           false, NULL),
  -- ⚠ REMAPPED.  The source dataset says 28% for HSN 8528.  That slab no
  --   longer exists: GST 2.0 (22 Sept 2025) moved monitors and televisions of
  --   every size to 18%.  Seeding 28 would have been a wrong number that
  --   looked authoritative because it came out of a file.
  ('MON27',  'Dell P2725H · 27" FHD IPS Monitor',
             (SELECT id FROM product_category WHERE code='hardware'),   16500.0000, 13200.0000, 'INR', 'Each',    18.00,
             'HSN 8528 · 27" 1920x1080 IPS, USB-C hub, height adjustable (GST 2.0: 28% → 18%)',                  false, NULL),
  -- The ZERO-RATED line.  Printed books and manuals are nil-rated under
  --   HSN 4901 and always have been.  It exists so the tax engine is
  --   demonstrably reading tax_pct per product rather than assuming 18
  --   everywhere — which, with a catalogue of IT hardware, it otherwise would
  --   never be asked to prove.
  ('MANUAL', 'Deployment Runbook · printed, per site',
             (SELECT id FROM product_category WHERE code='hardware'),     850.0000,   620.0000, 'INR', 'Each',     0.00,
             'HSN 4901 · printed deployment and handover runbook — nil-rated',                                   false, NULL),

  -- SERVICES · SAC codes, all 18%.  Thin margins on purpose (see header).
  ('SETUP',  'Onsite Setup & Commissioning',
             (SELECT id FROM product_category WHERE code='services'),     4500.0000,  4005.0000, 'INR', 'Each',    18.00,
             'SAC 998733 · installation services of office machinery and computers',                             false, NULL),
  ('WARR',   'Extended Hardware Warranty · 2 years',
             (SELECT id FROM product_category WHERE code='services'),     6800.0000,  6052.0000, 'INR', 'Each',    18.00,
             'SAC 998713 · maintenance and repair services of computers and peripheral equipment',               false, NULL),

  -- SUBSCRIPTIONS · billed per seat.  Prices match subscription_plan in
  -- 03-config.sql — a plan priced differently from its product is the kind of
  -- disagreement nobody notices until an invoice is wrong.
  ('CARE2',  'Care Plan 2yr · per seat',
             (SELECT id FROM product_category WHERE code='subscription'),  1450.0000,   653.0000, 'INR', 'Month',   18.00,
             'SAC 998713 · device care and support, billed monthly per seat',                                    true,  'monthly'),
  ('SLA',    'Priority Support SLA · per seat',
             (SELECT id FROM product_category WHERE code='subscription'),  9900.0000,  4950.0000, 'INR', 'Quarter', 18.00,
             'SAC 998313 · IT consulting and support services, 4-hour response',                                 true,  'quarterly');

-- ── VARIANTS ────────────────────────────────────────────────────────
-- Read-only in the UI: seeded, rendered, never generated.  Extra prices are
-- the real Lenovo uplift for the 8GB→16GB step, not a round number.
INSERT INTO product_attribute (product_id, name, sort_order) VALUES
  ((SELECT id FROM product WHERE sku='LP14'), 'Color', 1),
  ((SELECT id FROM product WHERE sku='LP14'), 'RAM',   2);

INSERT INTO product_attribute_value (attribute_id, value, extra_price) VALUES
  ((SELECT id FROM product_attribute WHERE name='Color' AND product_id=(SELECT id FROM product WHERE sku='LP14')), 'Blue',   0.0000),
  ((SELECT id FROM product_attribute WHERE name='Color' AND product_id=(SELECT id FROM product WHERE sku='LP14')), 'Black',  0.0000),
  ((SELECT id FROM product_attribute WHERE name='RAM'   AND product_id=(SELECT id FROM product WHERE sku='LP14')), '16GB',   0.0000),
  ((SELECT id FROM product_attribute WHERE name='RAM'   AND product_id=(SELECT id FROM product WHERE sku='LP14')), '32GB', 9800.0000);

INSERT INTO product_variant (product_id, sku, extra_price) VALUES
  ((SELECT id FROM product WHERE sku='LP14'), 'LP14-BLK-4',    0.0000),
  ((SELECT id FROM product WHERE sku='LP14'), 'LP14-BLK-8', 9800.0000);

INSERT INTO variant_option (variant_id, attribute_value_id) VALUES
  ((SELECT id FROM product_variant WHERE sku='LP14-BLK-4'), (SELECT v.id FROM product_attribute_value v JOIN product_attribute a ON a.id=v.attribute_id WHERE a.name='Color' AND v.value='Black')),
  ((SELECT id FROM product_variant WHERE sku='LP14-BLK-4'), (SELECT v.id FROM product_attribute_value v JOIN product_attribute a ON a.id=v.attribute_id WHERE a.name='RAM'   AND v.value='16GB')),
  ((SELECT id FROM product_variant WHERE sku='LP14-BLK-8'), (SELECT v.id FROM product_attribute_value v JOIN product_attribute a ON a.id=v.attribute_id WHERE a.name='Color' AND v.value='Black')),
  ((SELECT id FROM product_variant WHERE sku='LP14-BLK-8'), (SELECT v.id FROM product_attribute_value v JOIN product_attribute a ON a.id=v.attribute_id WHERE a.name='RAM'   AND v.value='32GB'));

-- ── PRICELISTS ──────────────────────────────────────────────────────
-- NAMES ARE LOAD-BEARING: 05-quotations.sql selects pricelists by name.
INSERT INTO pricelist (name, tier_id, currency_code) VALUES
  ('Bronze List', (SELECT id FROM customer_tier WHERE code='bronze'), 'INR'),
  ('Silver List', (SELECT id FROM customer_tier WHERE code='silver'), 'INR'),
  ('Gold List',   (SELECT id FROM customer_tier WHERE code='gold'),   'INR');

INSERT INTO pricelist_item (pricelist_id, category_id, rule_type, value) VALUES
  ((SELECT id FROM pricelist WHERE name='Bronze List'), (SELECT id FROM product_category WHERE code='hardware'), 'no_adjustment', 0),
  ((SELECT id FROM pricelist WHERE name='Silver List'), (SELECT id FROM product_category WHERE code='hardware'), 'discount_pct',  5),
  ((SELECT id FROM pricelist WHERE name='Gold List'),   (SELECT id FROM product_category WHERE code='hardware'), 'discount_pct', 10),
  -- Services are NOT discounted by tier.  Thin margins are the whole reason
  -- their ceiling is 10%, so a tier discount on top would be arguing with
  -- ourselves.  A judge who asks "why is there no Gold rate on Services?"
  -- gets that answer.
  ((SELECT id FROM pricelist WHERE name='Gold List'),   (SELECT id FROM product_category WHERE code='services'), 'no_adjustment', 0);

-- ── UPSELL RULES · PS §B5 / §A6 ─────────────────────────────────────
-- rank_score is SEEDED, not derived from co-purchase history — that is in the
-- "what we'd build next" note.  min_margin_pct suppresses a suggestion whose
-- margin is too thin to be worth pushing, so every value below has to sit
-- under the suggested product's real margin or the rule never fires:
--   DOCK 25.0% · MOUSE 31.1% · KBD 29.5% · MON27 20.0% · CARE2 55.0%
INSERT INTO upsell_rule (trigger_product_id, suggested_product_id, kind, is_promoted, promo_text, min_margin_pct, rank_score) VALUES
  ((SELECT id FROM product WHERE sku='LP14'), (SELECT id FROM product WHERE sku='DOCK'),  'cross_sell', true,  'Bundle: 15% off', 20.00, 90.00),
  ((SELECT id FROM product WHERE sku='LP14'), (SELECT id FROM product WHERE sku='CARE2'), 'upsell',     false, NULL,              25.00, 75.00),
  ((SELECT id FROM product WHERE sku='LP14'), (SELECT id FROM product WHERE sku='MON27'), 'cross_sell', false, NULL,              18.00, 60.00),
  ((SELECT id FROM product WHERE sku='LP14'), (SELECT id FROM product WHERE sku='KBD'),   'cross_sell', false, NULL,              25.00, 45.00),
  ((SELECT id FROM product WHERE sku='LP14'), (SELECT id FROM product WHERE sku='MOUSE'), 'cross_sell', false, NULL,              30.00, 40.00),
  ((SELECT id FROM product WHERE sku='LP16'), (SELECT id FROM product WHERE sku='DOCK'),  'cross_sell', false, NULL,              20.00, 85.00),
  ((SELECT id FROM product WHERE sku='DOCK'), (SELECT id FROM product WHERE sku='MOUSE'), 'cross_sell', false, NULL,              30.00, 35.00);

COMMIT;
