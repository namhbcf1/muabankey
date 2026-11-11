-- ============================================================
-- XAGrant — tool tăng tài nguyên XArena (sản phẩm RIÊNG, khác No Fog)
--
-- Chạy MỘT LẦN duy nhất trên D1 remote:
--   npx wrangler@4 d1 execute muabankey-db --remote --file=./db/schema-xagrant.sql --yes
--
-- File này KHÔNG idempotent ở phần ALTER TABLE (SQLite không hỗ trợ
-- ADD COLUMN IF NOT EXISTS). Nếu chạy lần hai sẽ báo "duplicate column name";
-- khi đó kiểm tra bằng:  PRAGMA table_info(licenses);
-- ============================================================

-- ---------- Mở rộng bảng licenses (dùng chung 1 bảng, tách bằng pid) ----------
-- Giữ nguyên giao thức + bảng cũ để client No Fog không bị ảnh hưởng.

-- Sản phẩm sở hữu license. NULL = dữ liệu cũ (No Fog / trial).
ALTER TABLE licenses ADD COLUMN pid TEXT;
-- Số giờ cho phép chạy offline sau lần /api/xg/check thành công gần nhất.
-- No Fog luôn 0 (bắt buộc online); XAGrant mặc định 24 để quán net đứt mạng
-- vẫn dùng được, nhưng vẫn phải quay về server trong 24h.
ALTER TABLE licenses ADD COLUMN grace_h INTEGER NOT NULL DEFAULT 0;
-- Khoá gate đã niêm phong cho từng license (xem xa_grant.py::build_gate).
-- Mỗi license một khoá khác nhau -> chia sẻ key KHÔNG nhân bản được hành vi.
ALTER TABLE licenses ADD COLUMN gate TEXT NOT NULL DEFAULT '';
-- Ràng buộc chế độ chạy do server áp: 'cmd' = chỉ cho phép chạy từ CMD.
ALTER TABLE licenses ADD COLUMN mode TEXT NOT NULL DEFAULT '';
-- Định danh ứng dụng: 'xagrant' | 'nofog' | 'trial'.
ALTER TABLE licenses ADD COLUMN app TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_lic_pid ON licenses(pid);

-- ---------- Nonce chống replay cho request đã ký ----------------------------
-- Mỗi request /api/xg/* mang ed25519/ECDSA signature của hash body + nonce.
-- Nonce chỉ dùng được 1 lần trong cửa sổ 90 giây -> chặn phát lại gói tin.
CREATE TABLE IF NOT EXISTS xg_nonce (
  nonce   TEXT PRIMARY KEY,
  key     TEXT,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xgn_at ON xg_nonce(at);

-- ---------- Phiên thiết bị ---------------------------------------------------
-- Sau khi kích hoạt, client giữ sid + secret. Server lưu băm để đối chiếu.
-- Cho phép thu hồi tức thời một phiên cụ thể mà không phải revoke cả key.
CREATE TABLE IF NOT EXISTS xg_session (
  sid        TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  hwid       TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  ua         TEXT,
  fp         TEXT,
  created_at INTEGER NOT NULL,
  last_at    INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_xgs_key ON xg_session(key, last_at DESC);

-- ---------- Log riêng của XAGrant -------------------------------------------
CREATE TABLE IF NOT EXISTS xg_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  key    TEXT,
  hwid   TEXT,
  sid    TEXT,
  kind   TEXT NOT NULL,
  detail TEXT,
  ip     TEXT,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_xge_key ON xg_events(key, at DESC);

-- Đếm vi phạm theo license (mỗi license chỉ có vài lần "quên tắt debugger")
CREATE TABLE IF NOT EXISTS xg_viol (
  key      TEXT PRIMARY KEY,
  n        INTEGER NOT NULL DEFAULT 0,
  last_at  INTEGER NOT NULL
);
