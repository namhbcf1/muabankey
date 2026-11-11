-- ============================================================
-- Trial v2 — bảng cuối cùng (thay cho schema-trial-v2.sql ban đầu)
--
-- Sửa so với bản nháp: `plan` -> `kind`, thêm idem_key, trial_bans.
-- ============================================================

-- Nếu bảng cũ đã tạo với cột `plan`, tạo lại với cột `kind`
DROP TABLE IF EXISTS trial_uses;
DROP TABLE IF EXISTS trial_quota;

CREATE TABLE trial_uses (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,              -- bắt buộc: hạn mức theo tài khoản
  kind          TEXT NOT NULL,              -- '1h' | '3d'
  lic_key       TEXT NOT NULL,
  hwid          TEXT NOT NULL,              -- HWID đầy đủ, chặn copy lic.bin
  device_weak   TEXT,                       -- weak HWID, chặn farm tài khoản
  ip            TEXT,
  ua            TEXT,
  started_at    INTEGER,                    -- NULL = chưa kích hoạt (hold)
  expires_at    INTEGER NOT NULL,           -- hold_until nếu chưa kích hoạt
  ended_at      INTEGER,
  end_reason    TEXT,                       -- expired | stopped | converted | revoked
  idem_key      TEXT UNIQUE,                -- chống retry trừ 2 lượt
  converted_key TEXT,                       -- key trả phí nếu khách mua
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_tu_user   ON trial_uses(user_id, kind, created_at DESC);
CREATE INDEX idx_tu_key    ON trial_uses(lic_key);
CREATE INDEX idx_tu_exp    ON trial_uses(expires_at);
CREATE INDEX idx_tu_weak   ON trial_uses(device_weak, kind);
CREATE INDEX idx_tu_ip     ON trial_uses(ip, created_at DESC);

-- Bộ đếm lượt (reset được mà vẫn giữ lịch sử trong trial_uses)
CREATE TABLE trial_quota (
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  quota         INTEGER NOT NULL DEFAULT 10,
  reset_count   INTEGER NOT NULL DEFAULT 0,
  last_reset_at INTEGER,
  reset_by      TEXT,
  banned_at     INTEGER,
  banned_reason TEXT,
  converted_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE INDEX idx_tq_kind ON trial_quota(kind, used);

-- Chặn thiết bị (thay banned_devices cũ)
CREATE TABLE IF NOT EXISTS trial_bans (
  scope   TEXT NOT NULL,                    -- 'weak' | 'ip' | 'user'
  value   TEXT NOT NULL,
  reason  TEXT,
  at      INTEGER NOT NULL,
  by      TEXT,
  PRIMARY KEY (scope, value)
);

-- Lịch sử admin reset (audit có cấu trúc)
CREATE TABLE IF NOT EXISTS trial_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kinds      TEXT NOT NULL,                 -- '1h,3d' hoặc 'all'
  reason     TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  revoked_keys TEXT,
  admin_id   TEXT NOT NULL,
  admin_name TEXT,
  at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tres_user  ON trial_resets(user_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_tres_admin ON trial_resets(admin_id, at DESC);
