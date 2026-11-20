-- ===========================================================================
-- QUYỀN THEO TÀI KHOẢN (bỏ hoàn toàn khái niệm "key" với khách)
--
-- Chủ shop chốt:
--   * Bỏ toàn bộ key trên hệ thống app và web
--   * Mua thì cộng thẳng vào TÀI KHOẢN
--   * Khách chỉ thấy: tên gói + hạn
--
-- Bảng này là nguồn sự thật DUY NHẤT cho quyền của một tài khoản.
-- `licenses` chỉ còn là vật mang token nội bộ, khách không bao giờ thấy.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS account_entitlements (
  user_id     TEXT NOT NULL,
  feature     TEXT NOT NULL,             -- 'nofog' | 'grant'
  expires_at  INTEGER NOT NULL,          -- unix GIÂY, 0 = vĩnh viễn
  source      TEXT NOT NULL DEFAULT 'purchase',  -- purchase | trial | admin | grant
  order_id    TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, feature)
);

CREATE INDEX IF NOT EXISTS idx_acc_ent_exp ON account_entitlements(expires_at);
CREATE INDEX IF NOT EXISTS idx_acc_ent_order ON account_entitlements(order_id);
