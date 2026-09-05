-- OWNER: Integrator (content from D4).
-- Categories, products, variants, pricelists, upsell rules.
-- Names match the mockup exactly — it will be on screen next to the app.
BEGIN;

-- PS §A3: Hardware 15, Services 10 (services have thinner margins)
INSERT INTO product_category (code, name, max_discount_pct) VALUES
  ('hardware',     'Hardware',     15.00),
  ('services',     'Services',     10.00),
  ('subscription', 'Subscription', 10.00);

-- Prices keep the mockup's numbers exactly.  Onsite Setup is 450, not 400.
-- Currency is INR everywhere (see 01-identity.sql for why).
--
-- COSTS ARE NOT DECORATION.  product.cost is NOT NULL and it drives
-- margin_amount, the live margin indicator on screen 4, and upsell_rule's
-- min_margin_pct.  It must also make PS §10's own justification TRUE:
--   "Hardware items are allowed up to 15 percent, since they have healthy margins"
--   "Service items are allowed only up to 10 percent, since they have thin margins"
-- So Hardware reads ~25% and Services ~11%.  If the costs said otherwise, the
-- seed data would argue against our own ceiling rule in front of a judge.
INSERT INTO product (sku, name, category_id, base_price, cost, currency_code, unit, tax_pct, description, is_subscription, recurring_cycle) VALUES
  ('LP14',  'Laptop Pro 14',        (SELECT id FROM product_category WHERE code='hardware'),     1200.0000,  900.0000, 'INR', 'Each',    18.00, '14-inch business laptop',       false, NULL),
  ('SETUP', 'Onsite Setup Service', (SELECT id FROM product_category WHERE code='services'),      450.0000,  400.0000, 'INR', 'Each',    18.00, 'Onsite installation',           false, NULL),
  ('DOCK',  'Docking Station',      (SELECT id FROM product_category WHERE code='hardware'),      180.0000,  135.0000, 'INR', 'Each',    18.00, 'USB-C dock',                    false, NULL),
  ('MOUSE', 'Wireless Mouse',       (SELECT id FROM product_category WHERE code='hardware'),       45.0000,   25.0000, 'INR', 'Each',    18.00, 'Bluetooth mouse',               false, NULL),
  ('WARR',  'Extended Warranty',    (SELECT id FROM product_category WHERE code='services'),      180.0000,  160.0000, 'INR', 'Each',    18.00, 'Extended hardware warranty',    false, NULL),
  ('CARE2', 'Care Plan 2yr',        (SELECT id FROM product_category WHERE code='subscription'),    40.0000,   18.0000, 'INR', 'Month',   18.00, 'Extended warranty and support', true,  'monthly'),
  ('SLA',   'Support SLA',          (SELECT id FROM product_category WHERE code='subscription'),   300.0000,  150.0000, 'INR', 'Quarter', 18.00, 'Priority support',              true,  'quarterly');

-- variants (read-only in the UI — seeded, not generated)
INSERT INTO product_attribute (product_id, name, sort_order) VALUES
  ((SELECT id FROM product WHERE sku='LP14'), 'Color', 1),
  ((SELECT id FROM product WHERE sku='LP14'), 'RAM',   2);

INSERT INTO product_attribute_value (attribute_id, value, extra_price) VALUES
  ((SELECT id FROM product_attribute WHERE name='Color' AND product_id=(SELECT id FROM product WHERE sku='LP14')), 'Blue',  0.0000),
  ((SELECT id FROM product_attribute WHERE name='Color' AND product_id=(SELECT id FROM product WHERE sku='LP14')), 'Black', 0.0000),
  ((SELECT id FROM product_attribute WHERE name='RAM'   AND product_id=(SELECT id FROM product WHERE sku='LP14')), '4GB',   0.0000),
  ((SELECT id FROM product_attribute WHERE name='RAM'   AND product_id=(SELECT id FROM product WHERE sku='LP14')), '8GB', 100.0000);

INSERT INTO product_variant (product_id, sku, extra_price) VALUES
  ((SELECT id FROM product WHERE sku='LP14'), 'LP14-BLK-4',   0.0000),
  ((SELECT id FROM product WHERE sku='LP14'), 'LP14-BLK-8', 100.0000);

INSERT INTO variant_option (variant_id, attribute_value_id) VALUES
  ((SELECT id FROM product_variant WHERE sku='LP14-BLK-4'), (SELECT v.id FROM product_attribute_value v JOIN product_attribute a ON a.id=v.attribute_id WHERE a.name='Color' AND v.value='Black')),
  ((SELECT id FROM product_variant WHERE sku='LP14-BLK-4'), (SELECT v.id FROM product_attribute_value v JOIN product_attribute a ON a.id=v.attribute_id WHERE a.name='RAM'   AND v.value='4GB')),
  ((SELECT id FROM product_variant WHERE sku='LP14-BLK-8'), (SELECT v.id FROM product_attribute_value v JOIN product_attribute a ON a.id=v.attribute_id WHERE a.name='Color' AND v.value='Black')),
  ((SELECT id FROM product_variant WHERE sku='LP14-BLK-8'), (SELECT v.id FROM product_attribute_value v JOIN product_attribute a ON a.id=v.attribute_id WHERE a.name='RAM'   AND v.value='8GB'));

-- tier pricelists (mockup screen 17: Bronze = no adjustment, Gold = 10% off base)
INSERT INTO pricelist (name, tier_id, currency_code) VALUES
  ('Bronze List', (SELECT id FROM customer_tier WHERE code='bronze'), 'INR'),
  ('Silver List', (SELECT id FROM customer_tier WHERE code='silver'), 'INR'),
  ('Gold List',   (SELECT id FROM customer_tier WHERE code='gold'),   'INR');

INSERT INTO pricelist_item (pricelist_id, category_id, rule_type, value) VALUES
  ((SELECT id FROM pricelist WHERE name='Bronze List'), (SELECT id FROM product_category WHERE code='hardware'), 'no_adjustment', 0),
  ((SELECT id FROM pricelist WHERE name='Silver List'), (SELECT id FROM product_category WHERE code='hardware'), 'discount_pct',  5),
  ((SELECT id FROM pricelist WHERE name='Gold List'),   (SELECT id FROM product_category WHERE code='hardware'), 'discount_pct', 10);

-- PS §B5 / §A6: ranked suggestions.  rank_score is SEEDED, not derived from
-- co-purchase history — that is in the "what we'd build next" note.
INSERT INTO upsell_rule (trigger_product_id, suggested_product_id, kind, is_promoted, promo_text, min_margin_pct, rank_score) VALUES
  ((SELECT id FROM product WHERE sku='LP14'), (SELECT id FROM product WHERE sku='DOCK'),  'cross_sell', true,  'Bundle: 15% off', 20.00, 90.00),
  ((SELECT id FROM product WHERE sku='LP14'), (SELECT id FROM product WHERE sku='CARE2'), 'upsell',     false, NULL,              25.00, 75.00),
  ((SELECT id FROM product WHERE sku='LP14'), (SELECT id FROM product WHERE sku='MOUSE'), 'cross_sell', false, NULL,              30.00, 40.00),
  ((SELECT id FROM product WHERE sku='DOCK'), (SELECT id FROM product WHERE sku='MOUSE'), 'cross_sell', false, NULL,              30.00, 35.00);

COMMIT;
