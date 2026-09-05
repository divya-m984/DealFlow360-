-- OWNER: D2.  CLAIMED — new file, additive only.  Runs last.
--
-- Jury review 2, asks 3, 4 and 7 need accounts that did not exist:
-- a genuinely read-only user, and a super admin.  01-identity.sql is the
-- Integrator's, so these are appended here rather than edited into it.
--
-- Password for every account below is `demo1234`, the same as every other
-- seeded login, and the hash is copied verbatim from 01-identity.sql rather
-- than regenerated — bcrypt salts differ per hash, so a fresh one would be
-- equally valid but would look like a different password to anyone diffing
-- the two files.
--
-- ON CONFLICT (email) DO NOTHING: re-running this file is a no-op, and it
-- will not clobber a role someone changed live through the promotion
-- endpoint while demonstrating ask 7.

BEGIN;

INSERT INTO app_user (email, password_hash, full_name, role, customer_id) VALUES
  -- READ-ONLY.  The gap the jury actually pointed at: no existing role was
  -- purely read-only.  sales_rep writes quotations; manager, finance and
  -- admin all have write surfaces.  Because every route in this app is an
  -- ALLOW-LIST, this account starts with zero permissions everywhere and
  -- only sees what a route deliberately opened to it — there is no
  -- deny-list anywhere it could slip past.
  ('viewer@dealflow.app',
   '$2b$10$2cmDTQRWIK5jZzQ5lJHXKOGoNRDcypW0hNkSnnqrnnCY2Q8DzU5vO',
   'Vikram Rao · Auditor', 'viewer', NULL),

  -- THE ONLY ROLE THAT MAY DESTROY DATA.  Deliberately not the same account
  -- as `admin`: admin edits discount ceilings and approval bands every day,
  -- and the role that tunes pricing should not also be the role that can
  -- erase the order book.  See app/api/admin/reset/route.ts.
  ('root@dealflow.app',
   '$2b$10$2cmDTQRWIK5jZzQ5lJHXKOGoNRDcypW0hNkSnnqrnnCY2Q8DzU5vO',
   'Priya Nair · System Owner', 'super_admin', NULL),

  -- A SECOND sales_rep, junior, existing only to be promoted on stage.
  -- Demonstrating ask 7 by promoting the rep who owns the seeded quotations
  -- would change who can approve them mid-demo; this account owns nothing,
  -- so promoting it proves the mechanism without moving the board.
  ('junior@dealflow.app',
   '$2b$10$2cmDTQRWIK5jZzQ5lJHXKOGoNRDcypW0hNkSnnqrnnCY2Q8DzU5vO',
   'Arjun Menon · Associate', 'sales_rep', NULL)
ON CONFLICT (email) DO NOTHING;

-- A super_admin must exist, or app/api/admin/reset is unreachable by anyone
-- and ask 4 cannot be demonstrated at all.  The promotion endpoint refuses
-- to remove the last one; this is the other half of that guarantee — it
-- fails the seed rather than producing a system nobody can administer.
DO $$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM app_user WHERE role = 'super_admin' AND is_active;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'No active super_admin exists — app/api/admin/reset would be unreachable.';
  END IF;
  RAISE NOTICE '08-users.sql: % active super_admin, % viewer, % total users',
    v_n,
    (SELECT count(*) FROM app_user WHERE role = 'viewer'),
    (SELECT count(*) FROM app_user);
END $$;

COMMIT;
