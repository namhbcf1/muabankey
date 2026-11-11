-- ============================================================
-- CẬP NHẬT TÀI KHOẢN NHẬN TIỀN SANG TÀI KHOẢN ĐÃ NỐI SEPAY
--
-- Trước: 8990124112002 — MBBank — NGUYEN THANH NAM (cá nhân)
-- Nay  : 241122888888  — MBBank — HO KINH DOANH TRUONG PHAT COMPUTER
--
-- Lý do: SePay chỉ nhận webhook cho tài khoản ĐÃ NỐI. Tài khoản cũ
-- không nối nên tiền vào không đổ về SePay, webhook không chạy.
-- ============================================================

INSERT INTO settings (key, value, updated_at) VALUES
  ('bank_name',    'MBBank', 0),
  ('bank_account', '241122888888', 0),
  ('bank_owner',   'HO KINH DOANH TRUONG PHAT COMPUTER', 0),
  ('bank_slug',    'MB', 0)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;

-- Hiển thị lại để kiểm tra
SELECT key, value FROM settings
WHERE key IN ('bank_name','bank_account','bank_owner','bank_slug')
ORDER BY key;
