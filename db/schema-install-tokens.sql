-- Token cài đặt /i/<key>?t=<token>
-- Trước đây /i/<key> công khai -> oracle liệt kê key tồn tại.
CREATE TABLE IF NOT EXISTS install_tokens (
  token_hash TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_it_key ON install_tokens(key, expires_at);
CREATE INDEX IF NOT EXISTS idx_it_user ON install_tokens(user_id, created_at);
