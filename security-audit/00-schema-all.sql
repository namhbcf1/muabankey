-- Tập hợp toàn bộ schema (base + migrations) cho D1 local.
-- Chỉ dùng cho môi trường test cục bộ, KHÔNG deploy.

-- === base: db/schema.sql ===
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  full_name     TEXT,
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'user',
  status        TEXT NOT NULL DEFAULT 'active',
  balance       INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  ua         TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

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

CREATE TABLE IF NOT EXISTS products (
  id             TEXT PRIMARY KEY,
  slug           TEXT NOT NULL UNIQUE,
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  short_desc     TEXT,
  description    TEXT,
  image_url      TEXT,
  badge          TEXT,
  price          INTEGER NOT NULL DEFAULT 0,
  compare_price  INTEGER,
  delivery_type  TEXT NOT NULL DEFAULT 'key',
  stock_count    INTEGER NOT NULL DEFAULT 0,
  sold_count     INTEGER NOT NULL DEFAULT 0,
  rating         REAL NOT NULL DEFAULT 5,
  rating_count   INTEGER NOT NULL DEFAULT 0,
  warranty_days  INTEGER NOT NULL DEFAULT 0,
  duration_label TEXT,
  features       TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  featured       INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  license_prefix TEXT,
  license_days   INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_products_cat ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products(slug);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active, sort_order);

CREATE TABLE IF NOT EXISTS product_keys (
  id           TEXT PRIMARY KEY,
  product_id   TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  secret       TEXT NOT NULL,
  note         TEXT,
  status       TEXT NOT NULL DEFAULT 'available',
  order_id     TEXT,
  delivered_at INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_keys_product_status ON product_keys(product_id, status);
CREATE INDEX IF NOT EXISTS idx_keys_order ON product_keys(order_id);

CREATE TABLE IF NOT EXISTS orders (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL UNIQUE,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  subtotal     INTEGER NOT NULL DEFAULT 0,
  discount     INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  coupon_code  TEXT,
  payment_method TEXT NOT NULL DEFAULT 'wallet',
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
  delivered_keys TEXT
);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  amount      INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  status      TEXT NOT NULL DEFAULT 'success',
  reference   TEXT,
  description TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_user ON wallet_transactions(user_id, created_at);

CREATE TABLE IF NOT EXISTS topups (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  provider   TEXT NOT NULL DEFAULT 'sepay',
  txn_ref    TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at    INTEGER,
  notified_at INTEGER,
  tg_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_topups_code ON topups(code);
CREATE INDEX IF NOT EXISTS idx_topups_user ON topups(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_topups_pending ON topups(status, created_at DESC);

CREATE TABLE IF NOT EXISTS coupons (
  id          TEXT PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  type        TEXT NOT NULL DEFAULT 'percent',
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

CREATE TABLE IF NOT EXISTS reviews (
  id         TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL,
  comment    TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id, created_at);

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

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  key        TEXT NOT NULL,
  window_at  INTEGER NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_at)
);

-- === migration: username ===
ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- === migration v2: license_issues ===
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

-- === license server ===
CREATE TABLE IF NOT EXISTS licenses (
  key          TEXT PRIMARY KEY,
  hwid         TEXT,
  plan         TEXT NOT NULL DEFAULT 'aoe1',
  note         TEXT,
  created_at   INTEGER NOT NULL,
  activated_at INTEGER,
  expires_at   INTEGER NOT NULL DEFAULT 0,
  last_seen    INTEGER,
  last_ip      TEXT,
  revoked      INTEGER NOT NULL DEFAULT 0,
  max_rebind   INTEGER NOT NULL DEFAULT 1,
  rebinds      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_lic_expires ON licenses(expires_at);
CREATE INDEX IF NOT EXISTS idx_lic_hwid    ON licenses(hwid);
CREATE INDEX IF NOT EXISTS idx_lic_created ON licenses(created_at);

CREATE TABLE IF NOT EXISTS lic_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  key    TEXT NOT NULL,
  hwid   TEXT,
  kind   TEXT NOT NULL,
  detail TEXT,
  ip     TEXT,
  at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_licev_key ON lic_events(key, at DESC);

CREATE TABLE IF NOT EXISTS lic_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_licatt_ip ON lic_attempts(ip, at);

-- === rebind tokens ===
CREATE TABLE IF NOT EXISTS rebind_tokens (
  token_hash TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rt_key ON rebind_tokens(key, expires_at);
CREATE INDEX IF NOT EXISTS idx_rt_user ON rebind_tokens(user_id, created_at);

-- === install tokens ===
CREATE TABLE IF NOT EXISTS install_tokens (
  token_hash TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_it_key ON install_tokens(key, expires_at);
CREATE INDEX IF NOT EXISTS idx_it_user ON install_tokens(user_id, created_at);

-- === trial ===
CREATE TABLE IF NOT EXISTS trial_grants (
  weak_hwid   TEXT PRIMARY KEY,
  lic_key     TEXT NOT NULL,
  hwid        TEXT NOT NULL,
  ip_first    TEXT,
  ua_first    TEXT,
  first_at    INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  resume_count INTEGER NOT NULL DEFAULT 0,
  last_at     INTEGER,
  converted_key TEXT,
  converted_at  INTEGER,
  suspect     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tg_ip   ON trial_grants(ip_first, first_at);
CREATE INDEX IF NOT EXISTS idx_tg_hwid ON trial_grants(hwid);
CREATE INDEX IF NOT EXISTS idx_tg_exp  ON trial_grants(expires_at);

CREATE TABLE IF NOT EXISTS trial_attempts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  weak    TEXT,
  hwid    TEXT,
  ip      TEXT,
  action  TEXT NOT NULL,
  detail  TEXT,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ta_weak ON trial_attempts(weak, at DESC);
CREATE INDEX IF NOT EXISTS idx_ta_ip   ON trial_attempts(ip, at DESC);
CREATE INDEX IF NOT EXISTS idx_ta_at   ON trial_attempts(at);

CREATE TABLE IF NOT EXISTS banned_devices (
  weak_hwid  TEXT PRIMARY KEY,
  reason     TEXT,
  banned_at  INTEGER NOT NULL,
  banned_by  TEXT
);
