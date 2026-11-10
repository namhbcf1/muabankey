-- ============================================================
-- MuaBanKey — Cloudflare D1 Schema
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- Người dùng ----------
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name     TEXT,
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'user',      -- user | staff | admin
  status        TEXT NOT NULL DEFAULT 'active',    -- active | locked
  balance       INTEGER NOT NULL DEFAULT 0,        -- VND
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- ---------- Phiên đăng nhập ----------
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- ---------- Danh mục ----------
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- ---------- Sản phẩm ----------
CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  short_desc     TEXT,
  description    TEXT,
  image_url      TEXT,
  badge          TEXT,                              -- HOT | NEW | SALE | null
  price          INTEGER NOT NULL DEFAULT 0,        -- VND
  compare_price  INTEGER,                           -- giá gốc để gạch
  delivery_type  TEXT NOT NULL DEFAULT 'key',       -- key | account | file | manual
  stock_count    INTEGER NOT NULL DEFAULT 0,
  sold_count     INTEGER NOT NULL DEFAULT 0,
  rating         REAL NOT NULL DEFAULT 5,
  rating_count   INTEGER NOT NULL DEFAULT 0,
  warranty_days  INTEGER NOT NULL DEFAULT 0,
  duration_label TEXT,                              -- "1 năm", "Vĩnh viễn"
  features       TEXT,                              -- JSON array string
  active         INTEGER NOT NULL DEFAULT 1,
  featured       INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active, sort_order);

-- ---------- Kho key ----------
CREATE TABLE IF NOT EXISTS product_keys (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  secret       TEXT NOT NULL,                -- key / tài khoản (mã hoá base64 + che)
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'available',  -- available | reserved | sold | disabled
  order_id     TEXT,
  delivered_at INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keys_product_status ON product_keys(product_id, status);
CREATE INDEX IF NOT EXISTS idx_keys_order ON product_keys(order_id);

-- ---------- Đơn hàng ----------
CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | delivered | cancelled | refunded
  subtotal     INTEGER NOT NULL DEFAULT 0,
  discount     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  coupon_code  TEXT,
  payment_method TEXT NOT NULL DEFAULT 'wallet',  -- wallet | sepay | manual
  payment_ref  TEXT,
  note         TEXT,
  created_at   INTEGER NOT NULL,
  paid_at      INTEGER,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(code);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL,
  product_name  TEXT NOT NULL,
  unit_price    INTEGER NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  line_total    INTEGER NOT NULL,
  delivered_keys TEXT                            -- JSON array
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

-- ---------- Giao dịch ví ----------
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,                     -- topup | purchase | refund | admin_credit | admin_debit
  amount      INTEGER NOT NULL,                  -- dương = cộng, âm = trừ
  balance_after INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'success',   -- pending | success | failed
  reference   TEXT,                              -- mã chuyển khoản / order code
  description TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id, created_at);

-- ---------- Mã nạp tiền (VietQR) ----------
CREATE TABLE IF NOT EXISTS topups (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,               -- nội dung CK: NAP + code
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',    -- pending | paid | expired | cancelled
  provider   TEXT NOT NULL DEFAULT 'sepay',
  txn_ref    TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_topups_code ON topups(code);
CREATE INDEX IF NOT EXISTS idx_topups_user ON topups(user_id, created_at);

-- ---------- Mã giảm giá ----------
CREATE TABLE IF NOT EXISTS coupons (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'percent',   -- percent | fixed
  value       INTEGER NOT NULL,
  min_subtotal INTEGER NOT NULL DEFAULT 0,
  max_discount INTEGER,
  usage_limit INTEGER,
  used_count  INTEGER NOT NULL DEFAULT 0,
  starts_at   INTEGER,
  expires_at  INTEGER,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

-- ---------- Đánh giá ----------
CREATE TABLE IF NOT EXISTS reviews (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL,
  comment    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, created_at);

-- ---------- Nhật ký kiểm toán ----------
CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  meta       TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ---------- Cấu hình site ----------
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL
);

-- ---------- Rate limit (fallback D1) ----------
CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT NOT NULL,
  window_at  INTEGER NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_at)
);
