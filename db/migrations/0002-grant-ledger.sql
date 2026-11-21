-- ===========================================================================
-- 0002 — SỔ CẤP QUYỀN BẤT BIẾN
--
-- Xem db/migrate-entitlement-grants.sql để biết lý do đầy đủ.
-- File này là bản được migration runner quản lý (có checksum, chạy một lần).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS entitlement_grants (
  grant_id        TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  feature         TEXT NOT NULL,
  source_type     TEXT NOT NULL,
  source_id       TEXT,
  days_added      INTEGER NOT NULL DEFAULT 0,
  prev_expires_at INTEGER NOT NULL DEFAULT 0,
  new_expires_at  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  revoked_at      INTEGER,
  revoke_reason   TEXT,
  note            TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_ent_grant_idem
  ON entitlement_grants(user_id, feature, source_type, source_id)
  WHERE source_id IS NOT NULL AND source_type = 'purchase';

CREATE INDEX IF NOT EXISTS idx_ent_grant_user ON entitlement_grants(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ent_grant_source ON entitlement_grants(source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_ent_grant_open ON entitlement_grants(user_id, feature, revoked_at);
