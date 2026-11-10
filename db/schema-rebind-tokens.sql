-- ============================================================
-- Bảng rebind_tokens: token đổi máy dùng 1 lần
-- Cho phép khách đổi máy trên máy mới mà không cần đăng nhập web.
-- ============================================================

CREATE TABLE IF NOT EXISTS rebind_tokens (
  token_hash TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rt_key ON rebind_tokens(key, expires_at);
CREATE INDEX IF NOT EXISTS idx_rt_user ON rebind_tokens(user_id, created_at);
