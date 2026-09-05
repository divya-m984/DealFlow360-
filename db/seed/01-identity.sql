-- OWNER: Integrator (content from D4).
-- Currencies, tiers, teams, customers, users.
-- All demo passwords are: demo1234
BEGIN;

INSERT INTO currency (code, symbol, name, minor_unit) VALUES
  ('INR', '₹', 'Indian Rupee', 2),
  ('USD', '$', 'US Dollar', 2),
  ('EUR', '€', 'Euro', 2);

-- PS §A3: Bronze 5, Silver 10, Gold 15
INSERT INTO customer_tier (code, name, max_discount_pct, sort_order) VALUES
  ('bronze', 'Bronze', 5.00,  1),
  ('silver', 'Silver', 10.00, 2),
  ('gold',   'Gold',   15.00, 3);

INSERT INTO customer (name, tier_id, currency_code, email) VALUES
  ('Acme Corp',      (SELECT id FROM customer_tier WHERE code='gold'),   'INR', 'ap@acme.example'),
  ('Beta Industries',(SELECT id FROM customer_tier WHERE code='silver'), 'INR', 'ap@beta.example'),
  ('Zenith Co',      (SELECT id FROM customer_tier WHERE code='gold'),   'INR', 'ap@zenith.example'),
  ('Delta LLC',      (SELECT id FROM customer_tier WHERE code='bronze'), 'INR', 'ap@delta.example');

-- password for every user below is 'demo1234'
INSERT INTO app_user (email, password_hash, full_name, role, customer_id) VALUES
  ('rep@dealflow.app',     '$2b$10$2cmDTQRWIK5jZzQ5lJHXKOGoNRDcypW0hNkSnnqrnnCY2Q8DzU5vO', 'A. Rao',    'sales_rep',     NULL),
  ('manager@dealflow.app', '$2b$10$2cmDTQRWIK5jZzQ5lJHXKOGoNRDcypW0hNkSnnqrnnCY2Q8DzU5vO', 'M. Shah',   'sales_manager', NULL),
  ('finance@dealflow.app', '$2b$10$2cmDTQRWIK5jZzQ5lJHXKOGoNRDcypW0hNkSnnqrnnCY2Q8DzU5vO', 'S. Iyer',   'finance',       NULL),
  ('admin@dealflow.app',   '$2b$10$2cmDTQRWIK5jZzQ5lJHXKOGoNRDcypW0hNkSnnqrnnCY2Q8DzU5vO', 'Admin',     'admin',         NULL);

-- portal user: buyer at Acme Corp
INSERT INTO app_user (email, password_hash, full_name, role, customer_id) VALUES
  ('buyer@acme.example', '$2b$10$2cmDTQRWIK5jZzQ5lJHXKOGoNRDcypW0hNkSnnqrnnCY2Q8DzU5vO', 'R. Menon', 'portal',
   (SELECT id FROM customer WHERE name='Acme Corp'));

INSERT INTO sales_team (code, name, manager_user_id) VALUES
  ('west', 'West Region', (SELECT id FROM app_user WHERE email='manager@dealflow.app')),
  ('east', 'East Region', (SELECT id FROM app_user WHERE email='manager@dealflow.app'));

UPDATE app_user SET team_id = (SELECT id FROM sales_team WHERE code='west')
WHERE email IN ('rep@dealflow.app','manager@dealflow.app');

COMMIT;
