-- ===========================================================================
-- 1 TÀI KHOẢN = 1 MÁY TẠI MỘT THỜI ĐIỂM
--
-- Chủ shop: "mua rồi thì đổi máy nào cũng được nhưng mà kiểm soát là chỉ
-- 1 nick 1 máy 1 thời điểm, đăng nhập nhiều lần nhiều máy 1 nick để dùng
-- thì không cho phép"
--
-- CÁCH LÀM: ghi HWID vào CHÍNH phiên đăng nhập (bảng sessions đã có sẵn,
-- không cần bảng mới). Khi một phiên hoạt động trên máy B, mọi phiên cũ
-- của cùng user_id bị đánh dấu "đã bị thay thế" -> máy A bị đá ra.
--
-- KHÔNG dùng bảng riêng vì sessions đã là nguồn sự thật duy nhất về
-- "ai đang đăng nhập".
-- ===========================================================================

-- HWID của máy đang giữ phiên này (NULL với phiên cũ trước khi có cột).
ALTER TABLE sessions ADD COLUMN hwid TEXT;

-- Thời điểm máy này lần cuối xác nhận còn sống.
ALTER TABLE sessions ADD COLUMN last_seen INTEGER;

-- Phiên này đã bị MÁY KHÁC chiếm chỗ hay chưa (1 = bị đá).
-- Giữ lại dòng thay vì xoá để còn truy vết và để máy cũ nhận đúng lý do
-- "tài khoản đang dùng ở máy khác" thay vì "phiên hết hạn".
ALTER TABLE sessions ADD COLUMN replaced_by INTEGER DEFAULT 0;

-- Truy vấn nóng: "phiên đang hoạt động của user này"
CREATE INDEX IF NOT EXISTS idx_sessions_user_active
  ON sessions(user_id, replaced_by, expires_at);
