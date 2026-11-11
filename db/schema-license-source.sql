-- ============================================================
-- Tách LICENSE KHO khỏi LICENSE ĐÃ BÁN
--
-- VẤN ĐỀ: 4.572 license trong đó 4.000 là "kho" seed (tạo 100 dòng/giây,
-- note "Kho ...lô 2026-1"), chỉ 20 license aoe1 có hwid (đã bán thật).
-- Không có cột phân biệt -> mọi metric license/revenue đều sai.
--
-- source:
--   'stock' -> tồn kho (admin tạo hàng loạt để bán dần)
--   'sold'  -> đã gán cho khách qua đơn hàng
--   'trial' -> dùng thử
--   'manual'-> admin tạo tay / tặng
-- ============================================================

ALTER TABLE licenses ADD COLUMN source TEXT;

-- Backfill: license có license_issues = đã bán
UPDATE licenses
SET source = 'sold'
WHERE source IS NULL
  AND key IN (SELECT license_key FROM license_issues);

-- Backfill: license trial
UPDATE licenses
SET source = 'trial'
WHERE source IS NULL AND plan = 'trial';

-- Backfill: còn lại là kho
UPDATE licenses
SET source = 'stock'
WHERE source IS NULL;

CREATE INDEX IF NOT EXISTS idx_lic_source ON licenses(source);
CREATE INDEX IF NOT EXISTS idx_lic_source_plan ON licenses(source, plan);

-- Index còn thiếu (agent phát hiện: wallet.js:249 query txn_ref full-scan)
CREATE INDEX IF NOT EXISTS idx_topups_txnref ON topups(txn_ref);
