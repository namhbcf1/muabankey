-- Cấu hình trial mặc định
INSERT INTO settings (key, value, updated_at) VALUES
  ('trial_enabled',    '1',   CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('trial_days',       '3',   CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('trial_max_per_ip', '3',   CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('trial_max_per_net','12',  CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('trial_max_per_day','200', CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
