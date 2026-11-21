-- ===========================================================================
-- MuaBanKey - SCHEMA HIEN HANH (sinh tu production, khong con migration le)
-- Database: muabankey-db (81f478c9-5627-458a-a35f-d483e69d400b)
-- Sinh ngay: 2026-11-20 08:18:35
--
-- Dung lai tu dau:
--   npx wrangler d1 execute muabankey-db --remote --file=db/schema.sql --yes
--
-- ===========================================================================
-- QUAN TRONG — DOC TRUOC KHI DUNG
--
-- File nay la ANH CHUP schema NEN (legacy baseline) va CO Y bo trong ba bang
-- cua mo hinh hien hanh:
--
--     account_entitlements      quyen theo tai khoan (nguon su that)
--     trial_accounts            luot dung thu theo tai khoan
--     entitlement_grants        so cap quyen bat bien
--     payment_inbox             chung tu tien vao ben vung
--     schema_migrations         phien ban da chay
--
-- Chung nam trong db/migrations/*.sql va PHAI chay kem:
--
--     node db/migrate.mjs --sqlite <duong-dan>     (kiem thu / SQLite)
--     npx wrangler d1 execute muabankey-db --remote --file=db/migrations/NNNN-*.sql
--
-- Hoac dung script `npm run db:setup` (xem package.json) de chay dung thu tu.
-- Neu chi chay file nay, CSDL moi se THIEU cac bang tren: moi truy van quyen
-- deu loi va bi `catch {}` nuot -> app bao "khach khong co quyen" cho ca khach
-- da tra tien, ma log khong co loi nao.
-- ===========================================================================

PRAGMA foreign_keys = OFF;

CREATE TABLE account_devices (
  user_id      TEXT    NOT NULL,
  scope        TEXT    NOT NULL DEFAULT 'nofog',
  active_hwid  TEXT    NOT NULL,
  active_since INTEGER NOT NULL,
  last_seen    INTEGER NOT NULL,
  last_key     TEXT,
  last_ip      TEXT,
  moves        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, scope)
);

CREATE TABLE audit_logs (
  id         TEXT PRIMARY KEY,
  actor_id   TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  meta       TEXT,
  ip         TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE banned_devices (
  weak_hwid  TEXT PRIMARY KEY,
  reason     TEXT,
  banned_at  INTEGER NOT NULL,
  banned_by  TEXT
);

CREATE TABLE categories (
  id          TEXT PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE TABLE coupons (
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

CREATE TABLE install_tokens (
  token_hash TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE lic_attempts (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE lic_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  key    TEXT NOT NULL,
  hwid   TEXT,
  kind   TEXT NOT NULL,
  detail TEXT,
  ip     TEXT,
  at     INTEGER NOT NULL
);

CREATE TABLE license_issues (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  product_id  TEXT NOT NULL,
  license_key TEXT NOT NULL,
  term_days   INTEGER NOT NULL DEFAULT 0,
  expires_at  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE licenses (
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
, reset_pending INTEGER NOT NULL DEFAULT 0, reset_at INTEGER, source TEXT, pid TEXT, grace_h INTEGER NOT NULL DEFAULT 0, gate TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT '', app TEXT NOT NULL DEFAULT '', rebind_until INTEGER, bind_hwid INTEGER);

CREATE TABLE order_items (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    TEXT NOT NULL,
  product_name  TEXT NOT NULL,
  unit_price    INTEGER NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  line_total    INTEGER NOT NULL,
  delivered_keys TEXT
);

CREATE TABLE orders (
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
, refund_started_at INTEGER, processing_started_at INTEGER, ledger_written INTEGER NOT NULL DEFAULT 0, coupon_released INTEGER NOT NULL DEFAULT 0, qr_expires_at INTEGER, confirmed_by TEXT, admin_note TEXT, telegram_msg TEXT, reminded_at INTEGER);

CREATE TABLE payments (
  id            TEXT PRIMARY KEY,
  order_id      TEXT,
  order_code    TEXT,
  amount        INTEGER NOT NULL,
  expected      INTEGER,
  method        TEXT NOT NULL,
  txn_ref       TEXT,
  content       TEXT,
  state         TEXT NOT NULL,
  confirmed_by  TEXT,
  telegram_msg  TEXT,
  raw           TEXT,
  at            INTEGER NOT NULL
, is_test INTEGER NOT NULL DEFAULT 0);

CREATE TABLE products (
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
  updated_at     INTEGER NOT NULL
, license_prefix TEXT, license_days   INTEGER NOT NULL DEFAULT 0);

CREATE TABLE rate_limits (
  key        TEXT NOT NULL,
  window_at  INTEGER NOT NULL,
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (key, window_at)
);

CREATE TABLE rebind_tokens (
  token_hash TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE refund_ledger (
  order_id    TEXT PRIMARY KEY,
  amount      INTEGER NOT NULL,
  user_id     TEXT,
  order_code  TEXT,
  state       TEXT NOT NULL DEFAULT 'pending',
  revoked     INTEGER NOT NULL DEFAULT 0,
  claim_token TEXT,
  source      TEXT,
  actor       TEXT,
  at          INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT,
  ua         TEXT
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE topups (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount     INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending',
  provider   TEXT NOT NULL DEFAULT 'sepay',
  txn_ref    TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  paid_at    INTEGER
, notified_at INTEGER, tg_message_id INTEGER);

CREATE TABLE trial_attempts (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  weak    TEXT,
  hwid    TEXT,
  ip      TEXT,
  action  TEXT NOT NULL,
  detail  TEXT,
  at      INTEGER NOT NULL
);

CREATE TABLE trial_bans (
  scope   TEXT NOT NULL,
  value   TEXT NOT NULL,
  reason  TEXT,
  at      INTEGER NOT NULL,
  by      TEXT,
  PRIMARY KEY (scope, value)
);

CREATE TABLE trial_grants (
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

CREATE TABLE trial_quota (
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  used          INTEGER NOT NULL DEFAULT 0,
  quota         INTEGER NOT NULL DEFAULT 10,
  reset_count   INTEGER NOT NULL DEFAULT 0,
  last_reset_at INTEGER,
  reset_by      TEXT,
  banned_at     INTEGER,
  banned_reason TEXT,
  converted_at  INTEGER,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind)
);

CREATE TABLE trial_quota_hw (
  hwid       TEXT NOT NULL,
  kind       TEXT NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  quota      INTEGER NOT NULL DEFAULT 10,
  reset_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (hwid, kind)
);

CREATE TABLE trial_resets (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kinds      TEXT NOT NULL,
  reason     TEXT NOT NULL,
  before_json TEXT NOT NULL,
  after_json TEXT NOT NULL,
  revoked_keys TEXT,
  admin_id   TEXT NOT NULL,
  admin_name TEXT,
  at         INTEGER NOT NULL
);

CREATE TABLE "trial_uses" (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  kind          TEXT NOT NULL,
  lic_key       TEXT NOT NULL,
  hwid          TEXT,
  device_weak   TEXT,
  ip            TEXT,
  ua            TEXT,
  started_at    INTEGER,
  expires_at    INTEGER NOT NULL,
  ended_at      INTEGER,
  end_reason    TEXT,
  idem_key      TEXT UNIQUE,
  converted_key TEXT,
  created_at    INTEGER NOT NULL
);

CREATE TABLE trial_whitelist (
  scope      TEXT NOT NULL,
  value      TEXT NOT NULL,
  note       TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  PRIMARY KEY (scope, value)
);

CREATE TABLE users (
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
, username TEXT);

CREATE TABLE wallet_transactions (
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

CREATE TABLE xg_events (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  key    TEXT,
  hwid   TEXT,
  sid    TEXT,
  kind   TEXT NOT NULL,
  detail TEXT,
  ip     TEXT,
  at     INTEGER NOT NULL
);

CREATE TABLE xg_nonce (
  nonce   TEXT PRIMARY KEY,
  key     TEXT,
  at      INTEGER NOT NULL
);

CREATE TABLE xg_session (
  sid        TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  hwid       TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  ua         TEXT,
  fp         TEXT,
  created_at INTEGER NOT NULL,
  last_at    INTEGER NOT NULL,
  revoked    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE xg_viol (
  key      TEXT PRIMARY KEY,
  n        INTEGER NOT NULL DEFAULT 0,
  last_at  INTEGER NOT NULL
);

-- ---------- INDEX ----------
CREATE INDEX idx_acctdev_hwid ON account_devices(active_hwid);
CREATE INDEX idx_audit_created ON audit_logs(created_at);
CREATE INDEX idx_it_key ON install_tokens(key, expires_at);
CREATE INDEX idx_it_user ON install_tokens(user_id, created_at);
CREATE INDEX idx_li_key   ON license_issues(license_key);
CREATE INDEX idx_li_order ON license_issues(order_id);
CREATE INDEX idx_li_order_key ON license_issues(order_id, license_key);
CREATE INDEX idx_li_user  ON license_issues(user_id, created_at);
CREATE INDEX idx_lic_created ON licenses(created_at);
CREATE INDEX idx_lic_expires ON licenses(expires_at);
CREATE INDEX idx_lic_hwid    ON licenses(hwid);
CREATE INDEX idx_lic_pid ON licenses(pid);
CREATE INDEX idx_lic_reset_pending ON licenses(reset_pending);
CREATE INDEX idx_lic_source ON licenses(source);
CREATE INDEX idx_lic_source_plan ON licenses(source, plan);
CREATE INDEX idx_licatt_ip ON lic_attempts(ip, at);
CREATE INDEX idx_licev_key ON lic_events(key, at DESC);
CREATE INDEX idx_ord_pending_pay
  ON orders(status, created_at DESC) WHERE status = 'pending';
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_orders_code ON orders(code);
CREATE INDEX idx_orders_coupon_released ON orders(coupon_code, coupon_released);
CREATE INDEX idx_orders_processing_started
  ON orders(status, processing_started_at);
CREATE INDEX idx_orders_refund_started
  ON orders(status, refund_started_at);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_status_created ON orders(status, created_at, total);
CREATE INDEX idx_orders_user ON orders(user_id, created_at);
CREATE INDEX idx_pay_at      ON payments(at);
CREATE INDEX idx_pay_code    ON payments(order_code);
CREATE INDEX idx_pay_order   ON payments(order_id);
CREATE INDEX idx_pay_state   ON payments(state, at DESC);
CREATE INDEX idx_pay_test ON payments(is_test, at);
CREATE INDEX idx_pay_txn     ON payments(txn_ref);
CREATE INDEX idx_products_active ON products(active, sort_order);
CREATE INDEX idx_products_cat ON products(category_id);
CREATE INDEX idx_products_slug ON products(slug);
CREATE INDEX idx_refund_ledger_state ON refund_ledger(state, at DESC);
CREATE INDEX idx_refund_ledger_user  ON refund_ledger(user_id, at DESC);
CREATE INDEX idx_rt_key ON rebind_tokens(key, expires_at);
CREATE INDEX idx_rt_user ON rebind_tokens(user_id, created_at);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_ta_at   ON trial_attempts(at);
CREATE INDEX idx_ta_ip   ON trial_attempts(ip, at DESC);
CREATE INDEX idx_ta_weak ON trial_attempts(weak, at DESC);
CREATE INDEX idx_tg_exp  ON trial_grants(expires_at);
CREATE INDEX idx_tg_hwid ON trial_grants(hwid);
CREATE INDEX idx_tg_ip   ON trial_grants(ip_first, first_at);
CREATE INDEX idx_topups_code ON topups(code);
CREATE INDEX idx_topups_pending
  ON topups(status, created_at DESC);
CREATE INDEX idx_topups_txnref ON topups(txn_ref);
CREATE INDEX idx_topups_user ON topups(user_id, created_at);
CREATE INDEX idx_tq_kind ON trial_quota(kind, used);
CREATE INDEX idx_tres_admin ON trial_resets(admin_id, at DESC);
CREATE INDEX idx_tres_user  ON trial_resets(user_id, at DESC);
CREATE INDEX idx_trial_quota_hw_kind
  ON trial_quota_hw(kind, updated_at);
CREATE INDEX idx_tu_exp  ON trial_uses(expires_at);
CREATE INDEX idx_tu_ip   ON trial_uses(ip, created_at DESC);
CREATE INDEX idx_tu_key  ON trial_uses(lic_key);
CREATE INDEX idx_tu_user ON trial_uses(user_id, kind, created_at DESC);
CREATE INDEX idx_tu_weak ON trial_uses(device_weak, kind);
CREATE INDEX idx_twl_scope ON trial_whitelist(scope);
CREATE INDEX idx_users_email ON users(email);
CREATE UNIQUE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;
CREATE INDEX idx_wallet_user ON wallet_transactions(user_id, created_at);
CREATE INDEX idx_xge_key ON xg_events(key, at DESC);
CREATE INDEX idx_xgn_at ON xg_nonce(at);
CREATE INDEX idx_xgs_key ON xg_session(key, last_at DESC);
CREATE UNIQUE INDEX ux_pay_txn ON payments(txn_ref) WHERE txn_ref IS NOT NULL;

PRAGMA foreign_keys = ON;
