-- ============================================================
-- trial_uses.hwid phải cho phép NULL
--
-- Lý do: web KHÔNG đọc được phần cứng máy khách, nên cấp trial qua web
-- thì HWID = NULL, gắn ở /api/check lần đầu (khi tool chạy).
-- ============================================================

CREATE TABLE trial_uses_new (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  lic_key       TEXT NOT NULL,
  hwid          TEXT,                       -- NULL = chưa gắn máy
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

INSERT INTO trial_uses_new
  (id, user_id, kind, lic_key, hwid, device_weak, ip, ua,
   started_at, expires_at, ended_at, end_reason, idem_key, converted_key, created_at)
SELECT
   id, user_id, kind, lic_key, hwid, device_weak, ip, ua,
   started_at, expires_at, ended_at, end_reason, idem_key, converted_key, created_at
FROM trial_uses;

DROP TABLE trial_uses;
ALTER TABLE trial_uses_new RENAME TO trial_uses;

CREATE INDEX idx_tu_user ON trial_uses(user_id, kind, created_at DESC);
CREATE INDEX idx_tu_key  ON trial_uses(lic_key);
CREATE INDEX idx_tu_exp  ON trial_uses(expires_at);
CREATE INDEX idx_tu_weak ON trial_uses(device_weak, kind);
CREATE INDEX idx_tu_ip   ON trial_uses(ip, created_at DESC);
