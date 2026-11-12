-- QA teardown #2 (remote-D1 safe: no TEMP tables, no subselect into temp).
PRAGMA foreign_keys = OFF;

DELETE FROM order_items WHERE order_id IN (
  SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id
   WHERE u.username LIKE 'qts%' OR u.username LIKE 'qr%'
      OR u.username LIKE 'qsec%' OR u.username = 'qr31i3w');

DELETE FROM license_issues WHERE user_id IN (
  SELECT id FROM users WHERE username LIKE 'qts%' OR username LIKE 'qr%'
     OR username LIKE 'qsec%' OR username = 'qr31i3w');

DELETE FROM refund_ledger WHERE order_id IN (
  SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id
   WHERE u.username LIKE 'qts%' OR u.username LIKE 'qr%'
      OR u.username LIKE 'qsec%' OR u.username = 'qr31i3w');

DELETE FROM payments WHERE order_id IN (
  SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id
   WHERE u.username LIKE 'qts%' OR u.username LIKE 'qr%'
      OR u.username LIKE 'qsec%' OR u.username = 'qr31i3w');

DELETE FROM payments WHERE txn_ref LIKE 'QATS%';

DELETE FROM orders WHERE user_id IN (
  SELECT id FROM users WHERE username LIKE 'qts%' OR username LIKE 'qr%'
     OR username LIKE 'qsec%' OR username = 'qr31i3w');

DELETE FROM trial_quota WHERE user_id IN (
  SELECT id FROM users WHERE username LIKE 'qts%' OR username LIKE 'qr%'
     OR username LIKE 'qsec%' OR username = 'qr31i3w');

DELETE FROM trial_uses WHERE user_id IN (
  SELECT id FROM users WHERE username LIKE 'qts%' OR username LIKE 'qr%'
     OR username LIKE 'qsec%' OR username = 'qr31i3w');

DELETE FROM trial_whitelist WHERE scope = 'user' AND value IN (
  SELECT username FROM users WHERE username LIKE 'qts%' OR username LIKE 'qr%'
     OR username LIKE 'qsec%' OR username = 'qr31i3w');

DELETE FROM sessions WHERE user_id IN (
  SELECT id FROM users WHERE username LIKE 'qts%' OR username LIKE 'qr%'
     OR username LIKE 'qsec%' OR username = 'qr31i3w');

DELETE FROM users WHERE username LIKE 'qts%' OR username LIKE 'qr%'
   OR username LIKE 'qsec%' OR username = 'qr31i3w';

DELETE FROM licenses WHERE note LIKE 'QA %';
DELETE FROM product_keys WHERE product_id IN (
  SELECT id FROM products WHERE slug LIKE 'p-qa-%');
DELETE FROM products WHERE slug LIKE 'p-qa-%';
