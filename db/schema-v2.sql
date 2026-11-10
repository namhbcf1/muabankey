-- ============================================================
-- MuaBanKey — Migration v2: bán license XArena
-- Nối shop với hệ thống xa_license (D1 riêng, binding LICENSE_DB)
-- ============================================================

-- Sản phẩm loại license: cần biết tiền tố + số ngày để sinh key
ALTER TABLE products ADD COLUMN license_prefix TEXT;
ALTER TABLE products ADD COLUMN license_days   INTEGER NOT NULL DEFAULT 0;

-- Sổ phát hành license của shop (để tra cứu ngược từ user/đơn hàng)
CREATE TABLE IF NOT EXISTS license_issues (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  license_key TEXT NOT NULL,
  term_days   INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_li_user  ON license_issues(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_li_order ON license_issues(order_id);
CREATE INDEX IF NOT EXISTS idx_li_key   ON license_issues(license_key);
