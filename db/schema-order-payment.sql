-- ============================================================
-- CHUYỂN SANG THANH TOÁN THEO ĐƠN (bỏ ví/nạp tiền)
--
-- YÊU CẦU CHỦ SHOP:
--   "không nạp tiền vào hệ thống. khách quét QR tự sinh QR theo giá
--    sản phẩm, nội dung cũng sinh theo. xong xác nhận trong telegram
--    rồi giao key cho khách chứ không nhận nạp và giữ tiền."
--
-- LUỒNG MỚI:
--   Đơn tạo -> QR sinh theo ĐƠN (số tiền = total, nội dung = mã đơn)
--   -> Khách quét CK -> SePay webhook hoặc admin bấm Telegram
--   -> Giao key -> Khách nhận ngay trên web
--
-- BẢNG MỚI: payments (sổ ghi từng lần tiền vào, thay wallet_transactions)
-- ============================================================

-- Sổ thanh toán THEO ĐƠN. Khác wallet_transactions (sổ ví):
--   - Mỗi dòng ứng với 1 đơn hoặc 1 lần CK dư
--   - Không có "số dư" — tiền vào thẳng ngân hàng shop
CREATE TABLE IF NOT EXISTS payments (
  id            TEXT PRIMARY KEY,
  order_id      TEXT,                       -- NULL nếu CK không khớp đơn nào
  order_code    TEXT,                       -- mã đơn (để tra ngược)
  amount        INTEGER NOT NULL,           -- số tiền thực nhận (VND)
  expected      INTEGER,                    -- số tiền đơn yêu cầu
  method        TEXT NOT NULL,              -- 'sepay' | 'payos' | 'manual'
  txn_ref       TEXT,                       -- mã giao dịch ngân hàng
  content       TEXT,                       -- nội dung CK khách ghi
  state         TEXT NOT NULL,              -- 'matched' | 'unmatched' | 'duplicate' | 'wrong_amount'
  confirmed_by  TEXT,                       -- 'webhook' | admin id
  telegram_msg  TEXT,                       -- message_id thông báo Telegram
  raw           TEXT,                       -- JSON gốc từ webhook (đối soát)
  at            INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pay_order   ON payments(order_id);
CREATE INDEX IF NOT EXISTS idx_pay_code    ON payments(order_code);
CREATE INDEX IF NOT EXISTS idx_pay_txn     ON payments(txn_ref);
/*
 * UNIQUE thật trên txn_ref — lớp chống replay webhook ở tầng DB.
 *
 * Code (payments.js) dựa vào ràng buộc này để bắt lỗi trùng khi INSERT; nếu
 * chỉ có index thường thì 2 webhook song song cùng mã giao dịch đều lọt qua
 * bước SELECT-then-INSERT (TOCTOU) và đơn bị giao 2 lần.
 * Production đã có index này (tên ux_pay_txn); file này phải khớp để dựng DB
 * mới cũng có cùng bảo vệ.
 */
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_txn ON payments(txn_ref) WHERE txn_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pay_state   ON payments(state, at DESC);
CREATE INDEX IF NOT EXISTS idx_pay_at      ON payments(at);

-- orders: cột phục vụ QR + xác nhận
-- payment_method: 'qr' (mặc định mới), 'wallet' (đơn cũ), 'manual'
-- payment_ref: mã CK/nội dung — ĐÃ CÓ, trước chưa dùng
-- paid_at: ĐÃ CÓ
ALTER TABLE orders ADD COLUMN qr_expires_at INTEGER;
ALTER TABLE orders ADD COLUMN confirmed_by TEXT;
ALTER TABLE orders ADD COLUMN admin_note TEXT;
ALTER TABLE orders ADD COLUMN telegram_msg TEXT;
ALTER TABLE orders ADD COLUMN reminded_at INTEGER;

-- Index cho việc quét đơn chờ CK
CREATE INDEX IF NOT EXISTS idx_ord_pending_pay
  ON orders(status, created_at DESC) WHERE status = 'pending';

-- ============================================================
-- ĐÁNH DẤU ĐƠN CŨ DÙNG VÍ (để báo cáo không lẫn)
-- ============================================================
UPDATE orders SET payment_method = 'wallet'
WHERE payment_method IS NULL OR payment_method = '';

-- ============================================================
-- KHÔNG XOÁ bảng topups / wallet_transactions / users.balance
-- Giữ lại để đối soát lịch sử. Code mới KHÔNG ghi vào nữa.
-- ============================================================
