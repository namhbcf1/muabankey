-- Đánh dấu giao dịch TEST để không tính vào hạn mức 50 GD/tháng của SePay
ALTER TABLE payments ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;

-- Backfill: các giao dịch test đã có
UPDATE payments SET is_test = 1
WHERE method = 'sepay' AND (
  txn_ref LIKE 'TEST%' OR txn_ref LIKE 'PROBE%' OR
  txn_ref LIKE 'SHORT%' OR txn_ref LIKE 'TOPUP%' OR
  txn_ref LIKE 'OVER%'  OR txn_ref LIKE 'TWICE%' OR
  txn_ref LIKE 'MULTI%' OR txn_ref LIKE 'OUT%'   OR
  txn_ref LIKE 'WRONGACC%' OR txn_ref LIKE 'NOMATCH%' OR
  txn_ref LIKE 'SAME%'  OR txn_ref LIKE 'TWO%'   OR
  txn_ref LIKE 'AGAIN%' OR txn_ref LIKE 'EXP%'   OR
  txn_ref LIKE 'CAN%'   OR txn_ref LIKE 'OOS%'   OR
  txn_ref LIKE 'APPROVE%' OR txn_ref LIKE 'E2E%' OR
  content LIKE 'KHONGCO%' OR content LIKE 'CHUYENKHOANBINHTHUONG%'
);

CREATE INDEX IF NOT EXISTS idx_pay_test ON payments(is_test, at);
