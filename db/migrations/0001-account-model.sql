-- ===========================================================================
-- 0001 — GỘP HAI BẢNG CỦA MÔ HÌNH MỚI VÀO SCHEMA CHUẨN
--
-- VÌ SAO CẦN (F08 trong kế hoạch):
--   `db/schema.sql` được sinh từ production TRƯỚC khi mô hình quyền theo tài
--   khoản ra đời, nên nó KHÔNG có `account_entitlements` và `trial_accounts`.
--   Hai bảng đó chỉ tồn tại trong hai file migrate rời:
--     db/migrate-account-entitlements.sql
--     db/migrate-trial-account.sql
--
--   Hệ quả thật: dựng một môi trường mới (staging, DR, máy dev) bằng
--   `npm run db:migrate` (chỉ chạy schema.sql) sẽ ra một CSDL THIẾU hai bảng
--   quan trọng nhất. Mọi truy vấn quyền đều bị `catch {}` nuốt và trả về
--   "khách không có quyền" — app khoá sạch khách đã trả tiền, mà log không
--   có lỗi nào vì lỗi đã bị nuốt.
--
-- File này là migration ĐÁNH SỐ, chạy được trên CSDL đã có dữ liệu.
-- Idempotent: mọi câu đều IF NOT EXISTS.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS account_entitlements (
  user_id     TEXT NOT NULL,
  feature     TEXT NOT NULL,             -- 'nofog' | 'grant'
  expires_at  INTEGER NOT NULL,          -- unix GIÂY, 0 = vĩnh viễn
  source      TEXT NOT NULL DEFAULT 'purchase',
  order_id    TEXT,
  note        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, feature)
);

CREATE INDEX IF NOT EXISTS idx_acc_ent_exp ON account_entitlements(expires_at);
CREATE INDEX IF NOT EXISTS idx_acc_ent_order ON account_entitlements(order_id);

CREATE TABLE IF NOT EXISTS trial_accounts (
  user_id     TEXT PRIMARY KEY,
  state       TEXT NOT NULL DEFAULT 'active',
  created_at  INTEGER NOT NULL,
  started_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  ended_at    INTEGER,
  end_reason  TEXT,
  hwid        TEXT,
  device_weak TEXT,
  ip          TEXT,
  ua          TEXT,
  nofog_key   TEXT,
  grant_key   TEXT,
  rebinds     INTEGER NOT NULL DEFAULT 0,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trial_acc_exp  ON trial_accounts(expires_at);
CREATE INDEX IF NOT EXISTS idx_trial_acc_weak ON trial_accounts(device_weak);
