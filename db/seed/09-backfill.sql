-- OWNER: D2.  CLAIMED — new file, runs last.
--
-- Backfills columns that 00-migrations.sql ADDS to tables other lanes SEED.
-- It cannot live in 00- because 00- runs before the rows exist, and it
-- cannot live in the seed files themselves because those belong to D1 and
-- the Integrator.  Hence a separate, last-running, idempotent pass.
--
-- Every statement is guarded by `IS NULL`, so this is safe to run against a
-- live database that has already been through it, and safe to re-run.

BEGIN;

-- ── negotiation_comment.author_side / author_user_id ─────────────────
-- 05-quotations.sql (D1's) seeds two comments on the Zenith negotiation.
-- They predate the author columns, so they load with author_side NULL —
-- which in a chat UI renders as a message from nobody, aligned to neither
-- side.  Their content is unambiguously the customer's ("Can this be 22%
-- off?", "Can we push the docks to next month?"), and negotiation_request
-- .created_by_user_id on that thread is the Zenith portal login, so both
-- are attributed to the buyer who opened the negotiation.
--
-- Attributing them to the request's creator rather than hardcoding a user id
-- keeps this correct if D1 reseeds a different customer.
UPDATE negotiation_comment nc
   SET author_side    = 'buyer',
       author_user_id = nr.created_by_user_id
  FROM negotiation_request nr
 WHERE nr.id = nc.negotiation_request_id
   AND nc.author_side IS NULL
   AND (SELECT role FROM app_user WHERE id = nr.created_by_user_id) = 'portal';

-- Any remaining orphan (a thread opened by an internal user) is the seller's.
UPDATE negotiation_comment nc
   SET author_side    = 'seller',
       author_user_id = COALESCE(nc.author_user_id, nr.created_by_user_id)
  FROM negotiation_request nr
 WHERE nr.id = nc.negotiation_request_id
   AND nc.author_side IS NULL;

DO $$
DECLARE v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans FROM negotiation_comment WHERE author_side IS NULL;
  IF v_orphans > 0 THEN
    RAISE EXCEPTION
      '% negotiation comment(s) still have no author_side — they would render as a message from nobody.', v_orphans;
  END IF;
  RAISE NOTICE '09-backfill.sql: negotiation authors OK (% buyer, % seller)',
    (SELECT count(*) FROM negotiation_comment WHERE author_side='buyer'),
    (SELECT count(*) FROM negotiation_comment WHERE author_side='seller');
END $$;

-- ── product.invoice_policy ───────────────────────────────────────────
-- 00-migrations.sql adds the column with a 'delivery' default, but it runs
-- BEFORE 02-catalog.sql and 07-mobility.sql, so it cannot set the values —
-- there are no products yet.  This is that second half.
--
-- Keyed on category and is_subscription rather than a SKU list, so it stays
-- correct when anyone adds a product later.  A service or a subscription
-- never ships; billing it on delivery would compute qty_shipped = 0 forever
-- and make it permanently unbillable with no error anywhere.
UPDATE product SET invoice_policy = 'order'
 WHERE invoice_policy <> 'order'
   AND (is_subscription
        OR category_id IN (SELECT id FROM product_category WHERE code IN ('services','subscription')));

DO $$
DECLARE v_bad int;
BEGIN
  SELECT count(*) INTO v_bad FROM product p
   WHERE p.invoice_policy = 'delivery'
     AND (p.is_subscription
          OR p.category_id IN (SELECT id FROM product_category WHERE code IN ('services','subscription')));
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      '% service/subscription product(s) are still invoice_policy=delivery — they would be silently unbillable.', v_bad;
  END IF;
  RAISE NOTICE '09-backfill.sql: invoice_policy OK (% on order, % on delivery)',
    (SELECT count(*) FROM product WHERE invoice_policy='order'),
    (SELECT count(*) FROM product WHERE invoice_policy='delivery');
END $$;

COMMIT;
