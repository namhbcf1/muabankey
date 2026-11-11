-- ============================================================
-- SỬA LẠI: TÀI KHOẢN NHẬN TIỀN = 8990124112002
--
-- Chủ shop xác nhận: dùng MBBank 8990124112002 — Nguyen Thanh Nam
-- kết nối qua API Banking (không phải 241122888888 như lúc trước).
--
-- SePay API xác nhận:
--   id=98282 | 8990124112002 | MBBank | Nguyen Thanh Nam | active=1
--   Giao dịch thật: 2026-11-12 05:10 | +10.000đ
-- ============================================================

INSERT INTO settings (key, value, updated_at) VALUES
  ('bank_name',    'MBBank', 0),
  ('bank_account', '8990124112002', 0),
  ('bank_owner',   'NGUYEN THANH NAM', 0),
  ('bank_slug',    'MB', 0)
ON CONFLICT(key) DO UPDATE SET
  value = excluded.value,
  updated_at = excluded.updated_at;

SELECT key, value FROM settings
WHERE key LIKE 'bank%' ORDER BY key;
