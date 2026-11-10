INSERT INTO settings (key, value, updated_at) VALUES
  ('trial1h_enabled', '1', 0),
  ('trial1h_minutes', '60', 0),
  ('trial1h_limit', '10', 0),
  ('trial3d_enabled', '1', 0),
  ('trial3d_days', '3', 0),
  ('trial3d_limit', '10', 0),
  ('trial_require_account', '1', 0)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
