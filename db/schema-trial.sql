-- ============================================================
-- Trial 3 ngày theo HWID — v2
--
-- Thiết kế: trial là license thật trong bảng `licenses` với plan='trial'
-- (để /api/check chạy nguyên), NHƯNG có bảng `trial_grants` làm mỏ neo
-- chống reset: weak_hwid (bỏ volume serial) -> license key.
--
-- Xoá lic.bin trên máy KHÔNG xin được trial mới: server tra weak_hwid
-- và trả lại đúng key cũ (hoặc từ chối nếu đã hết hạn).
-- ============================================================

-- Mỏ neo chống reset: 1 dòng / máy vĩnh viễn
CREATE TABLE IF NOT EXISTS trial_grants (
  weak_hwid   TEXT PRIMARY KEY,   -- sha256(machineguid|bios|cpu) — KHÔNG có volume serial
  lic_key     TEXT NOT NULL,      -- trỏ tới licenses.key
  hwid        TEXT NOT NULL,      -- HWID đầy đủ lần đầu
  ip_first    TEXT,
  ua_first    TEXT,
  first_at    INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  resume_count INTEGER NOT NULL DEFAULT 0,
  last_at     INTEGER,
  converted_key TEXT,             -- key trả tiền nếu khách mua sau trial
  converted_at  INTEGER,
  suspect     INTEGER NOT NULL DEFAULT 0   -- 1 = có dấu hiệu đổi HWID
);
CREATE INDEX IF NOT EXISTS idx_tg_ip   ON trial_grants(ip_first, first_at);
CREATE INDEX IF NOT EXISTS idx_tg_hwid ON trial_grants(hwid);
CREATE INDEX IF NOT EXISTS idx_tg_exp  ON trial_grants(expires_at);

-- Nhật ký mọi lần thử (kể cả bị chặn) — dùng để phát hiện farm
CREATE TABLE IF NOT EXISTS trial_attempts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  weak    TEXT,
  hwid    TEXT,
  ip      TEXT,
  action  TEXT NOT NULL,   -- start | resume | denied_expired | denied_device | denied_ip | denied_global
  detail  TEXT,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ta_weak ON trial_attempts(weak, at DESC);
CREATE INDEX IF NOT EXISTS idx_ta_ip   ON trial_attempts(ip, at DESC);
CREATE INDEX IF NOT EXISTS idx_ta_at   ON trial_attempts(at);

-- Thiết bị bị chặn thủ công
CREATE TABLE IF NOT EXISTS banned_devices (
  weak_hwid  TEXT PRIMARY KEY,
  reason     TEXT,
  banned_at  INTEGER NOT NULL,
  banned_by  TEXT
);

-- Cấu hình trial trong settings (đổi không cần deploy):
--   trial_enabled       = 1
--   trial_days          = 3
--   trial_max_per_ip    = 3      (3 máy/IP/30 ngày)
--   trial_max_per_net   = 12     (12 máy/24 subnet/30 ngày)
--   trial_max_per_day   = 200    (chặn tấn công hàng loạt)
