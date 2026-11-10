-- ============================================================
-- Cập nhật thông tin ngân hàng thật + hỗ trợ username
-- ============================================================

-- 1. Thông tin ngân hàng
INSERT INTO settings (key, value, updated_at) VALUES
  ('bank_name',    'MBBank',            CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('bank_account', '8990124112002',     CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('bank_owner',   'NGUYEN THANH NAM',  CAST(strftime('%s','now') AS INTEGER) * 1000)
ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;

-- 2. Cột username để đăng nhập không cần email
ALTER TABLE users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- 3. Đổi tài khoản admin sang namhbcf
UPDATE users
SET username  = 'namhbcf',
    full_name = 'Nguyen Thanh Nam',
    updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE id = 'u-admin';

-- 4. Username cho tài khoản demo (giữ nguyên mật khẩu cũ)
UPDATE users SET username = 'demo' WHERE id = 'u-demo' AND username IS NULL;
