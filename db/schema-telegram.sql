-- ============================================================
-- Telegram notification
-- ============================================================

-- Đánh dấu đã bắn thông báo + message_id để sửa tin sau khi duyệt
ALTER TABLE topups ADD COLUMN notified_at INTEGER;
ALTER TABLE topups ADD COLUMN tg_message_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_topups_pending
  ON topups(status, created_at DESC);

-- Cấu hình Telegram (đặt qua admin UI hoặc wrangler secret)
--   telegram_bot_token = "123456:ABC..."
--   telegram_chat_id   = "123456789"  (hoặc "-100...")
--   telegram_enabled   = "1"
