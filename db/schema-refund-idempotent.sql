-- ============================================================
-- MIGRATION: Hoàn tiền IDEMPOTENT (chống hoàn trùng ở tầng DB)
--
-- LỖI ĐANG VÁ — Lỗi 4: hoàn tiền không idempotent + cron hồi sinh đơn
--
--   adminRefund claim 'paid'|'delivered' -> 'refunding' (nguyên tử, tốt),
--   rồi CỘNG TIỀN, rồi mới đặt 'refunded'. Không có gì chống hoàn trùng.
--   Worker chết giữa chừng (CPU limit 30s, nhiều await tuần tự khi thu hồi
--   key/license) -> đơn kẹt 'refunding' NHƯNG TIỀN ĐÃ CỘNG. Cron đưa đơn
--   'refunding' quá hạn về 'paid' -> admin thấy lại nút "Hoàn" -> hoàn lần 2.
--
--   ĐÃ XẢY RA THẬT: MBK-L5W87H hoàn 70.000đ hai lần.
--
--   Bug tái diễn vì đường Telegram (nút bấm trong chat) được vá riêng và
--   bị bỏ sót so với đường web. Nay CẢ HAI đường cùng đi qua refund_ledger.
--
-- NGUYÊN TẮC THIẾT KẾ
--   * refund_ledger là NGUỒN SỰ THẬT DUY NHẤT cho câu hỏi "đơn này đã được
--     hoàn tiền chưa". PRIMARY KEY trên order_id nên mỗi đơn chỉ có TỐI ĐA
--     MỘT dòng, mãi mãi.
--   * orders.status chỉ là thứ phụ: nó có thể bị cron, sửa tay, hay crash
--     làm sai. Guard tiền PHẢI dựa vào sổ, KHÔNG dựa vào status.
--   * state='pending' = CHƯA cộng tiền (crash trước bước cộng ví)
--     state='done'    = ĐÃ cộng tiền   (cộng ví + ghi sổ cái + chốt sổ nằm
--                                       trong CÙNG một env.DB.batch)
--     Nhờ vậy không tồn tại trạng thái "đã cộng tiền nhưng sổ ghi pending"
--     -> cron phân biệt được đơn kẹt TRƯỚC hay SAU khi cộng tiền.
--
-- FILE NÀY IDEMPOTENT: chạy lại nhiều lần không lỗi, không mất dữ liệu.
-- ============================================================

PRAGMA foreign_keys = ON;

-- ============================================================
-- SỔ HOÀN TIỀN — chống hoàn trùng
-- ============================================================
-- KHÔNG đặt FK tới orders(id) có chủ đích: sổ tiền phải sống độc lập với
-- đơn hàng. Nếu ai đó xoá đơn, dấu vết "đã hoàn tiền" PHẢI còn lại — nếu
-- không thì xoá đơn = xoá luôn bằng chứng chống hoàn trùng.
CREATE TABLE IF NOT EXISTS refund_ledger (
  order_id    TEXT PRIMARY KEY,                 -- PK = chống hoàn trùng ở tầng DB
  amount      INTEGER NOT NULL,                 -- số tiền hoàn (VND)
  user_id     TEXT,                             -- người nhận tiền
  order_code  TEXT,                             -- mã đơn để đối soát bằng mắt
  state       TEXT NOT NULL DEFAULT 'pending',  -- pending = CHƯA cộng ví | done = ĐÃ cộng ví
  revoked     INTEGER NOT NULL DEFAULT 0,       -- số license + key đã thu hồi
  claim_token TEXT,                             -- token của lượt THẮNG khi cộng tiền
  source      TEXT,                             -- 'web' | 'telegram' — vá CẢ HAI đường
  actor       TEXT,                             -- admin id / tên người bấm nút
  at          INTEGER NOT NULL                  -- thời điểm ghi sổ (ms)
);

CREATE INDEX IF NOT EXISTS idx_refund_ledger_state ON refund_ledger(state, at DESC);
CREATE INDEX IF NOT EXISTS idx_refund_ledger_user  ON refund_ledger(user_id, at DESC);

-- ============================================================
-- ĐỐI SOÁT SAU KHI CHẠY MIGRATION
-- ============================================================
-- a) Sổ cái ví phải khớp số dư: mỗi user SUM(amount) = users.balance
--    SELECT u.id, u.balance, COALESCE(SUM(w.amount),0) AS so_cai,
--           u.balance - COALESCE(SUM(w.amount),0) AS lech
--      FROM users u LEFT JOIN wallet_transactions w
--        ON w.user_id = u.id AND w.status = 'success'
--     GROUP BY u.id HAVING lech <> 0;
--
-- b) Đơn 'refunding'/'refund_stuck' tồn đọng ngay sau migration (dữ liệu cũ):
--    SELECT o.id, o.code, o.status, o.total, l.state, l.amount
--      FROM orders o LEFT JOIN refund_ledger l ON l.order_id = o.id
--     WHERE o.status IN ('refunding','refund_stuck');
--      -> state NULL / 'pending' : CHƯA cộng tiền -> hoàn tiếp được (an toàn)
--      -> state 'done'           : ĐÃ cộng tiền   -> KHÔNG hoàn nữa
--
-- c) Sau khi vá, cron tự chốt đơn 'refunding' có sổ 'done' thành 'refunded',
--    và đẩy các đơn còn lại sang 'refund_stuck' để admin đối soát tay.
