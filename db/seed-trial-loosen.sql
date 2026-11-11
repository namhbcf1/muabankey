INSERT INTO settings (key, value, updated_at) VALUES
  ('trial_max_per_ip',        '100', 0),
  ('trial_max_per_net',       '2000', 0),
  ('trial_max_per_day',       '5000', 0),
  ('trial_device_acc_1h',     '50', 0),
  ('trial_device_acc_3d',     '20', 0),
  ('trial_recheck_1h',        '300', 0),
  ('trial_recheck_3d',        '1800', 0),
  ('trial_hold_sec',          '604800', 0),
  ('trial_require_account',   '0', 0)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
