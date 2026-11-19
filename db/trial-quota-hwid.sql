-- Đếm lượt dùng thử THEO PHẦN CỨNG (HWID), không theo tài khoản web.
--
-- VÌ SAO: hiện trial_quota khoá theo (user_id, kind). Khách xoá cookie / tạo
-- tài khoản mới -> user_id mới -> lại được 10 lượt. HWID thì đổi tài khoản
-- vẫn là cùng máy -> không lách được.
--
-- Bảng mới: trial_quota_hw
--   hwid  : HWID 32 hex (sha256 phần cứng, do CHÍNH TOOL tính rồi gửi lên;
--           server không tin hwid client tự khai ở chỗ khác, nhưng với
--           quota thì HWID chỉ là khoá đếm — gian lận HWID chỉ đổi được
--           bộ đếm, mà muốn có key vẫn phải qua bước cấp license có kiểm).
--   kind  : '1h' | '3d'
--   used  : đã dùng bao nhiêu lượt
--   quota : tổng được cấp
--
-- Giữ nguyên bảng trial_quota cũ để không phá dữ liệu đang chạy; code sẽ
-- ưu tiên HWID khi có, fallback user_id khi không đọc được phần cứng.

CREATE TABLE IF NOT EXISTS trial_quota_hw (
  hwid       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  quota      INTEGER NOT NULL DEFAULT 10,
  reset_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (hwid, kind)
);

CREATE INDEX IF NOT EXISTS idx_trial_quota_hw_kind
  ON trial_quota_hw(kind, updated_at);
