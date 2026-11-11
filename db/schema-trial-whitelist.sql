-- ============================================================
-- WHITELIST: máy/tài khoản được dùng thử VÔ HẠN LẦN
--
-- Dùng cho máy lập trình / test nội bộ.
-- Không ảnh hưởng khách thật.
--
-- scope:
--   'weak'   -> weak HWID (bỏ volume serial, ổn định khi format)
--   'hwid'   -> HWID đầy đủ
--   'device' -> device_id do browser sinh (localStorage), đã hash
--   'user'   -> user_id tài khoản web
--   'ip'     -> địa chỉ IP
--
-- Nguyên tắc: khớp whitelist -> quota = UNLIMITED, bỏ qua MỌI giới hạn
-- (số lượt, IP, subnet, ngày, thiết bị). Vẫn tính thời lượng trial
-- (1 giờ / 3 ngày) bình thường.
-- ============================================================

CREATE TABLE IF NOT EXISTS trial_whitelist (
  scope      TEXT NOT NULL,
  value      TEXT NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  PRIMARY KEY (scope, value)
);

CREATE INDEX IF NOT EXISTS idx_twl_scope ON trial_whitelist(scope);

-- Cấu hình quota vô hạn (số rất lớn thay vì NULL để code không phải
-- xử lý nhánh đặc biệt ở mọi nơi)
INSERT INTO settings (key, value, updated_at) VALUES
  ('trial_unlimited_quota', '999999', 0)
ON CONFLICT(key) DO UPDATE SET value = excluded.value;
