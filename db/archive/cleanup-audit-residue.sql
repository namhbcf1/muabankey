-- Dọn rác do chính các agent audit tạo ra
DELETE FROM lic_events WHERE key IN (SELECT key FROM licenses WHERE key LIKE 'AUDT-%');
DELETE FROM license_issues WHERE license_key IN (SELECT key FROM licenses WHERE key LIKE 'AUDT-%');
DELETE FROM licenses WHERE key LIKE 'AUDT-%';

DELETE FROM product_keys WHERE product_id IN (
  SELECT id FROM products WHERE name LIKE 'AUDIT TEST%'
);
DELETE FROM order_items WHERE product_id IN (
  SELECT id FROM products WHERE name LIKE 'AUDIT TEST%'
);
DELETE FROM products WHERE name LIKE 'AUDIT TEST%';

DELETE FROM wallet_transactions WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' AND email LIKE 'audit-test%'
);
DELETE FROM order_items WHERE order_id IN (
  SELECT o.id FROM orders o JOIN users u ON u.id=o.user_id
  WHERE u.email LIKE '%@example.com' AND u.email LIKE 'audit-test%'
);
DELETE FROM orders WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' AND email LIKE 'audit-test%'
);
DELETE FROM sessions WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@example.com' AND email LIKE 'audit-test%'
);
DELETE FROM users WHERE email LIKE '%@example.com' AND email LIKE 'audit-test%';

-- Đồng bộ lại
UPDATE products
SET stock_count = (SELECT COUNT(*) FROM product_keys k WHERE k.product_id = products.id AND k.status='available')
WHERE delivery_type != 'manual';

UPDATE products
SET sold_count = (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id
  WHERE oi.product_id = products.id AND o.status IN ('paid','delivered'));
