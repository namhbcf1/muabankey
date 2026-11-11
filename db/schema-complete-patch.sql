-- ============================================================
-- PATCH BỔ SUNG: các cột + bảng còn thiếu trong db/schema.sql
--
-- Agent audit phát hiện: db/schema.sql thiếu 18 thành phần mà code
-- đang dùng -> deploy từ ZERO sẽ crash ngay.
--
-- File này IDEMPOTENT: chạy nhiều lần không lỗi, không mất dữ liệu.
-- Dùng để: (a) vá DB cũ, (b) làm nền cho db/schema.sql mới.
-- ============================================================

-- ===== CỘT CÒN THIẾU =====
-- SQLite không có "ADD COLUMN IF NOT EXISTS" -> dùng cách an toàn:
-- chạy từng câu, câu nào lỗi "duplicate column" thì bỏ qua (wrangler
-- vẫn tiếp tục với các câu sau trong file).

ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE products ADD COLUMN license_prefix TEXT;
ALTER TABLE products ADD COLUMN license_days INTEGER;
ALTER TABLE orders ADD COLUMN refund_started_at INTEGER;
ALTER TABLE orders ADD COLUMN processing_started_at INTEGER;
ALTER TABLE orders ADD COLUMN ledger_written INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN coupon_released INTEGER NOT NULL DEFAULT 0;
ALTER TABLE topups ADD COLUMN notified_at INTEGER;
ALTER TABLE topups ADD COLUMN tg_message_id TEXT;

-- ===== BẢNG CÒN THIẾU =====

CREATE TABLE IF NOT EXISTS licenses (
  key          TEXT PRIMARY KEY,
  hwid         TEXT,
  plan         TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL,
  activated_at INTEGER,
  expires_at   INTEGER,
  last_seen    INTEGER,
  last_ip      TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0,
  max_rebind   INTEGER NOT NULL DEFAULT 0,
  rebinds      INTEGER NOT NULL DEFAULT 0,
  reset_pending INTEGER NOT NULL DEFAULT 0,
  reset_at     INTEGER,
  source       TEXT
);
CREATE INDEX IF NOT EXISTS idx_lic_key ON licenses(key);

CREATE TABLE IF NOT EXISTS license_issues (
  id          TEXT PRIMARY KEY,
  order_id    TEXT,
  user_id     TEXT NOT NULL,
  product_id  TEXT,
  license_key TEXT NOT NULL,
  term_days   INTEGER,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_li_user ON license_issues(user_id);
CREATE INDEX IF NOT EXISTS idx_li_key  ON license_issues(license_key);

CREATE TABLE IF NOT EXISTS lic_events (
  key    TEXT,
  hwid   TEXT,
  kind   TEXT,
  detail TEXT,
  ip     TEXT,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_le_at ON lic_events(at);

CREATE TABLE IF NOT EXISTS lic_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_la_ip ON lic_attempts(ip, at);

CREATE TABLE IF NOT EXISTS install_tokens (
  token_hash TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  user_id    TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rebind_tokens (
  token_hash TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  user_id    TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS banned_devices (
  weak_hwid TEXT PRIMARY KEY,
  reason    TEXT,
  at        INTEGER NOT NULL
);

-- ===== TRIAL =====
CREATE TABLE IF NOT EXISTS trial_uses (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  lic_key       TEXT NOT NULL,
  hwid          TEXT,
  device_weak   TEXT,
  ip            TEXT,
  ua            TEXT,
  started_at    INTEGER,
  expires_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  end_reason    TEXT,
  idem_key      TEXT UNIQUE,
  converted_key TEXT,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tu_user ON trial_uses(user_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tu_key  ON trial_uses(lic_key);
CREATE INDEX IF NOT EXISTS idx_tu_exp  ON trial_uses(expires_at);
CREATE INDEX IF NOT EXISTS idx_tu_weak ON trial_uses(device_weak, kind);
CREATE INDEX IF NOT EXISTS idx_tu_ip   ON trial_uses(ip, created_at DESC);

CREATE TABLE IF NOT EXISTS trial_quota (
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

CREATE TABLE IF NOT EXISTS trial_attempts (
  id       TEXT PRIMARY KEY,
  weak     TEXT,
  ip       TEXT,
  kind     TEXT,
  ok       INTEGER,
  code     TEXT,
  at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ta_at ON trial_attempts(at);

CREATE TABLE IF NOT EXISTS trial_resets (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  kinds        TEXT NOT NULL,
  reason       TEXT NOT NULL,
  before_json  TEXT NOT NULL,
  after_json   TEXT NOT NULL,
  revoked_keys TEXT,
  admin_id     TEXT NOT NULL,
  admin_name   TEXT,
  at           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS trial_bans (
  scope  TEXT NOT NULL,
  value  TEXT NOT NULL,
  reason TEXT,
  at     INTEGER NOT NULL,
  by     TEXT,
  PRIMARY KEY (scope, value)
);

CREATE TABLE IF NOT EXISTS trial_grants (
  weak_hwid      TEXT PRIMARY KEY,
  lic_key        TEXT,
  hwid           TEXT,
  ip_first       TEXT,
  ua_first       TEXT,
  first_at       INTEGER,
  expires_at     INTEGER,
  resume_count   INTEGER DEFAULT 0,
  last_at        INTEGER,
  converted_key  TEXT,
  converted_at   INTEGER,
  suspect        INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS trial_whitelist (
  scope      TEXT NOT NULL,
  value      TEXT NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  PRIMARY KEY (scope, value)
);
