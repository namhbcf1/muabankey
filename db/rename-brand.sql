-- Doi ten thuong hieu
INSERT INTO settings (key, value, updated_at) VALUES
  ('site_name',    'MuaBanKey', 0),
  ('site_tagline', 'XARENA MAP SÁNG — bỏ sương mù, thêm tài nguyên', 0)
ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at;
