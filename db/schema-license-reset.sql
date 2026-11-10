-- Đánh dấu license đang chờ đổi máy (sau admin reset).
-- Khác NULL hwid thường: reset_pending=1 nghĩa là PHẢI có token mới bind được.
ALTER TABLE licenses ADD COLUMN reset_pending INTEGER NOT NULL DEFAULT 0;
ALTER TABLE licenses ADD COLUMN reset_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_lic_reset_pending ON licenses(reset_pending);
