-- ============================================================
-- Đối soát sổ cái ví demo
--
-- Nguyên nhân lệch: trong lúc kiểm thử, balance được UPDATE trực tiếp
-- bằng SQL (không qua API) để test luồng mua hàng trên UI:
--   UPDATE users SET balance = balance + 3000000 WHERE email='demo@muabankey.vn'
-- => balance tăng 3.000.000 nhưng không có wallet_transactions tương ứng.
--
-- Cách xử lý: ghi bút toán đối soát để sổ cái khớp lại (không xoá tiền,
-- vì đây là tài khoản demo nội bộ).
-- ============================================================

-- Dọn sản phẩm rác audit còn sót
DELETE FROM product_keys WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'AUDIT %');
DELETE FROM order_items WHERE product_id IN (SELECT id FROM products WHERE name LIKE 'AUDIT %');
DELETE FROM products WHERE name LIKE 'AUDIT %';

-- Bút toán đối soát (idempotent: chỉ thêm nếu chưa có)
INSERT INTO wallet_transactions (id, user_id, type, amount, balance_after, status, reference, description, created_at)
SELECT 'wt-reconcile-1', 'u-demo', 'admin_credit', 3000000,
       (SELECT balance FROM users WHERE id='u-demo'),
       'success', 'RECONCILE',
       'Đối soát: bổ sung bút toán thiếu do test nội bộ',
       CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM wallet_transactions WHERE id = 'wt-reconcile-1');

-- Đồng bộ lại tồn kho và sold_count theo dữ liệu thật
UPDATE products
SET stock_count = (SELECT COUNT(*) FROM product_keys k WHERE k.product_id = products.id AND k.status='available')
WHERE delivery_type != 'manual';

UPDATE products
SET sold_count = (SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id
  WHERE oi.product_id = products.id AND o.status IN ('paid','delivered'));
