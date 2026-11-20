-- ===========================================================================
-- TRIAL THEO TÀI KHOẢN (thay cho trial theo mã TR-)
--
-- Chủ shop chốt:
--   * Mỗi TÀI KHOẢN mới được dùng thử 1 NGÀY
--   * Cả map sáng VÀ tài nguyên trong cùng 1 ngày đó
--   * KHÔNG cấp mã TR- nữa, khách không phải nhập key
--   * Đồng hồ bắt đầu từ lần ĐẦU MỞ APP (không phải lúc đăng ký)
--
-- Bảng này là NGUỒN SỰ THẬT DUY NHẤT cho "tài khoản nào đã dùng thử chưa".
-- Hai license nội bộ (map sáng + tài nguyên) chỉ là vật mang token, khách
-- không bao giờ nhìn thấy key của chúng.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS trial_accounts (
  user_id     TEXT PRIMARY KEY,          -- users.id
  state       TEXT NOT NULL DEFAULT 'active',  -- active | ended
  created_at  INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,          -- lần đầu mở app
  expires_at  INTEGER NOT NULL,          -- started_at + 1 ngày
  ended_at    INTEGER,
  end_reason  TEXT,                      -- expired | reset | admin
  hwid        TEXT,                      -- máy đang giữ quyền
  device_weak TEXT,                      -- chống farm nhiều tài khoản / máy
  ip          TEXT,
  ua          TEXT,
  nofog_key   TEXT,                      -- license nội bộ, KHÔNG lộ ra ngoài
  grant_key   TEXT,                      -- license nội bộ, KHÔNG lộ ra ngoài
  rebinds     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trial_acc_exp  ON trial_accounts(expires_at);
CREATE INDEX IF NOT EXISTS idx_trial_acc_weak ON trial_accounts(device_weak);
