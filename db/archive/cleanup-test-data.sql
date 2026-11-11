-- ============================================================
-- Dọn dữ liệu test khỏi production
-- Chạy SAU KHI đã backup: db/backup-*.sql
-- ============================================================

-- 1. License test (TEST-*, REPRO-*, NEW-*)
DELETE FROM lic_events WHERE key IN (
  SELECT key FROM licenses WHERE key LIKE 'TEST-%' OR key LIKE 'REPRO-%' OR key LIKE 'NEW-%'
);
DELETE FROM license_issues WHERE license_key IN (
  SELECT key FROM licenses WHERE key LIKE 'TEST-%' OR key LIKE 'REPRO-%' OR key LIKE 'NEW-%'
);
DELETE FROM licenses WHERE key LIKE 'TEST-%' OR key LIKE 'REPRO-%' OR key LIKE 'NEW-%';

-- 2. Trả key kho về available (KHÔNG xoá để không mất hàng)
UPDATE product_keys
SET status = 'available', order_id = NULL, delivered_at = NULL
WHERE order_id IN (
  SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id
  WHERE u.email LIKE '%@test.vn' OR u.email LIKE '%@audit-test.vn'
);

-- 3. Xoá đơn, item, ví, session của user test
DELETE FROM wallet_transactions WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@test.vn' OR email LIKE '%@audit-test.vn'
);
DELETE FROM order_items WHERE order_id IN (
  SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id
  WHERE u.email LIKE '%@test.vn' OR u.email LIKE '%@audit-test.vn'
);
DELETE FROM orders WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@test.vn' OR email LIKE '%@audit-test.vn'
);
DELETE FROM sessions WHERE user_id IN (
  SELECT id FROM users WHERE email LIKE '%@test.vn' OR email LIKE '%@audit-test.vn'
);
DELETE FROM users WHERE email LIKE '%@test.vn' OR email LIKE '%@audit-test.vn';

-- 4. Đồng bộ tồn kho lại
UPDATE products
SET stock_count = (
  SELECT COUNT(*) FROM product_keys k
  WHERE k.product_id = products.id AND k.status = 'available'
)
WHERE delivery_type != 'manual';

-- 5. Đưa sold_count về số thật (trước đây là số bịa trong seed)
UPDATE products
SET sold_count = (
  SELECT COALESCE(SUM(oi.quantity), 0)
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  WHERE oi.product_id = products.id AND o.status IN ('paid','delivered')
);
