-- ===========================================================================
-- HỘP THƯ TIỀN VÀO BỀN VỮNG (payment_inbox)
--
-- VÌ SAO CẦN: webhook ngân hàng là NGUỒN TIỀN DUY NHẤT không thể lấy lại.
-- Nếu webhook trả 200 mà chưa ghi được gì vào sổ, provider coi như xong và
-- KHÔNG BAO GIỜ gửi lại. Tiền đã vào tài khoản ngân hàng của shop nhưng hệ
-- thống không có dấu vết nào -> khách không được giao và admin không biết.
--
-- Bản cũ có đúng lỗ hổng này ở nhiều nhánh:
--   * đơn đã 'delivered' -> `return` TRƯỚC khi ghi `payments`
--     (payments.js:464 — giao dịch thứ hai sau khi giao không vào sổ);
--   * đơn đã 'paid' -> `deliverAndFinish` trước khi kiểm txn_ref;
--   * nhánh ngoài cửa sổ giờ / nhánh không khớp đơn -> `catch {}` nuốt lỗi
--     ghi sổ nhưng vẫn trả 200 cho provider.
--
-- NAY: mọi webhook phải INSERT vào bảng này TRƯỚC, trong một câu lệnh duy
-- nhất với UNIQUE(provider, transaction_id). Ghi được = tiền đã có chứng từ
-- bền vững, sau đó mới xử lý khớp đơn. Ghi không được = trả lỗi retryable để
-- provider gửi lại.
--
-- Bảng APPEND-ONLY: không xoá dòng. Cột `state` chỉ tiến theo một chiều.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS payment_inbox (
  id              TEXT PRIMARY KEY,
  provider        TEXT NOT NULL,              -- sepay | payos
  transaction_id  TEXT NOT NULL,              -- mã giao dịch phía provider
  account_number  TEXT,
  amount          INTEGER NOT NULL,
  content         TEXT,
  transfer_type   TEXT,                       -- in | out
  is_test         INTEGER NOT NULL DEFAULT 0,
  state           TEXT NOT NULL DEFAULT 'received',
      -- received        : đã ghi, chưa xử lý
      -- matched         : gắn được đơn
      -- unmatched       : không tìm ra đơn
      -- wrong_amount    : có đơn nhưng thiếu tiền
      -- wrong_account   : sai tài khoản nhận
      -- ignored         : tiền ra / rác
  order_id        TEXT,
  order_code      TEXT,
  deliver_state   TEXT NOT NULL DEFAULT 'none',
      -- none | delivered | pending_manual | failed
  raw             TEXT,
  received_at     INTEGER NOT NULL,
  processed_at    INTEGER,
  attempts        INTEGER NOT NULL DEFAULT 0,
  note            TEXT
);

-- LỚP CHỐNG REPLAY Ở TẦNG DB: một giao dịch của provider chỉ được ghi MỘT
-- lần, mãi mãi. Đây là thứ duy nhất chặn được hai webhook đồng thời.
CREATE UNIQUE INDEX IF NOT EXISTS ux_payment_inbox_txn
  ON payment_inbox(provider, transaction_id);

CREATE INDEX IF NOT EXISTS idx_payment_inbox_state
  ON payment_inbox(state, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_inbox_order
  ON payment_inbox(order_id, received_at DESC);

-- Khoản tiền chưa gắn được đơn: admin phải thấy để đối soát tay.
CREATE INDEX IF NOT EXISTS idx_payment_inbox_unmatched
  ON payment_inbox(state, received_at DESC)
  WHERE state IN ('unmatched', 'wrong_amount', 'wrong_account');
