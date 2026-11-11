-- Cấu hình SePay: 00:00-11:59 tự giao, 12:00-23:59 admin duyệt tay
INSERT INTO settings (key, value, updated_at) VALUES
  ('sepay_auto_enabled', '1', 0),
  ('sepay_auto_from',    '0', 0),
  ('sepay_auto_to',      '12', 0)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
