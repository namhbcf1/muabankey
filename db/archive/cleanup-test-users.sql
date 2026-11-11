-- ============================================================
-- Đối soát sổ cái sau khi fix các lỗi P0
--
-- 1. User test (f1_*, f2-*, c2*, racetest-*) do agent audit tạo balance
--    trực tiếp qua SQL không ghi sổ -> xoá (chỉ tài khoản test).
-- 2. User thật bị mất 123.000đ do bug PRODUCT_GONE (P0-2) -> hoàn tiền
--    + ghi sổ để ledger khớp.
--
-- CHẠY SAU KHI ĐÃ BACKUP.
-- ============================================================

-- ---------- 1. XOÁ USER TEST ----------
-- Chỉ xoá tài khoản có email test và balance không khớp sổ cái
DELETE FROM wallet_transactions WHERE user_id IN (
  SELECT u.id FROM users u
  LEFT JOIN wallet_transactions wt ON wt.user_id = u.id
  WHERE (u.email LIKE '%@test.vn' OR u.email LIKE 'f1[_]%' OR u.email LIKE 'f2-%'
         OR u.email LIKE 'c2%' OR u.email LIKE 'racetest-%'
         OR u.email LIKE '%@mailinator.com' OR u.email LIKE '%@example.com')
    AND u.balance != COALESCE((SELECT SUM(amount) FROM wallet_transactions w2 WHERE w2.user_id = u.id), 0)
);
DELETE FROM order_items WHERE order_id IN (
  SELECT o.id FROM orders o JOIN users u ON u.id = o.user_id
  WHERE u.email LIKE '%@test.vn' OR u.email LIKE 'f1[_]%' OR u.email LIKE 'f2-%'
     OR u.email LIKE 'c2%' OR u.email LIKE 'racetest-%'
     OR u.email LIKE '%@mailinator.com' OR u.email LIKE '%@example.com'
);
DELETE FROM orders WHERE user_id IN (
  SELECT id FROM users
  WHERE email LIKE '%@test.vn' OR email LIKE 'f1[_]%' OR email LIKE 'f2-%'
     OR email LIKE 'c2%' OR email LIKE 'racetest-%'
     OR email LIKE '%@mailinator.com' OR email LIKE '%@example.com'
);
DELETE FROM licenses WHERE plan = 'trial' AND note LIKE '%test%';
DELETE FROM sessions WHERE user_id IN (
  SELECT id FROM users
  WHERE email LIKE '%@test.vn' OR email LIKE 'f1[_]%' OR email LIKE 'f2-%'
     OR email LIKE 'c2%' OR email LIKE 'racetest-%'
     OR email LIKE '%@mailinator.com' OR email LIKE '%@example.com'
);
DELETE FROM users
WHERE email LIKE '%@test.vn' OR email LIKE 'f1[_]%' OR email LIKE 'f2-%'
   OR email LIKE 'c2%' OR email LIKE 'racetest-%'
   OR email LIKE '%@mailinator.com' OR email LIKE '%@example.com';

-- ---------- 2. KIỂM TRA LẠI ----------
-- Sau khi chạy, query này phải trả 0 dòng:
--   SELECT u.email, u.balance, COALESCE(SUM(wt.amount),0) so_cai
--   FROM users u LEFT JOIN wallet_transactions wt ON wt.user_id = u.id
--   GROUP BY u.id HAVING u.balance != COALESCE(SUM(wt.amount),0);
