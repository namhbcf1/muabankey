-- ============================================================
-- LUẬT "1 TÀI KHOẢN = 1 MÁY TẠI MỘT THỜI ĐIỂM"
-- (chủ shop: "chỉ 1 nick 1 máy 1 thời điểm đăng nhập nhiều lần nhiều máy
--  1 nick để dùng thì không cho phép")
--
-- CHẠY MỘT LẦN. KHÔNG phá dữ liệu cũ: chỉ thêm bảng mới.
--   npx wrangler d1 execute muabankey-db --remote --file=db/schema-account-device.sql
--
-- ============================================================
-- VÌ SAO BẢNG RIÊNG, KHÔNG DÙNG `sessions`
--
--   `sessions` = phiên ĐĂNG NHẬP WEB: (token_hash, user_id, created_at,
--   expires_at, ip, ua). Nó KHÔNG có cột nào định danh MÁY, và một khách mở
--   web trên 3 máy là 3 dòng hợp pháp.
--
--   Client EXE thì KHÔNG gửi cookie khi gọi /api/check hay /api/xg/check
--   (tool/app/xa_arena_api.py:1102), nên server không có phiên nào để đọc ở
--   đường licence. Nguồn sự thật duy nhất về "nick nào" là `license_issues`
--   (key được BÁN cho user nào) — bảng đó đã có sẵn, không cần migrate.
--
--   Bảng dưới đây chỉ giữ ĐÚNG MỘT dòng cho mỗi (user, sản phẩm).
-- ============================================================

CREATE TABLE IF NOT EXISTS account_devices (
  user_id      TEXT    NOT NULL,              -- users.id (chủ license, từ license_issues)
  -- Phạm vi khoá:
  --   'nofog' | 'xagrant' = mỗi sản phẩm một máy  (ĐANG DÙNG — xem
  --                         src/lib/account-device.js: DEVICE_SCOPE)
  --   'all'               = mỗi tài khoản một máy, bất kể sản phẩm
  scope        TEXT    NOT NULL DEFAULT 'nofog',
  active_hwid  TEXT    NOT NULL,              -- máy ĐANG được dùng
  active_since INTEGER NOT NULL,              -- giây unix, lúc máy này chiếm quyền
  last_seen    INTEGER NOT NULL,              -- giây unix, lần gọi hợp lệ gần nhất
  last_key     TEXT,                          -- key đã dùng ở lần gọi đó (chẩn đoán)
  last_ip      TEXT,
  moves        INTEGER NOT NULL DEFAULT 0,    -- số lần ĐỔI MÁY (activate từ máy khác)
  PRIMARY KEY (user_id, scope)
);

-- Tra "máy này đang phục vụ những tài khoản nào" (vận hành / chống farm).
CREATE INDEX IF NOT EXISTS idx_acctdev_hwid ON account_devices(active_hwid);
