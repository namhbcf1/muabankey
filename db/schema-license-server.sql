-- ============================================================
-- Bảng license phục vụ client XArena — nằm NGAY trong muabankey-db
-- (gộp vào một worker duy nhất, không còn DB/worker riêng)
-- ============================================================

CREATE TABLE IF NOT EXISTS licenses (
  key          TEXT PRIMARY KEY,
  hwid         TEXT,
  plan         TEXT NOT NULL DEFAULT 'aoe1',
  note         TEXT,
  created_at   INTEGER NOT NULL,
  activated_at INTEGER,
  expires_at   INTEGER NOT NULL DEFAULT 0,   -- unix GIÂY, 0 = vĩnh viễn
  last_seen    INTEGER,
  last_ip      TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0,
  max_rebind   INTEGER NOT NULL DEFAULT 1,
  rebinds      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lic_expires ON licenses(expires_at);
CREATE INDEX IF NOT EXISTS idx_lic_hwid    ON licenses(hwid);
CREATE INDEX IF NOT EXISTS idx_lic_created ON licenses(created_at);

CREATE TABLE IF NOT EXISTS lic_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  key    TEXT NOT NULL,
  hwid   TEXT,
  kind   TEXT NOT NULL,          -- activate | check | rebind | revoke | deny
  detail TEXT,
  ip     TEXT,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_licev_key ON lic_events(key, at DESC);

CREATE TABLE IF NOT EXISTS lic_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_licatt_ip ON lic_attempts(ip, at);
