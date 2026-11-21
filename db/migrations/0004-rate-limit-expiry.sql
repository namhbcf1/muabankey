-- ===========================================================================
-- 0004 — HẾT HẠN BỘ ĐẾM RATE LIMIT + KỲ HẠN SẢN PHẨM KHÔNG MẶC ĐỊNH VĨNH VIỄN
--
-- Hai lỗi P0 độc lập nhưng cùng bản chất: một giá trị mặc định sai đang được
-- hiểu là "không giới hạn" ở tầng nghiệp vụ.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- (1) rate_limits.expires_at — mốc hết hạn thật của khung đếm
--
-- LỖI: `window_at` = floor(unix_giây / windowSec) là CHỈ SỐ KHUNG, không phải
-- mốc thời gian. Cron cũ xoá bằng ngưỡng tính theo window 60s:
--     DELETE FROM rate_limits WHERE window_at < floor((now-86400)/60)
-- Với windowSec=900 (đăng nhập) window_at ~1,99e6 luôn nhỏ hơn ngưỡng ~2,98e7
-- -> mọi dòng bị xoá mỗi 10 phút -> bộ đếm chống dò mật khẩu mất tác dụng.
--
-- Nay mỗi dòng mang mốc hết hạn tuyệt đối, cron chỉ cần so với NOW.
-- NULL cho dòng cũ (không biết window nào) -> cron coi là quá hạn và dọn,
-- đúng ý định an toàn: bảng này chỉ là bộ đếm, xoá sớm không mất dữ liệu
-- nghiệp vụ.
-- ---------------------------------------------------------------------------
ALTER TABLE rate_limits ADD COLUMN expires_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_rate_limits_expires
  ON rate_limits(expires_at);

-- ---------------------------------------------------------------------------
-- (2) products.license_days — KHÔNG được mặc định 0
--
-- LỖI: 0 được quy ước là VĨNH VIỄN (giữ tương thích bảng licenses).
-- Nhưng `adminSaveProduct` ghi 0 khi client không gửi field, và form admin gửi
-- `Number(...) || 0` — nghĩa là ô "số ngày" để trống = bán quyền vĩnh viễn.
--
-- Migration KHÔNG tự đổi dữ liệu đang có (0 hiện tại có thể là vĩnh viễn thật
-- do khách đã mua). Chỉ ghi nhận để truy vấn đối soát:
--     SELECT * FROM products WHERE delivery_type='license' AND license_days=0;
-- Việc chặn ghi 0 mới nằm ở tầng API (bắt buộc nhập số ngày > 0).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_license_days
  ON products(delivery_type, license_days);
